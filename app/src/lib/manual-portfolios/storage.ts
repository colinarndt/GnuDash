import fs from "fs/promises";
import path from "path";

export interface ManualHolding {
  ticker: string;
  description: string | null;
  shares: number;
  price: number | null;
  marketValue?: number | null;
  costBasis: number | null;
  fetchPriceOnline: boolean;
}

export interface ManualPortfolio {
  id: string;
  name: string;
  holdings: ManualHolding[];
  createdAt: string;
  updatedAt: string;
  // populated by file import; absent for manually-entered portfolios
  institutionName?: string;
  accountNumber?: string;
  accountType?: string;
  source?: "manual" | "file-import";
  lastImported?: string;
  sourceFile?: string;
  balanceHistory?: { date: string; value: number }[];
}

const DATA_DIR = process.env.PLAID_DATA_DIR ?? path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "manual-portfolios.json");

export async function getPortfolios(): Promise<ManualPortfolio[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf-8")) as ManualPortfolio[];
  } catch {
    return [];
  }
}

function holdingValue(h: ManualHolding): number {
  if (h.price != null) return h.shares * h.price;
  return h.marketValue ?? 0;
}

function portfolioValue(holdings: ManualHolding[]): number {
  return holdings.reduce((s, h) => s + holdingValue(h), 0);
}

function withSnapshot(
  portfolio: ManualPortfolio,
  holdings: ManualHolding[]
): ManualPortfolio {
  const value = portfolioValue(holdings);
  if (value === 0) return portfolio;
  const today = new Date().toISOString().slice(0, 10);
  const history = (portfolio.balanceHistory ?? []).filter((e) => e.date !== today);
  return { ...portfolio, balanceHistory: [...history, { date: today, value }] };
}

async function savePortfolios(portfolios: ManualPortfolio[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(portfolios, null, 2), "utf-8");
}

export async function createPortfolio(
  data: Omit<ManualPortfolio, "id" | "createdAt" | "updatedAt">
): Promise<ManualPortfolio> {
  const portfolios = await getPortfolios();
  const now = new Date().toISOString();
  let portfolio: ManualPortfolio = {
    ...data,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  portfolio = withSnapshot(portfolio, data.holdings);
  portfolios.push(portfolio);
  await savePortfolios(portfolios);
  return portfolio;
}

export async function updatePortfolio(
  id: string,
  data: Omit<ManualPortfolio, "id" | "createdAt" | "updatedAt">
): Promise<ManualPortfolio | null> {
  const portfolios = await getPortfolios();
  const idx = portfolios.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  let updated: ManualPortfolio = { ...portfolios[idx], ...data, id, updatedAt: new Date().toISOString() };
  updated = withSnapshot(updated, data.holdings);
  portfolios[idx] = updated;
  await savePortfolios(portfolios);
  return portfolios[idx];
}

export async function deletePortfolio(id: string): Promise<boolean> {
  const portfolios = await getPortfolios();
  const filtered = portfolios.filter((p) => p.id !== id);
  if (filtered.length === portfolios.length) return false;
  await savePortfolios(filtered);
  return true;
}
