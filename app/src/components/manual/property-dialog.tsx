"use client";

import { useState, useEffect } from "react";
import { AlertTriangle, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import type { RealEstateProperty } from "@/lib/real-estate/types";

interface PropertyDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: (property: RealEstateProperty) => void;
  property?: RealEstateProperty;
  onDelete?: () => void;
}

interface DraftImprovement {
  id: string;
  description: string;
  date: string;
  cost: string;
}

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

function newImprovement(): DraftImprovement {
  return { id: crypto.randomUUID(), description: "", date: "", cost: "" };
}

function toDraft(imps: RealEstateProperty["improvements"]): DraftImprovement[] {
  return imps.map((i) => ({ id: i.id, description: i.description, date: i.date ?? "", cost: String(i.cost) }));
}

export function PropertyDialog({ open, onClose, onSaved, property, onDelete }: PropertyDialogProps) {
  const isEdit = !!property;

  const [nickname, setNickname] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [improvements, setImprovements] = useState<DraftImprovement[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [priceWarning, setPriceWarning] = useState<string | null>(null);

  // Populate fields when editing
  useEffect(() => {
    if (open) {
      if (property) {
        setNickname(property.nickname);
        setAddress(property.address);
        setCity(property.city);
        setState(property.state);
        setZip(property.zip);
        setPurchasePrice(property.purchasePrice != null ? String(property.purchasePrice) : "");
        setPurchaseDate(property.purchaseDate ?? "");
        setImprovements(toDraft(property.improvements ?? []));
      } else {
        setNickname(""); setAddress(""); setCity(""); setState(""); setZip("");
        setPurchasePrice(""); setPurchaseDate(""); setImprovements([]);
      }
      setError(null);
      setPriceWarning(null);
    }
  }, [open, property]);

  function handleClose() { onClose(); }

  function addImprovement() {
    setImprovements((prev) => [...prev, newImprovement()]);
  }

  function updateImprovement(id: string, field: keyof DraftImprovement, value: string) {
    setImprovements((prev) => prev.map((imp) => imp.id === id ? { ...imp, [field]: value } : imp));
  }

  function removeImprovement(id: string) {
    setImprovements((prev) => prev.filter((imp) => imp.id !== id));
  }

  const canSave =
    nickname.trim().length > 0 &&
    address.trim().length > 0 &&
    city.trim().length > 0 &&
    state.trim().length > 0 &&
    zip.trim().length > 0;

  const validImprovements = improvements
    .filter((imp) => imp.description.trim() && parseFloat(imp.cost) > 0)
    .map((imp) => ({
      id: imp.id,
      description: imp.description.trim(),
      date: imp.date || null,
      cost: parseFloat(imp.cost),
    }));

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    setPriceWarning(null);
    try {
      const body = {
        nickname, address, city, state, zip,
        purchasePrice: purchasePrice ? parseFloat(purchasePrice) : null,
        purchaseDate: purchaseDate || null,
        improvements: validImprovements,
      };

      let res: Response;
      if (isEdit) {
        res = await fetch(`/api/real-estate/${property!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch("/api/real-estate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }

      const data = (await res.json()) as { property?: RealEstateProperty; error?: string; priceError?: string };
      if (!res.ok) { setError(data.error ?? "Failed to save"); return; }

      if (!isEdit && data.priceError) {
        setPriceWarning(data.priceError);
        onSaved(data.property!);
      } else {
        onSaved(data.property!);
        handleClose();
      }
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

  const improvementsTotal = improvements.reduce((s, imp) => {
    const v = parseFloat(imp.cost);
    return s + (isNaN(v) ? 0 : v);
  }, 0);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Property" : "Add Real Estate Property"}</DialogTitle>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Nickname</label>
            <input className={inputCls} placeholder="e.g. Primary Home, Rental Property" value={nickname} onChange={(e) => setNickname(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Street Address</label>
            <input className={inputCls} placeholder="123 Main St" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">City</label>
              <input className={inputCls} placeholder="Austin" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">State</label>
              <select className={inputCls} value={state} onChange={(e) => setState(e.target.value)}>
                <option value="">— Select —</option>
                {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="w-32">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">ZIP Code</label>
            <input className={inputCls} placeholder="78701" value={zip} onChange={(e) => setZip(e.target.value)} />
          </div>

          <div className="border-t border-border pt-4">
            <p className="mb-3 text-xs font-medium text-muted-foreground">Purchase details (optional)</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Purchase Price</label>
                <input
                  className={inputCls}
                  type="number"
                  min="0"
                  placeholder="350000"
                  value={purchasePrice}
                  onChange={(e) => setPurchasePrice(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Purchase Date</label>
                <input
                  className={inputCls}
                  type="date"
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Improvements</p>
                {improvementsTotal > 0 && (
                  <p className="text-xs text-muted-foreground/60">
                    Total: ${improvementsTotal.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </p>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={addImprovement} type="button">
                <Plus className="mr-1 h-3 w-3" />
                Add
              </Button>
            </div>

            {improvements.length === 0 ? (
              <p className="text-xs text-muted-foreground/50">
                Add renovations, additions, or other capital improvements that increase your cost basis.
              </p>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_100px_90px_28px] gap-2 text-xs font-medium text-muted-foreground/60">
                  <span>Description</span>
                  <span>Date</span>
                  <span>Cost</span>
                  <span />
                </div>
                {improvements.map((imp) => (
                  <div key={imp.id} className="grid grid-cols-[1fr_100px_90px_28px] items-center gap-2">
                    <input
                      className={inputCls}
                      placeholder="Kitchen remodel"
                      value={imp.description}
                      onChange={(e) => updateImprovement(imp.id, "description", e.target.value)}
                    />
                    <input
                      className={inputCls}
                      type="date"
                      value={imp.date}
                      onChange={(e) => updateImprovement(imp.id, "date", e.target.value)}
                    />
                    <input
                      className={inputCls}
                      type="number"
                      min="0"
                      placeholder="25000"
                      value={imp.cost}
                      onChange={(e) => updateImprovement(imp.id, "cost", e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => removeImprovement(imp.id)}
                      className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground/50 hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          {priceWarning && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>
                <p className="font-medium">Property saved, but value estimate failed</p>
                <p className="mt-0.5 text-amber-800/80 dark:text-amber-300/70">{priceWarning}</p>
                <p className="mt-1">You can retry with the refresh button on the property card.</p>
              </div>
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          <div>
            {isEdit && onDelete && (
              <Button variant="ghost" size="sm" onClick={onDelete} className="text-destructive hover:text-destructive hover:bg-destructive/10">
                Delete property
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleClose} disabled={saving}>Cancel</Button>
            {priceWarning ? (
              <Button onClick={handleClose}>Close</Button>
            ) : (
              <Button onClick={handleSave} disabled={!canSave || saving}>
                {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                {saving ? (isEdit ? "Saving…" : "Fetching value…") : (isEdit ? "Save changes" : "Add property")}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
