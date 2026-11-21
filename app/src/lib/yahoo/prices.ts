import { upsertManyPrices, type PriceCache } from "@/lib/prices/storage";

interface YahooChartResult {
  timestamp?: number[];
  indicators?: { adjclose?: Array<{ adjclose?: (number | null)[] }> };
}

interface YahooChartResponse {
  chart?: { result?: YahooChartResult[] };
}

async function fetchTickerHistory(ticker: string): Promise<Record<string, number> | null> {
  try {
    const url =
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
      `?range=5y&interval=1mo`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as YahooChartResponse;
    const result = data.chart?.result?.[0];
    if (!result) return null;

    const timestamps = result.timestamp ?? [];
    const closes = result.indicators?.adjclose?.[0]?.adjclose ?? [];
    const monthly: Record<string, number> = {};
    for (let i = 0; i < timestamps.length; i++) {
      const price = closes[i];
      if (price == null) continue;
      const month = new Date(timestamps[i] * 1000).toISOString().slice(0, 7);
      monthly[month] = price;
    }
    return Object.keys(monthly).length > 0 ? monthly : null;
  } catch {
    return null;
  }
}

/**
 * Fetch 5 years of monthly price history from Yahoo Finance for each ticker
 * and merge into the local price cache. Requests run in parallel.
 */
export async function syncPriceHistory(tickers: string[]): Promise<void> {
  if (tickers.length === 0) return;
  const results = await Promise.allSettled(
    tickers.map(async (ticker) => ({ ticker, monthly: await fetchTickerHistory(ticker) }))
  );
  const updates: PriceCache = {};
  for (const r of results) {
    if (r.status === "fulfilled" && r.value.monthly) {
      updates[r.value.ticker] = r.value.monthly;
    }
  }
  if (Object.keys(updates).length > 0) await upsertManyPrices(updates);
}
