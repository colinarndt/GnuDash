import type { InvestmentHolding, MonthlyInvestmentValue } from "@/lib/types/gnucash";
import type { ParseContext } from "../context";
import { parseGnuCashDate, sqlMonth } from "../shared/dates";

/**
 * Compute current investment holdings for all STOCK and MUTUAL accounts.
 * Calculates cost basis (sum of buy-side split values), market value
 * (shares × latest price), gain/loss, and 12-month performance.
 * All monetary values are converted to base currency.
 */
export function computeInvestments(ctx: ParseContext): InvestmentHolding[] {
  const { db, accountMap, rootAccount, commodityMap, prices, latestPrices, latestPriceInfo, fxRates } = ctx;

  function buildPath(guid: string): string {
    const segments: string[] = [];
    let cur = accountMap.get(guid);
    while (cur && cur.guid !== rootAccount.guid) {
      segments.unshift(cur.name);
      cur = cur.parent_guid ? accountMap.get(cur.parent_guid) : undefined;
    }
    return segments.join(":");
  }

  // Price 12 months ago per commodity
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
  const price12mMap = new Map<string, number>();
  for (const p of prices) {
    const pDate = parseGnuCashDate(p.date);
    if (pDate <= twelveMonthsAgo && !price12mMap.has(p.commodity_guid)) {
      // Normalize to base currency
      const rawPrice = p.value_num / p.value_denom;
      price12mMap.set(p.commodity_guid, fxRates.toBase(p.currency_guid, rawPrice));
    }
  }

  // Per-split: convert each split's value to base currency BEFORE summing.
  // Necessary for accounts with mixed-currency transactions (e.g. crypto
  // bought in USD and transferred in BTC-denominated splits) — summing raw
  // values across different currencies and converting once at the end would
  // give garbage.
  const splitRows = db
    .prepare(
      `SELECT
        a.guid AS account_guid,
        a.name AS account_name,
        a.commodity_guid,
        t.currency_guid AS tx_currency_guid,
        CAST(s.quantity_num AS REAL) / s.quantity_denom AS shares,
        CAST(s.value_num AS REAL) / s.value_denom AS value
      FROM splits s
      JOIN accounts a ON s.account_guid = a.guid
      JOIN transactions t ON s.tx_guid = t.guid
      WHERE a.account_type IN ('STOCK', 'MUTUAL')`
    )
    .all() as {
    account_guid: string;
    account_name: string;
    commodity_guid: string;
    tx_currency_guid: string;
    shares: number;
    value: number;
  }[];

  const aggregated = new Map<string, { name: string; commodityGuid: string; sharesHeld: number; costBasis: number }>();
  for (const r of splitRows) {
    let agg = aggregated.get(r.account_guid);
    if (!agg) {
      agg = { name: r.account_name, commodityGuid: r.commodity_guid, sharesHeld: 0, costBasis: 0 };
      aggregated.set(r.account_guid, agg);
    }
    agg.sharesHeld += r.shares;
    agg.costBasis += fxRates.toBase(r.tx_currency_guid, r.value);
  }

  return [...aggregated.entries()].map(([accountGuid, h]) => {
    const commodity = commodityMap.get(h.commodityGuid);
    const latestPrice = latestPrices.get(h.commodityGuid) ?? 0;
    const price12m = price12mMap.get(h.commodityGuid);
    const marketValue = h.sharesHeld * latestPrice;
    const costBasis = h.costBasis;
    const gainLoss = marketValue - costBasis;
    const gainLossPct = costBasis !== 0 ? (gainLoss / Math.abs(costBasis)) * 100 : 0;

    let change12mPct: number | null = null;
    if (price12m && price12m > 0) {
      change12mPct = ((latestPrice - price12m) / price12m) * 100;
    }

    return {
      accountName: h.name,
      accountGuid,
      accountPath: buildPath(accountGuid),
      ticker: commodity?.mnemonic ?? "???",
      sharesHeld: h.sharesHeld,
      costBasis,
      marketValue,
      gainLoss,
      gainLossPct,
      change12m: change12mPct !== null ? latestPrice - (price12m ?? 0) : null,
      change12mPct,
    };
  });
}

/**
 * Compute monthly portfolio value time series for each investment ticker.
 * For each month, calculates cumulative shares held and multiplies by the
 * best available price at that month (carrying forward the last known price).
 * Prices and cost basis are converted to base currency.
 */
export function computeInvestmentValueSeries(ctx: ParseContext): MonthlyInvestmentValue[] {
  const { db, commodityMap, fxRates } = ctx;

  const splits = db
    .prepare(
      `SELECT
        a.guid AS account_guid,
        a.name AS account_name,
        a.commodity_guid,
        t.currency_guid AS tx_currency_guid,
        ${sqlMonth("t.post_date")} AS month,
        CAST(s.quantity_num AS REAL) / s.quantity_denom AS shares,
        CAST(s.value_num AS REAL) / s.value_denom AS cost
      FROM splits s
      JOIN accounts a ON s.account_guid = a.guid
      JOIN transactions t ON s.tx_guid = t.guid
      WHERE a.account_type IN ('STOCK', 'MUTUAL')
      ORDER BY t.post_date`
    )
    .all() as { account_guid: string; account_name: string; commodity_guid: string; tx_currency_guid: string; month: string; shares: number; cost: number }[];

  // Per-split FX conversion: accumulate cost in base currency directly so
  // mixed-currency transactions (e.g. crypto bought in USD and transferred in
  // BTC-denominated splits) are handled correctly. Each split's `cost` value
  // is in its own transaction's currency; convert via fxRates.toBase before
  // summing.
  const accountMonthly = new Map<string, Map<string, { shares: number; costInBase: number; commodity_guid: string; name: string }>>();
  for (const s of splits) {
    if (!accountMonthly.has(s.account_guid)) accountMonthly.set(s.account_guid, new Map());
    const months = accountMonthly.get(s.account_guid)!;
    const costInBase = fxRates.toBase(s.tx_currency_guid, s.cost);
    const existing = months.get(s.month);
    if (existing) {
      existing.shares += s.shares;
      existing.costInBase += costInBase;
    } else {
      months.set(s.month, { shares: s.shares, costInBase, commodity_guid: s.commodity_guid, name: s.account_name });
    }
  }

  const allPrices = db
    .prepare(
      `SELECT commodity_guid, currency_guid, ${sqlMonth("date")} AS month, CAST(value_num AS REAL) / value_denom AS price
      FROM prices ORDER BY date`
    )
    .all() as { commodity_guid: string; currency_guid: string; month: string; price: number }[];

  const priceByMonth = new Map<string, Map<string, { price: number; currencyGuid: string }>>();
  for (const p of allPrices) {
    if (!priceByMonth.has(p.commodity_guid)) priceByMonth.set(p.commodity_guid, new Map());
    priceByMonth.get(p.commodity_guid)!.set(p.month, { price: p.price, currencyGuid: p.currency_guid });
  }

  const allMonths = new Set<string>();
  for (const months of accountMonthly.values()) for (const m of months.keys()) allMonths.add(m);
  for (const months of priceByMonth.values()) for (const m of months.keys()) allMonths.add(m);
  const sortedMonths = [...allMonths].sort();

  const result: MonthlyInvestmentValue[] = [];

  for (const [accountGuid, monthlyData] of accountMonthly) {
    const firstEntry = [...monthlyData.values()][0];
    if (!firstEntry) continue;
    const commodity = commodityMap.get(firstEntry.commodity_guid);
    const ticker = commodity?.mnemonic ?? "???";
    const commodityPrices = priceByMonth.get(firstEntry.commodity_guid);

    let cumulativeShares = 0;
    let cumulativeCostInBase = 0;
    let lastKnownPrice = 0;
    let lastKnownPriceCurrency = firstEntry.commodity_guid;

    for (const month of sortedMonths) {
      const delta = monthlyData.get(month);
      if (delta) {
        cumulativeShares += delta.shares;
        cumulativeCostInBase += delta.costInBase;
      }

      const priceThisMonth = commodityPrices?.get(month);
      if (priceThisMonth !== undefined) {
        lastKnownPrice = priceThisMonth.price;
        lastKnownPriceCurrency = priceThisMonth.currencyGuid;
      }

      if (cumulativeShares === 0 && cumulativeCostInBase === 0 && !delta) continue;

      const valueInBase = fxRates.toBase(lastKnownPriceCurrency, cumulativeShares * lastKnownPrice);

      result.push({
        month,
        ticker,
        accountGuid,
        value: valueInBase,
        costBasis: cumulativeCostInBase,
      });
    }
  }

  // ── Second pass: per-leaf monthly balance for non-stock asset-side accounts.
  // Lets the Investment page draw a value-over-time line for cash-style
  // positions like a 401k tracked as Self/Work Contributions + Investment
  // Returns. The page aggregates these per-leaf rows into one synthetic
  // series per parent placeholder.
  const cashLikeSplits = db
    .prepare(
      `SELECT
        a.guid AS account_guid,
        a.name AS account_name,
        a.commodity_guid,
        ${sqlMonth("t.post_date")} AS month,
        CAST(s.quantity_num AS REAL) / s.quantity_denom AS qty
      FROM splits s
      JOIN accounts a ON s.account_guid = a.guid
      JOIN transactions t ON s.tx_guid = t.guid
      WHERE a.account_type NOT IN ('STOCK','MUTUAL','INCOME','EXPENSE','EQUITY','LIABILITY','CREDIT','PAYABLE','TRADING','ROOT')
        AND COALESCE(a.placeholder, 0) != 1
        AND COALESCE(a.hidden, 0) != 1
      ORDER BY t.post_date`
    )
    .all() as { account_guid: string; account_name: string; commodity_guid: string; month: string; qty: number }[];

  const cashAccountMonthly = new Map<string, Map<string, number>>();
  const cashAccountMeta = new Map<string, { name: string; commodityGuid: string }>();
  for (const s of cashLikeSplits) {
    if (!cashAccountMonthly.has(s.account_guid)) {
      cashAccountMonthly.set(s.account_guid, new Map());
      cashAccountMeta.set(s.account_guid, { name: s.account_name, commodityGuid: s.commodity_guid });
    }
    const months = cashAccountMonthly.get(s.account_guid)!;
    months.set(s.month, (months.get(s.month) ?? 0) + s.qty);
  }

  const cashMonths = new Set<string>();
  for (const months of cashAccountMonthly.values()) for (const m of months.keys()) cashMonths.add(m);
  const sortedCashMonths = [...cashMonths].sort();

  for (const [accountGuid, monthlyDeltas] of cashAccountMonthly) {
    const meta = cashAccountMeta.get(accountGuid)!;
    let cumQty = 0;
    for (const month of sortedCashMonths) {
      const delta = monthlyDeltas.get(month);
      if (delta) cumQty += delta;
      if (cumQty === 0 && !delta) continue;
      const valueInBase = fxRates.toBase(meta.commodityGuid, cumQty);
      result.push({
        month,
        ticker: meta.name,
        accountGuid,
        value: valueInBase,
        costBasis: valueInBase,
      });
    }
  }

  return result;
}
