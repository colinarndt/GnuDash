import { NextResponse } from "next/server";
import { getPlaidClient } from "@/lib/plaid/client";
import { upsertItem, appendTransactions, upsertHoldings, type StoredTransaction, type PlaidHolding } from "@/lib/plaid/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  public_token: string;
  metadata?: {
    institution?: { name?: string; institution_id?: string } | null;
  };
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.public_token) {
    return NextResponse.json({ error: "Missing public_token" }, { status: 400 });
  }

  try {
    const client = getPlaidClient();

    const exchange = await client.itemPublicTokenExchange({
      public_token: body.public_token,
    });
    const { access_token, item_id } = exchange.data;

    const accountsRes = await client.accountsBalanceGet({ access_token });
    const accounts = accountsRes.data.accounts.map((a) => ({
      accountId: a.account_id,
      name: a.name,
      officialName: a.official_name ?? null,
      type: a.type as string,
      subtype: (a.subtype as string) ?? null,
      mask: a.mask ?? null,
      balanceCurrent: a.balances.current ?? null,
      balanceAvailable: a.balances.available ?? null,
      displayName: null,
      accountType: null,
      hidden: false,
    }));

    await upsertItem({
      itemId: item_id,
      accessToken: access_token,
      institutionId: body.metadata?.institution?.institution_id ?? null,
      institutionName: body.metadata?.institution?.name ?? null,
      accounts,
      cursor: null,
      lastSynced: null,
      displayName: null,
      connectedAt: null,
    });

    // Initial full sync to populate transactions immediately
    let cursor: string | null = null;
    const allAdded: StoredTransaction[] = [];
    let hasMore = true;
    while (hasMore) {
      const sync = await client.transactionsSync({
        access_token,
        ...(cursor !== null && { cursor }),
      });
      for (const t of sync.data.added) {
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
      cursor = sync.data.next_cursor;
      hasMore = sync.data.has_more;
    }
    const synced = await appendTransactions(item_id, allAdded, cursor ?? "");

    // Initial holdings fetch for investment accounts
    const investmentAcctIds = new Set(
      accounts.filter((a) => a.type === "investment").map((a) => a.accountId)
    );
    let holdingsError: string | null = null;
    if (investmentAcctIds.size > 0) {
      try {
        const holdingsRes = await client.investmentsHoldingsGet({ access_token });
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
        }
        await upsertHoldings(item_id, grouped);
      } catch (err) {
        const plaidErr = (err as any)?.response?.data;
        holdingsError = plaidErr?.error_code
          ? `${plaidErr.error_code}: ${plaidErr.error_message}`
          : (err as Error).message;
      }
    }

    return NextResponse.json({
      item_id,
      accounts: accounts.length,
      transactions_synced: synced,
      holdings_error: holdingsError,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
