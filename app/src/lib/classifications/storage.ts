import fs from "fs/promises";
import path from "path";
import type { TickerAllocation } from "./index";

const DATA_DIR = process.env.PLAID_DATA_DIR ?? path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "ticker-classifications.json");

type LegacyEntry = { assetClass: string; region: string; classDetailed: string };

function normalize(raw: Record<string, TickerAllocation[] | LegacyEntry>): Record<string, TickerAllocation[]> {
  const out: Record<string, TickerAllocation[]> = {};
  for (const [ticker, val] of Object.entries(raw)) {
    if (Array.isArray(val)) {
      out[ticker] = val as TickerAllocation[];
    } else {
      out[ticker] = [{ weight: 1, assetClass: val.assetClass, region: val.region, classDetailed: val.classDetailed, sector: "" }];
    }
  }
  return out;
}

export async function getUserClassifications(): Promise<Record<string, TickerAllocation[]>> {
  try {
    const raw = JSON.parse(await fs.readFile(FILE, "utf-8")) as Record<string, TickerAllocation[] | LegacyEntry>;
    return normalize(raw);
  } catch {
    return {};
  }
}

export async function saveUserClassifications(
  updates: Record<string, TickerAllocation[]>
): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const existing = await getUserClassifications();
  await fs.writeFile(FILE, JSON.stringify({ ...existing, ...updates }, null, 2), "utf-8");
}
