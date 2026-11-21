import { NextResponse } from "next/server";
import { getYahooCrumb } from "@/lib/yahoo/crumb";
import { getCachedTickerInfo, setCachedTickerInfo } from "@/lib/yahoo/ticker-info-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── Types ────────────────────────────────────────────────────────

interface RawValue {
  raw?: number;
}

interface YahooSummaryResponse {
  quoteSummary?: {
    result?: Array<{
      price?: {
        longName?: string;
        shortName?: string;
        quoteType?: string;
        currency?: string;
      };
      summaryProfile?: {
        longBusinessSummary?: string;
        sector?: string;
        industry?: string;
        country?: string;
        website?: string;
      };
      defaultKeyStatistics?: {
        totalAssets?: RawValue;
        "52WeekChange"?: RawValue;
        yield?: RawValue;
        beta?: RawValue;
        forwardPE?: RawValue;
        trailingEps?: RawValue;
      };
      fundProfile?: {
        categoryName?: string;
        family?: string;
        legalType?: string;
        feesExpensesInvestment?: {
          annualReportExpenseRatio?: RawValue;
          netExpRatio?: RawValue;
        };
      };
    }>;
  };
}

// ── Route ────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker")?.trim().toUpperCase();
  if (!ticker) return NextResponse.json({ info: null }, { status: 400 });

  const cached = await getCachedTickerInfo(ticker);
  if (cached) return NextResponse.json({ info: cached });

  const auth = await getYahooCrumb();
  if (!auth) return NextResponse.json({ info: null });

  try {
    const modules = "price,summaryProfile,defaultKeyStatistics,fundProfile";
    const url =
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}` +
      `?modules=${modules}&crumb=${encodeURIComponent(auth.crumb)}`;

    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Cookie: auth.cookie },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return NextResponse.json({ info: null });

    const data = (await res.json()) as YahooSummaryResponse;
    const result = data.quoteSummary?.result?.[0];
    if (!result) return NextResponse.json({ info: null });

    const price = result.price ?? {};
    const profile = result.summaryProfile ?? {};
    const stats = result.defaultKeyStatistics ?? {};
    const fund = result.fundProfile ?? {};
    const fees = fund.feesExpensesInvestment ?? {};

    const info = {
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
    await setCachedTickerInfo(ticker, info);
    return NextResponse.json({ info });
  } catch {
    return NextResponse.json({ info: null });
  }
}
