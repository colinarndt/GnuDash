import fs from "fs/promises";
import path from "path";
import type { FundHoldingItem, FundHoldingsResult } from "@/app/api/fund-holdings/route";

const DATA_DIR = process.env.PLAID_DATA_DIR ?? path.join(process.cwd(), "data");
const CACHE_FILE = path.join(DATA_DIR, "fund-holdings-cache.json");

const TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

interface CachedEntry {
  fetchedAt: string;
  quoteType: string;
  holdings: FundHoldingItem[];
  totalMapped: number;
  stockPct: number;
  bondPct: number;
  cashPct: number;
  otherPct: number;
  source: "vanguard" | "yahoo" | "nport";
}

type CacheFile = Record<string, CachedEntry>;

async function read(): Promise<CacheFile> {
  try {
    return JSON.parse(await fs.readFile(CACHE_FILE, "utf-8")) as CacheFile;
  } catch {
    return {};
  }
}

async function write(cache: CacheFile): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");
}

function toResult(entry: CachedEntry): FundHoldingsResult {
  return {
    quoteType: entry.quoteType,
    holdings: entry.holdings,
    totalMapped: entry.totalMapped,
    stockPct: entry.stockPct ?? 0,
    bondPct: entry.bondPct ?? 0,
    cashPct: entry.cashPct ?? 0,
    otherPct: entry.otherPct ?? 0,
    source: entry.source,
  };
}

/** Returns valid (non-expired) cached entries for each requested ticker. */
export async function getManyCache(
  tickers: string[],
): Promise<Record<string, FundHoldingsResult | null>> {
  const cache = await read();
  const now = Date.now();
  const out: Record<string, FundHoldingsResult | null> = {};
  for (const ticker of tickers) {
    const entry = cache[ticker];
    if (entry && now - new Date(entry.fetchedAt).getTime() <= TTL_MS) {
      out[ticker] = toResult(entry);
    } else {
      out[ticker] = null;
    }
  }
  return out;
}

/** Writes all new results in one atomic operation, avoiding concurrent-write races. */
export async function setManyCache(
  updates: Record<string, FundHoldingsResult>,
): Promise<void> {
  if (Object.keys(updates).length === 0) return;
  const cache = await read();
  const now = new Date().toISOString();
  for (const [ticker, result] of Object.entries(updates)) {
    cache[ticker] = {
      fetchedAt: now,
      quoteType: result.quoteType,
      holdings: result.holdings,
      totalMapped: result.totalMapped,
      stockPct: result.stockPct,
      bondPct: result.bondPct,
      cashPct: result.cashPct,
      otherPct: result.otherPct,
      source: result.source,
    };
  }
  await write(cache);
}
