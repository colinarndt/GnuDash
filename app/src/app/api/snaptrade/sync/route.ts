import { NextResponse } from "next/server";
import { getSnapTradeClient } from "@/lib/snaptrade/client";
import { getSnapTradeUser, getAuthorizations, updateAuthorizationSync } from "@/lib/snaptrade/storage";
import { transactionsToCsv } from "@/lib/snaptrade/csv";
import { upsertManyPrices } from "@/lib/prices/storage";
import type { SnapTradeHolding, SnapTradeTransaction, SnapTradeBalancePoint } from "@/lib/snaptrade/storage";
import { classifyNewTickers } from "@/lib/classifications/auto-classify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  authorization_id: string;
  account_id?: string;
  from_date?: string;
  to_date?: string;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.authorization_id) {
    return NextResponse.json({ error: "Missing authorization_id" }, { status: 400 });
  }

  const authorizations = await getAuthorizations();
  const auth = authorizations.find((a) => a.authorizationId === body.authorization_id);
  if (!auth) return NextResponse.json({ error: "Authorization not found" }, { status: 404 });

  // CSV download mode
  if (body.account_id) {
    let txns = auth.transactions[body.account_id] ?? [];
    if (body.from_date) txns = txns.filter((t) => t.date >= body.from_date!);
    if (body.to_date) txns = txns.filter((t) => t.date <= body.to_date!);
    const account = auth.accounts.find((a) => a.id === body.account_id);
    const name = account ? `${auth.brokerage}-${account.name}${account.number ? `-${account.number}` : ""}` : body.account_id;
    const filename = name.replace(/[^a-z0-9-]/gi, "_") + ".csv";
    return new Response(transactionsToCsv(txns), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  // Sync mode
  const user = await getSnapTradeUser();
  if (!user) return NextResponse.json({ error: "SnapTrade user not registered" }, { status: 400 });

  try {
    const client = getSnapTradeClient();
    const { userId, userSecret } = user;
    const holdings: Record<string, SnapTradeHolding[]> = {};
    const transactions: Record<string, SnapTradeTransaction[]> = {};
    const balances: Record<string, number | null> = {};
    const balanceHistory: Record<string, SnapTradeBalancePoint[]> = {};

    for (const account of auth.accounts) {
      const accountId = account.id;

      try {
        const { data: positions } = await client.accountInformation.getUserAccountPositions({ userId, userSecret, accountId });
        holdings[accountId] = ((positions as any[]) ?? []).map((p: any) => ({
          symbol: p.symbol?.symbol?.symbol ?? p.symbol?.description ?? "",
          description: p.symbol?.symbol?.description ?? null,
          quantity: p.units ?? 0,
          price: p.price ?? null,
          marketValue: p.price != null && p.units != null ? p.price * p.units : (p.market_value ?? null),
          costBasis: p.average_purchase_price != null ? p.average_purchase_price * (p.units ?? 0) : null,
          currency: p.currency?.code ?? "USD",
        }));
      } catch { holdings[accountId] = auth.holdings[accountId] ?? []; }

      try {
        const { data: acctBalances } = await client.accountInformation.getUserAccountBalance({ userId, userSecret, accountId });
        const balanceArr: any[] = (acctBalances as any[]) ?? [];
        const equity = balanceArr.find((b: any) => b.total_equity != null)?.total_equity ?? null;
        balances[accountId] = equity ?? (holdings[accountId].reduce((s, h) => s + (h.marketValue ?? 0), 0) || null);
      } catch { balances[accountId] = null; }

      try {
        // Use the non-deprecated account-level endpoint with full pagination.
        const PAGE = 1000;
        const allActivities: any[] = [];
        let offset = 0;
        while (true) {
          const { data: page } = await client.accountInformation.getAccountActivities({
            accountId, userId, userSecret,
            startDate: "2010-01-01",
            limit: PAGE,
            offset,
          });
          const rows: any[] = (page as any)?.data ?? [];
          allActivities.push(...rows);
          const total: number = (page as any)?.pagination?.total ?? rows.length;
          offset += rows.length;
          if (rows.length < PAGE || offset >= total) break;
        }
        transactions[accountId] = allActivities.map((t: any) => ({
          id: t.id,
          date: t.trade_date ?? t.settlement_date ?? "",
          type: t.type ?? "Unknown",
          symbol: t.symbol?.symbol?.symbol ?? t.symbol?.description ?? null,
          description: t.description ?? null,
          quantity: t.units ?? null,
          price: t.price ?? null,
          amount: t.amount ?? null,
          fee: t.fee ?? null,
          currency: t.currency?.code ?? "USD",
        }));
      } catch { transactions[accountId] = []; }

      try {
        const { data: hist } = await client.accountInformation.getAccountBalanceHistory({
          userId, userSecret, accountId,
        });
        const points: SnapTradeBalancePoint[] = ((hist as any)?.history ?? [])
          .map((h: any) => ({ date: String(h.date ?? "").slice(0, 10), value: parseFloat(h.total_value ?? "0") }))
          .filter((h: SnapTradeBalancePoint) => h.date && !isNaN(h.value));
        balanceHistory[accountId] = points;
      } catch { /* endpoint may be disabled (403) — skip silently */ }
    }

    await updateAuthorizationSync(auth.authorizationId, holdings, transactions, balances, balanceHistory);

    const symbols = [...new Set(Object.values(holdings).flat().map((h) => h.symbol))].filter(Boolean);
    if (symbols.length > 0) classifyNewTickers(symbols).catch(() => {});

    // Option B: snapshot today's price for each holding into the local price cache.
    const currentMonth = new Date().toISOString().slice(0, 7);
    const priceSnapshot: Record<string, Record<string, number>> = {};
    for (const accountHoldings of Object.values(holdings)) {
      for (const h of accountHoldings) {
        if (h.symbol && h.price != null) {
          priceSnapshot[h.symbol] ??= {};
          priceSnapshot[h.symbol][currentMonth] = h.price;
        }
      }
    }
    if (Object.keys(priceSnapshot).length > 0) {
      await upsertManyPrices(priceSnapshot);
    }

    return NextResponse.json({ ok: true, authorization_id: auth.authorizationId });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
