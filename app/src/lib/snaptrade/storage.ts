import fs from "fs/promises";
import path from "path";

const DATA_DIR = process.env.PLAID_DATA_DIR ?? path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "snaptrade-data.json");

export interface SnapTradeHolding {
  symbol: string;
  description: string | null;
  quantity: number;
  price: number | null;
  marketValue: number | null;
  costBasis: number | null;
  currency: string;
}

export interface SnapTradeTransaction {
  id: string;
  date: string;
  type: string;
  symbol: string | null;
  description: string | null;
  quantity: number | null;
  price: number | null;
  amount: number | null;
  fee: number | null;
  currency: string;
}

export interface SnapTradeAccount {
  id: string;
  authorizationId: string;
  brokerage: string;
  name: string;
  number: string | null;
  currency: string;
  type: string | null;
  balance: number | null;
  accountType: string | null;
  hidden: boolean;
  displayName: string | null;
}

export interface SnapTradeBalancePoint {
  date: string;  // YYYY-MM-DD
  value: number;
}

export interface SnapTradeAuthorization {
  authorizationId: string;
  brokerage: string;
  accounts: SnapTradeAccount[];
  holdings: Record<string, SnapTradeHolding[]>;
  transactions: Record<string, SnapTradeTransaction[]>;
  /** Daily balance history per accountId, populated by getAccountBalanceHistory. */
  balanceHistory: Record<string, SnapTradeBalancePoint[]>;
  lastSynced: string | null;
  displayName: string | null;
  connectedAt: string | null;
}

interface Store {
  user: { userId: string; userSecret: string } | null;
  authorizations: SnapTradeAuthorization[];
}

async function readStore(): Promise<Store> {
  try {
    return JSON.parse(await fs.readFile(DATA_FILE, "utf-8")) as Store;
  } catch {
    return { user: null, authorizations: [] };
  }
}

async function writeStore(store: Store): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2), "utf-8");
}

export async function getSnapTradeUser(): Promise<{ userId: string; userSecret: string } | null> {
  return (await readStore()).user;
}

export async function saveSnapTradeUser(userId: string, userSecret: string): Promise<void> {
  const store = await readStore();
  store.user = { userId, userSecret };
  await writeStore(store);
}

export async function getAuthorizations(): Promise<SnapTradeAuthorization[]> {
  return (await readStore()).authorizations;
}

/** An account as SnapTrade reports it, before the user's local settings are applied. */
export type IncomingSnapTradeAccount = Omit<SnapTradeAccount, "accountType" | "hidden" | "displayName">;

export async function upsertAuthorization(
  auth: Omit<
    SnapTradeAuthorization,
    "accounts" | "holdings" | "transactions" | "balanceHistory" | "lastSynced" | "displayName" | "connectedAt"
  > & { accounts: IncomingSnapTradeAccount[] },
): Promise<void> {
  const store = await readStore();
  const idx = store.authorizations.findIndex((a) => a.authorizationId === auth.authorizationId);
  if (idx >= 0) {
    const existing = store.authorizations[idx];
    const mergedAccounts = auth.accounts.map((a) => {
      const prev = existing.accounts.find((e) => e.id === a.id);
      return prev
        ? { ...a, accountType: prev.accountType, hidden: prev.hidden, displayName: prev.displayName ?? null }
        : { ...a, accountType: null, hidden: false, displayName: null };
    });
    store.authorizations[idx] = { ...existing, ...auth, accounts: mergedAccounts };
  } else {
    store.authorizations.push({
      ...auth,
      accounts: auth.accounts.map((a) => ({ ...a, accountType: null, hidden: false, displayName: null })),
      holdings: {},
      transactions: {},
      balanceHistory: {},
      lastSynced: null,
      displayName: null,
      connectedAt: new Date().toISOString(),
    });
  }
  await writeStore(store);
}

export async function updateAuthorizationSync(
  authorizationId: string,
  holdings: Record<string, SnapTradeHolding[]>,
  transactions: Record<string, SnapTradeTransaction[]>,
  balances: Record<string, number | null> = {},
  balanceHistory: Record<string, SnapTradeBalancePoint[]> = {}
): Promise<void> {
  const store = await readStore();
  const auth = store.authorizations.find((a) => a.authorizationId === authorizationId);
  if (!auth) return;
  auth.holdings = holdings;
  for (const [accountId, newTxns] of Object.entries(transactions)) {
    const existing = auth.transactions[accountId] ?? [];
    const existingIds = new Set(existing.map((t) => t.id));
    auth.transactions[accountId] = [...existing, ...newTxns.filter((t) => !existingIds.has(t.id))];
  }
  auth.accounts = auth.accounts.map((a) =>
    a.id in balances ? { ...a, balance: balances[a.id] } : a
  );
  if (!auth.balanceHistory) auth.balanceHistory = {};
  for (const [accountId, points] of Object.entries(balanceHistory)) {
    auth.balanceHistory[accountId] = points;
  }
  auth.lastSynced = new Date().toISOString();
  await writeStore(store);
}

export async function updateAuthorizationMeta(
  authorizationId: string,
  meta: { displayName?: string | null; accountTypes?: Record<string, string>; hiddenAccounts?: Record<string, boolean>; accountDisplayNames?: Record<string, string> }
): Promise<void> {
  const store = await readStore();
  const auth = store.authorizations.find((a) => a.authorizationId === authorizationId);
  if (!auth) return;
  if ("displayName" in meta) auth.displayName = meta.displayName ?? null;
  if (meta.accountTypes || meta.hiddenAccounts || meta.accountDisplayNames) {
    auth.accounts = auth.accounts.map((a) => {
      const updates: Partial<SnapTradeAccount> = {};
      if (meta.accountTypes && a.id in meta.accountTypes) updates.accountType = meta.accountTypes[a.id] || null;
      if (meta.hiddenAccounts && a.id in meta.hiddenAccounts) updates.hidden = meta.hiddenAccounts[a.id];
      if (meta.accountDisplayNames && a.id in meta.accountDisplayNames) updates.displayName = meta.accountDisplayNames[a.id] || null;
      return Object.keys(updates).length ? { ...a, ...updates } : a;
    });
  }
  await writeStore(store);
}

export async function removeAuthorization(authorizationId: string): Promise<void> {
  const store = await readStore();
  store.authorizations = store.authorizations.filter((a) => a.authorizationId !== authorizationId);
  await writeStore(store);
}
