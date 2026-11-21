import fs from "fs/promises";
import path from "path";

const DATA_DIR = process.env.PLAID_DATA_DIR ?? path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "plaid-items.json");

const MAX_TRANSACTIONS = 10000;

export interface PlaidHolding {
  symbol: string;
  description: string | null;
  quantity: number;
  price: number | null;
  marketValue: number | null;
  costBasis: number | null;
  securityType: string | null;
  currency: string;
}

export interface StoredAccount {
  accountId: string;
  name: string;
  officialName: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
  balanceCurrent: number | null;
  balanceAvailable: number | null;
  displayName: string | null;
  accountType: string | null;
  hidden: boolean;
  balanceHistory?: { date: string; value: number }[];
}

export interface StoredTransaction {
  id: string;
  accountId: string;
  amount: number;
  date: string;
  name: string;
  merchantName: string | null;
  pending: boolean;
}

export interface StoredItem {
  itemId: string;
  accessToken: string;
  institutionId: string | null;
  institutionName: string | null;
  accounts: StoredAccount[];
  cursor: string | null;
  lastSynced: string | null;
  transactions: StoredTransaction[];
  holdings: Record<string, PlaidHolding[]>;
  displayName: string | null;
  connectedAt: string | null;
}

type Store = { items: StoredItem[] };

async function readStore(): Promise<Store> {
  try {
    const store = JSON.parse(await fs.readFile(DATA_FILE, "utf-8")) as Store;
    // backfill holdings field for items written before this field existed
    store.items = store.items.map((i) => ({ ...i, holdings: i.holdings ?? {} }));
    return store;
  } catch {
    return { items: [] };
  }
}

async function writeStore(store: Store): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2), "utf-8");
}

export async function getItems(): Promise<StoredItem[]> {
  return (await readStore()).items;
}

export async function upsertItem(
  item: Omit<StoredItem, "transactions" | "holdings">
): Promise<void> {
  const store = await readStore();
  const idx = store.items.findIndex((i) => i.itemId === item.itemId);
  if (idx >= 0) {
    store.items[idx] = { ...store.items[idx], ...item };
  } else {
    store.items.push({
      ...item,
      transactions: [],
      holdings: {},
      displayName: item.displayName ?? null,
      connectedAt: new Date().toISOString(),
    });
  }
  await writeStore(store);
}

export async function upsertHoldings(
  itemId: string,
  holdings: Record<string, PlaidHolding[]>
): Promise<void> {
  const store = await readStore();
  const item = store.items.find((i) => i.itemId === itemId);
  if (!item) return;
  item.holdings = holdings;
  item.lastSynced = new Date().toISOString();
  await writeStore(store);
}

export async function appendTransactions(
  itemId: string,
  added: StoredTransaction[],
  cursor: string
): Promise<number> {
  const store = await readStore();
  const item = store.items.find((i) => i.itemId === itemId);
  if (!item) return 0;
  const existingIds = new Set(item.transactions.map((t) => t.id));
  const fresh = added.filter((t) => !existingIds.has(t.id));
  item.transactions = [...item.transactions, ...fresh].slice(-MAX_TRANSACTIONS);
  item.cursor = cursor;
  item.lastSynced = new Date().toISOString();
  await writeStore(store);
  return fresh.length;
}

export async function updateAccountBalances(
  itemId: string,
  balances: { accountId: string; current: number | null; available: number | null }[]
): Promise<void> {
  const store = await readStore();
  const item = store.items.find((i) => i.itemId === itemId);
  if (!item) return;
  const today = new Date().toISOString().slice(0, 10);
  const map = new Map(balances.map((b) => [b.accountId, b]));
  item.accounts = item.accounts.map((a) => {
    const b = map.get(a.accountId);
    if (!b) return a;
    const value = b.current;
    const history = value != null
      ? [...(a.balanceHistory ?? []).filter((e) => e.date !== today), { date: today, value }]
      : a.balanceHistory;
    return { ...a, balanceCurrent: b.current, balanceAvailable: b.available, balanceHistory: history };
  });
  await writeStore(store);
}

export async function updateItemMeta(
  itemId: string,
  meta: { displayName?: string | null; accountTypes?: Record<string, string>; hiddenAccounts?: Record<string, boolean>; accountDisplayNames?: Record<string, string> }
): Promise<void> {
  const store = await readStore();
  const item = store.items.find((i) => i.itemId === itemId);
  if (!item) return;
  if ("displayName" in meta) item.displayName = meta.displayName ?? null;
  if (meta.accountTypes || meta.hiddenAccounts || meta.accountDisplayNames) {
    item.accounts = item.accounts.map((a) => {
      const updates: Partial<StoredAccount> = {};
      if (meta.accountTypes && a.accountId in meta.accountTypes) updates.accountType = meta.accountTypes[a.accountId] || null;
      if (meta.hiddenAccounts && a.accountId in meta.hiddenAccounts) updates.hidden = meta.hiddenAccounts[a.accountId];
      if (meta.accountDisplayNames && a.accountId in meta.accountDisplayNames) updates.displayName = meta.accountDisplayNames[a.accountId] || null;
      return Object.keys(updates).length ? { ...a, ...updates } : a;
    });
  }
  await writeStore(store);
}

export async function removeItem(itemId: string): Promise<void> {
  const store = await readStore();
  store.items = store.items.filter((i) => i.itemId !== itemId);
  await writeStore(store);
}
