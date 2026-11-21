import { NextResponse } from "next/server";
import { getPlaidClient } from "@/lib/plaid/client";
import { getItems, appendTransactions, updateAccountBalances, upsertHoldings, type StoredTransaction, type PlaidHolding } from "@/lib/plaid/storage";
import { transactionsToCsv } from "@/lib/plaid/csv";
import { classifyNewTickers } from "@/lib/classifications/auto-classify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  item_id: string;
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
  if (!body.item_id) {
    return NextResponse.json({ error: "Missing item_id" }, { status: 400 });
  }

  const items = await getItems();
  const item = items.find((i) => i.itemId === body.item_id);
  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  // CSV download mode: return stored transactions for the requested account
  if (body.account_id) {
    const account = item.accounts.find((a) => a.accountId === body.account_id);
    let txns = item.transactions.filter((t) => t.accountId === body.account_id);
    if (body.from_date) txns = txns.filter((t) => t.date >= body.from_date!);
    if (body.to_date) txns = txns.filter((t) => t.date <= body.to_date!);
    const name = account
      ? `${account.name}${account.mask ? `-${account.mask}` : ""}`
      : body.account_id;
    const filename = name.replace(/[^a-z0-9-]/gi, "_") + ".csv";
    return new Response(transactionsToCsv(txns), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  // Sync mode: fetch new transactions from Plaid and store them
  try {
    const client = getPlaidClient();
    let cursor: string | null = item.cursor;
    const allAdded: StoredTransaction[] = [];
    let hasMore = true;

    while (hasMore) {
      const res = await client.transactionsSync({
        access_token: item.accessToken,
        ...(cursor !== null && { cursor }),
      });
      for (const t of res.data.added) {
        allAdded.push({
          id: t.transaction_id,
          accountId: t.account_id,
          amount: t.amount,
          date: t.date,
          name: t.name,
          merchantName: t.merchant_name ?? null,
          pending: t.pending,
        });
      }
      cursor = res.data.next_cursor;
      hasMore = res.data.has_more;
    }

    const [added, balancesRes] = await Promise.all([
      appendTransactions(item.itemId, allAdded, cursor ?? ""),
      client.accountsBalanceGet({ access_token: item.accessToken }),
    ]);
    await updateAccountBalances(
      item.itemId,
      balancesRes.data.accounts.map((a) => ({
        accountId: a.account_id,
        current: a.balances.current ?? null,
        available: a.balances.available ?? null,
      }))
    );

    // Fetch investment holdings for any investment-type accounts
    const investmentAcctIds = new Set(
      item.accounts.filter((a) => a.type === "investment").map((a) => a.accountId)
    );
    let holdingsAdded = 0;
    let holdingsError: string | null = null;
    if (investmentAcctIds.size > 0) {
      try {
        const holdingsRes = await client.investmentsHoldingsGet({ access_token: item.accessToken });
        const secMap = new Map(holdingsRes.data.securities.map((s) => [s.security_id, s]));
        const grouped: Record<string, PlaidHolding[]> = {};
        for (const h of holdingsRes.data.holdings) {
          if (!investmentAcctIds.has(h.account_id)) continue;
          const sec = secMap.get(h.security_id);
          const symbol = sec?.ticker_symbol ?? sec?.name ?? "Unknown";
          if (!grouped[h.account_id]) grouped[h.account_id] = [];
          grouped[h.account_id].push({
            symbol,
            description: sec?.name ?? null,
            quantity: h.quantity,
            price: h.institution_price ?? null,
            marketValue: h.institution_value ?? null,
            costBasis: h.cost_basis ?? null,
            securityType: sec?.type ?? null,
            currency: h.iso_currency_code ?? "USD",
          });
          holdingsAdded++;
        }
        await upsertHoldings(item.itemId, grouped);
        const symbols = [...new Set(Object.values(grouped).flat().map((h) => h.symbol))].filter(Boolean);
        if (symbols.length > 0) classifyNewTickers(symbols).catch(() => {});
      } catch (err) {
        const plaidErr = (err as any)?.response?.data;
        holdingsError = plaidErr?.error_code
          ? `${plaidErr.error_code}: ${plaidErr.error_message}`
          : (err as Error).message;
      }
    }

    return NextResponse.json({ added, item_id: item.itemId, holdingsAdded, holdingsError });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
