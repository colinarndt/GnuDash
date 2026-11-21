import fs from "fs/promises";
import path from "path";

const DATA_DIR = process.env.PLAID_DATA_DIR ?? path.join(process.cwd(), "data");
const PRICE_FILE = path.join(DATA_DIR, "price-history.json");

// symbol → { "YYYY-MM": adjustedClosePrice }
export type PriceCache = Record<string, Record<string, number>>;

async function read(): Promise<PriceCache> {
  try {
    return JSON.parse(await fs.readFile(PRICE_FILE, "utf-8")) as PriceCache;
  } catch {
    return {};
  }
}

async function write(cache: PriceCache): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(PRICE_FILE, JSON.stringify(cache), "utf-8");
}

export async function getAllPrices(): Promise<PriceCache> {
  return read();
}

/** Merge new month→price entries into the cache for one or many symbols. */
export async function upsertManyPrices(updates: PriceCache): Promise<void> {
  const cache = await read();
  for (const [symbol, prices] of Object.entries(updates)) {
    cache[symbol] = { ...cache[symbol], ...prices };
  }
  await write(cache);
}
