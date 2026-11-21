"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { ASSET_CLASSES, REGIONS, DETAILED_CLASSES, SECTORS, type TickerAllocation } from "@/lib/classifications";

interface ClassificationDialogProps {
  open: boolean;
  onClose: () => void;
  unclassifiedTickers: string[];
  onSave: (classifications: Record<string, TickerAllocation[]>) => Promise<void>;
}

interface DraftEntry {
  assetClass: string;
  region: string;
  classDetailed: string;
  sector: string;
}

const BLANK: DraftEntry = { assetClass: "", region: "", classDetailed: "", sector: "" };

export function ClassificationDialog({
  open,
  onClose,
  unclassifiedTickers,
  onSave,
}: ClassificationDialogProps) {
  const [draft, setDraft] = useState<Record<string, DraftEntry>>(() =>
    Object.fromEntries(unclassifiedTickers.map((t) => [t, { ...BLANK }]))
  );
  const [saving, setSaving] = useState(false);

  const tickerKey = unclassifiedTickers.join(",");
  const [lastKey, setLastKey] = useState(tickerKey);
  if (tickerKey !== lastKey) {
    setLastKey(tickerKey);
    setDraft(Object.fromEntries(unclassifiedTickers.map((t) => [t, { ...BLANK }])));
  }

  function update(ticker: string, field: keyof DraftEntry, value: string) {
    setDraft((d) => ({ ...d, [ticker]: { ...d[ticker], [field]: value } }));
  }

  async function handleSave() {
    const complete: Record<string, TickerAllocation[]> = {};
    for (const [ticker, v] of Object.entries(draft)) {
      if (v.assetClass && v.region && v.classDetailed && v.sector) {
        complete[ticker] = [{ weight: 1, assetClass: v.assetClass, region: v.region, classDetailed: v.classDetailed, sector: v.sector }];
      }
    }
    if (Object.keys(complete).length === 0) { onClose(); return; }
    setSaving(true);
    try {
      await onSave(complete);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Classify unknown tickers</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p className="text-sm text-muted-foreground">
            These tickers aren&apos;t in the built-in table. Assign a class and region so they
            appear correctly in the allocation view. Saved to your local data folder.
          </p>
          <div className="mt-4 space-y-4">
            {unclassifiedTickers.map((ticker) => {
              const row = draft[ticker] ?? { ...BLANK };
              return (
                <div key={ticker} className="space-y-1.5">
                  <p className="text-sm font-medium">{ticker}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={row.assetClass}
                      onChange={(e) => update(ticker, "assetClass", e.target.value)}
                      className="rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">Asset Class…</option>
                      {ASSET_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <select
                      value={row.region}
                      onChange={(e) => update(ticker, "region", e.target.value)}
                      className="rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">Region…</option>
                      {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <select
                      value={row.classDetailed}
                      onChange={(e) => update(ticker, "classDetailed", e.target.value)}
                      className="rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">Detail…</option>
                      {DETAILED_CLASSES.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <select
                      value={row.sector}
                      onChange={(e) => update(ticker, "sector", e.target.value)}
                      className="rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">Sector…</option>
                      {SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
