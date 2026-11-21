"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";

export type Timeline =
  | { kind: "total" }
  | { kind: "last-6-months" }
  | { kind: "last-12-months" }
  | { kind: "this-year" }
  | { kind: "last-year" }
  | { kind: "last-2-years" }
  | { kind: "last-5-years" }
  | { kind: "custom"; startMonth: string; endMonth: string };

interface TimelineSelectorProps {
  value: Timeline;
  onChange: (next: Timeline) => void;
}

const PRESETS: { kind: Exclude<Timeline["kind"], "custom">; label: string }[] = [
  { kind: "total", label: "All time" },
  { kind: "last-6-months", label: "Last 6 months" },
  { kind: "last-12-months", label: "Last 12 months" },
  { kind: "this-year", label: "This year" },
  { kind: "last-year", label: "Last year" },
  { kind: "last-2-years", label: "Last 2 years" },
  { kind: "last-5-years", label: "Last 5 years" },
];

function labelFor(t: Timeline): string {
  if (t.kind === "custom") return `${t.startMonth} → ${t.endMonth}`;
  return PRESETS.find((p) => p.kind === t.kind)?.label ?? "All time";
}

/**
 * Short label for use in summary card labels (e.g. "Gain/Loss This Year"). Returns null for
 * the All-time preset so callers can keep their existing "Total Gain/Loss" wording.
 */
export function periodLabel(t: Timeline): string | null {
  switch (t.kind) {
    case "total": return null;
    case "last-6-months": return "Last 6 Months";
    case "last-12-months": return "Last 12 Months";
    case "this-year": return "This Year";
    case "last-year": return "Last Year";
    case "last-2-years": return "Last 2 Years";
    case "last-5-years": return "Last 5 Years";
    case "custom": return `${t.startMonth} → ${t.endMonth}`;
  }
}

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function TimelineSelector({ value, onChange }: TimelineSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [customStart, setCustomStart] = useState(
    value.kind === "custom" ? value.startMonth : currentYearMonth(),
  );
  const [customEnd, setCustomEnd] = useState(
    value.kind === "custom" ? value.endMonth : currentYearMonth(),
  );

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function applyCustom() {
    if (!customStart || !customEnd) return;
    onChange({ kind: "custom", startMonth: customStart, endMonth: customEnd });
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-[#EFEFEF] bg-white px-2.5 py-1 text-xs font-medium text-[#6F767E] shadow-sm transition-colors hover:border-[#D4DAE0] dark:border-border dark:bg-card dark:text-foreground"
      >
        {labelFor(value)}
        <ChevronDown
          className={`h-3 w-3 shrink-0 text-[#9A9FA5] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-xl border border-[#EFEFEF] bg-white shadow-lg dark:border-border dark:bg-card">
          <div className="py-1">
            {PRESETS.map((p) => {
              const isActive = value.kind === p.kind;
              return (
                <button
                  key={p.kind}
                  onClick={() => {
                    onChange({ kind: p.kind } as Timeline);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  <span className="w-3.5 shrink-0">
                    {isActive && <Check className="h-3.5 w-3.5 text-[#6C9B8B]" />}
                  </span>
                  <span>{p.label}</span>
                </button>
              );
            })}
          </div>
          <div className="border-t border-[#EFEFEF] dark:border-border" />
          <div className="px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="w-3.5 shrink-0">
                {value.kind === "custom" && <Check className="h-3.5 w-3.5 text-[#6C9B8B]" />}
              </span>
              <span className="text-sm">Custom</span>
            </div>
            <div className="mt-1.5 ml-5 flex flex-col gap-1">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                From
                <input
                  type="month"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="rounded border border-border bg-background px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                To
                <input
                  type="month"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="rounded border border-border bg-background px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </label>
              <button
                onClick={applyCustom}
                disabled={!customStart || !customEnd || customStart > customEnd}
                className="mt-1 self-end rounded bg-[#6C9B8B] px-2 py-0.5 text-xs font-medium text-white transition-colors hover:bg-[#5a8a7a] disabled:opacity-40"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Resolve a Timeline to start/end YYYY-MM strings. start = null means "since inception" (no period delta). */
export function resolveTimeline(t: Timeline): { startMonth: string | null; endMonth: string } {
  const now = new Date();
  const yr = now.getFullYear();
  const mo = now.getMonth() + 1; // 1..12
  const cur = `${yr}-${String(mo).padStart(2, "0")}`;
  function addMonths(year: number, month: number, delta: number): string {
    const total = year * 12 + (month - 1) + delta;
    const ny = Math.floor(total / 12);
    const nm = (total % 12) + 1;
    return `${ny}-${String(nm).padStart(2, "0")}`;
  }
  switch (t.kind) {
    case "total":
      return { startMonth: null, endMonth: cur };
    case "last-6-months":
      return { startMonth: addMonths(yr, mo, -6), endMonth: cur };
    case "last-12-months":
      return { startMonth: addMonths(yr, mo, -12), endMonth: cur };
    case "this-year":
      // End of last December is the "start" snapshot, current month is the end.
      return { startMonth: `${yr - 1}-12`, endMonth: cur };
    case "last-year":
      // Previous calendar year: Dec two years ago → Dec one year ago.
      return { startMonth: `${yr - 2}-12`, endMonth: `${yr - 1}-12` };
    case "last-2-years":
      return { startMonth: addMonths(yr, mo, -24), endMonth: cur };
    case "last-5-years":
      return { startMonth: addMonths(yr, mo, -60), endMonth: cur };
    case "custom": {
      // The user's "From" month is inclusive of activity in that month, so
      // the start snapshot must be taken at the END of the previous month
      // (= position entering the From month). The To month is inclusive: we
      // want the cumulative through end of that month.
      const [sy, sm] = t.startMonth.split("-").map(Number);
      const startSnapMonth = addMonths(sy, sm, -1);
      return { startMonth: startSnapMonth, endMonth: t.endMonth };
    }
  }
}
