"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { Loader2 } from "lucide-react";
import { AccountMultiSelect } from "@/components/ui/account-multi-select";
import type { AccountOption } from "@/components/ui/account-multi-select";
import { PortfolioSummary } from "@/components/investment/portfolio-summary";
import { AllocationPie } from "@/components/investment/allocation-pie";
import { HoldingsTable } from "@/components/investment/holdings-table";
import { ValueOverTimeChart } from "@/components/investment/value-over-time-chart";
import { ViewSelector } from "@/components/investment/view-selector";
import type { PortfolioView } from "@/components/investment/view-selector";
import { Card, CardContent } from "@/components/ui/card";
import type { GroupedHolding } from "@/app/(dashboard)/investment/page";
import type { GroupMode } from "@/components/investment/allocation-pie";
import type { InvestmentHolding, MonthlyInvestmentValue } from "@/lib/types/gnucash";
import type { TickerAllocation } from "@/lib/classifications";
import type { ManualPortfolio } from "@/lib/manual-portfolios/storage";
import type { RealEstateProperty } from "@/lib/real-estate/types";
import { totalCostBasis } from "@/lib/real-estate/types";
import type { FundHoldingsResult } from "@/app/api/fund-holdings/route";

// ── API response shapes ──────────────────────────────────────────

interface SnapHolding {
  symbol: string;
  description: string | null;
  quantity: number;
  price: number | null;
  marketValue: number | null;
  costBasis: number | null;
}

interface SnapTransaction {
  id: string;
  date: string;
  type: string;
  symbol: string | null;
  quantity: number | null;
  price: number | null;
  amount: number | null;
}

interface SnapAccount {
  id: string;
  name: string;
  displayName: string | null;
  hidden: boolean;
  balance: number | null;
  accountType: string | null;
}

interface SnapAuth {
  authorizationId: string;
  brokerage: string;
  displayName: string | null;
  accounts: SnapAccount[];
  holdings: Record<string, SnapHolding[]>;
  transactions: Record<string, SnapTransaction[]>;
  balanceHistory: Record<string, Array<{ date: string; value: number }>>;
}

interface PlaidHolding {
  symbol: string;
  description: string | null;
  quantity: number;
  price: number | null;
  marketValue: number | null;
  costBasis: number | null;
  currency: string;
}

interface PlaidAccount {
  accountId: string;
  name: string;
  displayName: string | null;
  type: string;
  hidden: boolean;
  accountType: string | null;
  balanceCurrent: number | null;
  balanceHistory?: { date: string; value: number }[];
}

interface PlaidItem {
  itemId: string;
  institutionName: string | null;
  displayName: string | null;
  accounts: PlaidAccount[];
  holdings: Record<string, PlaidHolding[]>;
}

// ── Holdings helpers ─────────────────────────────────────────────

function plaidToGrouped(accId: string, accName: string, holdings: PlaidHolding[]): GroupedHolding[] {
  return holdings.map((h) => {
    const marketValue = h.marketValue ?? 0;
    const costBasis = h.costBasis ?? 0;
    const gainLoss = marketValue - costBasis;
    const gainLossPct = costBasis !== 0 ? (gainLoss / Math.abs(costBasis)) * 100 : 0;
    return {
      key: `plaid:${accId}:${h.symbol}`,
      ticker: h.symbol,
      accountName: accName,
      accounts: [accName],
      sharesHeld: h.quantity,
      costBasis,
      marketValue,
      gainLoss,
      gainLossPct,
      description: h.description,
    };
  });
}

function snapToGrouped(accId: string, accName: string, holdings: SnapHolding[]): GroupedHolding[] {
  return holdings.map((h) => {
    const marketValue = h.marketValue ?? 0;
    const costBasis = h.costBasis ?? 0;
    const gainLoss = marketValue - costBasis;
    const gainLossPct = costBasis !== 0 ? (gainLoss / Math.abs(costBasis)) * 100 : 0;
    return {
      key: `${accId}:${h.symbol}`,
      ticker: h.symbol,
      accountName: accName,
      accounts: [accName],
      sharesHeld: h.quantity,
      costBasis,
      marketValue,
      gainLoss,
      gainLossPct,
      description: h.description,
    };
  });
}

function manualToGrouped(portfolio: ManualPortfolio): GroupedHolding[] {
  return portfolio.holdings.map((h) => {
    const marketValue = h.price != null ? h.shares * h.price : (h.marketValue ?? 0);
    const costBasis = h.costBasis ?? 0;
    const gainLoss = marketValue - costBasis;
    const gainLossPct = costBasis !== 0 ? (gainLoss / Math.abs(costBasis)) * 100 : 0;
    return {
      key: `manual:${portfolio.id}:${h.ticker}`,
      ticker: h.ticker,
      accountName: portfolio.name,
      accounts: [portfolio.name],
      sharesHeld: h.shares,
      costBasis,
      marketValue,
      gainLoss,
      gainLossPct,
      description: h.description,
    };
  });
}

function realEstateToGrouped(property: RealEstateProperty): GroupedHolding {
  const marketValue = property.estimatedValue ?? 0;
  const costBasis = totalCostBasis(property);
  const gainLoss = marketValue - costBasis;
  const gainLossPct = costBasis !== 0 ? (gainLoss / costBasis) * 100 : 0;
  return {
    key: `realestate:${property.id}`,
    ticker: property.nickname,
    accountName: property.nickname,
    accounts: [property.nickname],
    sharesHeld: 1,
    costBasis,
    marketValue,
    gainLoss,
    gainLossPct,
  };
}

function groupByTicker(flat: GroupedHolding[]): GroupedHolding[] {
  const map = new Map<string, { accounts: string[]; shares: number; cost: number; market: number; description: string | null }>();
  for (const h of flat) {
    const existing = map.get(h.ticker);
    if (existing) {
      for (const a of h.accounts) {
        if (!existing.accounts.includes(a)) existing.accounts.push(a);
      }
      existing.shares += h.sharesHeld;
      existing.cost += h.costBasis;
      existing.market += h.marketValue;
      if (!existing.description && h.description) existing.description = h.description;
    } else {
      map.set(h.ticker, {
        accounts: [...h.accounts],
        shares: h.sharesHeld,
        cost: h.costBasis,
        market: h.marketValue,
        description: h.description ?? null,
      });
    }
  }
  return [...map.entries()].map(([ticker, g]) => {
    const gainLoss = g.market - g.cost;
    const gainLossPct = g.cost !== 0 ? (gainLoss / Math.abs(g.cost)) * 100 : 0;
    return {
      key: ticker,
      ticker,
      accountName: g.accounts.length === 1 ? g.accounts[0] : `${g.accounts.length} accounts`,
      accounts: g.accounts,
      sharesHeld: g.shares,
      costBasis: g.cost,
      marketValue: g.market,
      gainLoss,
      gainLossPct,
      description: g.description,
    };
  });
}

function filterActive(items: GroupedHolding[]): GroupedHolding[] {
  return items.filter(
    (g) => Math.abs(g.marketValue) >= 0.01 || Math.abs(g.sharesHeld) >= 0.0001
  );
}

// ── Value series helper ──────────────────────────────────────────

function addHistoryToMonthly(
  history: { date: string; value: number }[],
  monthly: Map<string, number>,
) {
  if (history.length === 0) return;
  const accMonthly: Record<string, number> = {};
  for (const { date, value } of [...history].sort((a, b) => a.date.localeCompare(b.date))) {
    accMonthly[date.slice(0, 7)] = value;
  }
  for (const [month, value] of Object.entries(accMonthly)) {
    monthly.set(month, (monthly.get(month) ?? 0) + value);
  }
}

function computeBalanceSeries(
  snapAuths: SnapAuth[],
  plaidItems: PlaidItem[],
  manualPortfolios: ManualPortfolio[],
  realEstateProperties: RealEstateProperty[],
  selected: Set<string>,
): MonthlyInvestmentValue[] {
  const monthly = new Map<string, number>();

  for (const auth of snapAuths) {
    for (const acc of auth.accounts) {
      if (acc.hidden || !selected.has(`snap:${acc.id}`)) continue;
      addHistoryToMonthly((auth.balanceHistory ?? {})[acc.id] ?? [], monthly);
    }
  }

  for (const item of plaidItems) {
    for (const acc of item.accounts) {
      if (acc.hidden || !selected.has(`plaid:${acc.accountId}`)) continue;
      addHistoryToMonthly(acc.balanceHistory ?? [], monthly);
    }
  }

  for (const portfolio of manualPortfolios) {
    if (!selected.has(`manual:${portfolio.id}`)) continue;
    addHistoryToMonthly(portfolio.balanceHistory ?? [], monthly);
  }

  for (const property of realEstateProperties) {
    if (!selected.has(`realestate:${property.id}`)) continue;
    addHistoryToMonthly(property.balanceHistory ?? [], monthly);
  }

  return [...monthly.entries()].map(([month, value]) => ({
    month,
    ticker: "portfolio",
    value,
    costBasis: 0,
  }));
}

// ── Filter groups ────────────────────────────────────────────────

const RETIREMENT_ACCOUNT_TYPES = new Set([
  "roth_ira", "traditional_ira", "roth_401k", "traditional_401k",
  "403b", "457b", "sep_ira", "solo_401k", "simple_ira", "pension",
]);

// ── Page ─────────────────────────────────────────────────────────

// Persists for the lifetime of the browser session — survives component re-mounts.
const prefetchedThisSession = new Set<string>();

export default function PortfolioPage() {
  const [loading, setLoading] = useState(true);
  const [snapAuths, setSnapAuths] = useState<SnapAuth[]>([]);
  const [plaidItems, setPlaidItems] = useState<PlaidItem[]>([]);
  const [manualPortfolios, setManualPortfolios] = useState<ManualPortfolio[]>([]);
  const [realEstateProperties, setRealEstateProperties] = useState<RealEstateProperty[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [initialised, setInitialised] = useState(false);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<GroupMode>("class");
  const [userClassifications, setUserClassifications] = useState<Record<string, TickerAllocation[]>>({});
  const [views, setViews] = useState<PortfolioView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [xrayData, setXrayData] = useState<Record<string, FundHoldingsResult | null> | null>(null);
  const [xrayLoading, setXrayLoading] = useState(false);

  // ── Initial data load ────────────────────────────────────────

  useEffect(() => {
    Promise.all([
      fetch("/api/snaptrade/accounts").then((r) =>
        r.ok ? (r.json() as Promise<{ authorizations: SnapAuth[] }>) : { authorizations: [] }
      ),
      fetch("/api/plaid/items").then((r) =>
        r.ok ? (r.json() as Promise<{ items: PlaidItem[] }>) : { items: [] }
      ),
      fetch("/api/classifications").then((r) =>
        r.ok ? (r.json() as Promise<{ classifications: Record<string, TickerAllocation[]> }>) : { classifications: {} }
      ),
      fetch("/api/manual-portfolios").then((r) =>
        r.ok ? (r.json() as Promise<{ portfolios: ManualPortfolio[] }>) : { portfolios: [] }
      ),
      fetch("/api/real-estate").then((r) =>
        r.ok ? (r.json() as Promise<{ properties: RealEstateProperty[] }>) : { properties: [] }
      ),
      fetch("/api/portfolio/views").then((r) =>
        r.ok ? (r.json() as Promise<{ views: PortfolioView[] }>) : { views: [] }
      ),
    ])
      .then(([snap, plaid, cls, manual, realestate, viewsData]) => {
        setSnapAuths(snap.authorizations ?? []);
        setPlaidItems(plaid.items ?? []);
        setUserClassifications(cls.classifications ?? {});
        setManualPortfolios(manual.portfolios ?? []);
        setRealEstateProperties(realestate.properties ?? []);
        setViews(viewsData.views ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  // Auto-sync real estate properties not updated in the last 30 days
  useEffect(() => {
    if (loading) return;
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const stale = realEstateProperties.filter(
      (p) => !p.lastSynced || new Date(p.lastSynced).getTime() < thirtyDaysAgo
    );
    for (const p of stale) {
      fetch(`/api/real-estate/${p.id}`, { method: "POST" })
        .then((r) => r.ok ? r.json() as Promise<{ property: RealEstateProperty }> : null)
        .then((d) => {
          if (!d) return;
          setRealEstateProperties((prev) =>
            prev.map((x) => (x.id === d.property.id ? d.property : x))
          );
        })
        .catch(() => {});
    }
  }, [loading, realEstateProperties]);

  // ── Default account selection ────────────────────────────────

  const accountOptions: AccountOption[] = useMemo(() => {
    const opts: AccountOption[] = [];
    for (const auth of snapAuths) {
      for (const acc of auth.accounts) {
        if (acc.hidden) continue;
        opts.push({
          id: `snap:${acc.id}`,
          name: acc.displayName ?? acc.name,
          institution: auth.displayName ?? auth.brokerage,
        });
      }
    }
    for (const item of plaidItems) {
      for (const acc of item.accounts) {
        if (acc.hidden || acc.type !== "investment") continue;
        opts.push({
          id: `plaid:${acc.accountId}`,
          name: acc.displayName ?? acc.name,
          institution: item.displayName ?? item.institutionName ?? "Unknown",
        });
      }
    }
    for (const portfolio of manualPortfolios) {
      opts.push({
        id: `manual:${portfolio.id}`,
        name: portfolio.name,
        institution: portfolio.institutionName ?? portfolio.name,
      });
    }
    for (const property of realEstateProperties) {
      opts.push({
        id: `realestate:${property.id}`,
        name: property.nickname,
        institution: "Real Estate",
      });
    }
    return opts;
  }, [snapAuths, plaidItems, manualPortfolios, realEstateProperties]);

  useEffect(() => {
    if (!loading && !initialised) {
      const defaultView = views.find((v) => v.isDefault);
      if (defaultView) {
        setSelected(new Set(defaultView.selectedAccounts));
        setActiveViewId(defaultView.id);
      } else {
        setSelected(new Set(accountOptions.map((o) => o.id)));
      }
      setInitialised(true);
    }
  }, [loading, initialised, accountOptions, views]);

  const filterGroups = useMemo(() => {
    const taxAdvantaged = new Set<string>();
    const retirement = new Set<string>();
    const taxable = new Set<string>();
    const realEstate = new Set<string>();

    const TAX_ADVANTAGED_TYPES = new Set([...RETIREMENT_ACCOUNT_TYPES, "hsa", "529"]);

    for (const auth of snapAuths) {
      for (const acc of auth.accounts) {
        if (acc.hidden) continue;
        const at = acc.accountType;
        if (!at) continue;
        if (TAX_ADVANTAGED_TYPES.has(at)) taxAdvantaged.add(`snap:${acc.id}`);
        if (RETIREMENT_ACCOUNT_TYPES.has(at)) retirement.add(`snap:${acc.id}`);
        if (at === "taxable") taxable.add(`snap:${acc.id}`);
      }
    }
    for (const item of plaidItems) {
      for (const acc of item.accounts) {
        if (acc.hidden || acc.type !== "investment") continue;
        const at = acc.accountType;
        if (!at) continue;
        if (TAX_ADVANTAGED_TYPES.has(at)) taxAdvantaged.add(`plaid:${acc.accountId}`);
        if (RETIREMENT_ACCOUNT_TYPES.has(at)) retirement.add(`plaid:${acc.accountId}`);
        if (at === "taxable") taxable.add(`plaid:${acc.accountId}`);
      }
    }
    for (const portfolio of manualPortfolios) {
      const at = portfolio.accountType;
      if (!at) continue;
      if (TAX_ADVANTAGED_TYPES.has(at)) taxAdvantaged.add(`manual:${portfolio.id}`);
      if (RETIREMENT_ACCOUNT_TYPES.has(at)) retirement.add(`manual:${portfolio.id}`);
      if (at === "taxable") taxable.add(`manual:${portfolio.id}`);
    }
    for (const property of realEstateProperties) {
      realEstate.add(`realestate:${property.id}`);
    }

    return [
      { label: "Tax-Advantaged", ids: taxAdvantaged },
      { label: "Retirement", ids: retirement },
      { label: "Taxable", ids: taxable },
      { label: "Real Estate", ids: realEstate },
    ].filter((g) => g.ids.size > 0);
  }, [snapAuths, plaidItems, manualPortfolios, realEstateProperties]);

  const viewDirty = useMemo(() => {
    if (!activeViewId) return false;
    const view = views.find((v) => v.id === activeViewId);
    if (!view) return false;
    const saved = new Set(view.selectedAccounts);
    if (saved.size !== selected.size) return true;
    for (const id of selected) if (!saved.has(id)) return true;
    return false;
  }, [activeViewId, views, selected]);

  function handleApplyView(view: PortfolioView) {
    setSelected(new Set(view.selectedAccounts));
    setActiveViewId(view.id);
  }

  async function handleSaveNewView(name: string) {
    const res = await fetch("/api/portfolio/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, selected_accounts: [...selected] }),
    });
    if (!res.ok) return;
    const { view } = (await res.json()) as { view: PortfolioView };
    setViews((prev) => [...prev, view]);
    setActiveViewId(view.id);
  }

  async function handleUpdateView() {
    if (!activeViewId) return;
    const res = await fetch("/api/portfolio/views", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: activeViewId, selected_accounts: [...selected] }),
    });
    if (!res.ok) return;
    const { view } = (await res.json()) as { view: PortfolioView };
    setViews((prev) => prev.map((v) => (v.id === view.id ? view : v)));
  }

  async function handleSetDefaultView(id: string | null) {
    const res = await fetch("/api/portfolio/views", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, set_default: true }),
    });
    if (!res.ok) return;
    const { views: next } = (await res.json()) as { views: PortfolioView[] };
    setViews(next);
  }

  async function handleDeleteView(id: string) {
    const res = await fetch("/api/portfolio/views", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) return;
    setViews((prev) => prev.filter((v) => v.id !== id));
    setActiveViewId(null);
  }

  function toggleGroup(ids: Set<string>) {
    const allOn = [...ids].every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOn) {
        for (const id of ids) next.delete(id);
      } else {
        for (const id of ids) next.add(id);
      }
      return next;
    });
  }

  // ── Derived data ─────────────────────────────────────────────

  const flatHoldings: GroupedHolding[] = useMemo(() => {
    const out: GroupedHolding[] = [];

    for (const auth of snapAuths) {
      for (const acc of auth.accounts) {
        if (acc.hidden || !selected.has(`snap:${acc.id}`)) continue;
        const accName = acc.displayName ?? acc.name;
        const holdings = auth.holdings[acc.id] ?? [];
        if (holdings.length > 0) {
          out.push(...snapToGrouped(acc.id, accName, holdings));
        } else if (acc.balance != null) {
          out.push({
            key: `snap:${acc.id}:_bal`,
            ticker: accName,
            accountName: auth.displayName ?? auth.brokerage,
            accounts: [accName],
            sharesHeld: 1,
            costBasis: 0,
            marketValue: acc.balance,
            gainLoss: 0,
            gainLossPct: 0,
          });
        }
      }
    }

    for (const item of plaidItems) {
      for (const acc of item.accounts) {
        if (acc.hidden || acc.type !== "investment") continue;
        if (!selected.has(`plaid:${acc.accountId}`)) continue;
        const accName = acc.displayName ?? acc.name;
        const holdings = (item.holdings ?? {})[acc.accountId] ?? [];
        if (holdings.length > 0) {
          out.push(...plaidToGrouped(acc.accountId, accName, holdings));
        } else if (acc.balanceCurrent != null) {
          out.push({
            key: `plaid:${acc.accountId}`,
            ticker: accName,
            accountName: item.displayName ?? item.institutionName ?? "Unknown",
            accounts: [accName],
            sharesHeld: 1,
            costBasis: 0,
            marketValue: acc.balanceCurrent,
            gainLoss: 0,
            gainLossPct: 0,
          });
        }
      }
    }

    for (const portfolio of manualPortfolios) {
      if (!selected.has(`manual:${portfolio.id}`)) continue;
      out.push(...manualToGrouped(portfolio));
    }

    for (const property of realEstateProperties) {
      if (!selected.has(`realestate:${property.id}`)) continue;
      out.push(realEstateToGrouped(property));
    }

    return out;
  }, [snapAuths, plaidItems, manualPortfolios, realEstateProperties, selected]);

  const allItems = useMemo(
    () => groupByTicker(flatHoldings),
    [flatHoldings]
  );
  const activeItems = useMemo(() => filterActive(allItems), [allItems]);

  // ── X-Ray data: fetch once and share across AllocationPie + HoldingsTable ──

  async function fetchXrayData(items: GroupedHolding[]) {
    const tickers = [...new Set(items.map((h) => h.ticker))].filter(
      (t) => !/\s/.test(t) && t.length <= 15,
    );
    if (tickers.length === 0) return;
    setXrayLoading(true);
    try {
      const res = await fetch(`/api/fund-holdings?tickers=${tickers.join(",")}`);
      const json = (await res.json()) as { results: Record<string, FundHoldingsResult | null> };
      setXrayData(json.results);
    } catch {
      setXrayData({});
    } finally {
      setXrayLoading(false);
    }
  }

  // Prefetch after page has settled; re-fetch when the active account selection changes
  const xrayPrefetchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (activeItems.length === 0) return;
    if (xrayPrefetchRef.current) clearTimeout(xrayPrefetchRef.current);
    xrayPrefetchRef.current = setTimeout(() => { void fetchXrayData(activeItems); }, 1500);
    return () => { if (xrayPrefetchRef.current) clearTimeout(xrayPrefetchRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeItems]);

  // ── Ticker-info prefetch ─────────────────────────────────────────
  // Module-level set persists across re-mounts (navigation away and back)
  // so we never re-send a ticker we already fetched this browser session.
  function prefetchTickerInfo(tickers: string[]) {
    const novel = tickers.filter(
      (t) => !/\s/.test(t) && t.length <= 15 && !prefetchedThisSession.has(t),
    );
    if (novel.length === 0) return;
    for (const t of novel) prefetchedThisSession.add(t);
    void fetch(`/api/ticker-info/batch?tickers=${novel.join(",")}`);
  }

  // Phase 1: direct holdings — fires 1.5 s after page settles
  const infoPrefetchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (activeItems.length === 0) return;
    if (infoPrefetchRef.current) clearTimeout(infoPrefetchRef.current);
    infoPrefetchRef.current = setTimeout(
      () => prefetchTickerInfo(activeItems.map((h) => h.ticker)),
      1500,
    );
    return () => { if (infoPrefetchRef.current) clearTimeout(infoPrefetchRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeItems]);

  // Phase 2: top 30 xray underlying holdings — fires once xrayData arrives
  useEffect(() => {
    if (!xrayData) return;
    const directTickers = new Set(activeItems.map((h) => h.ticker));
    const top30 = Object.entries(xrayData)
      .flatMap(([, result]) => result?.holdings ?? [])
      .filter((h) => !directTickers.has(h.symbol))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 30)
      .map((h) => h.symbol);
    prefetchTickerInfo(top30);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xrayData]);

  const summaryHoldings: InvestmentHolding[] = useMemo(
    () =>
      filterActive(flatHoldings).map((h) => ({
        accountName: h.accountName,
        accountGuid: h.key,
        accountPath: h.accountName,
        ticker: h.ticker,
        sharesHeld: h.sharesHeld,
        costBasis: h.costBasis,
        marketValue: h.marketValue,
        gainLoss: h.gainLoss,
        gainLossPct: h.gainLossPct,
        change12m: null,
        change12mPct: null,
      })),
    [flatHoldings]
  );

  const valueSeries: MonthlyInvestmentValue[] = useMemo(() => {
    const series = computeBalanceSeries(snapAuths, plaidItems, manualPortfolios, realEstateProperties, selected);
    // Use live holdings total for the current month so the chart endpoint always
    // matches the widgets (accounts with no balance history are still included).
    const currentTotal = flatHoldings.reduce((sum, h) => sum + h.marketValue, 0);
    if (currentTotal > 0) {
      const currentMonth = new Date().toISOString().slice(0, 7);
      if (series.some((s) => s.month === currentMonth)) {
        return series.map((s) =>
          s.month === currentMonth ? { ...s, value: currentTotal } : s
        );
      }
      return [...series, { month: currentMonth, ticker: "portfolio", value: currentTotal, costBasis: 0 }];
    }
    return series;
  }, [snapAuths, plaidItems, manualPortfolios, realEstateProperties, selected, flatHoldings]);

  async function handleSaveClassification(classifications: Record<string, TickerAllocation[]>) {
    await fetch("/api/classifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classifications }),
    });
    setUserClassifications((prev) => ({ ...prev, ...classifications }));
  }

  // ── Render ───────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      {/* Header + filter row */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-[#1A1D1F] sm:text-xl">Portfolio</h2>
          <div className="flex items-center gap-3">
            {selectedTicker && (
              <button
                onClick={() => setSelectedTicker(null)}
                className="flex items-center gap-1 rounded-full bg-[#6C9B8B]/10 px-2.5 py-1 text-xs font-medium text-[#6C9B8B] transition-colors hover:bg-[#6C9B8B]/20"
              >
                {selectedTicker}
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
            {accountOptions.length > 0 && (
              <AccountMultiSelect
                options={accountOptions}
                selected={selected}
                onChange={setSelected}
              />
            )}
          </div>
        </div>

        {(filterGroups.length > 0 || accountOptions.length > 0) && (
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {filterGroups.map((group) => {
                const allOn = group.ids.size > 0 && [...group.ids].every((id) => selected.has(id));
                return (
                  <button
                    key={group.label}
                    onClick={() => toggleGroup(group.ids)}
                    className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
                      allOn
                        ? "border-[#6C9B8B]/40 bg-[#6C9B8B]/10 text-[#6C9B8B]"
                        : "border-[#EFEFEF] bg-transparent text-[#9A9FA5] hover:border-[#6C9B8B]/30 hover:text-[#6C9B8B]"
                    }`}
                  >
                    {group.label}
                  </button>
                );
              })}
            </div>
            {accountOptions.length > 0 && (
              <ViewSelector
                views={views}
                activeViewId={activeViewId}
                isDirty={viewDirty}
                onApply={handleApplyView}
                onSaveNew={handleSaveNewView}
                onUpdate={handleUpdateView}
                onDelete={handleDeleteView}
                onSetDefault={handleSetDefaultView}
              />
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : accountOptions.length === 0 ? (
        <p className="py-12 text-center text-sm text-[#9A9FA5]">
          No investment accounts connected. Add accounts on the{" "}
          <a href="/connections" className="text-[#6C9B8B] hover:underline">Connections</a> page.
        </p>
      ) : activeItems.length === 0 ? (
        <p className="py-12 text-center text-sm text-[#9A9FA5]">
          No holdings found for the selected accounts. Try syncing your connections or selecting
          more accounts above.
        </p>
      ) : (
        <>
          <PortfolioSummary holdings={summaryHoldings} currency="USD" />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
            <AllocationPie
              items={activeItems}
              currency="USD"
              selectedTicker={selectedTicker}
              onSelect={setSelectedTicker}
              groupBy={groupBy}
              onGroupByChange={(mode) => { setGroupBy(mode); setSelectedTicker(null); }}
              userClassifications={userClassifications}
              onSaveClassification={handleSaveClassification}
              xrayData={xrayData}
            />
            {valueSeries.length === 0 ? (
              <Card className="border-[#EFEFEF] shadow-sm">
                <CardContent className="flex h-[316px] flex-col items-center justify-center gap-2">
                  <p className="text-sm text-muted-foreground">Balance history not yet available</p>
                  <p className="text-xs text-muted-foreground/60">
                    Sync your accounts to populate history. Data appears once the balance history feature is enabled.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <ValueOverTimeChart
                key={[...selected].sort().join(",")}
                series={valueSeries}
                currency="USD"
                selectedTicker={null}
              />
            )}
          </div>

          <HoldingsTable
            activeItems={activeItems}
            allItems={allItems}
            currency="USD"
            selectedTicker={selectedTicker}
            xrayData={xrayData}
            xrayLoading={xrayLoading}
            onFetchXray={() => void fetchXrayData(activeItems)}
          />
        </>
      )}
    </div>
  );
}
