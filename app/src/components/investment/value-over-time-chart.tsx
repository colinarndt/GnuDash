"use client";

import { useMemo, useState, useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import type { MonthlyInvestmentValue } from "@/lib/types/gnucash";
import { TimelineSelector, type Timeline, resolveTimeline } from "./timeline-selector";

interface ValueOverTimeChartProps {
  series: MonthlyInvestmentValue[];
  currency: string;
  selectedTicker: string | null;
  /** Optional. If provided, renders the TimelineSelector in the header. */
  timeline?: Timeline;
  onTimelineChange?: (next: Timeline) => void;
}

export function ValueOverTimeChart({ series, currency, selectedTicker, timeline, onTimelineChange }: ValueOverTimeChartProps) {
  const [showCostBasis, setShowCostBasis] = useState(true);

  // When switching to a specific time period, the cost-basis line tends to
  // dominate the y-axis and flatten the market-value movement. Default to
  // hidden for periods, visible for "All time".
  useEffect(() => {
    if (!timeline) return;
    setShowCostBasis(timeline.kind === "total");
  }, [timeline]);


  const chartData = useMemo(() => {
    // Cap at the current month — future-dated transactions / prices shouldn't
    // produce a forward-looking data point.
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    // Resolve timeline to a visible x-axis range. "All time" lets the chart
    // start from the earliest data point.
    const { startMonth, endMonth } = timeline
      ? resolveTimeline(timeline)
      : { startMonth: null, endMonth: currentMonth };
    const visibleEnd = endMonth > currentMonth ? currentMonth : endMonth;

    // Filter by ticker if selected
    const filtered = (selectedTicker
      ? series.filter((s) => s.ticker === selectedTicker)
      : series
    ).filter((s) => s.month <= visibleEnd && (!startMonth || s.month >= startMonth));

    // Aggregate by month: sum value and costBasis across all tickers
    const monthly = new Map<string, { value: number; costBasis: number }>();
    for (const row of filtered) {
      const existing = monthly.get(row.month);
      if (existing) {
        existing.value += row.value;
        existing.costBasis += row.costBasis;
      } else {
        monthly.set(row.month, { value: row.value, costBasis: row.costBasis });
      }
    }

    return [...monthly.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => {
        const [yr, mo] = month.split("-");
        const d = new Date(Number(yr), Number(mo) - 1, 1);
        return {
          month,
          label: d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
          value: data.value,
          costBasis: data.costBasis,
        };
      });
  }, [series, selectedTicker, timeline]);

  // Tight-fit the y-axis to the actual visible range. Starting at 0 makes
  // short periods (e.g. "This month") look flat when the position is ~$300k
  // with $2k of movement — we want the movement to be visible.
  const { yMin, yMax, maxValue } = useMemo(() => {
    if (chartData.length === 0) return { yMin: 0, yMax: 1, maxValue: 0 };
    let lo = Infinity;
    let hi = -Infinity;
    for (const d of chartData) {
      lo = Math.min(lo, d.value);
      hi = Math.max(hi, d.value);
      if (showCostBasis) {
        lo = Math.min(lo, d.costBasis);
        hi = Math.max(hi, d.costBasis);
      }
    }
    return { yMin: lo, yMax: hi, maxValue: hi };
  }, [chartData, showCostBasis]);

  const yDomain = useMemo<[number, number]>(() => {
    const range = yMax - yMin;
    if (range <= 0) return [Math.max(0, yMin - 1), yMax + 1];
    const pad = range * 0.1;
    // Clamp the floor at 0 so accounts that legitimately start near zero
    // (e.g. "All time" inception) still have a sensible baseline.
    return [Math.max(0, yMin - pad), yMax + pad];
  }, [yMin, yMax]);

  const hasCostBasis = useMemo(() => chartData.some((d) => d.costBasis > 0), [chartData]);

  return (
    <Card className="shadow-sm border-[#EFEFEF] overflow-visible">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-lg font-semibold text-[#1A1D1F]">
          Portfolio Value
          {selectedTicker && (
            <span className="ml-2 text-sm font-normal text-[#6C9B8B]">
              {selectedTicker}
            </span>
          )}
        </CardTitle>
        <div className="flex items-center gap-3">
          {hasCostBasis && (
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[#6F767E] select-none">
              <input
                type="checkbox"
                checked={showCostBasis}
                onChange={(e) => setShowCostBasis(e.target.checked)}
                className="h-3 w-3 accent-[#6C9B8B]"
              />
              Cost Basis
            </label>
          )}
          {timeline && onTimelineChange && (
            <TimelineSelector value={timeline} onChange={onTimelineChange} />
          )}
        </div>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <p className="py-8 text-center text-sm text-[#9A9FA5]">No data available</p>
        ) : (
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EFEFEF" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "#9A9FA5" }}
                  tickLine={false}
                  axisLine={{ stroke: "#EFEFEF" }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  // Explicit tight-fit domain so the line shows movement even
                  // when the position is large vs the range. Floor clamped to
                  // 0 so inception-style series still anchor at zero.
                  domain={yDomain}
                  tick={{ fontSize: 11, fill: "#9A9FA5" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) =>
                    maxValue >= 1000
                      ? `${(v / 1000).toFixed(0)}k`
                      : String(v)
                  }
                  width={52}
                />
                <Tooltip
                  formatter={(value, name) => [
                    formatCurrency(Number(value), currency, { decimals: 0 }),
                    name === "value" ? "Market Value" : "Cost Basis",
                  ]}
                  labelFormatter={(label) => String(label)}
                  contentStyle={{
                    backgroundColor: "white",
                    border: "1px solid #EFEFEF",
                    borderRadius: "10px",
                    fontSize: "13px",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                  }}
                />
                <Legend
                  formatter={(value) => (
                    <span className="text-xs text-[#6F767E]">
                      {value === "value" ? "Market Value" : "Cost Basis"}
                    </span>
                  )}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#6C9B8B"
                  strokeWidth={2}
                  dot={false}
                  name="value"
                />
                {hasCostBasis && showCostBasis && (
                  <Line
                    type="monotone"
                    dataKey="costBasis"
                    stroke="#9A9FA5"
                    strokeWidth={1.5}
                    strokeDasharray="6 4"
                    dot={false}
                    name="costBasis"
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
