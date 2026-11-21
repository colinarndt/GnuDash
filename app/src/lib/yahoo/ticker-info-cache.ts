import fs from "fs/promises";
import path from "path";

const DATA_DIR = process.env.PLAID_DATA_DIR ?? path.join(process.cwd(), "data");
const CACHE_FILE = path.join(DATA_DIR, "ticker-info-cache.json");

const TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export interface TickerInfo {
  name: string;
  quoteType: string | null;
  currency: string | null;
  fundFamily: string | null;
  category: string | null;
  legalType: string | null;
  expenseRatio: number | null;
  totalAssets: number | null;
  yield: number | null;
  weekChange52: number | null;
  sector: string | null;
  industry: string | null;
  country: string | null;
  website: string | null;
  beta: number | null;
  forwardPE: number | null;
  trailingEps: number | null;
  description: string | null;
}

interface CachedEntry {
  fetchedAt: string;
  info: TickerInfo;
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

export async function getCachedTickerInfo(ticker: string): Promise<TickerInfo | null> {
  const cache = await read();
  const entry = cache[ticker];
  if (entry && Date.now() - new Date(entry.fetchedAt).getTime() <= TTL_MS) {
    return entry.info;
  }
  return null;
}

export async function setCachedTickerInfo(ticker: string, info: TickerInfo): Promise<void> {
  const cache = await read();
  cache[ticker] = { fetchedAt: new Date().toISOString(), info };
  await write(cache);
}

/** Returns cached (non-expired) entries; null means cache miss for that ticker. */
export async function getManyCachedTickerInfo(
  tickers: string[],
): Promise<Record<string, TickerInfo | null>> {
  const cache = await read();
  const now = Date.now();
  const out: Record<string, TickerInfo | null> = {};
  for (const ticker of tickers) {
    const entry = cache[ticker];
    out[ticker] = entry && now - new Date(entry.fetchedAt).getTime() <= TTL_MS
      ? entry.info
      : null;
  }
  return out;
}

/** Writes all results in one atomic operation. */
export async function setManyCachedTickerInfo(
  updates: Record<string, TickerInfo>,
): Promise<void> {
  if (Object.keys(updates).length === 0) return;
  const cache = await read();
  const now = new Date().toISOString();
  for (const [ticker, info] of Object.entries(updates)) {
    cache[ticker] = { fetchedAt: now, info };
  }
  await write(cache);
}
