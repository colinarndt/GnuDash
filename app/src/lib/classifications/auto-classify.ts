import { getUserClassifications, saveUserClassifications } from "./storage";
import {
  getManyCachedTickerInfo,
  setCachedTickerInfo,
  type TickerInfo,
} from "@/lib/yahoo/ticker-info-cache";
import { getYahooCrumb } from "@/lib/yahoo/crumb";
import type { TickerAllocation } from "./index";

// ── Sector mapping (Yahoo Finance labels → our labels) ──────────────────────

const SECTOR_MAP: Record<string, string> = {
  "Technology": "Technology",
  "Healthcare": "Healthcare",
  "Financial Services": "Financials",
  "Financials": "Financials",
  "Consumer Cyclical": "Consumer Discretionary",
  "Consumer Defensive": "Consumer Staples",
  "Energy": "Energy",
  "Utilities": "Utilities",
  "Basic Materials": "Materials",
  "Industrials": "Industrials",
  "Real Estate": "Real Estate",
  "Communication Services": "Communication Services",
};

function mapSector(s: string | null): string {
  if (!s) return "Diversified";
  return SECTOR_MAP[s] ?? "Diversified";
}

// ── Morningstar category → TickerAllocation ─────────────────────────────────

function morningstarToAlloc(category: string | null): TickerAllocation | null {
  if (!category) return null;
  const c = category.toLowerCase();

  // Fixed Income (check before generic equity terms)
  if (c.includes("ultrashort") || c.includes("short-term bond") || c.includes("short term bond"))
    return { weight: 1, assetClass: "Fixed Income", region: "Domestic", classDetailed: "Short-Term Bonds", sector: "Diversified" };
  if (c.includes("inflation-protected") || c.includes("tips"))
    return { weight: 1, assetClass: "Fixed Income", region: "Domestic", classDetailed: "TIPS", sector: "Diversified" };
  if (c.includes("long-term bond") || c.includes("long government"))
    return { weight: 1, assetClass: "Fixed Income", region: "Domestic", classDetailed: "Long-Term Bonds", sector: "Diversified" };
  if (c.includes("intermediate") && (c.includes("bond") || c.includes("govt")))
    return { weight: 1, assetClass: "Fixed Income", region: "Domestic", classDetailed: "Interm Bonds", sector: "Diversified" };
  if (c.includes("world bond") || c.includes("international bond") || c.includes("emerging markets bond") || c.includes("foreign bond"))
    return { weight: 1, assetClass: "Fixed Income", region: c.includes("emerging") ? "International" : "Global", classDetailed: "Intl Bonds", sector: "Diversified" };
  if (c.includes("bond") || c.includes("government") || c.includes("corporate bond") || c.includes("municipal"))
    return { weight: 1, assetClass: "Fixed Income", region: "Domestic", classDetailed: "US Bonds", sector: "Diversified" };

  // Money Market
  if (c.includes("money market"))
    return { weight: 1, assetClass: "Cash", region: "Domestic", classDetailed: "Money Market", sector: "Diversified" };

  // Real Estate
  if (c.includes("real estate"))
    return { weight: 1, assetClass: "Real Estate", region: "Domestic", classDetailed: "US REITs", sector: "Real Estate" };

  // Alternatives
  if (c.includes("commodities") || c.includes("commodity"))
    return { weight: 1, assetClass: "Alternatives", region: "Global", classDetailed: "Commodities", sector: "Materials" };
  if (c.includes("precious metal") || c.includes("gold"))
    return { weight: 1, assetClass: "Alternatives", region: "Global", classDetailed: "Gold", sector: "Materials" };

  // International / Emerging equity
  if (c.includes("diversified emerging") || c.includes("emerging markets equity"))
    return { weight: 1, assetClass: "Equity", region: "International", classDetailed: "Emerging Markets", sector: "Diversified" };
  if (c.includes("foreign") || c.includes("international equity") || c.includes("europe") || c.includes("japan"))
    return { weight: 1, assetClass: "Equity", region: "International", classDetailed: "Intl Developed", sector: "Diversified" };
  if (c.includes("world") || c.includes("global equity"))
    return { weight: 1, assetClass: "Equity", region: "Global", classDetailed: "Global Equity", sector: "Diversified" };

  // Sector equity
  if (c.includes("technology"))     return { weight: 1, assetClass: "Equity", region: "Domestic", classDetailed: "US Large Cap", sector: "Technology" };
  if (c.includes("health"))         return { weight: 1, assetClass: "Equity", region: "Domestic", classDetailed: "US Large Cap", sector: "Healthcare" };
  if (c.includes("financial"))      return { weight: 1, assetClass: "Equity", region: "Domestic", classDetailed: "US Large Cap", sector: "Financials" };
  if (c.includes("energy"))         return { weight: 1, assetClass: "Equity", region: "Domestic", classDetailed: "US Large Cap", sector: "Energy" };
  if (c.includes("consumer cyclical")) return { weight: 1, assetClass: "Equity", region: "Domestic", classDetailed: "US Large Cap", sector: "Consumer Discretionary" };
  if (c.includes("consumer defensive")) return { weight: 1, assetClass: "Equity", region: "Domestic", classDetailed: "US Large Cap", sector: "Consumer Staples" };
  if (c.includes("utilities"))      return { weight: 1, assetClass: "Equity", region: "Domestic", classDetailed: "US Large Cap", sector: "Utilities" };
  if (c.includes("industrial"))     return { weight: 1, assetClass: "Equity", region: "Domestic", classDetailed: "US Large Cap", sector: "Industrials" };
  if (c.includes("communication"))  return { weight: 1, assetClass: "Equity", region: "Domestic", classDetailed: "US Large Cap", sector: "Communication Services" };
  if (c.includes("materials") || c.includes("natural resources")) return { weight: 1, assetClass: "Equity", region: "Domestic", classDetailed: "US Large Cap", sector: "Materials" };

  // US equity by cap
  if (c.includes("small"))
    return { weight: 1, assetClass: "Equity", region: "Domestic", classDetailed: "US Small Cap", sector: "Diversified" };
  if (c.includes("mid-cap") || c.includes("mid cap"))
    return { weight: 1, assetClass: "Equity", region: "Domestic", classDetailed: "US Mid Cap", sector: "Diversified" };
  if (c.includes("large") || c.includes("blend") || c.includes("growth") || c.includes("value"))
    return { weight: 1, assetClass: "Equity", region: "Domestic", classDetailed: "US Large Cap", sector: "Diversified" };

  // Generic equity catch-all
  if (c.includes("equity") || c.includes("stock"))
    return { weight: 1, assetClass: "Equity", region: "Domestic", classDetailed: "US Large Cap", sector: "Diversified" };

  return null;
}

// ── TickerInfo → TickerAllocation[] ─────────────────────────────────────────

function yahooInfoToAllocation(ticker: string, info: TickerInfo): TickerAllocation[] | null {
  const qt = (info.quoteType ?? "").toUpperCase();

  if (qt === "CRYPTOCURRENCY") {
    const base = ticker.toUpperCase().replace(/-USD$/, "");
    if (base === "BTC") return [{ weight: 1, assetClass: "Crypto", region: "Global", classDetailed: "Bitcoin ETF", sector: "Crypto" }];
    if (base === "ETH") return [{ weight: 1, assetClass: "Crypto", region: "Global", classDetailed: "Ethereum ETF", sector: "Crypto" }];
    return [{ weight: 1, assetClass: "Crypto", region: "Global", classDetailed: "Crypto", sector: "Crypto" }];
  }

  if (qt === "EQUITY") {
    const region = (info.country === "United States" || !info.country) ? "Domestic" : "International";
    const classDetailed = region === "Domestic" ? "US Large Cap" : "Intl Developed";
    return [{ weight: 1, assetClass: "Equity", region, classDetailed, sector: mapSector(info.sector) }];
  }

  if (qt === "ETF" || qt === "MUTUALFUND") {
    const alloc = morningstarToAlloc(info.category);
    if (alloc) return [alloc];
    // Fallback: use sector if available
    if (info.sector) return [{ weight: 1, assetClass: "Equity", region: "Domestic", classDetailed: "US Large Cap", sector: mapSector(info.sector) }];
    return null;
  }

  return null;
}

// ── Yahoo Finance fetch (minimal, shares logic with /api/ticker-info) ────────

interface YahooRaw { raw?: number }
interface YahooSummary {
  quoteSummary?: { result?: Array<{
    price?: { longName?: string; shortName?: string; quoteType?: string; currency?: string };
    summaryProfile?: { sector?: string; industry?: string; country?: string; website?: string; longBusinessSummary?: string };
    defaultKeyStatistics?: { totalAssets?: YahooRaw; "52WeekChange"?: YahooRaw; yield?: YahooRaw; beta?: YahooRaw; forwardPE?: YahooRaw; trailingEps?: YahooRaw };
    fundProfile?: { categoryName?: string; family?: string; legalType?: string; feesExpensesInvestment?: { annualReportExpenseRatio?: YahooRaw; netExpRatio?: YahooRaw } };
  }> };
}

async function fetchAndCacheInfo(ticker: string): Promise<TickerInfo | null> {
  const auth = await getYahooCrumb();
  if (!auth) return null;
  try {
    const modules = "price,summaryProfile,defaultKeyStatistics,fundProfile";
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules}&crumb=${encodeURIComponent(auth.crumb)}`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Cookie: auth.cookie }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = (await res.json()) as YahooSummary;
    const r = data.quoteSummary?.result?.[0];
    if (!r) return null;
    const price = r.price ?? {};
    const profile = r.summaryProfile ?? {};
    const stats = r.defaultKeyStatistics ?? {};
    const fund = r.fundProfile ?? {};
    const fees = fund.feesExpensesInvestment ?? {};
    const info: TickerInfo = {
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
    return info;
  } catch {
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Find tickers not yet classified, fetch Yahoo info, derive classification, and save. */
export async function classifyNewTickers(tickers: string[]): Promise<void> {
  const existing = await getUserClassifications();
  const unknown = [...new Set(tickers)].filter((t) => t && !existing[t]);
  if (unknown.length === 0) return;

  // Check Yahoo cache first, then fetch missing ones
  const cached = await getManyCachedTickerInfo(unknown);
  const toFetch = unknown.filter((t) => !cached[t]);

  // Fetch uncached tickers (sequential to be polite to Yahoo)
  for (const ticker of toFetch) {
    cached[ticker] = await fetchAndCacheInfo(ticker);
  }

  // Map Yahoo info → TickerAllocation and save
  const classified: Record<string, TickerAllocation[]> = {};
  for (const ticker of unknown) {
    const info = cached[ticker];
    if (!info) continue;
    const allocs = yahooInfoToAllocation(ticker, info);
    if (allocs) classified[ticker] = allocs;
  }

  if (Object.keys(classified).length > 0) {
    await saveUserClassifications(classified);
  }
}
