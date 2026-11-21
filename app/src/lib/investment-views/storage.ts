import fs from "fs/promises";
import path from "path";

const DATA_DIR = process.env.PLAID_DATA_DIR ?? path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "investment-views.json");

export interface InvestmentView {
  id: string;
  name: string;
  selectedAccounts: string[];
  createdAt: string;
  updatedAt: string;
  /** Exactly one view per file may have isDefault = true; applied on page load when no view is active. */
  isDefault?: boolean;
}

async function read(): Promise<InvestmentView[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf-8")) as InvestmentView[];
  } catch {
    return [];
  }
}

async function write(views: InvestmentView[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(views, null, 2), "utf-8");
}

export async function getViews(): Promise<InvestmentView[]> {
  return read();
}

export async function createView(name: string, selectedAccounts: string[]): Promise<InvestmentView> {
  const views = await read();
  const now = new Date().toISOString();
  const view: InvestmentView = { id: crypto.randomUUID(), name, selectedAccounts, createdAt: now, updatedAt: now };
  views.push(view);
  await write(views);
  return view;
}

export async function updateView(
  id: string,
  patch: { name?: string; selectedAccounts?: string[] },
): Promise<InvestmentView | null> {
  const views = await read();
  const idx = views.findIndex((v) => v.id === id);
  if (idx === -1) return null;
  views[idx] = { ...views[idx], ...patch, updatedAt: new Date().toISOString() };
  await write(views);
  return views[idx];
}

export async function deleteView(id: string): Promise<boolean> {
  const views = await read();
  const filtered = views.filter((v) => v.id !== id);
  if (filtered.length === views.length) return false;
  await write(filtered);
  return true;
}

/**
 * Mark a single view as the default (and clear isDefault on all others).
 * Pass id = null to clear all defaults.
 */
export async function setDefaultView(id: string | null): Promise<InvestmentView[]> {
  const views = await read();
  const now = new Date().toISOString();
  const next = views.map((v) => {
    const shouldBeDefault = v.id === id;
    if (!!v.isDefault === shouldBeDefault) return v;
    return { ...v, isDefault: shouldBeDefault, updatedAt: now };
  });
  await write(next);
  return next;
}
