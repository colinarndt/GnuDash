import { NextResponse } from "next/server";
import { getYahooCrumb } from "@/lib/yahoo/crumb";
import {
  getManyCachedTickerInfo,
  setManyCachedTickerInfo,
  type TickerInfo,
} from "@/lib/yahoo/ticker-info-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH_SIZE = 10;

interface YahooSummaryResponse {
  quoteSummary?: {
    result?: Array<{
      price?: { longName?: string; shortName?: string; quoteType?: string; currency?: string };
      summaryProfile?: {
        longBusinessSummary?: string; sector?: string; industry?: string;
        country?: string; website?: string;
      };
      defaultKeyStatistics?: {
        totalAssets?: { raw?: number };
        "52WeekChange"?: { raw?: number };
        yield?: { raw?: number };
        beta?: { raw?: number };
        forwardPE?: { raw?: number };
        trailingEps?: { raw?: number };
      };
      fundProfile?: {
        categoryName?: string; family?: string; legalType?: string;
        feesExpensesInvestment?: {
          annualReportExpenseRatio?: { raw?: number };
          netExpRatio?: { raw?: number };
        };
      };
    }>;
  };
}

async function fetchOne(
  ticker: string,
  auth: { crumb: string; cookie: string },
): Promise<TickerInfo | null> {
  try {
    const url =
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}` +
      `?modules=price,summaryProfile,defaultKeyStatistics,fundProfile&crumb=${encodeURIComponent(auth.crumb)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Cookie: auth.cookie },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as YahooSummaryResponse;
    const result = data.quoteSummary?.result?.[0];
    if (!result) return null;

    const price = result.price ?? {};
    const profile = result.summaryProfile ?? {};
    const stats = result.defaultKeyStatistics ?? {};
    const fund = result.fundProfile ?? {};
    const fees = fund.feesExpensesInvestment ?? {};

    return {
      name: price.longName ?? price.shortName ?? ticker,
      quoteType: price.quoteType ?? null,
      currency: price.currency ?? null,
      fundFamily: fund.family ?? null,
      category: fund.categoryName ?? null,
      legalType: fund.legalType ?? null,
      expenseRatio: fees.annualReportExpenseRatio?.raw ?? fees.netExpRatio?.raw ?? null,
      totalAssets: stats.totalAssets?.raw ?? null,
      yield: stats.yield?.raw ?? null,
      weekChange52: stats["52WeekChange"]?.raw ?? null,
      sector: profile.sector ?? null,
      industry: profile.industry ?? null,
      country: profile.country ?? null,
      website: profile.website ?? null,
      beta: stats.beta?.raw ?? null,
      forwardPE: stats.forwardPE?.raw ?? null,
      trailingEps: stats.trailingEps?.raw ?? null,
      description: profile.longBusinessSummary ?? null,
    };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const param = searchParams.get("tickers") ?? "";
  const tickers = param
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);

  if (tickers.length === 0) return NextResponse.json({ results: {} });

  // Single cache read — only fetch misses
  const cached = await getManyCachedTickerInfo(tickers);
  const misses = tickers.filter((t) => cached[t] === null);

  const fetched: Record<string, TickerInfo> = {};
  if (misses.length > 0) {
    const auth = await getYahooCrumb();
    if (auth) {
      // Process in batches of BATCH_SIZE to avoid hammering Yahoo
      for (let i = 0; i < misses.length; i += BATCH_SIZE) {
        const batch = misses.slice(i, i + BATCH_SIZE);
        const settled = await Promise.allSettled(batch.map((t) => fetchOne(t, auth)));
        for (let j = 0; j < batch.length; j++) {
          const r = settled[j];
          if (r.status === "fulfilled" && r.value) fetched[batch[j]] = r.value;
        }
      }
    }
  }

  // Single cache write
  await setManyCachedTickerInfo(fetched);

  const results: Record<string, TickerInfo | null> = {};
  for (const ticker of tickers) {
    results[ticker] = cached[ticker] ?? fetched[ticker] ?? null;
  }

  return NextResponse.json({ results });
}
