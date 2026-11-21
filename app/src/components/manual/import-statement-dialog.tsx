"use client";

import { useState, useRef } from "react";
import { AlertCircle, FileUp, Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";
import type { DetectedAccount, DetectedHolding } from "@/app/api/import/parse/route";

const ACCOUNT_TYPES = [
  { value: "", label: "— Select type —" },
  { value: "roth_ira", label: "Roth IRA" },
  { value: "traditional_ira", label: "Traditional IRA" },
  { value: "roth_401k", label: "Roth 401(k)" },
  { value: "traditional_401k", label: "Traditional 401(k)" },
  { value: "403b", label: "403(b)" },
  { value: "457b", label: "457(b)" },
  { value: "sep_ira", label: "SEP-IRA" },
  { value: "solo_401k", label: "Solo 401(k)" },
  { value: "hsa", label: "HSA" },
  { value: "529", label: "529 Plan" },
  { value: "taxable", label: "Taxable Brokerage" },
  { value: "other", label: "Other" },
];

interface EditableHolding extends DetectedHolding {
  sharesStr: string;
  priceStr: string;
  costBasisStr: string;
}

interface EditableAccount {
  institutionName: string;
  accountName: string;
  accountNumber: string;
  accountType: string;
  inferenceNotes: string[];
  holdings: EditableHolding[];
  include: boolean;
}

function toEditable(accounts: DetectedAccount[]): EditableAccount[] {
  return accounts.map((a) => ({
    ...a,
    accountNumber: a.accountNumber ?? "",
    accountType: a.accountType ?? "",
    include: true,
    holdings: a.holdings.map((h) => ({
      ...h,
      sharesStr: h.shares?.toString() ?? "",
      priceStr: h.price?.toString() ?? "",
      costBasisStr: h.costBasis?.toString() ?? "",
    })),
  }));
}

function fromEditable(accounts: EditableAccount[]): DetectedAccount[] {
  return accounts
    .filter((a) => a.include)
    .map((a) => ({
      institutionName: a.institutionName,
      accountName: a.accountName,
      accountNumber: a.accountNumber || null,
      accountType: a.accountType || null,
      inferenceNotes: a.inferenceNotes,
      holdings: a.holdings.map((h) => ({
        ticker: h.ticker,
        description: h.description,
        shares: parseFloat(h.sharesStr) || 0,
        price: h.priceStr ? parseFloat(h.priceStr) : null,
        marketValue: h.marketValue,
        costBasis: h.costBasisStr ? parseFloat(h.costBasisStr) : null,
      })),
    }));
}

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
  institutionName: string;
}

export function ImportStatementDialog({ open, onClose, onImported, institutionName }: Props) {
  const [step, setStep] = useState<"upload" | "parsing" | "review">("upload");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [editableAccounts, setEditableAccounts] = useState<EditableAccount[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setStep("upload");
    setImportFile(null);
    setImportError(null);
    setEditableAccounts([]);
    setIsSaving(false);
    setDragging(false);
  }

  function handleClose() {
    if (step === "parsing") return;
    reset();
    onClose();
  }

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setImportError("Only PDF files are supported.");
      return;
    }
    setImportFile(file);
    setImportError(null);
    setStep("parsing");

    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch("/api/import/parse", { method: "POST", body: form });
      const data = (await res.json()) as { accounts?: DetectedAccount[]; error?: string };
      if (!res.ok || data.error) {
        setImportError(data.error ?? "Parsing failed.");
        setStep("upload");
        return;
      }
      setEditableAccounts(toEditable(data.accounts ?? []));
      setStep("review");
    } catch {
      setImportError("Network error — please try again.");
      setStep("upload");
    }
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      const accounts = fromEditable(editableAccounts);
      const res = await fetch("/api/import/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts, sourceFile: importFile?.name ?? "unknown" }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        setImportError(d.error ?? "Save failed.");
        return;
      }
      reset();
      onImported();
      onClose();
    } catch {
      setImportError("Network error — please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  function updateAccount(i: number, patch: Partial<EditableAccount>) {
    setEditableAccounts((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  }

  function updateHolding(ai: number, hi: number, patch: Partial<EditableHolding>) {
    setEditableAccounts((prev) =>
      prev.map((a, idx) =>
        idx === ai
          ? { ...a, holdings: a.holdings.map((h, hIdx) => (hIdx === hi ? { ...h, ...patch } : h)) }
          : a
      )
    );
  }

  const includedCount = editableAccounts.filter((a) => a.include).length;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {step === "review" ? "Review extracted data" : `Import ${institutionName} statement`}
          </DialogTitle>
        </DialogHeader>

        <DialogBody>
          {/* Upload / parsing step */}
          {(step === "upload" || step === "parsing") && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Upload a statement from{" "}
                <span className="font-medium text-foreground">{institutionName}</span>.
                All accounts on the statement will be imported or updated. Your per-holding
                settings (like &ldquo;Get Quotes&rdquo;) are preserved.
              </p>

              {importError && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {importError}
                </div>
              )}

              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const f = e.dataTransfer.files[0];
                  if (f) handleFile(f);
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-14 transition-colors ${
                  dragging
                    ? "border-[#6C9B8B] bg-[#6C9B8B]/5"
                    : "border-border hover:border-[#6C9B8B]/50 hover:bg-muted/30"
                } ${step === "parsing" ? "pointer-events-none opacity-50" : ""}`}
              >
                {step === "parsing" ? (
                  <>
                    <Loader2 className="h-8 w-8 animate-spin text-[#6C9B8B]" />
                    <p className="text-sm font-medium">Claude is reading your statement…</p>
                    <p className="text-xs text-muted-foreground">This usually takes 10–20 seconds.</p>
                  </>
                ) : (
                  <>
                    <FileUp className="h-8 w-8 text-muted-foreground/50" />
                    <div className="text-center">
                      <p className="text-sm font-medium">Drop a PDF here or click to browse</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Brokerage statements from any institution
                      </p>
                    </div>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
            </div>
          )}

          {/* Review step */}
          {step === "review" && (
            <div className="space-y-6">
              {importError && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {importError}
                </div>
              )}

              {editableAccounts.map((acc, ai) => (
                <div
                  key={ai}
                  className={`rounded-xl border border-border ${!acc.include ? "opacity-50" : ""}`}
                >
                  <div className="flex items-start justify-between gap-4 border-b border-border p-4">
                    <div className="flex-1 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-muted-foreground">Institution</label>
                          <input
                            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            value={acc.institutionName}
                            onChange={(e) => updateAccount(ai, { institutionName: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">Account name</label>
                          <input
                            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            value={acc.accountName}
                            onChange={(e) => updateAccount(ai, { accountName: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">Account type</label>
                          <select
                            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            value={acc.accountType}
                            onChange={(e) => updateAccount(ai, { accountType: e.target.value })}
                          >
                            {ACCOUNT_TYPES.map((t) => (
                              <option key={t.value} value={t.value}>{t.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">Account # (last 4)</label>
                          <input
                            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            value={acc.accountNumber}
                            maxLength={4}
                            onChange={(e) => updateAccount(ai, { accountNumber: e.target.value })}
                          />
                        </div>
                      </div>
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 pt-1 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={acc.include}
                        onChange={(e) => updateAccount(ai, { include: e.target.checked })}
                        className="rounded"
                      />
                      Include
                    </label>
                  </div>

                  {acc.inferenceNotes.length > 0 && (
                    <div className="border-b border-border bg-amber-50/60 px-4 py-3 dark:bg-amber-950/20">
                      <div className="flex items-start gap-2">
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                            Claude inferred the following — please verify:
                          </p>
                          {acc.inferenceNotes.map((note, ni) => (
                            <p key={ni} className="text-xs text-amber-700 dark:text-amber-400">{note}</p>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground/60">
                          <th className="px-4 py-2 text-left font-medium">Ticker</th>
                          <th className="px-4 py-2 text-left font-medium">Description</th>
                          <th className="px-4 py-2 text-right font-medium">Shares</th>
                          <th className="px-4 py-2 text-right font-medium">Price</th>
                          <th className="px-4 py-2 text-right font-medium">Cost Basis</th>
                        </tr>
                      </thead>
                      <tbody>
                        {acc.holdings.map((h, hi) => (
                          <tr key={hi} className="border-b border-border/50 last:border-0">
                            <td className="px-4 py-2">
                              <input
                                className="w-20 rounded border border-border bg-background px-1.5 py-1 font-mono uppercase focus:outline-none focus:ring-1 focus:ring-ring"
                                value={h.ticker ?? ""}
                                placeholder="TICK"
                                onChange={(e) => updateHolding(ai, hi, { ticker: e.target.value.toUpperCase() })}
                              />
                            </td>
                            <td className="px-4 py-2">
                              <input
                                className="w-full min-w-[140px] rounded border border-border bg-background px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                                value={h.description ?? ""}
                                onChange={(e) => updateHolding(ai, hi, { description: e.target.value })}
                              />
                            </td>
                            <td className="px-4 py-2">
                              <input
                                className="w-24 rounded border border-border bg-background px-1.5 py-1 text-right focus:outline-none focus:ring-1 focus:ring-ring"
                                value={h.sharesStr}
                                onChange={(e) => updateHolding(ai, hi, { sharesStr: e.target.value })}
                              />
                            </td>
                            <td className="px-4 py-2">
                              <input
                                className="w-24 rounded border border-border bg-background px-1.5 py-1 text-right focus:outline-none focus:ring-1 focus:ring-ring"
                                value={h.priceStr}
                                onChange={(e) => updateHolding(ai, hi, { priceStr: e.target.value })}
                              />
                            </td>
                            <td className="px-4 py-2">
                              <input
                                className="w-28 rounded border border-border bg-background px-1.5 py-1 text-right focus:outline-none focus:ring-1 focus:ring-ring"
                                value={h.costBasisStr}
                                onChange={(e) => updateHolding(ai, hi, { costBasisStr: e.target.value })}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogBody>

        {step === "review" && (
          <DialogFooter>
            <Button variant="outline" onClick={() => setStep("upload")}>Back</Button>
            <Button onClick={handleSave} disabled={isSaving || includedCount === 0}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Update {includedCount} account{includedCount !== 1 ? "s" : ""}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
