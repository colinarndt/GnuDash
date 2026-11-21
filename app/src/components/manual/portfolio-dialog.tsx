"use client";

import { useState } from "react";
import { PlusCircle, Trash2 } from "lucide-react";
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
import { TickerInput } from "@/components/ui/ticker-input";
import type { ManualPortfolio, ManualHolding } from "@/lib/manual-portfolios/storage";

const PORTFOLIO_ACCOUNT_TYPES = [
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
  { value: "other", label: "Other" },
];

interface DraftRow {
  id: string;
  ticker: string;
  description: string;
  shares: string;
  price: string;
  marketValue: string;
  costBasis: string;
  fetchPriceOnline: boolean;
}

function emptyRow(): DraftRow {
  return { id: crypto.randomUUID(), ticker: "", description: "", shares: "", price: "", marketValue: "", costBasis: "", fetchPriceOnline: true };
}

function holdingsToDraft(holdings: ManualHolding[]): DraftRow[] {
  if (holdings.length === 0) return [emptyRow()];
  return holdings.map((h) => ({
    id: crypto.randomUUID(),
    ticker: h.ticker,
    description: h.description ?? "",
    shares: h.shares > 0 ? h.shares.toString() : "",
    price: h.price?.toString() ?? "",
    marketValue: h.marketValue?.toString() ?? "",
    costBasis: h.costBasis?.toString() ?? "",
    fetchPriceOnline: h.fetchPriceOnline !== false,
  }));
}

interface PortfolioDialogProps {
  open: boolean;
  onClose: () => void;
  portfolio?: ManualPortfolio;
  onSaved: (portfolio: ManualPortfolio) => void;
  onDelete?: () => void;
}

export function PortfolioDialog({ open, onClose, portfolio, onSaved, onDelete }: PortfolioDialogProps) {
  const isEdit = !!portfolio;
  const [name, setName] = useState(portfolio?.name ?? "");
  const [accountType, setAccountType] = useState(portfolio?.accountType ?? "");
  const [rows, setRows] = useState<DraftRow[]>(() => holdingsToDraft(portfolio?.holdings ?? []));
  const [saving, setSaving] = useState(false);

  // Reset state when dialog opens for a different portfolio
  const [lastId, setLastId] = useState(portfolio?.id ?? "__new__");
  const currentId = portfolio?.id ?? "__new__";
  if (currentId !== lastId) {
    setLastId(currentId);
    setName(portfolio?.name ?? "");
    setAccountType(portfolio?.accountType ?? "");
    setRows(holdingsToDraft(portfolio?.holdings ?? []));
  }

  function updateRow(id: string, field: keyof Omit<DraftRow, "id">, value: string | boolean) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  function removeRow(id: string) {
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs));
  }

  function addRow() {
    setRows((rs) => [...rs, emptyRow()]);
  }

  async function handleSave() {
    if (!name.trim()) return;

    const holdings: ManualHolding[] = rows
      .filter((r) => r.ticker && (parseFloat(r.shares) > 0 || parseFloat(r.marketValue) > 0))
      .map((r) => ({
        ticker: r.ticker.toUpperCase(),
        description: r.description.trim() || null,
        shares: parseFloat(r.shares) || 0,
        price: r.price ? parseFloat(r.price) : null,
        marketValue: r.marketValue ? parseFloat(r.marketValue) : null,
        costBasis: r.costBasis ? parseFloat(r.costBasis) : null,
        fetchPriceOnline: r.fetchPriceOnline,
      }));

    setSaving(true);
    try {
      const url = isEdit ? `/api/manual-portfolios/${portfolio.id}` : "/api/manual-portfolios";
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), holdings, account_type: accountType || undefined }),
      });
      if (!res.ok) return;
      const { portfolio: saved } = (await res.json()) as { portfolio: ManualPortfolio };
      onSaved(saved);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const canSave = name.trim().length > 0 && rows.some((r) => r.ticker && (parseFloat(r.shares) > 0 || parseFloat(r.marketValue) > 0));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit portfolio" : "Add portfolio"}</DialogTitle>
        </DialogHeader>

        <DialogBody>
          {/* Portfolio name + type */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Portfolio name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Fidelity, TIAA, Personal Brokerage"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Account type</label>
              <select
                value={accountType}
                onChange={(e) => setAccountType(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {PORTFOLIO_ACCOUNT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Holdings */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Holdings</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="pb-2 text-left font-medium w-[130px]">Ticker</th>
                    <th className="pb-2 pl-2 text-left font-medium">Description <span className="font-normal text-muted-foreground/50">(opt)</span></th>
                    <th className="pb-2 pl-2 text-right font-medium w-[90px]">Shares</th>
                    <th className="pb-2 pl-2 text-right font-medium w-[100px]">
                      Price
                      <span className="ml-1 font-normal text-muted-foreground/50">(opt)</span>
                    </th>
                    <th className="pb-2 pl-2 text-right font-medium w-[110px]">
                      Mkt Value
                      <span className="ml-1 font-normal text-muted-foreground/50">(opt)</span>
                    </th>
                    <th className="pb-2 pl-2 text-right font-medium w-[110px]">
                      Cost Basis
                      <span className="ml-1 font-normal text-muted-foreground/50">(opt)</span>
                    </th>
                    <th className="pb-2 pl-2 text-center font-medium w-[60px]" title="Fetch current price from Yahoo Finance">
                      Get Quotes
                    </th>
                    <th className="pb-2 pl-2 w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="py-1.5 pr-2">
                        <TickerInput
                          value={row.ticker}
                          onChange={(v) => updateRow(row.id, "ticker", v)}
                          placeholder="e.g. VTI"
                        />
                      </td>
                      <td className="py-1.5 pl-2">
                        <input
                          type="text"
                          value={row.description}
                          onChange={(e) => updateRow(row.id, "description", e.target.value)}
                          placeholder="Security name"
                          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </td>
                      <td className="py-1.5 pl-2">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={row.shares}
                          onChange={(e) => updateRow(row.id, "shares", e.target.value)}
                          placeholder="0"
                          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </td>
                      <td className="py-1.5 pl-2">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={row.price}
                          onChange={(e) => updateRow(row.id, "price", e.target.value)}
                          placeholder="—"
                          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </td>
                      <td className="py-1.5 pl-2">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={row.marketValue}
                          onChange={(e) => updateRow(row.id, "marketValue", e.target.value)}
                          placeholder="—"
                          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </td>
                      <td className="py-1.5 pl-2">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={row.costBasis}
                          onChange={(e) => updateRow(row.id, "costBasis", e.target.value)}
                          placeholder="—"
                          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </td>
                      <td className="py-1.5 pl-2 text-center">
                        <input
                          type="checkbox"
                          checked={row.fetchPriceOnline}
                          onChange={(e) => updateRow(row.id, "fetchPriceOnline", e.target.checked)}
                          title="Fetch current price from Yahoo Finance"
                          className="h-4 w-4 cursor-pointer accent-[#6C9B8B]"
                        />
                      </td>
                      <td className="py-1.5 pl-2">
                        <button
                          type="button"
                          onClick={() => removeRow(row.id)}
                          disabled={rows.length === 1}
                          className="rounded p-1 text-muted-foreground/40 transition-colors hover:bg-muted hover:text-destructive disabled:pointer-events-none disabled:opacity-20"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={addRow}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <PlusCircle className="h-3.5 w-3.5" />
              Add holding
            </button>
          </div>

          <p className="text-xs text-muted-foreground/50">
            Price and Cost Basis are optional. Enter Price to see market value on the Portfolio page.
          </p>
        </DialogBody>

        <DialogFooter>
          <div>
            {isEdit && onDelete && (
              <Button variant="ghost" size="sm" onClick={onDelete} className="text-destructive hover:text-destructive hover:bg-destructive/10">
                Delete portfolio
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving || !canSave}>
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {isEdit ? "Save changes" : "Add portfolio"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
