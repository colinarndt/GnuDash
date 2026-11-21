import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface FundHoldingItem {
  symbol: string;
  name: string;
  pct: number;
  /** N-PORT asset category: "EC" (equity), "DBT" (debt), "STIV", "DE", etc. */
  assetCategory?: string;
  /** N-PORT issuer category for debt: "UST", "CORP", "MUN", "FORGOV", etc. */
  issuerCategory?: string;
}

export interface FundHoldingsResult {
  quoteType: string;
  holdings: FundHoldingItem[];
  totalMapped: number;
  /** Equity/stock allocation percentage (0–1). */
  stockPct: number;
  /** Fixed-income allocation percentage (0–1). */
  bondPct: number;
  /** Cash/money-market allocation percentage (0–1). */
  cashPct: number;
  /** Other/unclassified allocation percentage (0–1). */
  otherPct: number;
  source: "vanguard" | "yahoo" | "nport";
}

const MAX_HOLDINGS = 500;
const DATA_DIR = process.env.PLAID_DATA_DIR ?? path.join(process.cwd(), "data");
const NPORT_CACHE_FILE = path.join(DATA_DIR, "nport-cache.json");

// ── N-PORT cache (pre-built by scripts/fetch-nport.py) ──────────────

let nportMem: { data: Record<string, FundHoldingsResult>; at: number } | null = null;

async function getNportCache(): Promise<Record<string, FundHoldingsResult>> {
  if (nportMem && Date.now() - nportMem.at < 5 * 60 * 1000) return nportMem.data;
  try {
    const data = JSON.parse(await fs.readFile(NPORT_CACHE_FILE, "utf-8")) as Record<string, FundHoldingsResult>;
    nportMem = { data, at: Date.now() };
    return data;
  } catch {
    return {};
  }
}

// ── Vanguard ─────────────────────────────────────────────────────
// Kept for reference; no longer called — superseded by N-PORT cache.

interface VanguardEntity {
  ticker?: string;
  longName?: string;
  shortName?: string;
  percentWeight?: string;
}

interface VanguardResponse {
  fund?: { entity?: VanguardEntity[] };
  size?: number;
}

async function fetchVanguardPage(ticker: string, segment: "stock" | "bond"): Promise<VanguardResponse | null> {
  try {
    const url =
      `https://investor.vanguard.com/investment-products/etfs/profile/api/` +
      `${encodeURIComponent(ticker)}/portfolio-holding/${segment}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return (await res.json()) as VanguardResponse;
  } catch {
    return null;
  }
}

async function fetchVanguard(ticker: string): Promise<FundHoldingsResult | null> {
  // Fetch stock and bond endpoints in parallel
  const [stockData, bondData] = await Promise.all([
    fetchVanguardPage(ticker, "stock"),
    fetchVanguardPage(ticker, "bond"),
  ]);

  const stockEntities = stockData?.fund?.entity;
  if (!Array.isArray(stockEntities) || stockEntities.length === 0) return null;

  const holdings: FundHoldingItem[] = stockEntities
    .filter((e) => e.ticker && e.percentWeight)
    .map((e) => ({
      symbol: e.ticker!,
      name: e.longName ?? e.shortName ?? e.ticker!,
      pct: parseFloat(e.percentWeight!) / 100,
    }))
    .filter((h) => h.pct > 0)
    .slice(0, MAX_HOLDINGS);

  if (holdings.length === 0) return null;

  const totalMapped = holdings.reduce((s, h) => s + h.pct, 0);

  // Calculate bond allocation
  let bondPct = 0;
  if (bondData) {
    const bondEntities = bondData.fund?.entity ?? [];
    const bondSize = bondData.size ?? 0;
    if (bondSize > 0) {
      if (bondSize <= bondEntities.length) {
        // All bonds fit on page 1 — sum exactly
        bondPct = bondEntities.reduce(
          (s, e) => s + (e.percentWeight ? parseFloat(e.percentWeight) / 100 : 0),
          0,
        );
      } else {
        // More bonds than page 1 — estimate as the remaining non-stock allocation
        bondPct = Math.max(0, 1 - totalMapped);
      }
    }
  }

  const stockPct = totalMapped;
  return { quoteType: "ETF", holdings, totalMapped, stockPct, bondPct, cashPct: 0, otherPct: 0, source: "vanguard" };
}

// ── Yahoo Finance (top 10 fallback) ──────────────────────────────
// Kept for reference; no longer called — superseded by N-PORT cache.

interface YahooTopHoldingsResponse {
  quoteSummary?: {
    result?: Array<{
      price?: { quoteType?: string };
      topHoldings?: {
        stockPosition?: { raw?: number };
        bondPosition?: { raw?: number };
        cashPosition?: { raw?: number };
        otherPosition?: { raw?: number };
        holdings?: Array<{
          symbol?: string;
          holdingName?: string;
          holdingPercent?: { raw?: number };
        }>;
      };
    }>;
  };
}

async function fetchYahoo(
  ticker: string,
  auth: { crumb: string; cookie: string },
): Promise<FundHoldingsResult | null> {
  try {
    const url =
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}` +
      `?modules=price,topHoldings&crumb=${encodeURIComponent(auth.crumb)}`;

    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Cookie: auth.cookie },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as YahooTopHoldingsResponse;
    const result = data.quoteSummary?.result?.[0];
    if (!result) return null;

    const quoteType = result.price?.quoteType ?? "";
    const topHoldings = result.topHoldings ?? {};
    const raw = topHoldings.holdings ?? [];
    const stockPct = topHoldings.stockPosition?.raw ?? 0;
    const bondPct = topHoldings.bondPosition?.raw ?? 0;
    const cashPct = topHoldings.cashPosition?.raw ?? 0;
    const otherPct = topHoldings.otherPosition?.raw ?? 0;

    const holdings: FundHoldingItem[] = raw
      .map((h) => ({
        symbol: h.symbol ?? "",
        name: h.holdingName ?? h.symbol ?? "",
        pct: h.holdingPercent?.raw ?? 0,
      }))
      .filter((h) => h.symbol && h.pct > 0)
      .slice(0, MAX_HOLDINGS);

    const totalMapped = holdings.reduce((s, h) => s + h.pct, 0);
    return { quoteType, holdings, totalMapped, stockPct, bondPct, cashPct, otherPct, source: "yahoo" };
  } catch {
    return null;
  }
}

// ── Route ────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const param = searchParams.get("tickers") ?? "";
  const tickers = param
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);

  if (tickers.length === 0) return NextResponse.json({ results: {} });

  const nportCache = await getNportCache();
  const results: Record<string, FundHoldingsResult | null> = {};
  for (const ticker of tickers) {
    results[ticker] = nportCache[ticker] ?? null;
  }

  return NextResponse.json({ results });
}
