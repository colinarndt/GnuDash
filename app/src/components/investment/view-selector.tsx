"use client";

import { useState, useRef, useEffect } from "react";
import { Check, ChevronDown, Loader2, Pencil, Star, Trash2 } from "lucide-react";

export interface PortfolioView {
  id: string;
  name: string;
  selectedAccounts: string[];
  isDefault?: boolean;
}

interface ViewSelectorProps {
  views: PortfolioView[];
  activeViewId: string | null;
  isDirty: boolean;
  onApply: (view: PortfolioView) => void;
  onSaveNew: (name: string) => Promise<void>;
  onUpdate: () => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSetDefault: (id: string | null) => Promise<void>;
}

export function ViewSelector({
  views,
  activeViewId,
  isDirty,
  onApply,
  onSaveNew,
  onUpdate,
  onDelete,
  onSetDefault,
}: ViewSelectorProps) {
  const [open, setOpen] = useState(false);
  const [showNewInput, setShowNewInput] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeView = views.find((v) => v.id === activeViewId) ?? null;
  const label = activeView ? (isDirty ? `${activeView.name} *` : activeView.name) : "Views";

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowNewInput(false);
        setNewName("");
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  useEffect(() => {
    if (showNewInput) inputRef.current?.focus();
  }, [showNewInput]);

  async function handleSaveNew() {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await onSaveNew(newName.trim());
      setNewName("");
      setShowNewInput(false);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdate() {
    setBusy(true);
    try {
      await onUpdate();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!activeViewId || !activeView) return;
    if (!confirm(`Delete view "${activeView.name}"?`)) return;
    setBusy(true);
    try {
      await onDelete(activeViewId);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleSetDefault() {
    if (!activeViewId || !activeView) return;
    setBusy(true);
    try {
      // Toggle: if it's already the default, clear; otherwise set.
      await onSetDefault(activeView.isDefault ? null : activeViewId);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium shadow-sm transition-colors ${
          activeView
            ? "border-[#6C9B8B]/40 bg-[#6C9B8B]/10 text-[#6C9B8B] hover:border-[#6C9B8B]/60"
            : "border-[#EFEFEF] bg-white text-[#1A1D1F] hover:border-[#D4DAE0] dark:border-border dark:bg-card dark:text-foreground"
        }`}
      >
        {label}
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-xl border border-border bg-background shadow-lg">
          {views.length > 0 && (
            <>
              <div className="py-1">
                {views.map((view) => {
                  const isActive = view.id === activeViewId;
                  return (
                    <button
                      key={view.id}
                      onClick={() => { onApply(view); setOpen(false); setShowNewInput(false); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                    >
                      <span className="w-3.5 shrink-0">
                        {isActive && !isDirty && <Check className="h-3.5 w-3.5 text-[#6C9B8B]" />}
                      </span>
                      <span className="flex-1 truncate">{view.name}</span>
                      {view.isDefault && (
                        <Star className="h-3 w-3 shrink-0 fill-[#6C9B8B] text-[#6C9B8B]" aria-label="Default view" />
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="border-t border-border" />
            </>
          )}

          <div className="py-1">
            {activeView && isDirty && (
              <button
                onClick={handleUpdate}
                disabled={busy}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#6C9B8B] hover:bg-muted disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                ) : (
                  <Pencil className="h-3.5 w-3.5 shrink-0" />
                )}
                Update &ldquo;{activeView.name}&rdquo;
              </button>
            )}

            {activeView && (
              <button
                onClick={handleSetDefault}
                disabled={busy}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                <Star
                  className={`h-3.5 w-3.5 shrink-0 ${activeView.isDefault ? "fill-[#6C9B8B] text-[#6C9B8B]" : ""}`}
                />
                {activeView.isDefault ? "Clear default" : "Set as default"}
              </button>
            )}

            {activeView && (
              <button
                onClick={handleDelete}
                disabled={busy}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-destructive hover:bg-muted disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5 shrink-0" />
                Delete view
              </button>
            )}

            {showNewInput ? (
              <div className="flex items-center gap-2 px-3 py-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveNew();
                    if (e.key === "Escape") { setShowNewInput(false); setNewName(""); }
                  }}
                  placeholder="View name…"
                  className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  onClick={handleSaveNew}
                  disabled={!newName.trim() || busy}
                  className="shrink-0 rounded bg-[#6C9B8B] px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-[#5a8a7a] disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowNewInput(true)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <span className="w-3.5 shrink-0 text-center text-base leading-none">+</span>
                Save as new view
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
