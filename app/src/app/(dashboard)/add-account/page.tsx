"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import { usePlaidLink, type PlaidLinkOnSuccess } from "react-plaid-link";
import { Globe, Upload, PenLine, Loader2, Link2, TrendingUp, AlertCircle, CheckCircle2, FileUp, Info, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { PortfolioDialog } from "@/components/manual/portfolio-dialog";
import { PropertyDialog } from "@/components/manual/property-dialog";
import type { DetectedAccount, DetectedHolding } from "@/app/api/import/parse/route";

// ── Account type options (shared with Connections page) ──────────────────────

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

// ── Editable import state ────────────────────────────────────────────────────

interface EditableHolding extends DetectedHolding {
  sharesStr: string;
  priceStr: string;
  marketValueStr: string;
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
      marketValueStr: h.marketValue?.toString() ?? "",
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
        marketValue: h.marketValueStr ? parseFloat(h.marketValueStr) : (h.marketValue ?? null),
        costBasis: h.costBasisStr ? parseFloat(h.costBasisStr) : null,
      })),
    }));
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function AddAccountPage() {
  // Connect Online state
  const [connectOpen, setConnectOpen] = useState(false);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [plaidError, setPlaidError] = useState<string | null>(null);
  const [snapConnecting, setSnapConnecting] = useState(false);
  const [connectSuccess, setConnectSuccess] = useState<string | null>(null);

  // Manual Entry state
  const [manualChooserOpen, setManualChooserOpen] = useState(false);
  const [portfolioDialogOpen, setPortfolioDialogOpen] = useState(false);
  const [propertyDialogOpen, setPropertyDialogOpen] = useState(false);

  // Import state
  const [importOpen, setImportOpen] = useState(false);
  const [importStep, setImportStep] = useState<"upload" | "parsing" | "review" | "saving">("upload");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [editableAccounts, setEditableAccounts] = useState<EditableAccount[]>([]);
  const [importSuccess, setImportSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Connect Online ─────────────────────────────────────────────────────────

  const refreshLinkToken = useCallback(async () => {
    try {
      const res = await fetch("/api/plaid/link-token", { method: "POST" });
      const data = (await res.json()) as { link_token?: string; error?: string };
      if (res.ok && data.link_token) {
        setLinkToken(data.link_token);
        setPlaidError(null);
      } else {
        setPlaidError(data.error ?? "Plaid unavailable");
      }
    } catch {
      setPlaidError("Could not reach Plaid API");
    }
  }, []);

  useEffect(() => {
    if (connectOpen && !linkToken) refreshLinkToken();
  }, [connectOpen, linkToken, refreshLinkToken]);

  const onPlaidSuccess: PlaidLinkOnSuccess = useCallback(async (publicToken, metadata) => {
    await fetch("/api/plaid/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ public_token: publicToken, metadata }),
    });
    setConnectSuccess("Connected via Plaid! Your accounts are now visible on the Connections page.");
  }, []);

  const onPlaidExit = useCallback(() => {
    setConnectOpen(false);
  }, []);

  const { open: openPlaid, ready: plaidReady } = usePlaidLink({ token: linkToken, onSuccess: onPlaidSuccess, onExit: onPlaidExit });

  async function connectSnapTrade() {
    setSnapConnecting(true);
    try {
      await fetch("/api/snaptrade/user", { method: "POST" });

      // Snapshot existing auth IDs so we can detect a new one after the popup closes
      const existingRes = await fetch("/api/snaptrade/accounts");
      const existingData = existingRes.ok
        ? ((await existingRes.json()) as { authorizations: { authorizationId: string }[] })
        : { authorizations: [] };
      const existingIds = new Set(existingData.authorizations.map((a) => a.authorizationId));

      const res = await fetch("/api/snaptrade/connect", { method: "POST" });
      const data = (await res.json()) as { redirectURL?: string; error?: string };
      if (data.redirectURL) {
        const popup = window.open(data.redirectURL, "snaptrade-connect", "width=600,height=700,left=200,top=100");
        const poll = setInterval(async () => {
          if (popup?.closed) {
            clearInterval(poll);
            // Check whether a new authorization was actually created
            const afterRes = await fetch("/api/snaptrade/accounts");
            const afterData = afterRes.ok
              ? ((await afterRes.json()) as { authorizations: { authorizationId: string }[] })
              : { authorizations: [] };
            const added = afterData.authorizations.some((a) => !existingIds.has(a.authorizationId));
            setConnectSuccess(
              added
                ? "Account connected via SnapTrade! Your holdings are now visible on the Connections page."
                : null
            );
            if (!added) setConnectOpen(false);
            setSnapConnecting(false);
          }
        }, 1000);
      } else {
        alert(data.error ?? "Could not connect to SnapTrade");
        setSnapConnecting(false);
      }
    } catch {
      alert("Could not reach SnapTrade");
      setSnapConnecting(false);
    }
  }

  // ── Import ─────────────────────────────────────────────────────────────────

  function openImport() {
    setImportStep("upload");
    setImportFile(null);
    setImportError(null);
    setEditableAccounts([]);
    setImportSuccess(false);
    setImportOpen(true);
  }

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setImportError("Only PDF files are supported.");
      return;
    }
    setImportFile(file);
    setImportError(null);
    setImportStep("parsing");

    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch("/api/import/parse", { method: "POST", body: form });
      const data = (await res.json()) as { accounts?: DetectedAccount[]; error?: string };
      if (!res.ok || data.error) {
        setImportError(data.error ?? "Parsing failed.");
        setImportStep("upload");
        return;
      }
      setEditableAccounts(toEditable(data.accounts ?? []));
      setImportStep("review");
    } catch {
      setImportError("Network error — please try again.");
      setImportStep("upload");
    }
  }

  async function saveImport() {
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
      setImportSuccess(true);
      setImportStep("upload");
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

  // ── Render ─────────────────────────────────────────────────────────────────

  const options = [
    {
      icon: Globe,
      label: "Connect Online",
      description: "Link a brokerage or bank account directly via Plaid or SnapTrade.",
      color: "#4A7B6A",
      hoverColor: "#3D6A5A",
      onClick: () => { setConnectSuccess(null); setConnectOpen(true); },
    },
    {
      icon: Upload,
      label: "Import File",
      description: "Upload a brokerage statement PDF — Claude will extract your holdings automatically.",
      color: "#4A6A8A",
      hoverColor: "#3D5A7A",
      onClick: openImport,
    },
    {
      icon: PenLine,
      label: "Manual Entry",
      description: "Enter holdings by hand for accounts you can't connect or import.",
      color: "#7A6A5A",
      hoverColor: "#6A5A4A",
      onClick: () => setManualChooserOpen(true),
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Add Account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose how you&apos;d like to add your account. We recommend connecting online for the most accurate data.
        </p>
      </div>

      {/* Option cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {options.map((opt) => (
          <button
            key={opt.label}
            onClick={opt.onClick}
            className="group flex flex-col items-start gap-4 rounded-2xl p-6 text-left text-white shadow-md transition-all hover:shadow-lg active:scale-[0.98]"
            style={{ backgroundColor: opt.color }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = opt.hoverColor)}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = opt.color)}
          >
            <div className="rounded-xl bg-white/20 p-3">
              <opt.icon className="h-6 w-6" />
            </div>
            <div>
              <p className="text-lg font-semibold">{opt.label}</p>
              <p className="mt-1 text-sm text-white/75">{opt.description}</p>
            </div>
          </button>
        ))}
      </div>

      {/* ── Connect Online dialog ────────────────────────────────────────── */}
      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Connect Online</DialogTitle>
          </DialogHeader>
          <DialogBody>
            {connectSuccess ? (
              <div className="flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">Connected!</p>
                  <p className="mt-0.5">{connectSuccess}</p>
                  <a href="/connections" className="mt-2 inline-block text-xs underline underline-offset-2">
                    View on Connections →
                  </a>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={connectSnapTrade}
                    disabled={snapConnecting}
                    className="flex flex-col items-center gap-3 rounded-xl border border-border bg-muted/30 px-4 py-6 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    {snapConnecting ? <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /> : <TrendingUp className="h-7 w-7 text-muted-foreground" />}
                    SnapTrade
                  </button>
                  {plaidError ? (
                    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-muted/10 px-4 py-6 text-xs text-muted-foreground/50">
                      <AlertCircle className="h-7 w-7" />
                      Plaid unavailable
                    </div>
                  ) : (
                    <button
                      onClick={() => openPlaid()}
                      disabled={!plaidReady}
                      className="flex flex-col items-center gap-3 rounded-xl border border-border bg-muted/30 px-4 py-6 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
                    >
                      <Link2 className="h-7 w-7 text-muted-foreground" />
                      Plaid
                    </button>
                  )}
                </div>
                <p className="text-center text-xs text-muted-foreground/60">
                  SnapTrade is recommended — it supports most brokerages including Fidelity, Schwab, and Vanguard. A popup will open when you connect.
                </p>
              </div>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>

      {/* ── Manual Entry chooser dialog ──────────────────────────────────── */}
      <Dialog open={manualChooserOpen} onOpenChange={setManualChooserOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>What would you like to add?</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => { setManualChooserOpen(false); setPortfolioDialogOpen(true); }}
                className="flex flex-col items-center gap-3 rounded-xl border border-border bg-muted/30 px-4 py-6 text-sm font-medium transition-colors hover:bg-muted"
              >
                <TrendingUp className="h-7 w-7 text-muted-foreground" />
                Portfolio
              </button>
              <button
                onClick={() => { setManualChooserOpen(false); setPropertyDialogOpen(true); }}
                className="flex flex-col items-center gap-3 rounded-xl border border-border bg-muted/30 px-4 py-6 text-sm font-medium transition-colors hover:bg-muted"
              >
                <Home className="h-7 w-7 text-muted-foreground" />
                Real Estate
              </button>
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>

      {/* ── Import dialog ────────────────────────────────────────────────── */}
      <Dialog open={importOpen} onOpenChange={(o) => { if (importStep !== "parsing" && importStep !== "saving") setImportOpen(o); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {importStep === "review" ? "Review Extracted Data" : "Import from PDF"}
            </DialogTitle>
          </DialogHeader>

          <DialogBody>
            {/* Upload step */}
            {(importStep === "upload" || importStep === "parsing") && (
              <div className="space-y-4">
                {importSuccess && (
                  <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span>
                      Account imported successfully.{" "}
                      <a href="/connections" className="underline underline-offset-2">View in Accounts →</a>
                    </span>
                  </div>
                )}
                {importError && (
                  <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {importError}
                  </div>
                )}
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-14 transition-colors ${
                    dragging ? "border-[#6C9B8B] bg-[#6C9B8B]/5" : "border-border hover:border-[#6C9B8B]/50 hover:bg-muted/30"
                  } ${importStep === "parsing" ? "pointer-events-none opacity-50" : ""}`}
                >
                  {importStep === "parsing" ? (
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
                        <p className="mt-1 text-xs text-muted-foreground">Brokerage statements from any institution</p>
                      </div>
                    </>
                  )}
                </div>
                <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              </div>
            )}

            {/* Review step */}
            {importStep === "review" && (
              <div className="space-y-6">
                {editableAccounts.map((acc, ai) => (
                  <div key={ai} className={`rounded-xl border border-border ${!acc.include ? "opacity-50" : ""}`}>
                    {/* Account header */}
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
                              {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
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
                        <input type="checkbox" checked={acc.include} onChange={(e) => updateAccount(ai, { include: e.target.checked })} className="rounded" />
                        Include
                      </label>
                    </div>

                    {/* Inference notes */}
                    {acc.inferenceNotes.length > 0 && (
                      <div className="border-b border-border bg-amber-50/60 px-4 py-3 dark:bg-amber-950/20">
                        <div className="flex items-start gap-2">
                          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                          <div className="space-y-1">
                            <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Claude inferred the following — please verify:</p>
                            {acc.inferenceNotes.map((note, ni) => (
                              <p key={ni} className="text-xs text-amber-700 dark:text-amber-400">{note}</p>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Holdings */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border text-muted-foreground/60">
                            <th className="px-4 py-2 text-left font-medium">Ticker</th>
                            <th className="px-4 py-2 text-left font-medium">Description</th>
                            <th className="px-4 py-2 text-right font-medium">Shares</th>
                            <th className="px-4 py-2 text-right font-medium">Price</th>
                            <th className="px-4 py-2 text-right font-medium">Mkt Value</th>
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
                                  value={h.marketValueStr}
                                  placeholder={h.priceStr ? "" : "required"}
                                  onChange={(e) => updateHolding(ai, hi, { marketValueStr: e.target.value })}
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

          {importStep === "review" && (
            <DialogFooter>
              <Button variant="outline" onClick={() => setImportStep("upload")}>Back</Button>
              <Button
                onClick={saveImport}
                disabled={isSaving || !editableAccounts.some((a) => a.include)}
              >
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Import {editableAccounts.filter((a) => a.include).length} account{editableAccounts.filter((a) => a.include).length !== 1 ? "s" : ""}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Existing dialogs ─────────────────────────────────────────────── */}
      <PortfolioDialog
        open={portfolioDialogOpen}
        onClose={() => setPortfolioDialogOpen(false)}
        onSaved={() => {}}
      />
      <PropertyDialog
        open={propertyDialogOpen}
        onClose={() => setPropertyDialogOpen(false)}
        onSaved={() => {}}
      />
    </div>
  );
}
