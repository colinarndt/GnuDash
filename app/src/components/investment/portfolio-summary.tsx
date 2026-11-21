"use client";

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import type { InvestmentHolding } from "@/lib/types/gnucash";

interface PortfolioSummaryProps {
  holdings: InvestmentHolding[];
  currency: string;
  /** Optional. When provided, gain/loss + return labels are scoped to this period. */
  periodLabel?: string;
}

export function PortfolioSummary({ holdings, currency, periodLabel }: PortfolioSummaryProps) {
  const stats = useMemo(() => {
    const totalMarketValue = holdings.reduce((s, h) => s + h.marketValue, 0);
    const totalCostBasis = holdings.reduce((s, h) => s + h.costBasis, 0);
    // Per-holding gainLoss already encodes the right basis (cost basis for
    // All-time, marketStart for period). Summing works for both modes.
    const totalGainLoss = holdings.reduce((s, h) => s + h.gainLoss, 0);
    // Implicit basis used for gainLoss = marketValue - gainLoss. Summing gives
    // the correct denominator for the % return in both modes without needing
    // a separate field on InvestmentHolding.
    const totalReturnBasis = holdings.reduce((s, h) => s + (h.marketValue - h.gainLoss), 0);
    const totalReturnPct = totalReturnBasis !== 0
      ? (totalGainLoss / Math.abs(totalReturnBasis)) * 100
      : 0;
    return { totalMarketValue, totalCostBasis, totalGainLoss, totalReturnPct };
  }, [holdings]);

  const gainLabel = periodLabel ? `Gain/Loss ${periodLabel}` : "Total Gain/Loss";
  const returnLabel = periodLabel ? `Return ${periodLabel}` : "Total Return";

  const cards = [
    { label: "Market Value", value: formatCurrency(stats.totalMarketValue, currency, { decimals: 0 }) },
    { label: "Cost Basis", value: formatCurrency(stats.totalCostBasis, currency, { decimals: 0 }) },
    {
      label: gainLabel,
      value: formatCurrency(stats.totalGainLoss, currency, { decimals: 0 }),
      color: stats.totalGainLoss >= 0 ? "#6C9B8B" : "#F87171",
    },
    {
      label: returnLabel,
      value: `${stats.totalReturnPct >= 0 ? "+" : ""}${stats.totalReturnPct.toFixed(1)}%`,
      color: stats.totalReturnPct >= 0 ? "#6C9B8B" : "#F87171",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
      {cards.map((c) => (
        <Card key={c.label} className="border-[#EFEFEF] p-4 shadow-sm">
          <p className="text-xs text-[#9A9FA5]">{c.label}</p>
          <p
            className="mt-1 text-lg font-bold sm:text-xl"
            style={{ color: c.color ?? "#1A1D1F" }}
            data-v
          >
            {c.value}
          </p>
        </Card>
      ))}
    </div>
  );
}
