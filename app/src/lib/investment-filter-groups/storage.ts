import fs from "fs/promises";
import path from "path";

const DATA_DIR = process.env.PLAID_DATA_DIR ?? path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "investment-filter-groups.json");

export interface FilterGroup {
  label: string;
  paths: string[];
  accountType?: string;
}

export const DEFAULT_FILTER_GROUPS: FilterGroup[] = [
  { label: "Retirement", paths: ["Assets:Retirement"] },
  { label: "Tax-Advantaged", paths: ["Assets:Retirement", "Banks:HSA"] },
  { label: "Taxable", paths: ["Assets:Crypto", "Banks:Kraken"] },
  { label: "Real Estate", paths: ["Assets:Fixed Assets:Ravenwing Condo"] },
  { label: "Cash", paths: ["Assets:Retirement", "Banks:HSA", "Banks:Kraken"], accountType: "CASH" },
];

export async function getFilterGroups(): Promise<FilterGroup[]> {
  try {
    const raw = await fs.readFile(FILE, "utf-8");
    return JSON.parse(raw) as FilterGroup[];
  } catch {
    return DEFAULT_FILTER_GROUPS;
  }
}

export async function replaceFilterGroups(groups: FilterGroup[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(groups, null, 2), "utf-8");
}
