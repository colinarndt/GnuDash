"use client";

import { useEffect, useState } from "react";
import { Loader2, ExternalLink } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { TickerInfo } from "@/lib/yahoo/ticker-info-cache";

const QUOTE_TYPE_LABEL: Record<string, string> = {
  ETF: "ETF",
  EQUITY: "Stock",
  MUTUALFUND: "Mutual Fund",
  CRYPTOCURRENCY: "Crypto",
};

function formatAUM(val: number): string {
  if (val >= 1e12) return `$${(val / 1e12).toFixed(1)}T`;
  if (val >= 1e9) return `$${(val / 1e9).toFixed(1)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
  return `$${val.toLocaleString()}`;
}

interface FundInfoSheetProps {
  ticker: string | null;
  onClose: () => void;
}

export function FundInfoSheet({ ticker, onClose }: FundInfoSheetProps) {
  const [info, setInfo] = useState<TickerInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ticker) return;
    setInfo(null);
    setLoading(true);
    fetch(`/api/ticker-info?ticker=${encodeURIComponent(ticker)}`)
      .then((r) => (r.ok ? r.json() : { info: null }))
      .then((d: { info: TickerInfo | null }) => setInfo(d.info))
      .catch(() => setInfo(null))
      .finally(() => setLoading(false));
  }, [ticker]);

  const isFund = info?.quoteType === "ETF" || info?.quoteType === "MUTUALFUND";
  const isStock = info?.quoteType === "EQUITY";

  return (
    <Sheet open={ticker !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="sm:max-w-md w-full overflow-y-auto">
        <SheetHeader className="border-b border-[#EFEFEF] pb-4">
          <div className="pr-8">
            <SheetTitle className="text-base font-semibold text-[#1A1D1F] leading-snug">
              {info?.name ?? ticker}
            </SheetTitle>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="font-mono text-sm text-[#6F767E]">{ticker}</span>
              {info?.quoteType && (
                <span className="rounded-full bg-[#6C9B8B]/10 px-2 py-0.5 text-xs font-medium text-[#6C9B8B]">
                  {QUOTE_TYPE_LABEL[info.quoteType] ?? info.quoteType}
                </span>
              )}
              {info?.currency && (
                <span className="text-xs text-[#9A9FA5]">{info.currency}</span>
              )}
            </div>
          </div>
        </SheetHeader>

        <div className="px-4 py-5 space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !info ? (
            <p className="py-12 text-center text-sm text-[#9A9FA5]">No data available</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2.5">
                {/* Fund / ETF stats */}
                {isFund && info.fundFamily && <Stat label="Fund Family" value={info.fundFamily} />}
                {isFund && info.category && <Stat label="Category" value={info.category} />}
                {isFund && info.expenseRatio != null && (
                  <Stat label="Expense Ratio" value={`${(info.expenseRatio * 100).toFixed(2)}%`} />
                )}
                {isFund && info.totalAssets != null && (
                  <Stat label="AUM" value={formatAUM(info.totalAssets)} />
                )}

                {/* Stock stats */}
                {isStock && info.sector && <Stat label="Sector" value={info.sector} />}
                {isStock && info.industry && <Stat label="Industry" value={info.industry} />}
                {isStock && info.beta != null && <Stat label="Beta" value={info.beta.toFixed(2)} />}
                {isStock && info.forwardPE != null && (
                  <Stat label="Forward P/E" value={info.forwardPE.toFixed(1)} />
                )}
                {isStock && info.trailingEps != null && (
                  <Stat label="Trailing EPS" value={`$${info.trailingEps.toFixed(2)}`} />
                )}

                {/* Cross-type stats */}
                {info.yield != null && (
                  <Stat label="Yield" value={`${(info.yield * 100).toFixed(2)}%`} />
                )}
                {info.weekChange52 != null && (
                  <Stat
                    label="52-Week Change"
                    value={`${info.weekChange52 >= 0 ? "+" : ""}${(info.weekChange52 * 100).toFixed(1)}%`}
                    valueClassName={info.weekChange52 >= 0 ? "text-[#6C9B8B]" : "text-[#F87171]"}
                  />
                )}
                {info.country && <Stat label="Country" value={info.country} />}
              </div>

              {info.website && (
                <a
                  href={info.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-sm text-[#6C9B8B] hover:underline"
                >
                  {info.website.replace(/^https?:\/\//, "")}
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                </a>
              )}

              {info.description && (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[#9A9FA5]">
                    Overview
                  </p>
                  <p className="text-sm leading-relaxed text-[#6F767E]">{info.description}</p>
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Stat({
  label,
  value,
  valueClassName = "text-[#1A1D1F]",
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-lg bg-[#F9FAFB] p-3">
      <p className="mb-0.5 text-xs text-[#9A9FA5]">{label}</p>
      <p className={`text-sm font-medium ${valueClassName}`}>{value}</p>
    </div>
  );
}
