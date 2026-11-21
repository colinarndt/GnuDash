"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { Plus, Trash2, ArrowUp, ArrowDown, X, RotateCcw, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface FilterGroup {
  label: string;
  paths: string[];
  accountType?: string;
}

interface FilterGroupsEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: FilterGroup[];
  defaults: FilterGroup[];
  /** Account paths from the live tree (used for path typeahead). */
  pathSuggestions: string[];
  /** Account types present in the tree (e.g. STOCK, MUTUAL, CASH, BANK, ASSET). */
  accountTypeOptions: string[];
  onSave: (groups: FilterGroup[]) => Promise<void>;
}

export function FilterGroupsEditor({
  open,
  onOpenChange,
  groups,
  defaults,
  pathSuggestions,
  accountTypeOptions,
  onSave,
}: FilterGroupsEditorProps) {
  const [draft, setDraft] = useState<FilterGroup[]>(groups);
  const [busy, setBusy] = useState(false);

  // Reset draft when dialog opens or props change.
  useEffect(() => {
    if (open) setDraft(groups.map((g) => ({ ...g, paths: [...g.paths] })));
  }, [open, groups]);

  function updateGroup(i: number, patch: Partial<FilterGroup>) {
    setDraft((prev) => prev.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));
  }

  function addGroup() {
    setDraft((prev) => [...prev, { label: "New filter", paths: [""] }]);
  }

  function removeGroup(i: number) {
    setDraft((prev) => prev.filter((_, idx) => idx !== i));
  }

  function moveGroup(i: number, dir: -1 | 1) {
    setDraft((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function addPath(i: number) {
    updateGroup(i, { paths: [...draft[i].paths, ""] });
  }

  function updatePath(gi: number, pi: number, value: string) {
    const next = [...draft[gi].paths];
    next[pi] = value;
    updateGroup(gi, { paths: next });
  }

  function removePath(gi: number, pi: number) {
    const next = draft[gi].paths.filter((_, idx) => idx !== pi);
    updateGroup(gi, { paths: next });
  }

  async function handleSave() {
    const cleaned = draft
      .map((g) => ({
        ...g,
        label: g.label.trim(),
        paths: g.paths.map((p) => p.trim()).filter((p) => p.length > 0),
        accountType: g.accountType?.trim() || undefined,
      }))
      .filter((g) => g.label.length > 0);
    setBusy(true);
    try {
      await onSave(cleaned);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  function handleReset() {
    if (!confirm("Reset all chips to the built-in defaults? Your custom edits will be lost.")) return;
    setDraft(defaults.map((g) => ({ ...g, paths: [...g.paths] })));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit quick-filter chips</DialogTitle>
        </DialogHeader>
        <DialogBody className="max-h-[60vh] overflow-y-auto">
          <div className="flex flex-col gap-3">
            {draft.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No chips. Click &ldquo;Add filter&rdquo; to create one.
              </p>
            )}
            {draft.map((g, i) => (
              <div
                key={i}
                className="rounded-lg border border-border bg-card p-3"
              >
                <div className="mb-2 flex items-center gap-2">
                  <input
                    type="text"
                    value={g.label}
                    onChange={(e) => updateGroup(i, { label: e.target.value })}
                    placeholder="Chip label"
                    className="flex-1 rounded border border-border bg-background px-2 py-1 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button
                    onClick={() => moveGroup(i, -1)}
                    disabled={i === 0}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                    aria-label="Move up"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => moveGroup(i, 1)}
                    disabled={i === draft.length - 1}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                    aria-label="Move down"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => removeGroup(i)}
                    className="rounded p-1 text-destructive hover:bg-destructive/10"
                    aria-label="Delete chip"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-[80px_1fr] items-start gap-x-2 gap-y-2">
                  <label className="pt-1.5 text-xs text-muted-foreground">Paths</label>
                  <div className="flex flex-col gap-1.5">
                    {g.paths.map((p, pi) => (
                      <PathInput
                        key={pi}
                        value={p}
                        suggestions={pathSuggestions}
                        onChange={(v) => updatePath(i, pi, v)}
                        onRemove={() => removePath(i, pi)}
                      />
                    ))}
                    <button
                      onClick={() => addPath(i)}
                      className="flex w-fit items-center gap-1 rounded px-1.5 py-0.5 text-xs text-[#6C9B8B] hover:bg-[#6C9B8B]/10"
                    >
                      <Plus className="h-3 w-3" /> Add path
                    </button>
                  </div>

                  <label className="pt-1.5 text-xs text-muted-foreground">Type</label>
                  <select
                    value={g.accountType ?? ""}
                    onChange={(e) =>
                      updateGroup(i, { accountType: e.target.value || undefined })
                    }
                    className="w-fit rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">Any</option>
                    {accountTypeOptions.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}

            <button
              onClick={addGroup}
              className="flex items-center justify-center gap-1 rounded-lg border border-dashed border-border py-2 text-sm text-muted-foreground hover:border-[#6C9B8B] hover:text-[#6C9B8B]"
            >
              <Plus className="h-4 w-4" /> Add filter
            </button>
          </div>
        </DialogBody>
        <DialogFooter className="flex items-center justify-between">
          <button
            onClick={handleReset}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" /> Reset to defaults
          </button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface PathInputProps {
  value: string;
  suggestions: string[];
  onChange: (v: string) => void;
  onRemove: () => void;
}

function PathInput({ value, suggestions, onChange, onRemove }: PathInputProps) {
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setFocused(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const matches = useMemo(() => {
    if (!focused) return [];
    const q = value.trim().toLowerCase();
    if (!q) return suggestions.slice(0, 8);
    return suggestions.filter((s) => s.toLowerCase().includes(q)).slice(0, 8);
  }, [focused, value, suggestions]);

  return (
    <div ref={ref} className="relative flex items-center gap-1">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        placeholder="e.g. Assets:Retirement"
        className="flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <button
        onClick={onRemove}
        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
        aria-label="Remove path"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      {focused && matches.length > 0 && (
        <div className="absolute left-0 right-7 top-full z-50 mt-0.5 max-h-48 overflow-y-auto rounded border border-border bg-background shadow-lg">
          {matches.map((m) => (
            <button
              key={m}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(m);
                setFocused(false);
              }}
              className="block w-full truncate px-2 py-1 text-left font-mono text-xs hover:bg-muted"
            >
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
