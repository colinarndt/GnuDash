"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ChevronDown,
  ChevronRight,
  CreditCard,
  Download,
  Info,
  Landmark,
  Loader2,
  Plus,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { PortfolioDialog } from "@/components/manual/portfolio-dialog";
import { ImportStatementDialog } from "@/components/manual/import-statement-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PropertyDialog } from "@/components/manual/property-dialog";
import type { ManualPortfolio } from "@/lib/manual-portfolios/storage";
import type { RealEstateProperty } from "@/lib/real-estate/types";
import { totalCostBasis } from "@/lib/real-estate/types";

function last4(num: string | null | undefined): string | null {
  if (!num) return null;
  return num.replace(/\s/g, "").slice(-4) || null;
}

const BANK_CREDIT_ACCOUNT_TYPES = new Set(["checking", "savings", "money_market", "cd", "credit_card"]);
function isBankOrCredit(plaidType?: string, accountType?: string | null): boolean {
  if (plaidType === "depository" || plaidType === "credit") return true;
  return accountType != null && BANK_CREDIT_ACCOUNT_TYPES.has(accountType);
}

const ACCOUNT_TYPES = [
  { value: "", label: "— Select type —" },
  { value: "roth_ira", label: "Roth IRA" },
  { value: "traditional_ira", label: "Traditional IRA" },
  { value: "roth_401k", label: "Roth 401(k)" },
  { value: "traditional_401k", label: "Traditional 401(k)" },
  { value: "403b", label: "403(b)" },
  { value: "457b", label: "457(b)" },
  { value: "sep_ira", label: "SEP-IRA" },
  { value: "solo_401k", label: "Solo 401(k)" },
  { value: "simple_ira", label: "SIMPLE IRA" },
  { value: "pension", label: "Pension" },
  { value: "hsa", label: "HSA" },
  { value: "529", label: "529 Plan" },
  { value: "taxable", label: "Taxable Brokerage" },
  { value: "checking", label: "Checking" },
  { value: "savings", label: "Savings" },
  { value: "money_market", label: "Money Market" },
  { value: "cd", label: "CD / Certificate of Deposit" },
  { value: "credit_card", label: "Credit Card" },
  { value: "other", label: "Other" },
];

// SnapTrade types
interface SnapTradeHolding {
  symbol: string;
  description: string | null;
  quantity: number;
  price: number | null;
  marketValue: number | null;
  costBasis: number | null;
  currency: string;
}

interface SnapTradeAccount {
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

interface SnapTradeTransaction {
  id: string;
  date: string;
  type: string;
  symbol: string | null;
  description: string | null;
  amount: number | null;
  currency: string;
}

interface SnapTradeAuthorization {
  authorizationId: string;
  brokerage: string;
  accounts: SnapTradeAccount[];
  holdings: Record<string, SnapTradeHolding[]>;
  transactions: Record<string, SnapTradeTransaction[]>;
  lastSynced: string | null;
  displayName: string | null;
  connectedAt: string | null;
}

interface PlaidHolding {
  symbol: string;
  description: string | null;
  quantity: number;
  price: number | null;
  marketValue: number | null;
  costBasis: number | null;
  securityType: string | null;
  currency: string;
}

interface SafeAccount {
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
}

interface SafeItem {
  itemId: string;
  institutionId: string | null;
  institutionName: string | null;
  accounts: SafeAccount[];
  cursor: string | null;
  lastSynced: string | null;
  transactionCounts: Record<string, number>;
  holdings: Record<string, PlaidHolding[]>;
  transactions: {
    id: string;
    accountId: string;
    amount: number;
    date: string;
    name: string;
    merchantName: string | null;
    pending: boolean;
  }[];
  displayName: string | null;
  connectedAt: string | null;
}

// Info dialog state
interface InfoState {
  kind: "plaid" | "snap";
  id: string;
  service: string;
  institutionName: string;
  connectedAt: string | null;
  lastSynced: string | null;
  displayName: string;
  accounts: { id: string; name: string; displayName: string; accountType: string; hidden: boolean }[];
}

export default function ConnectionsPage() {
  const [items, setItems] = useState<SafeItem[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [downloading, setDownloading] = useState<Record<string, boolean>>({});
  const [snapAuths, setSnapAuths] = useState<SnapTradeAuthorization[]>([]);
  const [snapRefreshing, setSnapRefreshing] = useState(false);
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const [infoState, setInfoState] = useState<InfoState | null>(null);
  const [infoSaving, setInfoSaving] = useState(false);
  const [infoDeleting, setInfoDeleting] = useState(false);
  const [manualPortfolios, setManualPortfolios] = useState<ManualPortfolio[]>([]);
  const [manualDialogOpen, setManualDialogOpen] = useState(false);
  const [editingPortfolio, setEditingPortfolio] = useState<ManualPortfolio | undefined>(undefined);
  const [syncingPrices, setSyncingPrices] = useState(false);
  const [realEstateProperties, setRealEstateProperties] = useState<RealEstateProperty[]>([]);
  const [propertyDialogOpen, setPropertyDialogOpen] = useState(false);
  const [editingProperty, setEditingProperty] = useState<RealEstateProperty | undefined>(undefined);
  const [importingInstitution, setImportingInstitution] = useState<string | null>(null);
  const [refreshingProperty, setRefreshingProperty] = useState<Record<string, boolean>>({});

  function toggleAccount(accountId: string) {
    setExpandedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  }

  function openPlaidInfo(item: SafeItem) {
    setInfoState({
      kind: "plaid",
      id: item.itemId,
      service: "Plaid",
      institutionName: item.institutionName ?? "Unknown Institution",
      connectedAt: item.connectedAt,
      lastSynced: item.lastSynced,
      displayName: item.displayName ?? "",
      accounts: item.accounts.map((a) => ({ id: a.accountId, name: a.name, displayName: a.displayName ?? "", accountType: a.accountType ?? "", hidden: a.hidden ?? false })),
    });
  }

  function openSnapInfo(auth: SnapTradeAuthorization) {
    setInfoState({
      kind: "snap",
      id: auth.authorizationId,
      service: "SnapTrade",
      institutionName: auth.brokerage,
      connectedAt: auth.connectedAt,
      lastSynced: auth.lastSynced,
      displayName: auth.displayName ?? "",
      accounts: auth.accounts.map((a) => ({ id: a.id, name: a.name, displayName: a.displayName ?? "", accountType: a.accountType ?? "", hidden: a.hidden ?? false })),
    });
  }

  function updateInfoAccountType(accountId: string, value: string) {
    setInfoState((s) =>
      s ? { ...s, accounts: s.accounts.map((a) => a.id === accountId ? { ...a, accountType: value } : a) } : s
    );
  }

  function updateInfoAccountDisplayName(accountId: string, value: string) {
    setInfoState((s) =>
      s ? { ...s, accounts: s.accounts.map((a) => a.id === accountId ? { ...a, displayName: value } : a) } : s
    );
  }

  function toggleInfoAccountHidden(accountId: string) {
    setInfoState((s) =>
      s ? { ...s, accounts: s.accounts.map((a) => a.id === accountId ? { ...a, hidden: !a.hidden } : a) } : s
    );
  }

  async function saveInfo() {
    if (!infoState) return;
    setInfoSaving(true);
    try {
      const accountTypes = Object.fromEntries(infoState.accounts.map((a) => [a.id, a.accountType]));
      const hiddenAccounts = Object.fromEntries(infoState.accounts.map((a) => [a.id, a.hidden]));
      const accountDisplayNames = Object.fromEntries(infoState.accounts.map((a) => [a.id, a.displayName]));
      if (infoState.kind === "plaid") {
        await fetch("/api/plaid/items", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ item_id: infoState.id, display_name: infoState.displayName || null, account_types: accountTypes, hidden_accounts: hiddenAccounts, account_display_names: accountDisplayNames }),
        });
        await refreshItems();
      } else {
        await fetch("/api/snaptrade/accounts", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ authorization_id: infoState.id, display_name: infoState.displayName || null, account_types: accountTypes, hidden_accounts: hiddenAccounts, account_display_names: accountDisplayNames }),
        });
        await refreshSnapAuths();
      }
      setInfoState(null);
    } finally {
      setInfoSaving(false);
    }
  }

  async function deleteFromInfo() {
    if (!infoState) return;
    const label = infoState.displayName || infoState.institutionName;
    if (!confirm(`Remove ${label}? This deletes all stored data for this connection.`)) return;
    setInfoDeleting(true);
    try {
      if (infoState.kind === "plaid") {
        await fetch("/api/plaid/items", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ item_id: infoState.id }),
        });
        await refreshItems();
      } else {
        await fetch("/api/snaptrade/accounts", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ authorization_id: infoState.id }),
        });
        await refreshSnapAuths();
      }
      setInfoState(null);
    } finally {
      setInfoDeleting(false);
    }
  }

  const refreshItems = useCallback(async () => {
    const res = await fetch("/api/plaid/items");
    if (res.ok) setItems(((await res.json()) as { items: SafeItem[] }).items);
  }, []);

  const refreshSnapAuths = useCallback(async () => {
    const res = await fetch("/api/snaptrade/accounts");
    if (res.ok) setSnapAuths(((await res.json()) as { authorizations: SnapTradeAuthorization[] }).authorizations);
  }, []);

  const refreshManualPortfolios = useCallback(async () => {
    const res = await fetch("/api/manual-portfolios");
    if (res.ok) setManualPortfolios(((await res.json()) as { portfolios: ManualPortfolio[] }).portfolios);
  }, []);

  async function syncManualPrices(force = true) {
    setSyncingPrices(true);
    try {
      await fetch("/api/manual-portfolios/sync-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      await refreshManualPortfolios();
    } finally {
      setSyncingPrices(false);
    }
  }

  const refreshRealEstate = useCallback(async () => {
    const res = await fetch("/api/real-estate");
    if (res.ok) setRealEstateProperties(((await res.json()) as { properties: RealEstateProperty[] }).properties);
  }, []);

  async function refreshProperty(id: string) {
    setRefreshingProperty((r) => ({ ...r, [id]: true }));
    try {
      await fetch(`/api/real-estate/${id}`, { method: "POST" });
      await refreshRealEstate();
    } finally {
      setRefreshingProperty((r) => ({ ...r, [id]: false }));
    }
  }


  async function refreshAll() {
    setSnapRefreshing(true);
    try {
      await Promise.allSettled([
        fetch("/api/snaptrade/refresh", { method: "POST" }),
        ...items.map((item) =>
          fetch("/api/plaid/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ item_id: item.itemId }),
          })
        ),
        fetch("/api/manual-portfolios/sync-prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force: true }),
        }),
        ...realEstateProperties.map((p) =>
          fetch(`/api/real-estate/${p.id}`, { method: "POST" })
        ),
      ]);
      await Promise.all([
        refreshSnapAuths(),
        refreshItems(),
        refreshManualPortfolios(),
        refreshRealEstate(),
      ]);
    } finally {
      setSnapRefreshing(false);
    }
  }

  async function syncSnapAuth(authorizationId: string) {
    setSyncing((s) => ({ ...s, [authorizationId]: true }));
    try {
      await fetch("/api/snaptrade/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorization_id: authorizationId }),
      });
      await refreshSnapAuths();
    } finally {
      setSyncing((s) => ({ ...s, [authorizationId]: false }));
    }
  }

  function downloadPlaidHoldingsCsv(item: SafeItem, account: SafeAccount) {
    const holdings = item.holdings[account.accountId] ?? [];
    const rows: string[][] = [
      ["Symbol", "Description", "Quantity", "Price", "Market Value", "Cost Basis", "Type", "Currency"],
      ...holdings.map((h) => [
        h.symbol,
        h.description ?? "",
        h.quantity.toString(),
        h.price?.toString() ?? "",
        h.marketValue?.toString() ?? "",
        h.costBasis?.toString() ?? "",
        h.securityType ?? "",
        h.currency,
      ]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const label = `${item.institutionName ?? "plaid"}-${account.name}${account.mask ? `-${account.mask}` : ""}`;
    a.download = label.replace(/[^a-z0-9-]/gi, "_").toLowerCase() + "-holdings.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function downloadHoldingsCsv(auth: SnapTradeAuthorization, account: SnapTradeAccount, label: string) {
    const holdings = auth.holdings[account.id] ?? [];
    const rows: string[][] = [
      ["Symbol", "Description", "Quantity", "Price", "Market Value", "Cost Basis", "Currency"],
      ...holdings.map((h) => [
        h.symbol,
        h.description ?? "",
        h.quantity.toString(),
        h.price?.toString() ?? "",
        h.marketValue?.toString() ?? "",
        h.costBasis?.toString() ?? "",
        h.currency,
      ]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = label.replace(/[^a-z0-9-]/gi, "_").toLowerCase() + "-holdings.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function downloadSnapCsv(authorizationId: string, accountId: string, label: string) {
    setDownloading((d) => ({ ...d, [accountId]: true }));
    try {
      const res = await fetch("/api/snaptrade/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorization_id: authorizationId, account_id: accountId }),
      });
      if (!res.ok) { alert(((await res.json()) as { error: string }).error); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = label.replace(/[^a-z0-9-]/gi, "_").toLowerCase() + ".csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setDownloading((d) => ({ ...d, [accountId]: false }));
    }
  }

  useEffect(() => {
    Promise.all([refreshItems(), refreshSnapAuths(), refreshManualPortfolios(), refreshRealEstate()]).finally(() =>
      setPageLoading(false)
    );
  }, [refreshItems, refreshSnapAuths, refreshManualPortfolios, refreshRealEstate]);

  async function syncItem(itemId: string) {
    setSyncing((s) => ({ ...s, [itemId]: true }));
    try {
      await fetch("/api/plaid/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: itemId }),
      });
      await refreshItems();
    } finally {
      setSyncing((s) => ({ ...s, [itemId]: false }));
    }
  }

  if (pageLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Accounts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your connected accounts and portfolios.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={refreshAll} disabled={snapRefreshing} title="Refresh all accounts">
            {snapRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          <Link
            href="/add-account"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#3B6B8A] text-white transition-colors hover:bg-[#2D5570]"
            title="Add account"
          >
            <Plus className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* Empty state */}
      {items.length === 0 && snapAuths.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <Landmark className="mb-4 h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm font-medium text-muted-foreground">No accounts connected yet</p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Use <a href="/add-account" className="underline underline-offset-2">Add Account</a> to link a brokerage or bank account.
          </p>
        </div>
      )}

      {/* Accounts grouped by type */}
      {(items.length > 0 || snapAuths.length > 0) && (() => {
        type Group = {
          label: string;
          types: string[];
          Icon: React.ElementType;
          getBalance: (a: SafeAccount) => number | null;
        };
        const knownTypes = new Set(["depository", "credit", "investment"]);
        const otherTypes = [...new Set(items.flatMap((i) => i.accounts.map((a) => a.type)).filter((t) => !knownTypes.has(t)))];
        const groups: Group[] = [
          { label: "Banks", types: ["depository"], Icon: Landmark, getBalance: (a) => a.balanceAvailable ?? a.balanceCurrent },
          { label: "Credit Cards", types: ["credit"], Icon: CreditCard, getBalance: (a) => a.balanceCurrent },
          { label: "Portfolio", types: ["investment"], Icon: TrendingUp, getBalance: (a) => a.balanceCurrent },
          ...(otherTypes.length > 0 ? [{ label: "Other", types: otherTypes, Icon: Landmark, getBalance: (a: SafeAccount) => a.balanceCurrent }] : []),
        ];

        return (
          <div className="space-y-8">
            {groups.map((group) => {
              const isPortfolio = group.label === "Portfolio";
              const groupedItems = items
                .map((item) => ({ ...item, accounts: item.accounts.filter((a) => group.types.includes(a.type) && !a.hidden) }))
                .filter((item) => item.accounts.length > 0);
              if (groupedItems.length === 0 && !(isPortfolio && snapAuths.length > 0)) return null;

              const sectionBalances = groupedItems
                .flatMap((i) => i.accounts)
                .map((a) => group.getBalance(a))
                .filter((b): b is number => b != null);
              const snapTotal = isPortfolio
                ? snapAuths.flatMap((a) => a.accounts).filter((a) => !a.hidden).map((a) => a.balance).filter((b): b is number => b != null).reduce((s, b) => s + b, 0)
                : 0;
              const allBalances = [...sectionBalances, ...(isPortfolio ? [snapTotal] : [])];
              const total = allBalances.length > 0 ? allBalances.reduce((s, b) => s + b, 0) : null;

              return (
                <section key={group.label} className="space-y-3">
                  <div className="flex items-center justify-between border-b border-border pb-2">
                    <div className="flex items-center gap-2">
                      <group.Icon className="h-4 w-4 text-muted-foreground/70" />
                      <h2 className="text-sm font-semibold">{group.label}</h2>
                    </div>
                    {total != null && (
                      <span className="text-sm font-medium" data-v>
                        ${total.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </span>
                    )}
                  </div>

                  <div className="space-y-3">
                    {/* Plaid institution cards */}
                    {groupedItems.sort((a, b) => (a.displayName ?? a.institutionName ?? "").localeCompare(b.displayName ?? b.institutionName ?? "")).map((item) => {
                      const itemBalances = item.accounts.map((a) => group.getBalance(a)).filter((b): b is number => b != null);
                      const itemTotal = itemBalances.length > 0 ? itemBalances.reduce((s, b) => s + b, 0) : null;
                      return (
                      <Card key={item.itemId}>
                        <CardHeader className="pb-3">
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-1">
                              <CardTitle className="text-base">
                                {item.displayName ?? item.institutionName ?? "Unknown Institution"}
                              </CardTitle>
                              <Button variant="ghost" size="sm" onClick={() => syncItem(item.itemId)} disabled={syncing[item.itemId]} title="Sync" className="h-6 w-6 p-0 text-muted-foreground/50 hover:text-foreground">
                                {syncing[item.itemId] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => openPlaidInfo(item)} title="Connection details" className="h-6 w-6 p-0 text-muted-foreground/50 hover:text-foreground">
                                <Info className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                            {itemTotal != null && (
                              <span className="text-base font-semibold" data-v>
                                ${itemTotal.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                              </span>
                            )}
                          </div>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <div className="divide-y divide-border rounded-lg border border-border">
                            {item.accounts.map((account) => {
                              const isInvestment = account.type === "investment";
                              const label = `${item.institutionName ?? "bank"}-${account.name}${account.mask ? `-${account.mask}` : ""}`;
                              const bal = group.getBalance(account);
                              const typeLabel = account.accountType
                                ? ACCOUNT_TYPES.find((t) => t.value === account.accountType)?.label ?? account.accountType
                                : account.subtype?.replace(/_/g, " ");
                              const holdings = isInvestment ? (item.holdings[account.accountId] ?? []) : [];
                              const accountTxns = !isInvestment
                                ? item.transactions
                                    .filter((t) => t.accountId === account.accountId)
                                    .sort((a, b) => b.date.localeCompare(a.date))
                                    .slice(0, 100)
                                : [];
                              const hasContent = isInvestment ? holdings.length > 0 : accountTxns.length > 0;
                              const isExpanded = expandedAccounts.has(account.accountId);
                              return (
                                <div key={account.accountId}>
                                  <div className="flex items-center justify-between px-4 py-3">
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() => toggleAccount(account.accountId)}
                                        className={`text-muted-foreground/50 hover:text-foreground transition-colors ${!hasContent ? "invisible" : ""}`}
                                      >
                                        {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                      </button>
                                      <div>
                                        <p className="text-sm font-medium">
                                          {account.displayName ?? account.name}
                                          {account.mask && (
                                            <span className="ml-1.5 font-normal text-muted-foreground/60">
                                              &bull;&bull;&bull;&bull; {account.mask}
                                            </span>
                                          )}
                                        </p>
                                        {typeLabel && (
                                          <p className="mt-0.5 text-xs capitalize text-muted-foreground/50">{typeLabel}</p>
                                        )}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {bal != null && (
                                        <Badge variant="secondary" className="text-xs">
                                          <span data-v>${bal.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                                        </Badge>
                                      )}
                                      {isInvestment && (
                                        <Button
                                          variant="outline" size="sm"
                                          onClick={() => downloadPlaidHoldingsCsv(item, account)}
                                          disabled={holdings.length === 0}
                                          title={holdings.length === 0 ? "No holdings yet — click Sync first" : "Download holdings snapshot as CSV"}
                                        >
                                          <Download className="mr-1.5 h-3.5 w-3.5" />
                                          Holdings (CSV)
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                  {isInvestment && isExpanded && holdings.length > 0 && (
                                    <div className="border-t border-border bg-muted/30 px-4 pb-3 pt-2">
                                      <table className="w-full text-xs">
                                        <thead>
                                          <tr className="border-b border-border text-muted-foreground/60">
                                            <th className="pb-2 text-left font-medium">Symbol</th>
                                            <th className="pb-2 text-left font-medium">Description</th>
                                            <th className="pb-2 text-right font-medium">Qty</th>
                                            <th className="pb-2 text-right font-medium">Price</th>
                                            <th className="pb-2 text-right font-medium">Market Value</th>
                                            <th className="pb-2 text-right font-medium">Cost Basis</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {holdings.map((h, i) => (
                                            <tr key={i} className="border-b border-border/50 last:border-0">
                                              <td className="py-1.5 pr-3 font-medium">{h.symbol}</td>
                                              <td className="py-1.5 pr-3 text-muted-foreground/70 max-w-[200px] truncate">{h.description ?? "—"}</td>
                                              <td className="py-1.5 text-right">{h.quantity.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
                                              <td className="py-1.5 pl-3 text-right" data-v>{h.price != null ? `$${h.price.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "—"}</td>
                                              <td className="py-1.5 pl-3 text-right" data-v>{h.marketValue != null ? `$${h.marketValue.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "—"}</td>
                                              <td className="py-1.5 pl-3 text-right" data-v>{h.costBasis != null ? `$${h.costBasis.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "—"}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                  {!isInvestment && isExpanded && accountTxns.length > 0 && (
                                    <div className="border-t border-border bg-muted/30 px-4 pb-3 pt-2">
                                      <table className="w-full text-xs">
                                        <thead>
                                          <tr className="border-b border-border text-muted-foreground/60">
                                            <th className="pb-2 text-left font-medium">Date</th>
                                            <th className="pb-2 text-left font-medium">Description</th>
                                            <th className="pb-2 text-right font-medium">Amount</th>
                                            <th className="pb-2 text-right font-medium">Status</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {accountTxns.map((t) => {
                                            const isInflow = t.amount < 0;
                                            return (
                                              <tr key={t.id} className="border-b border-border/50 last:border-0">
                                                <td className="py-1.5 pr-3 text-muted-foreground/70 whitespace-nowrap">{t.date}</td>
                                                <td className="py-1.5 pr-3 max-w-[240px] truncate">{t.merchantName ?? t.name}</td>
                                                <td className={`py-1.5 pl-3 text-right font-mono ${isInflow ? "text-green-600 dark:text-green-400" : ""}`}>
                                                  {isInflow ? "+" : "−"}${Math.abs(t.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </td>
                                                <td className="py-1.5 pl-3 text-right text-muted-foreground/50">
                                                  {t.pending ? "Pending" : ""}
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          {!item.lastSynced && (
                            <p className="mt-2 text-xs text-muted-foreground/50">
                              Click Sync to fetch transactions from this institution.
                            </p>
                          )}
                        </CardContent>
                      </Card>
                      );
                    })}

                    {/* SnapTrade authorization cards — only in Portfolio section */}
                    {isPortfolio && [...snapAuths].sort((a, b) => (a.displayName ?? a.brokerage).localeCompare(b.displayName ?? b.brokerage)).map((auth) => {
                      const authBalances = auth.accounts.filter((a) => !a.hidden).map((a) => a.balance).filter((b): b is number => b != null);
                      const authTotal = authBalances.length > 0 ? authBalances.reduce((s, b) => s + b, 0) : null;
                      return (
                      <Card key={auth.authorizationId}>
                        <CardHeader className="pb-3">
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-1">
                              <CardTitle className="text-base">{auth.displayName ?? auth.brokerage}</CardTitle>
                              <Button variant="ghost" size="sm" onClick={() => syncSnapAuth(auth.authorizationId)} disabled={syncing[auth.authorizationId]} title="Sync" className="h-6 w-6 p-0 text-muted-foreground/50 hover:text-foreground">
                                {syncing[auth.authorizationId] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => openSnapInfo(auth)} title="Connection details" className="h-6 w-6 p-0 text-muted-foreground/50 hover:text-foreground">
                                <Info className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                            {authTotal != null && (
                              <span className="text-base font-semibold" data-v>
                                ${authTotal.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                              </span>
                            )}
                          </div>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <div className="divide-y divide-border rounded-lg border border-border">
                            {auth.accounts.filter((a) => !a.hidden).map((account) => {
                              const holdings = auth.holdings[account.id] ?? [];
                              const balance = account.balance;
                              const acctLast4 = last4(account.number);
                              const label = `${auth.brokerage}-${account.name}${acctLast4 ? `-${acctLast4}` : ""}`;
                              const hasHoldings = holdings.length > 0;
                              const isSnapBankCredit = isBankOrCredit(undefined, account.accountType);
                              const snapTxns = isSnapBankCredit
                                ? (auth.transactions[account.id] ?? []).slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100)
                                : [];
                              const hasContent = isSnapBankCredit ? snapTxns.length > 0 : hasHoldings;
                              const isExpanded = expandedAccounts.has(account.id);
                              const typeLabel = account.accountType
                                ? ACCOUNT_TYPES.find((t) => t.value === account.accountType)?.label ?? account.accountType
                                : account.type;
                              return (
                                <div key={account.id}>
                                  <div className="flex items-center justify-between px-4 py-3">
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() => toggleAccount(account.id)}
                                        className={`text-muted-foreground/50 hover:text-foreground transition-colors ${!hasContent ? "invisible" : ""}`}
                                        title={hasContent ? (isExpanded ? "Collapse" : "Expand") : undefined}
                                      >
                                        {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                      </button>
                                      <div>
                                        <p className="text-sm font-medium">
                                          {account.displayName ?? account.name}
                                          {acctLast4 && <span className="ml-1.5 font-normal text-muted-foreground/60">&bull;&bull;&bull;&bull; {acctLast4}</span>}
                                        </p>
                                        {typeLabel && <p className="mt-0.5 text-xs capitalize text-muted-foreground/50">{typeLabel.replace(/_/g, " ")}</p>}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {balance != null && (
                                        <Badge variant="secondary" className="text-xs">
                                          <span data-v>${balance.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                                        </Badge>
                                      )}
                                      {!isSnapBankCredit && (
                                        <Button
                                          variant="outline" size="sm"
                                          onClick={() => downloadHoldingsCsv(auth, account, label)}
                                          disabled={!hasHoldings}
                                          title={hasHoldings ? "Download holdings snapshot as CSV" : "No holdings yet — click Sync first"}
                                        >
                                          <Download className="mr-1.5 h-3.5 w-3.5" />
                                          Holdings (CSV)
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                  {!isSnapBankCredit && isExpanded && hasHoldings && (
                                    <div className="border-t border-border bg-muted/30 px-4 pb-3 pt-2">
                                      <table className="w-full text-xs">
                                        <thead>
                                          <tr className="border-b border-border text-muted-foreground/60">
                                            <th className="pb-2 text-left font-medium">Symbol</th>
                                            <th className="pb-2 text-left font-medium">Description</th>
                                            <th className="pb-2 text-right font-medium">Qty</th>
                                            <th className="pb-2 text-right font-medium">Price</th>
                                            <th className="pb-2 text-right font-medium">Market Value</th>
                                            <th className="pb-2 text-right font-medium">Cost Basis</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {holdings.map((h, i) => (
                                            <tr key={i} className="border-b border-border/50 last:border-0">
                                              <td className="py-1.5 pr-3 font-medium">{h.symbol}</td>
                                              <td className="py-1.5 pr-3 text-muted-foreground/70 max-w-[200px] truncate">{h.description ?? "—"}</td>
                                              <td className="py-1.5 text-right">{h.quantity.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
                                              <td className="py-1.5 pl-3 text-right" data-v>{h.price != null ? `$${h.price.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "—"}</td>
                                              <td className="py-1.5 pl-3 text-right" data-v>{h.marketValue != null ? `$${h.marketValue.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "—"}</td>
                                              <td className="py-1.5 pl-3 text-right" data-v>{h.costBasis != null ? `$${h.costBasis.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "—"}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                  {isSnapBankCredit && isExpanded && snapTxns.length > 0 && (
                                    <div className="border-t border-border bg-muted/30 px-4 pb-3 pt-2">
                                      <table className="w-full text-xs">
                                        <thead>
                                          <tr className="border-b border-border text-muted-foreground/60">
                                            <th className="pb-2 text-left font-medium">Date</th>
                                            <th className="pb-2 text-left font-medium">Description</th>
                                            <th className="pb-2 text-right font-medium">Amount</th>
                                            <th className="pb-2 text-right font-medium">Type</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {snapTxns.map((t) => {
                                            const isInflow = t.amount != null && t.amount > 0;
                                            return (
                                              <tr key={t.id} className="border-b border-border/50 last:border-0">
                                                <td className="py-1.5 pr-3 text-muted-foreground/70 whitespace-nowrap">{t.date}</td>
                                                <td className="py-1.5 pr-3 max-w-[240px] truncate">{t.description ?? t.type}</td>
                                                <td className={`py-1.5 pl-3 text-right font-mono ${isInflow ? "text-green-600 dark:text-green-400" : ""}`}>
                                                  {t.amount != null
                                                    ? `${isInflow ? "+" : "−"}$${Math.abs(t.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                                    : "—"}
                                                </td>
                                                <td className="py-1.5 pl-3 text-right text-muted-foreground/50 capitalize">{t.type}</td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          {!auth.lastSynced && (
                            <p className="mt-2 text-xs text-muted-foreground/50">Click Sync to fetch holdings and transactions.</p>
                          )}
                        </CardContent>
                      </Card>
                      );
                    })}
                  </div>
                </section>
              );
            })}

          </div>
        );
      })()}

      {/* Manual Portfolios */}
      <section className="space-y-3">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground/70" />
            <h2 className="text-sm font-semibold">Manual Portfolios</h2>
          </div>
        </div>

        {manualPortfolios.length === 0 && realEstateProperties.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground/50">
            No manual portfolios yet. Use this to track accounts you can&apos;t connect automatically.
          </p>
        ) : (
          <div className="space-y-3">
            {Array.from(
              manualPortfolios.reduce((map, p) => {
                const key = p.institutionName ?? p.name;
                if (!map.has(key)) map.set(key, []);
                map.get(key)!.push(p);
                return map;
              }, new Map<string, ManualPortfolio[]>())
            ).sort(([a], [b]) => a.localeCompare(b)).map(([institution, portfolios]) => {
              const groupTotal = portfolios.reduce(
                (s, p) => s + p.holdings.reduce((hs, h) => hs + (h.price != null ? h.shares * h.price : (h.marketValue ?? 0)), 0),
                0
              );
              return (
                <Card key={institution}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-1">
                        <CardTitle className="text-base">{institution}</CardTitle>
                        <Button
                          variant="ghost" size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground/50 hover:text-foreground"
                          title="Sync prices"
                          onClick={() => syncManualPrices(true)}
                          disabled={syncingPrices}
                        >
                          {syncingPrices ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        </Button>
                        <button
                          onClick={() => setImportingInstitution(institution)}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground"
                          title="Import statement"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {groupTotal > 0 && (
                        <span className="text-base font-semibold" data-v>
                          ${groupTotal.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </span>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="divide-y divide-border rounded-lg border border-border">
                      {portfolios.map((p) => {
                        const accountTotal = p.holdings.reduce(
                          (s, h) => s + (h.price != null ? h.shares * h.price : (h.marketValue ?? 0)),
                          0
                        );
                        const hasHoldings = p.holdings.length > 0;
                        const isExpanded = expandedAccounts.has(p.id);
                        const typeLabel = p.accountType
                          ? ACCOUNT_TYPES.find((t) => t.value === p.accountType)?.label ?? p.accountType
                          : null;
                        return (
                          <div key={p.id}>
                            <div className="flex items-center justify-between px-4 py-3">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => toggleAccount(p.id)}
                                  className={`text-muted-foreground/50 hover:text-foreground transition-colors ${!hasHoldings ? "invisible" : ""}`}
                                  title={hasHoldings ? (isExpanded ? "Collapse holdings" : "Expand holdings") : undefined}
                                >
                                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                </button>
                                <div>
                                  <div className="flex items-center gap-1">
                                    <p className="text-sm font-medium">{p.name}</p>
                                    <Button
                                      variant="ghost" size="sm"
                                      className="h-6 w-6 p-0 text-muted-foreground/50 hover:text-foreground"
                                      title="Edit portfolio"
                                      onClick={() => { setEditingPortfolio(p); setManualDialogOpen(true); }}
                                    >
                                      <Info className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                  {typeLabel && <p className="mt-0.5 text-xs text-muted-foreground/50">{typeLabel}</p>}
                                </div>
                              </div>
                              <div className="flex items-center">
                                {accountTotal > 0 && (
                                  <Badge variant="secondary" className="text-xs">
                                    <span data-v>${accountTotal.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                                  </Badge>
                                )}
                              </div>
                            </div>
                            {isExpanded && hasHoldings && (
                              <div className="border-t border-border bg-muted/30 px-4 pb-3 pt-2">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="border-b border-border text-muted-foreground/60">
                                      <th className="pb-2 text-left font-medium">Ticker</th>
                                      <th className="pb-2 text-left font-medium">Description</th>
                                      <th className="pb-2 text-right font-medium">Shares</th>
                                      <th className="pb-2 pl-3 text-right font-medium">Price</th>
                                      <th className="pb-2 pl-3 text-right font-medium">Market Value</th>
                                      <th className="pb-2 pl-3 text-right font-medium">Cost Basis</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {p.holdings.map((h, i) => {
                                      const mv = h.price != null ? h.shares * h.price : (h.marketValue ?? null);
                                      return (
                                        <tr key={i} className="border-b border-border/50 last:border-0">
                                          <td className="py-1.5 pr-3 font-mono font-medium">{h.ticker}</td>
                                          <td className="py-1.5 pr-3 text-muted-foreground/70 max-w-[200px] truncate">{h.description ?? "—"}</td>
                                          <td className="py-1.5 text-right">
                                            {h.shares > 0 ? h.shares.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "—"}
                                          </td>
                                          <td className="py-1.5 pl-3 text-right" data-v>
                                            {h.price != null ? `$${h.price.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "—"}
                                          </td>
                                          <td className="py-1.5 pl-3 text-right" data-v>
                                            {mv != null ? `$${mv.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "—"}
                                          </td>
                                          <td className="py-1.5 pl-3 text-right" data-v>
                                            {h.costBasis != null ? `$${h.costBasis.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "—"}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {[...realEstateProperties].sort((a, b) => (a.nickname || a.address).localeCompare(b.nickname || b.address)).map((p) => {
              const basis = totalCostBasis(p);
              const isExpanded = expandedAccounts.has(p.id);
              const improvements = p.improvements ?? [];
              return (
                <Card key={p.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-1">
                        <CardTitle className="text-base">{p.nickname || p.address}</CardTitle>
                        <Button
                          variant="ghost" size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground/50 hover:text-foreground"
                          title="Refresh estimated value"
                          onClick={() => refreshProperty(p.id)}
                          disabled={refreshingProperty[p.id]}
                        >
                          {refreshingProperty[p.id] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                      {p.estimatedValue != null && (
                        <span className="text-base font-semibold" data-v>
                          ${p.estimatedValue.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </span>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="divide-y divide-border rounded-lg border border-border">
                      <div>
                        <div className="flex items-center justify-between px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => toggleAccount(p.id)}
                              className="text-muted-foreground/50 hover:text-foreground transition-colors"
                              title={isExpanded ? "Collapse details" : "Expand details"}
                            >
                              {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            </button>
                            <div>
                              <div className="flex items-center gap-1">
                                <p className="text-sm font-medium">{p.address}</p>
                                <Button
                                  variant="ghost" size="sm"
                                  className="h-6 w-6 p-0 text-muted-foreground/50 hover:text-foreground"
                                  title="Edit property"
                                  onClick={() => { setEditingProperty(p); setPropertyDialogOpen(true); }}
                                >
                                  <Info className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                              {/* {p.purchaseDate && (
                                <p className="mt-0.5 text-xs text-muted-foreground/50">
                                  Purchased {new Date(p.purchaseDate + "T12:00:00").toLocaleDateString(undefined, { month: "short", year: "numeric" })}
                                </p>
                              )} */}
                            </div>
                          </div>
                          {p.estimatedValue != null && (
                            <Badge variant="secondary" className="text-xs">
                              <span data-v>${p.estimatedValue.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                            </Badge>
                          )}
                        </div>
                        {isExpanded && (
                          <div className="border-t border-border bg-muted/30 px-4 pb-3 pt-2">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-border text-muted-foreground/60">
                                  <th className="pb-2 text-left font-medium">Item</th>
                                  <th className="pb-2 pl-3 text-right font-medium">Date</th>
                                  <th className="pb-2 pl-3 text-right font-medium">Cost</th>
                                  <th className="pb-2 pl-3 text-right font-medium">Market Value</th>
                                </tr>
                              </thead>
                              <tbody>
                                {p.purchasePrice != null && (
                                  <tr className="border-b border-border/50">
                                    <td className="py-1.5 font-medium">Property purchase</td>
                                    <td className="py-1.5 pl-3 text-right text-muted-foreground/70">
                                      {p.purchaseDate
                                        ? new Date(p.purchaseDate + "T12:00:00").toLocaleDateString(undefined, { month: "short", year: "numeric" })
                                        : "—"}
                                    </td>
                                    <td className="py-1.5 pl-3 text-right" data-v>
                                      ${p.purchasePrice.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                    </td>
                                    <td className="py-1.5 pl-3 text-right" data-v>
                                      {p.estimatedValue != null
                                        ? `$${p.estimatedValue.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                                        : "—"}
                                    </td>
                                  </tr>
                                )}
                                {improvements.map((imp) => (
                                  <tr key={imp.id} className="border-b border-border/50 last:border-0">
                                    <td className="py-1.5 text-muted-foreground/80">{imp.description}</td>
                                    <td className="py-1.5 pl-3 text-right text-muted-foreground/70">
                                      {imp.date
                                        ? new Date(imp.date + "T12:00:00").toLocaleDateString(undefined, { month: "short", year: "numeric" })
                                        : "—"}
                                    </td>
                                    <td className="py-1.5 pl-3 text-right" data-v>
                                      ${imp.cost.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                    </td>
                                    <td className="py-1.5 pl-3 text-right text-muted-foreground/40">—</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

      </section>

      {/* Account details dialog */}
      <Dialog open={infoState !== null} onOpenChange={(open) => { if (!open) setInfoState(null); }}>
        <DialogContent>
          {infoState && (
            <>
              <DialogHeader>
                <DialogTitle>{infoState.institutionName}</DialogTitle>
              </DialogHeader>
              <DialogBody>
                {/* Connection info */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  <span className="text-muted-foreground">Service</span>
                  <span>{infoState.service}</span>
                  <span className="text-muted-foreground">Connected</span>
                  <span>
                    {infoState.connectedAt
                      ? new Date(infoState.connectedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                      : "—"}
                  </span>
                  <span className="text-muted-foreground">Last synced</span>
                  <span>
                    {infoState.lastSynced
                      ? new Date(infoState.lastSynced).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                      : "Never"}
                  </span>
                </div>

                {/* Display name */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Display name</label>
                  <input
                    type="text"
                    value={infoState.displayName}
                    onChange={(e) => setInfoState((s) => s ? { ...s, displayName: e.target.value } : s)}
                    placeholder={infoState.institutionName}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                {/* Per-account types */}
                {infoState.accounts.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Accounts</p>
                    <div className="space-y-2">
                      {infoState.accounts.map((account) => (
                        <div key={account.id} className={`space-y-1.5 ${account.hidden ? "opacity-50" : ""}`}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium">{account.name}</span>
                            <button
                              onClick={() => toggleInfoAccountHidden(account.id)}
                              title={account.hidden ? "Show account" : "Hide account"}
                              className={`shrink-0 rounded px-2 py-1 text-xs font-medium transition-colors ${account.hidden ? "bg-muted text-muted-foreground hover:bg-muted/70" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}
                            >
                              {account.hidden ? "Show" : "Hide"}
                            </button>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={account.displayName}
                              onChange={(e) => updateInfoAccountDisplayName(account.id, e.target.value)}
                              placeholder={account.name}
                              disabled={account.hidden}
                              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                            />
                            <select
                              value={account.accountType}
                              onChange={(e) => updateInfoAccountType(account.id, e.target.value)}
                              disabled={account.hidden}
                              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                            >
                              {ACCOUNT_TYPES.map((t) => (
                                <option key={t.value} value={t.value}>{t.label}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </DialogBody>
              <DialogFooter>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={deleteFromInfo}
                  disabled={infoDeleting}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  {infoDeleting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                  Delete connection
                </Button>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setInfoState(null)}>Cancel</Button>
                  <Button size="sm" onClick={saveInfo} disabled={infoSaving}>
                    {infoSaving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                    Save
                  </Button>
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      {importingInstitution && (
        <ImportStatementDialog
          open={!!importingInstitution}
          onClose={() => setImportingInstitution(null)}
          onImported={refreshManualPortfolios}
          institutionName={importingInstitution}
        />
      )}
      <PortfolioDialog
        open={manualDialogOpen}
        onClose={() => { setManualDialogOpen(false); setEditingPortfolio(undefined); }}
        portfolio={editingPortfolio}
        onSaved={() => { refreshManualPortfolios(); }}
        onDelete={editingPortfolio ? async () => {
          if (!confirm(`Delete "${editingPortfolio.name}"? This cannot be undone.`)) return;
          await fetch(`/api/manual-portfolios/${editingPortfolio.id}`, { method: "DELETE" });
          setManualDialogOpen(false);
          setEditingPortfolio(undefined);
          await refreshManualPortfolios();
        } : undefined}
      />
      <PropertyDialog
        open={propertyDialogOpen}
        onClose={() => { setPropertyDialogOpen(false); setEditingProperty(undefined); }}
        onSaved={() => { refreshRealEstate(); }}
        property={editingProperty}
        onDelete={editingProperty ? async () => {
          if (!confirm(`Delete "${editingProperty.nickname}"? This cannot be undone.`)) return;
          await fetch(`/api/real-estate/${editingProperty.id}`, { method: "DELETE" });
          setPropertyDialogOpen(false);
          setEditingProperty(undefined);
          await refreshRealEstate();
        } : undefined}
      />
    </div>
  );
}
