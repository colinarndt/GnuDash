"use client";

import { useMemo, useState } from "react";
import { Info, Scan, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatPct } from "@/lib/format";
import { FundInfoSheet } from "@/components/investment/fund-info-sheet";
import type { GroupedHolding } from "@/app/(dashboard)/investment/page";
import type { FundHoldingsResult } from "@/app/api/fund-holdings/route";

interface HoldingsTableProps {
  activeItems: GroupedHolding[];
  allItems: GroupedHolding[];
  currency: string;
  selectedTicker: string | null;
  xrayData: Record<string, FundHoldingsResult | null> | null;
  xrayLoading: boolean;
  onFetchXray: () => void;
}

type SortKey = "ticker" | "marketValue" | "pct" | "costBasis" | "gainLoss" | "gainLossPct";
type SortDir = "asc" | "desc";

interface XrayItem {
  key: string;
  ticker: string;
  name: string;
  description: string;
  marketValue: number;
  sources: string[];
  rowType: "normal" | "bonds" | "other";
}

const BOND_KEY_PREFIX = "__BOND_";

const ISSUER_CAT_LABELS: Record<string, string> = {
  UST: "US Treasuries",
  USGA: "US Govt Agencies",
  USO: "US Govt Sponsored",
  CORP: "Corporate Bonds",
  MUN: "Municipal Bonds",
  FORGOV: "Foreign Govt Bonds",
  ABS: "Asset-Backed Securities",
  MBS: "Mortgage-Backed Securities",
  OTH: "Other Fixed Income",
};

function isPublicTicker(ticker: string): boolean {
  return !/\s/.test(ticker) && ticker.length <= 15;
}

function computeXray(
  activeItems: GroupedHolding[],
  fundData: Record<string, FundHoldingsResult | null>,
): XrayItem[] {
  const combined = new Map<string, { name: string; description: string; value: number; sources: Set<string> }>();
  const remainders: XrayItem[] = [];

  for (const item of activeItems) {
    const fund = fundData[item.ticker];
    const isFund =
      fund && (fund.quoteType === "ETF" || fund.quoteType === "MUTUALFUND") && fund.holdings.length > 0;

    if (!isFund) {
      const existing = combined.get(item.ticker);
      if (existing) {
        existing.value += item.marketValue;
        for (const s of item.accounts) existing.sources.add(s);
        if (!existing.description && item.description) existing.description = item.description;
      } else {
        combined.set(item.ticker, {
          name: item.ticker,
          description: item.description ?? "",
          value: item.marketValue,
          sources: new Set(item.accounts),
        });
      }
      continue;
    }

    // Apportion underlying holdings
    for (const h of fund.holdings) {
      const attributed = item.marketValue * h.pct;

      if (h.assetCategory === "DBT") {
        // Bond group — aggregate by issuer category using a synthetic key so
        // positions from multiple funds (e.g. two balanced funds) collapse into one row.
        const bondKey = `${BOND_KEY_PREFIX}${h.issuerCategory ?? "OTH"}`;
        const label = ISSUER_CAT_LABELS[h.issuerCategory ?? "OTH"] ?? h.name;
        const existing = combined.get(bondKey);
        if (existing) {
          existing.value += attributed;
          existing.sources.add(item.ticker);
        } else {
          combined.set(bondKey, {
            name: label,
            description: label,
            value: attributed,
            sources: new Set([item.ticker]),
          });
        }
        continue;
      }

      const existing = combined.get(h.symbol);
      if (existing) {
        existing.value += attributed;
        existing.sources.add(item.ticker);
      } else {
        combined.set(h.symbol, {
          name: h.name,
          description: h.name,
          value: attributed,
          sources: new Set([item.ticker]),
        });
      }
    }

    // Bond catch-all: only when bond groups are NOT already in holdings (non-N-PORT sources)
    const hasBondHoldings = fund.holdings.some((h) => h.assetCategory === "DBT");
    const bondPct = hasBondHoldings ? 0 : (fund.bondPct ?? 0);
    if (bondPct > 0.001) {
      remainders.push({
        key: `xray-bonds:${item.ticker}`,
        ticker: `${item.ticker} — fixed income`,
        name: `Bond & fixed income allocation`,
        description: `Bond & fixed income allocation`,
        marketValue: item.marketValue * bondPct,
        sources: [item.ticker],
        rowType: "bonds",
      });
    }

    // Truly unmapped portion (for N-PORT, bonds are in totalMapped so this is just the remainder)
    const unmapped = Math.max(0, 1 - fund.totalMapped - bondPct);
    if (unmapped > 0.001) {
      remainders.push({
        key: `xray-other:${item.ticker}`,
        ticker: `${item.ticker} — other`,
        name: `Remaining ${(unmapped * 100).toFixed(0)}% beyond top holdings`,
        description: `Remaining ${(unmapped * 100).toFixed(0)}% beyond top holdings`,
        marketValue: item.marketValue * unmapped,
        sources: [item.ticker],
        rowType: "other",
      });
    }
  }

  const items: XrayItem[] = [...combined.entries()].map(([key, d]) => {
    const isBondGroup = key.startsWith(BOND_KEY_PREFIX);
    return {
      key: `xray:${key}`,
      ticker: isBondGroup ? d.name : key,
      name: d.name,
      description: d.description,
      marketValue: d.value,
      sources: [...d.sources],
      rowType: isBondGroup ? "bonds" : "normal",
    };
  });

  return [...items, ...remainders].sort((a, b) => b.marketValue - a.marketValue);
}

export function HoldingsTable({ activeItems, allItems, currency, selectedTicker, xrayData, xrayLoading, onFetchXray }: HoldingsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("marketValue");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [showZero, setShowZero] = useState(false);
  const [search, setSearch] = useState("");
  const [infoTicker, setInfoTicker] = useState<string | null>(null);
  const [xrayMode, setXrayMode] = useState(false);

  const hasZero = allItems.length > activeItems.length;
  const items = showZero ? allItems : activeItems;

  const totalMV = useMemo(
    () => activeItems.reduce((sum, h) => sum + h.marketValue, 0),
    [activeItems],
  );

  function toggleXray() {
    if (xrayMode) { setXrayMode(false); return; }
    setXrayMode(true);
    if (xrayData === null) onFetchXray();
  }

  const xrayItems = useMemo(() => {
    if (!xrayMode || !xrayData) return null;
    return computeXray(activeItems, xrayData);
  }, [xrayMode, xrayData, activeItems]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const sorted = useMemo(() => {
    const filtered = selectedTicker ? items.filter((h) => h.ticker === selectedTicker) : items;
    return [...filtered].sort((a, b) => {
      if (sortKey === "ticker") return sortDir === "asc" ? a.ticker.localeCompare(b.ticker) : b.ticker.localeCompare(a.ticker);
      const av = sortKey === "pct" ? a.marketValue : a[sortKey];
      const bv = sortKey === "pct" ? b.marketValue : b[sortKey];
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [items, selectedTicker, sortKey, sortDir]);

  const arrow = (key: SortKey) => sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  const searchQ = search.toLowerCase().trim();
  const filteredSorted = searchQ
    ? sorted.filter(
        (h) =>
          h.ticker.toLowerCase().includes(searchQ) ||
          h.accountName.toLowerCase().includes(searchQ) ||
          (h.description ?? "").toLowerCase().includes(searchQ),
      )
    : sorted;
  const filteredXray = xrayItems && searchQ
    ? xrayItems.filter(
        (i) =>
          i.ticker.toLowerCase().includes(searchQ) ||
          i.description.toLowerCase().includes(searchQ),
      )
    : xrayItems;

  return (
    <>
      <Card className="shadow-sm border-[#EFEFEF]">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <CardTitle className="text-lg font-semibold text-[#1A1D1F]">
            Holdings
            <span className="ml-2 text-sm font-normal text-[#9A9FA5]">
              {xrayMode && filteredXray
                ? `${filteredXray.filter((i) => i.rowType === "normal").length} underlying positions`
                : `${filteredSorted.length} ${filteredSorted.length === 1 ? "position" : "positions"}`}
            </span>
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-lg border border-[#EFEFEF] px-2.5 py-1.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-[#9A9FA5]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="w-28 bg-transparent text-sm text-[#1A1D1F] placeholder:text-[#9A9FA5] focus:outline-none"
              />
            </div>
            {hasZero && !xrayMode && (
              <button
                onClick={() => setShowZero((v) => !v)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  showZero
                    ? "border-[#6C9B8B] bg-[#6C9B8B]/10 text-[#6C9B8B]"
                    : "border-[#EFEFEF] text-[#6F767E] hover:bg-[#F4F5F7]"
                }`}
              >
                {showZero ? "Hide" : "Show"} fully sold
              </button>
            )}
            <button
              onClick={toggleXray}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                xrayMode
                  ? "border-violet-400/50 bg-violet-50 text-violet-600"
                  : "border-[#EFEFEF] text-[#6F767E] hover:bg-[#F4F5F7]"
              }`}
            >
              <Scan className="h-3.5 w-3.5" />
              X-Ray
            </button>
          </div>
        </CardHeader>
        <CardContent>
          {filteredSorted.length === 0 && !xrayMode ? (
            <p className="py-8 text-center text-sm text-[#9A9FA5]">No investment holdings</p>
          ) : xrayMode ? (
            <XrayTable
              items={filteredXray}
              loading={xrayLoading}
              totalMV={totalMV}
              currency={currency}
              onInfo={setInfoTicker}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#EFEFEF]">
                    <Th onClick={() => handleSort("ticker")} className="w-[110px] max-w-[110px]">Holding{arrow("ticker")}</Th>
                    <Th onClick={() => handleSort("ticker")} className="hidden sm:table-cell w-[340px] max-w-[340px]">Description</Th>
                    <Th onClick={() => handleSort("pct")} align="right">Pct{arrow("pct")}</Th>
                    <Th onClick={() => handleSort("costBasis")} align="right" className="hidden sm:table-cell">Cost Basis{arrow("costBasis")}</Th>
                    <Th onClick={() => handleSort("gainLoss")} align="right">Gain/Loss{arrow("gainLoss")}</Th>
                    <Th onClick={() => handleSort("gainLossPct")} align="right" className="hidden md:table-cell">Return{arrow("gainLossPct")}</Th>
                    <Th onClick={() => handleSort("marketValue")} align="right">Value{arrow("marketValue")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSorted.map((h) => {
                    const pct = totalMV > 0 ? (h.marketValue / totalMV) * 100 : 0;
                    return (
                      <tr key={h.key} className="border-b border-[#EFEFEF] last:border-0">
                        <td className="w-[110px] max-w-[110px] overflow-hidden py-3 pr-4">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-medium text-[#1A1D1F]">{h.ticker}</span>
                            {isPublicTicker(h.ticker) && (
                              <button
                                onClick={() => setInfoTicker(h.ticker)}
                                className="shrink-0 text-[#9A9FA5] transition-colors hover:text-[#6C9B8B]"
                                aria-label={`Info for ${h.ticker}`}
                              >
                                <Info className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                          <div className="truncate text-xs text-[#9A9FA5]">{h.accountName}</div>
                        </td>
                        <td className="hidden w-[340px] max-w-[340px] overflow-hidden py-3 pr-4 sm:table-cell">
                          <div className="truncate text-sm text-[#6F767E]">{h.description ?? ""}</div>
                        </td>
                        <td className="whitespace-nowrap py-3 text-right text-sm text-[#6F767E]">
                          {formatPct(pct)}
                        </td>
                        <td className="hidden whitespace-nowrap py-3 text-right text-sm text-[#6F767E] sm:table-cell">
                          {formatCurrency(h.costBasis, currency, { decimals: 0 })}
                        </td>
                        <td className="whitespace-nowrap py-3 text-right text-sm font-medium">
                          <span className={h.gainLoss >= 0 ? "text-[#6C9B8B]" : "text-[#F87171]"}>
                            {h.gainLoss >= 0 ? "+" : ""}{formatCurrency(h.gainLoss, currency, { decimals: 0 })}
                          </span>
                        </td>
                        <td className="hidden whitespace-nowrap py-3 text-right text-sm font-medium md:table-cell">
                          <span className={h.gainLossPct >= 0 ? "text-[#6C9B8B]" : "text-[#F87171]"}>
                            {h.gainLossPct >= 0 ? "+" : ""}{formatPct(h.gainLossPct)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap py-3 text-right text-sm font-medium text-[#1A1D1F]">
                          {formatCurrency(h.marketValue, currency, { decimals: 0 })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <FundInfoSheet ticker={infoTicker} onClose={() => setInfoTicker(null)} />
    </>
  );
}

// ── X-Ray table ──────────────────────────────────────────────────

function XrayTable({
  items,
  loading,
  totalMV,
  currency,
  onInfo,
}: {
  items: XrayItem[] | null;
  loading: boolean;
  totalMV: number;
  currency: string;
  onInfo: (ticker: string) => void;
}) {
  if (loading || items === null) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-[#9A9FA5]">
        <svg className="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
        Looking through your funds…
      </div>
    );
  }

  if (items.length === 0) {
    return <p className="py-8 text-center text-sm text-[#9A9FA5]">No holdings to display</p>;
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#EFEFEF]">
              <th className="pb-2 pr-4 text-left text-xs font-medium text-[#9A9FA5]">Underlying Holding</th>
              <th className="pb-2 pr-4 text-left text-xs font-medium text-[#9A9FA5] hidden sm:table-cell">Description</th>
              <th className="pb-2 pr-4 text-right text-xs font-medium text-[#9A9FA5]">Pct</th>
              <th className="pb-2 text-right text-xs font-medium text-[#9A9FA5]">Value</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const pct = totalMV > 0 ? (item.marketValue / totalMV) * 100 : 0;
              if (item.rowType === "other") {
                return (
                  <tr key={item.key} className="border-b border-[#EFEFEF] last:border-0">
                    <td className="py-2.5 pr-4">
                      <div className="text-sm italic text-[#9A9FA5]">{item.ticker}</div>
                    </td>
                    <td className="py-2.5 pr-4 text-sm text-[#C0C5CB] hidden sm:table-cell">{item.description}</td>
                    <td className="whitespace-nowrap py-2.5 pr-4 text-right text-sm text-[#C0C5CB]">
                      {formatPct(pct)}
                    </td>
                    <td className="whitespace-nowrap py-2.5 text-right text-sm text-[#C0C5CB]">
                      {formatCurrency(item.marketValue, currency, { decimals: 0 })}
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={item.key} className="border-b border-[#EFEFEF] last:border-0">
                  <td className="py-2.5 pr-4">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-[#1A1D1F]">{item.ticker}</span>
                      {isPublicTicker(item.ticker) && (
                        <button
                          onClick={() => onInfo(item.ticker)}
                          className="text-[#9A9FA5] transition-colors hover:text-[#6C9B8B]"
                          aria-label={`Info for ${item.ticker}`}
                        >
                          <Info className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    {item.sources.length > 0 && (
                      <div className="text-[11px] text-[#C0C5CB]">
                        from {item.sources.join(", ")}
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 text-sm text-[#6F767E] hidden sm:table-cell">
                    {item.description}
                  </td>
                  <td className="whitespace-nowrap py-2.5 pr-4 text-right text-sm text-[#6F767E]">
                    {pct.toFixed(1)}%
                  </td>
                  <td className="whitespace-nowrap py-2.5 text-right text-sm font-medium text-[#1A1D1F]">
                    {formatCurrency(item.marketValue, currency, { decimals: 0 })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-[#C0C5CB]">
        X-Ray shows up to 500 equity holdings per fund by weight. Bond allocations are grouped by issuer type. Remaining weight shown as "— other" rows.
      </p>
    </div>
  );
}

function Th({
  children,
  onClick,
  align = "left",
  className = "",
}: {
  children: React.ReactNode;
  onClick: () => void;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      onClick={onClick}
      className={`cursor-pointer select-none whitespace-nowrap pb-2 pr-4 text-xs font-medium text-[#9A9FA5] transition-colors hover:text-[#6F767E] ${
        align === "right" ? "text-right" : "text-left"
      } ${className}`}
    >
      {children}
    </th>
  );
}
