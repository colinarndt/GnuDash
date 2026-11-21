"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { useDashboard } from "@/lib/dashboard-context";
import { PortfolioSummary } from "@/components/investment/portfolio-summary";
import { AllocationPie } from "@/components/investment/allocation-pie";
import type { GroupMode } from "@/components/investment/allocation-pie";
import { AccountTreePicker } from "@/components/ui/account-tree-picker";
import { ViewSelector } from "@/components/investment/view-selector";
import type { PortfolioView } from "@/components/investment/view-selector";
import type { TickerAllocation } from "@/lib/classifications";
import { HoldingsTable } from "@/components/investment/holdings-table";
import { ValueOverTimeChart } from "@/components/investment/value-over-time-chart";
import { PricesTable } from "@/components/investment/prices-table";
import type { InvestmentHolding, AccountNode, MonthlyInvestmentValue } from "@/lib/types/gnucash";
import type { FundHoldingsResult } from "@/app/api/fund-holdings/route";
import { FilterGroupsEditor, type FilterGroup } from "@/components/investment/filter-groups-editor";
import { Settings2, Loader2 } from "lucide-react";
import { resolveTimeline, periodLabel as timelinePeriodLabel, type Timeline } from "@/components/investment/timeline-selector";

export interface GroupedHolding {
  key: string;
  ticker: string;
  accountName: string;
  accounts: string[];
  sharesHeld: number;
  costBasis: number;
  marketValue: number;
  gainLoss: number;
  gainLossPct: number;
  description?: string | null;
}

// Picker scope: only the investment brokerages live in these subtrees. The
// children of each "expand" path become top-level entries in the picker;
// each "direct" path is shown as-is. Everything else (credit cards, taxable
// brokerages outside crypto, fixed assets, reimbursables, etc.) is hidden.
const PICKER_EXPAND_PATHS = ["Assets:Crypto", "Assets:Retirement", "Banks:HSA"];
const PICKER_DIRECT_PATHS = ["Banks:Kraken"];

function findNodeByPath(roots: AccountNode[], path: string): AccountNode | null {
  for (const n of roots) {
    if (n.hidden) continue;
    if (n.fullPath === path) return n;
    if (path.startsWith(n.fullPath + ":")) {
      const found = findNodeByPath(n.children, path);
      if (found) return found;
    }
  }
  return null;
}

// ── Helpers ──────────────────────────────────────────────────────

function isSelectableLeaf(n: AccountNode): boolean {
  if (n.hidden || n.placeholder) return false;
  return n.children.every((c) => c.hidden);
}

function flattenAccounts(roots: AccountNode[]): AccountNode[] {
  const out: AccountNode[] = [];
  const walk = (n: AccountNode) => {
    if (n.hidden) return;
    out.push(n);
    for (const c of n.children) walk(c);
  };
  for (const r of roots) walk(r);
  return out;
}

function toGrouped(holdings: InvestmentHolding[]): GroupedHolding[] {
  const map = new Map<string, { accounts: string[]; shares: number; cost: number; market: number }>();
  for (const h of holdings) {
    const key = h.ticker || h.accountName;
    const existing = map.get(key);
    if (existing) {
      existing.accounts.push(h.accountName);
      existing.shares += h.sharesHeld;
      existing.cost += h.costBasis;
      existing.market += h.marketValue;
    } else {
      map.set(key, {
        accounts: [h.accountName],
        shares: h.sharesHeld,
        cost: h.costBasis,
        market: h.marketValue,
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
    };
  });
}

function filterActive(items: GroupedHolding[]): GroupedHolding[] {
  return items.filter((g) => Math.abs(g.marketValue) >= 0.01 || Math.abs(g.sharesHeld) >= 0.0001);
}

export default function InvestmentPage() {
  const { data } = useDashboard();
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<GroupMode>("class");
  const [userClassifications, setUserClassifications] = useState<Record<string, TickerAllocation[]>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [initialised, setInitialised] = useState(false);
  const [views, setViews] = useState<PortfolioView[]>([]);
  const [viewsLoaded, setViewsLoaded] = useState(false);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [xrayData, setXrayData] = useState<Record<string, FundHoldingsResult | null> | null>(null);
  const [xrayLoading, setXrayLoading] = useState(false);

  async function fetchXrayData(tickers: string[]) {
    const novel = [...new Set(tickers)].filter(
      (t) => !/\s/.test(t) && t.length <= 15,
    );
    if (novel.length === 0) return;
    setXrayLoading(true);
    try {
      const res = await fetch(`/api/fund-holdings?tickers=${novel.join(",")}`);
      const json = (await res.json()) as { results: Record<string, FundHoldingsResult | null> };
      setXrayData((prev) => ({ ...(prev ?? {}), ...json.results }));
    } catch {
      setXrayData((prev) => prev ?? {});
    } finally {
      setXrayLoading(false);
    }
  }
  const [filterGroupDefs, setFilterGroupDefs] = useState<FilterGroup[]>([]);
  const [filterGroupDefaults, setFilterGroupDefaults] = useState<FilterGroup[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [timeline, setTimeline] = useState<Timeline>({ kind: "total" });

  useEffect(() => {
    Promise.all([
      fetch("/api/classifications").then((r) =>
        r.ok ? (r.json() as Promise<{ classifications: Record<string, TickerAllocation[]> }>) : { classifications: {} }
      ),
      fetch("/api/investment/views").then((r) =>
        r.ok ? (r.json() as Promise<{ views: PortfolioView[] }>) : { views: [] }
      ),
      fetch("/api/investment/filter-groups").then((r) =>
        r.ok
          ? (r.json() as Promise<{ groups: FilterGroup[]; defaults: FilterGroup[] }>)
          : { groups: [], defaults: [] }
      ),
    ]).then(([cls, viewsData, fg]) => {
      setUserClassifications(cls.classifications ?? {});
      setViews(viewsData.views ?? []);
      setFilterGroupDefs(fg.groups ?? []);
      setFilterGroupDefaults(fg.defaults ?? []);
      setViewsLoaded(true);
    }).catch(() => {
      // Even on failure unblock initialisation so the user isn't stuck with
      // no selection at all.
      setViewsLoaded(true);
    });
  }, []);

  // ── Account tree (Assets + Banks roots) ─────────────────────
  const accountRoots = useMemo<AccountNode[]>(() => {
    if (!data) return [];
    const out: AccountNode[] = [];
    for (const path of PICKER_EXPAND_PATHS) {
      const node = findNodeByPath(data.accounts, path);
      if (!node) continue;
      for (const c of node.children) if (!c.hidden) out.push(c);
    }
    for (const path of PICKER_DIRECT_PATHS) {
      const node = findNodeByPath(data.accounts, path);
      if (node) out.push(node);
    }
    // Top-level only: alphabetical by name. Children below keep their
    // original GnuCash order.
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [data]);

  const flatLeaves = useMemo<AccountNode[]>(
    () => flattenAccounts(accountRoots).filter(isSelectableLeaf),
    [accountRoots],
  );

  const leafByGuid = useMemo(() => {
    const m = new Map<string, AccountNode>();
    for (const l of flatLeaves) m.set(l.guid, l);
    return m;
  }, [flatLeaves]);

  // Default selection: STOCK/MUTUAL + CASH leaves checked
  useEffect(() => {
    // Wait for views to come back from the API before initialising — otherwise
    // we'd fall back to the type-based defaults and stick there, even when a
    // default view exists in storage.
    if (!data || initialised || flatLeaves.length === 0 || !viewsLoaded) return;
    // If a view is marked as default, prefer it. Falls back to type-based
    // (STOCK/MUTUAL/CASH) when there is no default.
    const defaultView = views.find((v) => v.isDefault);
    if (defaultView) {
      setSelected(new Set(defaultView.selectedAccounts));
      setActiveViewId(defaultView.id);
    } else {
      const defaults = new Set<string>();
      for (const l of flatLeaves) {
        if (l.type === "STOCK" || l.type === "MUTUAL" || l.type === "CASH") {
          defaults.add(l.guid);
        }
      }
      setSelected(defaults);
    }
    setInitialised(true);
  }, [data, initialised, flatLeaves, views, viewsLoaded]);

  // ── Quick filter resolution ─────────────────────────────────
  function resolveFilterGuids(f: FilterGroup): Set<string> {
    const out = new Set<string>();
    for (const l of flatLeaves) {
      if (f.accountType && l.type !== f.accountType) continue;
      for (const p of f.paths) {
        if (l.fullPath === p || l.fullPath.startsWith(p + ":")) {
          out.add(l.guid);
          break;
        }
      }
    }
    return out;
  }

  const filterGroups = useMemo(
    () =>
      filterGroupDefs
        .map((f) => ({ label: f.label, ids: resolveFilterGuids(f) }))
        .filter((g) => g.ids.size > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flatLeaves, filterGroupDefs],
  );

  // Path suggestions for the editor's typeahead: every non-hidden node
  // under the Assets/Banks roots, by fullPath.
  const pathSuggestions = useMemo(() => {
    const set = new Set<string>();
    const walk = (n: AccountNode) => {
      if (n.hidden) return;
      if (n.fullPath) set.add(n.fullPath);
      for (const c of n.children) walk(c);
    };
    for (const r of accountRoots) walk(r);
    return [...set].sort();
  }, [accountRoots]);

  const accountTypeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const l of flatLeaves) if (l.type) set.add(l.type);
    return [...set].sort();
  }, [flatLeaves]);

  async function handleSaveFilterGroups(next: FilterGroup[]) {
    const res = await fetch("/api/investment/filter-groups", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groups: next }),
    });
    if (!res.ok) return;
    const { groups } = (await res.json()) as { groups: FilterGroup[] };
    setFilterGroupDefs(groups);
  }

  function toggleGroup(ids: Set<string>) {
    const allOn = [...ids].every((id) => selected.has(id));
    const next = new Set(selected);
    if (allOn) for (const id of ids) next.delete(id);
    else for (const id of ids) next.add(id);
    setSelected(next);
  }

  // ── Saved views ─────────────────────────────────────────────
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
    const res = await fetch("/api/investment/views", {
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
    const res = await fetch("/api/investment/views", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: activeViewId, selected_accounts: [...selected] }),
    });
    if (!res.ok) return;
    const { view } = (await res.json()) as { view: PortfolioView };
    setViews((prev) => prev.map((v) => (v.id === view.id ? view : v)));
  }

  async function handleSetDefaultView(id: string | null) {
    const res = await fetch("/api/investment/views", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, set_default: true }),
    });
    if (!res.ok) return;
    const { views: next } = (await res.json()) as { views: PortfolioView[] };
    setViews(next);
  }

  async function handleDeleteView(id: string) {
    const res = await fetch("/api/investment/views", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) return;
    setViews((prev) => prev.filter((v) => v.id !== id));
    setActiveViewId(null);
  }

  // ── Full node map (all nodes, not just leaves) for parent lookup ──
  const nodeByGuid = useMemo(() => {
    const m = new Map<string, AccountNode>();
    if (!data) return m;
    const walk = (n: AccountNode) => {
      m.set(n.guid, n);
      for (const c of n.children) walk(c);
    };
    for (const r of data.accounts) walk(r);
    return m;
  }, [data]);

  // Build a per-leaf snapshot at a specific month cap: for each accountGuid,
  // take the latest series row with month <= cap. Used to support a "timeline"
  // selector: end snapshot = current value, start snapshot = value entering
  // the window, so we can show period delta in the widget / holdings table.
  function snapshotAt(monthCap: string): Map<string, { value: number; costBasis: number }> {
    const m = new Map<string, { value: number; costBasis: number }>();
    if (!data) return m;
    const latestMonth = new Map<string, string>();
    for (const s of data.investmentValueSeries) {
      if (!s.accountGuid) continue;
      if (s.month > monthCap) continue;
      const prev = latestMonth.get(s.accountGuid);
      if (!prev || s.month > prev) {
        latestMonth.set(s.accountGuid, s.month);
        m.set(s.accountGuid, { value: s.value, costBasis: s.costBasis });
      }
    }
    return m;
  }

  const { startMonth, endMonth } = useMemo(() => resolveTimeline(timeline), [timeline]);
  const currentMonth = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }, []);
  const effectiveEndMonth = endMonth > currentMonth ? currentMonth : endMonth;

  // End snapshot is the "as of now (or as of end of window)" view.
  // Start snapshot is the "position entering the window" view, only used for
  // period-delta semantics when a non-Total timeline is active.
  const endLeafSnapshot = useMemo(
    () => snapshotAt(effectiveEndMonth),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, effectiveEndMonth],
  );
  const startLeafSnapshot = useMemo<Map<string, { value: number; costBasis: number }> | null>(
    () => (startMonth ? snapshotAt(startMonth) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, startMonth],
  );

  // ── Unified holdings + supporting maps ──
  // Three categories of selected leaves:
  //   1. STOCK/MUTUAL → start from precomputed InvestmentHolding, then override
  //      marketValue/costBasis from the chart snapshot.
  //   2. CASH → synthesize a cash row, tagged for auto-classification as 100% Cash.
  //   3. Other (ASSET/BANK/etc.) → group by parent placeholder and emit one
  //      aggregated row per parent (e.g. "Ally 401K"). Sub-accounts matching
  //      /investment returns?/i contribute to gain; the rest are cost basis.
  //      Lone leaves with no placeholder parent emit individually.
  // All synthesized values come from latestLeafSnapshot (chart-aligned).
  const { investedHoldings, cashTickers, aggregatedPositions } = useMemo(() => {
    if (!data) {
      return {
        investedHoldings: [] as InvestmentHolding[],
        cashTickers: new Set<string>(),
        aggregatedPositions: new Map<string, { ticker: string; leafGuids: Set<string>; returnsLeafGuids: Set<string> }>(),
      };
    }
    const investmentsByGuid = new Map<string, InvestmentHolding>();
    for (const h of data.investments ?? []) investmentsByGuid.set(h.accountGuid, h);

    // marketValue and costBasis always show their traditional meaning.
    // When a startSnapshot is present (period-delta mode) we ADDITIONALLY
    // compute a "value at start of window" per holding so gainLoss can be
    // marketEnd - marketStart instead of marketEnd - costBasis.
    function leafValue(guid: string, fallback: number): number {
      return endLeafSnapshot.get(guid)?.value ?? fallback;
    }
    function leafCostBasis(guid: string, fallbackEnd: number): number {
      return endLeafSnapshot.get(guid)?.costBasis ?? fallbackEnd;
    }
    function leafStartValue(guid: string): number {
      return startLeafSnapshot?.get(guid)?.value ?? 0;
    }

    const out: InvestmentHolding[] = [];
    const cashTickers = new Set<string>();
    const aggregatedPositions = new Map<string, { ticker: string; leafGuids: Set<string>; returnsLeafGuids: Set<string> }>();
    const otherByParent = new Map<string, AccountNode[]>();
    const otherLone: AccountNode[] = [];

    for (const guid of selected) {
      const real = investmentsByGuid.get(guid);
      if (real) {
        const marketValue = leafValue(guid, real.marketValue);
        const costBasis = leafCostBasis(guid, real.costBasis);
        const basis = startLeafSnapshot ? leafStartValue(guid) : costBasis;
        const gainLoss = marketValue - basis;
        const gainLossPct = basis !== 0 ? (gainLoss / Math.abs(basis)) * 100 : 0;
        out.push({ ...real, marketValue, costBasis, gainLoss, gainLossPct });
        continue;
      }
      const node = leafByGuid.get(guid);
      if (!node) continue;

      if (node.type === "CASH") {
        const marketValue = leafValue(guid, node.balance);
        if (Math.abs(marketValue) < 0.01) continue;
        // For cash, traditional cost basis = current market (no unrealized gain).
        const costBasis = marketValue;
        const basis = startLeafSnapshot ? leafStartValue(guid) : costBasis;
        const gainLoss = marketValue - basis;
        const gainLossPct = basis !== 0 ? (gainLoss / Math.abs(basis)) * 100 : 0;
        const ticker = node.commodityMnemonic || node.name;
        cashTickers.add(ticker);
        out.push({
          accountName: node.name,
          accountGuid: node.guid,
          accountPath: node.fullPath,
          ticker,
          sharesHeld: 1,
          costBasis,
          marketValue,
          gainLoss,
          gainLossPct,
          change12m: null,
          change12mPct: null,
        });
        continue;
      }

      // "Other" leaf: try to aggregate by placeholder parent.
      const parent = node.parentGuid ? nodeByGuid.get(node.parentGuid) : undefined;
      if (parent?.placeholder) {
        const arr = otherByParent.get(parent.guid) ?? [];
        arr.push(node);
        otherByParent.set(parent.guid, arr);
      } else {
        otherLone.push(node);
      }
    }

    const RETURNS_RE = /investment returns?/i;

    // Aggregated placeholder positions
    for (const [parentGuid, children] of otherByParent) {
      const parent = nodeByGuid.get(parentGuid);
      if (!parent) continue;
      const totalMarket = children.reduce((s, c) => s + leafValue(c.guid, c.balance), 0);
      // Cost basis is always traditional: sum of non-Investment-Returns
      // children's current value (the contributions only).
      const costBasis = children
        .filter((c) => !RETURNS_RE.test(c.name))
        .reduce((s, c) => s + leafValue(c.guid, c.balance), 0);
      if (Math.abs(totalMarket) < 0.01) continue;
      // Period-delta gain: change in total market value over the window.
      // All-time gain: market value minus contributions.
      const basis = startLeafSnapshot
        ? children.reduce((s, c) => s + leafStartValue(c.guid), 0)
        : costBasis;
      const gainLoss = totalMarket - basis;
      const gainLossPct = basis !== 0 ? (gainLoss / Math.abs(basis)) * 100 : 0;
      // ticker = last two path segments joined with space, e.g. "Ally 401K"
      const segs = parent.fullPath.split(":");
      const ticker = segs.slice(-2).join(" ");

      const leafGuids = new Set(children.map((c) => c.guid));
      const returnsLeafGuids = new Set(children.filter((c) => RETURNS_RE.test(c.name)).map((c) => c.guid));
      aggregatedPositions.set(parentGuid, { ticker, leafGuids, returnsLeafGuids });

      out.push({
        accountName: parent.fullPath,
        accountGuid: parent.guid,
        accountPath: parent.fullPath,
        ticker,
        sharesHeld: 1,
        costBasis,
        marketValue: totalMarket,
        gainLoss,
        gainLossPct,
        change12m: null,
        change12mPct: null,
      });
    }

    // Lone "Other" leaves → traditional cost = current market (no info to
    // model gain at cost-basis level). Period-delta gain = change over window.
    for (const node of otherLone) {
      const marketValue = leafValue(node.guid, node.balance);
      if (Math.abs(marketValue) < 0.01) continue;
      const costBasis = marketValue;
      const basis = startLeafSnapshot ? leafStartValue(node.guid) : costBasis;
      const gainLoss = marketValue - basis;
      const gainLossPct = basis !== 0 ? (gainLoss / Math.abs(basis)) * 100 : 0;
      out.push({
        accountName: node.name,
        accountGuid: node.guid,
        accountPath: node.fullPath,
        ticker: node.commodityMnemonic || node.name,
        sharesHeld: 1,
        costBasis,
        marketValue,
        gainLoss,
        gainLossPct,
        change12m: null,
        change12mPct: null,
      });
    }

    return { investedHoldings: out, cashTickers, aggregatedPositions };
  }, [data, selected, leafByGuid, nodeByGuid, endLeafSnapshot, startLeafSnapshot]);

  // Chart series: filter by selection, then aggregate per-leaf rows for
  // any aggregated parent placeholder into a single ticker line.
  const chartSeries = useMemo<MonthlyInvestmentValue[]>(() => {
    if (!data) return [];
    const leafToParent = new Map<string, string>();
    for (const [parentGuid, p] of aggregatedPositions) {
      for (const leaf of p.leafGuids) leafToParent.set(leaf, parentGuid);
    }
    const passthrough: MonthlyInvestmentValue[] = [];
    const aggByMonth = new Map<string, Map<string, { value: number; costBasis: number }>>();
    for (const s of data.investmentValueSeries) {
      if (!s.accountGuid) {
        passthrough.push(s);
        continue;
      }
      if (!selected.has(s.accountGuid)) continue;
      const parent = leafToParent.get(s.accountGuid);
      if (!parent) {
        passthrough.push(s);
        continue;
      }
      const pos = aggregatedPositions.get(parent)!;
      if (!aggByMonth.has(parent)) aggByMonth.set(parent, new Map());
      const months = aggByMonth.get(parent)!;
      const existing = months.get(s.month) ?? { value: 0, costBasis: 0 };
      existing.value += s.value;
      if (!pos.returnsLeafGuids.has(s.accountGuid)) existing.costBasis += s.value;
      months.set(s.month, existing);
    }
    const aggregated: MonthlyInvestmentValue[] = [];
    for (const [parentGuid, months] of aggByMonth) {
      const pos = aggregatedPositions.get(parentGuid)!;
      for (const [month, v] of months) {
        aggregated.push({ month, ticker: pos.ticker, accountGuid: parentGuid, value: v.value, costBasis: v.costBasis });
      }
    }
    return [...passthrough, ...aggregated];
  }, [data, selected, aggregatedPositions]);

  // Auto-classifications for CASH tickers (user-set classifications win).
  const mergedClassifications = useMemo(() => {
    const cashAlloc: TickerAllocation[] = [
      { weight: 1, assetClass: "Cash", region: "Domestic", classDetailed: "Money Market", sector: "Diversified" },
    ];
    const synthetic: Record<string, TickerAllocation[]> = {};
    for (const t of cashTickers) synthetic[t] = cashAlloc;
    return { ...synthetic, ...userClassifications };
  }, [cashTickers, userClassifications]);

  // Prefetch fund-holdings X-Ray data once the holdings settle so the
  // AllocationPie X-ray toggle and Holdings X-Ray button both have fresh
  // data without an explicit user click. Debounced to absorb selection churn.
  const xrayTickers = useMemo(
    () => [...new Set(investedHoldings.map((h) => h.ticker))],
    [investedHoldings],
  );
  const xrayPrefetchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (xrayTickers.length === 0) return;
    if (xrayPrefetchRef.current) clearTimeout(xrayPrefetchRef.current);
    xrayPrefetchRef.current = setTimeout(() => { void fetchXrayData(xrayTickers); }, 1500);
    return () => {
      if (xrayPrefetchRef.current) clearTimeout(xrayPrefetchRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xrayTickers]);

  const activeHoldings = investedHoldings.filter(
    (h) => Math.abs(h.marketValue) >= 0.01 || Math.abs(h.sharesHeld) >= 0.0001,
  );

  const allItems = toGrouped(investedHoldings);
  const activeItems = filterActive(allItems);

  if (!data) return null;

  const c = data.currency;

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      {/* Header + filter row */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-[#1A1D1F] sm:text-xl">Investments</h2>
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
            {accountRoots.length > 0 && (
              <AccountTreePicker
                roots={accountRoots}
                selected={selected}
                onChange={setSelected}
              />
            )}
          </div>
        </div>

        {accountRoots.length > 0 && (
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
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
              <button
                onClick={() => setEditorOpen(true)}
                className="rounded-full border border-[#EFEFEF] p-1.5 text-[#9A9FA5] transition-colors hover:border-[#6C9B8B]/30 hover:text-[#6C9B8B]"
                aria-label="Edit filter chips"
                title="Edit filter chips"
              >
                <Settings2 className="h-3.5 w-3.5" />
              </button>
            </div>
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
          </div>
        )}

        <FilterGroupsEditor
          open={editorOpen}
          onOpenChange={setEditorOpen}
          groups={filterGroupDefs}
          defaults={filterGroupDefaults}
          pathSuggestions={pathSuggestions}
          accountTypeOptions={accountTypeOptions}
          onSave={handleSaveFilterGroups}
        />
      </div>

      {!initialised ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-[#9A9FA5]" />
        </div>
      ) : activeHoldings.length === 0 ? (
        <p className="py-12 text-center text-sm text-[#9A9FA5]">
          No investment accounts selected
        </p>
      ) : (
        <>
          <PortfolioSummary holdings={activeHoldings} currency={c} periodLabel={timelinePeriodLabel(timeline) ?? undefined} />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
            <ValueOverTimeChart
              series={chartSeries}
              currency={c}
              selectedTicker={selectedTicker}
              timeline={timeline}
              onTimelineChange={setTimeline}
            />
            <AllocationPie
              items={activeItems}
              currency={c}
              selectedTicker={selectedTicker}
              onSelect={setSelectedTicker}
              groupBy={groupBy}
              onGroupByChange={(mode) => { setGroupBy(mode); setSelectedTicker(null); }}
              userClassifications={mergedClassifications}
              xrayData={xrayData}
              onSaveClassification={async (cls: Record<string, TickerAllocation[]>) => {
                await fetch("/api/classifications", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ classifications: cls }),
                });
                setUserClassifications((prev) => ({ ...prev, ...cls }));
              }}
            />
          </div>

          <HoldingsTable
            activeItems={activeItems}
            allItems={allItems}
            currency={c}
            selectedTicker={selectedTicker}
            xrayData={xrayData}
            xrayLoading={xrayLoading}
            onFetchXray={() => fetchXrayData(activeItems.map((h) => h.ticker))}
          />

          <PricesTable currency={c} selectedTicker={selectedTicker} />
        </>
      )}
    </div>
  );
}
