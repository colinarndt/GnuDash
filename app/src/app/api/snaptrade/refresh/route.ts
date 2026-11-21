import { NextResponse } from "next/server";
import { getSnapTradeClient } from "@/lib/snaptrade/client";
import { getSnapTradeUser, upsertAuthorization, updateAuthorizationSync } from "@/lib/snaptrade/storage";
import type { SnapTradeHolding, SnapTradeTransaction } from "@/lib/snaptrade/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getSnapTradeUser();
  if (!user) return NextResponse.json({ error: "SnapTrade user not registered" }, { status: 400 });

  try {
    const client = getSnapTradeClient();
    const { userId, userSecret } = user;

    const { data: auths } = await client.connections.listBrokerageAuthorizations({ userId, userSecret });
    const { data: accounts } = await client.accountInformation.listUserAccounts({ userId, userSecret });

    let synced = 0;
    for (const auth of (auths as any[]) ?? []) {
      const authId: string = auth.id;
      const brokerageName: string = auth.brokerage?.name ?? "Unknown Brokerage";
      const authAccounts = ((accounts as any[]) ?? []).filter((a: any) => a.brokerage_authorization === authId);

      await upsertAuthorization({
        authorizationId: authId,
        brokerage: brokerageName,
        accounts: authAccounts.map((a: any) => ({
          id: a.id,
          authorizationId: authId,
          brokerage: brokerageName,
          name: a.name,
          number: a.number ?? null,
          currency: a.currency ?? "USD",
          type: a.meta?.type ?? null,
          balance: null,
        })),
      });

      const holdings: Record<string, SnapTradeHolding[]> = {};
      const transactions: Record<string, SnapTradeTransaction[]> = {};
      const balances: Record<string, number | null> = {};

      for (const account of authAccounts) {
        const accountId: string = account.id;

        // Fetch positions
        try {
          const { data: positions } = await client.accountInformation.getUserAccountPositions({ userId, userSecret, accountId });
          console.log(`[snaptrade/refresh] positions for ${accountId}:`, JSON.stringify(positions).slice(0, 500));
          holdings[accountId] = ((positions as any[]) ?? []).map((p: any) => ({
            symbol: p.symbol?.symbol?.symbol ?? p.symbol?.description ?? "",
            description: p.symbol?.symbol?.description ?? null,
            quantity: p.units ?? 0,
            price: p.price ?? null,
            marketValue: p.price != null && p.units != null ? p.price * p.units : (p.market_value ?? null),
            costBasis: p.average_purchase_price != null ? p.average_purchase_price * (p.units ?? 0) : null,
            currency: p.currency?.code ?? "USD",
          }));
        } catch (e: any) {
          console.error(`[snaptrade/refresh] positions error for ${accountId}:`, e?.response?.data ?? e?.message);
          holdings[accountId] = [];
        }

        // Fetch balances
        try {
          const { data: acctBalances } = await client.accountInformation.getUserAccountBalance({ userId, userSecret, accountId });
          console.log(`[snaptrade/refresh] balances for ${accountId}:`, JSON.stringify(acctBalances).slice(0, 500));
          const balanceArr: any[] = (acctBalances as any[]) ?? [];
          const equity = balanceArr.find((b: any) => b.total_equity != null)?.total_equity ?? null;
          balances[accountId] = equity ?? (holdings[accountId].reduce((s, h) => s + (h.marketValue ?? 0), 0) || null);
        } catch (e: any) {
          console.error(`[snaptrade/refresh] balance error for ${accountId}:`, e?.response?.data ?? e?.message);
          balances[accountId] = holdings[accountId].reduce((s, h) => s + (h.marketValue ?? 0), 0) || null;
        }

        // Fetch transactions
        try {
          const { data: t } = await client.transactionsAndReporting.getActivities({ userId, userSecret, accounts: accountId });
          console.log(`[snaptrade/refresh] activities for ${accountId}:`, JSON.stringify(t).slice(0, 500));
          transactions[accountId] = ((t as any[]) ?? []).map((tx: any) => ({
            id: tx.id,
            date: tx.trade_date ?? tx.settlement_date ?? "",
            type: tx.action ?? tx.type ?? "Unknown",
            symbol: tx.symbol?.symbol?.symbol ?? null,
            description: tx.description ?? null,
            quantity: tx.units ?? null,
            price: tx.price ?? null,
            amount: tx.amount ?? null,
            fee: tx.fee ?? null,
            currency: tx.currency ?? "USD",
          }));
        } catch (e: any) {
          console.error(`[snaptrade/refresh] activities error for ${accountId}:`, e?.response?.data ?? e?.message);
          transactions[accountId] = [];
        }
      }

      await updateAuthorizationSync(authId, holdings, transactions, balances);
      synced++;
    }

    return NextResponse.json({ ok: true, authorizations: synced });
  } catch (err: any) {
    const body = err?.response?.data ?? err?.responseBody;
    console.error("[snaptrade/refresh] error:", body ?? err?.message);
    return NextResponse.json({ error: body ? JSON.stringify(body) : err?.message }, { status: 502 });
  }
}
