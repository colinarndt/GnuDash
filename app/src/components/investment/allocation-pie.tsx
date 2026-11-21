"use client";

import { useMemo, useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import { getClassification, type TickerAllocation, type GroupField } from "@/lib/classifications";
import { ClassificationDialog } from "@/components/investment/classification-dialog";
import type { GroupedHolding } from "@/app/(dashboard)/investment/page";
import type { FundHoldingsResult } from "@/app/api/fund-holdings/route";

export type GroupMode = "ticker" | "class" | "region" | "classDetailed" | "sector";

interface AllocationPieProps {
  items: GroupedHolding[];
  currency: string;
  selectedTicker: string | null;
  onSelect: (ticker: string | null) => void;
  groupBy: GroupMode;
  onGroupByChange: (mode: GroupMode) => void;
  userClassifications?: Record<string, TickerAllocation[]>;
  onSaveClassification?: (classifications: Record<string, TickerAllocation[]>) => Promise<void>;
  xrayData?: Record<string, FundHoldingsResult | null> | null;
}

const COLORS = [
  "#4A7A6B", "#5C8C7C", "#6C9B8B", "#7DAA9A", "#8FB9A9",
  "#A0C8B8", "#B2D7C8", "#3B6B8A", "#4A7A9A", "#5889A9",
  "#6798B8", "#76A7C7", "#85B6D6", "#D4DAE0",
];
const UNCLASSIFIED_COLOR = "#F59E0B";

interface SliceData {
  key: string;
  name: string;
  ticker: string;
  value: number;
  color: string;
  isUnclassified?: boolean;
}

function syntheticAllocations(r: FundHoldingsResult): TickerAllocation[] {
  const candidates: Array<{ weight: number } & Omit<TickerAllocation, "weight">> = [
    { weight: r.stockPct, assetClass: "Equity",       region: "Global", classDetailed: "Global Equity", sector: "Diversified" },
    { weight: r.bondPct,  assetClass: "Fixed Income", region: "Domestic", classDetailed: "US Bonds",    sector: "Diversified" },
    { weight: r.cashPct,  assetClass: "Cash",         region: "Domestic", classDetailed: "Money Market", sector: "Diversified" },
    { weight: r.otherPct, assetClass: "Alternatives", region: "Global",  classDetailed: "Global Equity", sector: "Diversified" },
  ];
  const entries = candidates.filter((e) => e.weight > 0.001);
  const total = entries.reduce((s, e) => s + e.weight, 0);
  if (total === 0) return [];
  return entries.map((e) => ({ ...e, weight: e.weight / total }));
}

const GROUP_OPTIONS: { value: GroupMode; label: string; disabled?: boolean }[] = [
  { value: "class", label: "Asset Class" },
  { value: "region", label: "Region" },
  { value: "sector", label: "Sector" },
  { value: "ticker", label: "Ticker" },
  { value: "classDetailed", label: "Class (detailed)", disabled: true },
];

export function AllocationPie({
  items, currency, selectedTicker, onSelect,
  groupBy, onGroupByChange,
  userClassifications = {},
  onSaveClassification,
  xrayData,
}: AllocationPieProps) {
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [xray, setXray] = useState(false);

  const merged = userClassifications;

  const totalValue = useMemo(
    () => items.reduce((s, h) => s + h.marketValue, 0),
    [items]
  );

  const { pieData, unclassifiedTickers } = useMemo(() => {
    if (totalValue === 0) return { pieData: [], unclassifiedTickers: [] };

    if (groupBy === "ticker") {
      const sorted = [...items]
        .filter((h) => h.marketValue > 0)
        .sort((a, b) => b.marketValue - a.marketValue);


      const significant: SliceData[] = [];
      let othersTotal = 0;

      sorted.forEach((h, i) => {
        if ((h.marketValue / totalValue) * 100 >= 2) {
          significant.push({
            key: h.key,
            name: h.ticker,
            ticker: h.ticker,
            value: h.marketValue,
            color: COLORS[i % COLORS.length],
          });
        } else {
          othersTotal += h.marketValue;
        }
      });

      if (othersTotal > 0) {
        significant.push({ key: "__others", name: "Others", ticker: "", value: othersTotal, color: "#D4DAE0" });
      }
      return { pieData: significant, unclassifiedTickers: [] };
    }

    // Classification-based grouping with look-through
    const field: GroupField =
      groupBy === "class" ? "assetClass"
      : groupBy === "region" ? "region"
      : groupBy === "sector" ? "sector"
      : "classDetailed";

    const buckets = new Map<string, number>();
    const unknowns = new Set<string>();

    for (const h of items) {
      if (h.marketValue <= 0) continue;
      const allocs = getClassification(h.ticker, merged);
      const fund = xrayData?.[h.ticker];
      // X-Ray ON + we have live fund data → use the real underlying composition,
      //   overriding any manual classification (the whole point of X-Ray).
      // X-Ray OFF → use manual classification; fall back to fund data only when
      //   the ticker hasn't been classified at all.
      const effectiveAllocs = xray && fund
        ? syntheticAllocations(fund)
        : allocs.length > 0
          ? allocs
          : fund
            ? syntheticAllocations(fund)
            : [];
      if (effectiveAllocs.length === 0) {
        unknowns.add(h.ticker);
        buckets.set("Unclassified", (buckets.get("Unclassified") ?? 0) + h.marketValue);
      } else {
        const totalWeight = effectiveAllocs.reduce((s, a) => s + a.weight, 0);
        for (const alloc of effectiveAllocs) {
          const key = alloc[field] || "Unclassified";
          buckets.set(key, (buckets.get(key) ?? 0) + h.marketValue * (alloc.weight / totalWeight));
        }
      }
    }

    const sorted = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
    let colorIdx = 0;
    const slices: SliceData[] = sorted.map(([name, value]) => {
      const isUnclassified = name === "Unclassified";
      const color = isUnclassified ? UNCLASSIFIED_COLOR : COLORS[colorIdx++ % COLORS.length];
      return { key: name, name, ticker: name, value, color, isUnclassified };
    });

    return { pieData: slices, unclassifiedTickers: [...unknowns].sort() };
  }, [items, totalValue, groupBy, merged, xray, xrayData]);

  const isTicker = groupBy === "ticker";

  return (
    <>
      <Card className="shadow-sm border-[#EFEFEF] h-full">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <CardTitle className="text-lg font-semibold text-[#1A1D1F]">
            Allocation
          </CardTitle>
          <div className="flex items-center gap-2">
            {!isTicker && groupBy !== "sector" && (
              <button
                onClick={() => setXray((v) => !v)}
                className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                  xray
                    ? "bg-[#6C9B8B] text-white"
                    : "border border-[#EFEFEF] text-[#9A9FA5] hover:bg-[#F4F5F7]"
                }`}
              >
                X-ray
              </button>
            )}
            {!isTicker && unclassifiedTickers.length > 0 && onSaveClassification && (
              <button
                onClick={() => setClassifyOpen(true)}
                className="rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-300 hover:bg-amber-100 transition-colors"
              >
                {unclassifiedTickers.length} unclassified
              </button>
            )}
            <div className="relative">
              <select
                value={groupBy}
                onChange={(e) => onGroupByChange(e.target.value as GroupMode)}
                className="cursor-pointer appearance-none rounded-lg border border-[#EFEFEF] bg-white py-1.5 pl-3 pr-7 text-xs font-medium text-[#6F767E] transition-colors hover:bg-[#F4F5F7] focus:outline-none"
              >
                {GROUP_OPTIONS.map(({ value, label, disabled }) => (
                  <option key={value} value={value} disabled={disabled}>{label}</option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
                <ChevronDown className="h-3 w-3 text-[#9A9FA5]" />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {pieData.length === 0 ? (
            <p className="py-8 text-center text-sm text-[#9A9FA5]">No holdings</p>
          ) : (
            <div className="flex flex-col gap-4 sm:flex-row">
              <div className="flex shrink-0 flex-col items-center sm:w-[200px]">
                <div className="mb-2 text-center">
                  <span className="text-2xl font-bold text-[#1A1D1F]" data-v>
                    {formatCurrency(totalValue, currency, { decimals: 0 })}
                  </span>
                  <p className="text-[11px] text-[#9A9FA5]">Total value</p>
                </div>
                <div className="relative h-[170px] w-[170px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={2}
                        dataKey="value"
                        stroke="none"
                        onClick={(_, index) => {
                          if (!isTicker) return;
                          const t = pieData[index].ticker;
                          if (!t) return;
                          onSelect(selectedTicker === t ? null : t);
                        }}
                        style={{ cursor: isTicker ? "pointer" : "default" }}
                      >
                        {pieData.map((entry, i) => (
                          <Cell
                            key={`cell-${i}`}
                            fill={entry.color}
                            opacity={isTicker && selectedTicker && entry.ticker !== selectedTicker ? 0.3 : 1}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value) => {
                          const pct = totalValue > 0 ? ((Number(value) / totalValue) * 100).toFixed(1) : "0";
                          return `${formatCurrency(Number(value), currency, { decimals: 0 })} (${pct}%)`;
                        }}
                        contentStyle={{
                          backgroundColor: "white",
                          border: "1px solid #EFEFEF",
                          borderRadius: "10px",
                          fontSize: "13px",
                          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="flex flex-1 flex-col justify-center gap-1.5 overflow-y-auto">
                {pieData.map((entry) => {
                  const pct = totalValue > 0 ? ((entry.value / totalValue) * 100).toFixed(1) : "0";
                  const isSelected = isTicker && selectedTicker === entry.ticker;
                  return (
                    <div
                      key={entry.key}
                      onClick={() => {
                        if (!isTicker || !entry.ticker) return;
                        onSelect(isSelected ? null : entry.ticker);
                      }}
                      className={`flex items-center justify-between gap-2 rounded-md px-1 py-0.5 transition-colors ${
                        isTicker && entry.ticker ? "cursor-pointer" : "cursor-default"
                      } ${isSelected ? "bg-[#6C9B8B]/10" : isTicker && entry.ticker ? "hover:bg-[#F4F5F7]" : ""
                      } ${isTicker && selectedTicker && !isSelected && entry.ticker ? "opacity-40" : ""}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: entry.color }}
                        />
                        <span className={`truncate text-xs ${isSelected ? "font-medium text-[#1A1D1F]" : entry.isUnclassified ? "text-amber-700" : "text-[#6F767E]"}`} data-l>
                          {entry.name}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-xs font-medium text-[#1A1D1F]" data-v>
                          {formatCurrency(entry.value, currency, { decimals: 0 })}
                        </span>
                        <span className="w-[36px] text-right text-[11px] text-[#9A9FA5]" data-v>
                          {pct}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {onSaveClassification && (
        <ClassificationDialog
          open={classifyOpen}
          onClose={() => setClassifyOpen(false)}
          unclassifiedTickers={unclassifiedTickers}
          onSave={onSaveClassification}
        />
      )}
    </>
  );
}
