"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";

interface TickerResult {
  symbol: string;
  name: string;
  type: string;
}

interface DropdownPos {
  top: number;
  left: number;
  width: number;
}

interface TickerInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function TickerInput({
  value,
  onChange,
  placeholder = "Ticker…",
  className = "",
}: TickerInputProps) {
  const [suggestions, setSuggestions] = useState<TickerResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [dropdownPos, setDropdownPos] = useState<DropdownPos | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const upper = value.toUpperCase();

  // Fetch from Yahoo Finance (debounced)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!upper) { setSuggestions([]); setOpen(false); return; }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/ticker-search?q=${encodeURIComponent(upper)}`);
        if (res.ok) {
          const data = (await res.json()) as { results: TickerResult[] };
          setSuggestions(data.results ?? []);
          setHighlighted(0);
          if ((data.results ?? []).length > 0) setOpen(true);
        }
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [upper]);

  // Compute fixed position from the input's bounding rect whenever dropdown opens
  useEffect(() => {
    if (open && suggestions.length > 0 && inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: Math.max(rect.width, 280),
      });
    }
  }, [open, suggestions]);

  // Close on outside click — check both the input container and the portal dropdown
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      const inInput = inputRef.current?.contains(target);
      const inDropdown = dropdownRef.current?.contains(target);
      if (!inInput && !inDropdown) setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  function select(symbol: string) {
    onChange(symbol);
    setOpen(false);
    setSuggestions([]);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && suggestions[highlighted]) {
      e.preventDefault();
      select(suggestions[highlighted].symbol);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const dotColor = upper ? "bg-amber-400" : null;

  const dropdown =
    open && suggestions.length > 0 && dropdownPos
      ? createPortal(
          <div
            ref={dropdownRef}
            style={{
              position: "fixed",
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: dropdownPos.width,
              zIndex: 9999,
            }}
            className="overflow-hidden rounded-md border border-border bg-background shadow-lg"
          >
            {suggestions.map((s, i) => (
              <button
                key={s.symbol}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); select(s.symbol); }}
                onMouseEnter={() => setHighlighted(i)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
                  i === highlighted ? "bg-accent" : "hover:bg-muted"
                }`}
              >
                <span className="w-14 shrink-0 font-mono font-semibold text-foreground">
                  {s.symbol}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {s.name}
                </span>
                <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground/50">
                  {s.type}
                </span>
              </button>
            ))}
          </div>,
          document.body
        )
      : null;

  return (
    <div className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value.toUpperCase());
          setHighlighted(0);
        }}
        onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 pr-6 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
        {loading ? (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/40" />
        ) : dotColor ? (
          <div
            className={`h-2 w-2 rounded-full ${dotColor}`}
            title="Will be classified on next sync"
          />
        ) : null}
      </div>
      {dropdown}
    </div>
  );
}
