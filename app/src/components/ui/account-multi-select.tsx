"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { ChevronDown, Check, Search } from "lucide-react";

export interface AccountOption {
  id: string;
  name: string;
  institution: string;
}

interface AccountMultiSelectProps {
  options: AccountOption[];
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
}

export function AccountMultiSelect({ options, selected, onChange }: AccountMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return options.filter(
      (o) => o.name.toLowerCase().includes(q) || o.institution.toLowerCase().includes(q)
    );
  }, [options, search]);

  const allSelected = selected.size === options.length;
  const noneSelected = selected.size === 0;

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  const label = noneSelected
    ? "No accounts"
    : allSelected
    ? "All accounts"
    : `${selected.size} account${selected.size !== 1 ? "s" : ""}`;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between gap-2 rounded-lg border border-[#EFEFEF] bg-white px-3 py-1.5 text-sm font-medium text-[#1A1D1F] shadow-sm transition-colors hover:border-[#D4DAE0] dark:border-border dark:bg-card dark:text-foreground"
      >
        <span className="truncate">{label}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[#9A9FA5] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-[280px] rounded-xl border border-[#EFEFEF] bg-white shadow-lg dark:border-border dark:bg-card">
          {/* Search */}
          <div className="flex items-center gap-2 border-b border-[#EFEFEF] px-3 py-2 dark:border-border">
            <Search className="h-3.5 w-3.5 shrink-0 text-[#9A9FA5]" />
            <input
              autoFocus
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search accounts…"
              className="flex-1 bg-transparent text-sm text-[#1A1D1F] placeholder:text-[#9A9FA5] focus:outline-none dark:text-foreground"
            />
          </div>

          {/* Select all / Clear all */}
          <div className="flex items-center justify-between border-b border-[#EFEFEF] px-3 py-1.5 dark:border-border">
            <button
              onClick={() => onChange(new Set(options.map((o) => o.id)))}
              className="text-xs text-[#6C9B8B] hover:underline"
            >
              Select all
            </button>
            <button
              onClick={() => onChange(new Set())}
              className="text-xs text-[#9A9FA5] hover:underline"
            >
              Clear all
            </button>
          </div>

          {/* Options */}
          <div className="max-h-[260px] overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="py-3 text-center text-xs text-[#9A9FA5]">No accounts found</p>
            ) : (
              filtered.map((option) => {
                const isSelected = selected.has(option.id);
                return (
                  <button
                    key={option.id}
                    onClick={() => toggle(option.id)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-[#F4F5F7] dark:hover:bg-muted"
                  >
                    <div
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                        isSelected
                          ? "border-[#6C9B8B] bg-[#6C9B8B]"
                          : "border-[#D4DAE0] dark:border-border"
                      }`}
                    >
                      {isSelected && <Check className="h-2.5 w-2.5 text-white" />}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[#1A1D1F] dark:text-foreground">
                        {option.name}
                      </p>
                      <p className="truncate text-xs text-[#9A9FA5]">{option.institution}</p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
