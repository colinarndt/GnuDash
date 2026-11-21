"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { ChevronDown, ChevronRight, Check, Minus, Search } from "lucide-react";
import type { AccountNode } from "@/lib/types/gnucash";

interface AccountTreePickerProps {
  roots: AccountNode[];
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
}

interface VisibleNode {
  node: AccountNode;
  depth: number;
  leafGuids: string[];
  hasChildren: boolean;
}

function isSelectableLeaf(n: AccountNode): boolean {
  if (n.hidden || n.placeholder) return false;
  return n.children.every((c) => c.hidden);
}

function collectLeafGuids(n: AccountNode, out: string[] = []): string[] {
  if (n.hidden) return out;
  if (isSelectableLeaf(n)) {
    out.push(n.guid);
    return out;
  }
  for (const c of n.children) collectLeafGuids(c, out);
  return out;
}

function matchesSearch(n: AccountNode, q: string): boolean {
  if (!q) return true;
  if (n.name.toLowerCase().includes(q) || n.fullPath.toLowerCase().includes(q)) return true;
  return n.children.some((c) => !c.hidden && matchesSearch(c, q));
}

function buildVisible(
  roots: AccountNode[],
  expanded: Set<string>,
  q: string,
): VisibleNode[] {
  const out: VisibleNode[] = [];
  const walk = (n: AccountNode, depth: number) => {
    if (n.hidden) return;
    if (q && !matchesSearch(n, q)) return;
    const visibleChildren = n.children.filter((c) => !c.hidden);
    const hasChildren = visibleChildren.length > 0;
    out.push({
      node: n,
      depth,
      leafGuids: collectLeafGuids(n),
      hasChildren,
    });
    // Auto-expand when searching
    if (hasChildren && (expanded.has(n.guid) || q)) {
      for (const c of visibleChildren) walk(c, depth + 1);
    }
  };
  for (const r of roots) walk(r, 0);
  return out;
}

export function AccountTreePicker({ roots, selected, onChange }: AccountTreePickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(roots.map((r) => r.guid)));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const q = search.trim().toLowerCase();
  const visible = useMemo(() => buildVisible(roots, expanded, q), [roots, expanded, q]);

  const allLeafGuids = useMemo(() => {
    const s = new Set<string>();
    for (const r of roots) for (const g of collectLeafGuids(r)) s.add(g);
    return s;
  }, [roots]);

  const totalLeaves = allLeafGuids.size;
  const selectedLeafCount = useMemo(() => {
    let n = 0;
    for (const g of selected) if (allLeafGuids.has(g)) n++;
    return n;
  }, [selected, allLeafGuids]);

  const label =
    selectedLeafCount === 0
      ? "No accounts"
      : selectedLeafCount === totalLeaves
        ? "All accounts"
        : `${selectedLeafCount} account${selectedLeafCount !== 1 ? "s" : ""}`;

  function toggleExpand(guid: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(guid)) next.delete(guid);
      else next.add(guid);
      return next;
    });
  }

  function toggleNode(leafGuids: string[]) {
    const allOn = leafGuids.length > 0 && leafGuids.every((g) => selected.has(g));
    const next = new Set(selected);
    if (allOn) {
      for (const g of leafGuids) next.delete(g);
    } else {
      for (const g of leafGuids) next.add(g);
    }
    onChange(next);
  }

  function nodeState(leafGuids: string[]): "none" | "some" | "all" {
    if (leafGuids.length === 0) return "none";
    let on = 0;
    for (const g of leafGuids) if (selected.has(g)) on++;
    if (on === 0) return "none";
    if (on === leafGuids.length) return "all";
    return "some";
  }

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
        <div className="absolute right-0 top-full z-50 mt-1.5 w-[340px] rounded-xl border border-[#EFEFEF] bg-white shadow-lg dark:border-border dark:bg-card">
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

          <div className="flex items-center justify-between border-b border-[#EFEFEF] px-3 py-1.5 dark:border-border">
            <button
              onClick={() => onChange(new Set(allLeafGuids))}
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

          <div className="max-h-[360px] overflow-y-auto py-1">
            {visible.length === 0 ? (
              <p className="py-3 text-center text-xs text-[#9A9FA5]">No accounts found</p>
            ) : (
              visible.map(({ node, depth, leafGuids, hasChildren }) => {
                const state = nodeState(leafGuids);
                const isExpanded = expanded.has(node.guid) || !!q;
                return (
                  <div
                    key={node.guid}
                    className="flex w-full items-center gap-1 px-2 py-1 transition-colors hover:bg-[#F4F5F7] dark:hover:bg-muted"
                    style={{ paddingLeft: `${depth * 16 + 8}px` }}
                  >
                    <button
                      onClick={() => hasChildren && toggleExpand(node.guid)}
                      className={`flex h-4 w-4 shrink-0 items-center justify-center text-[#9A9FA5] ${
                        hasChildren ? "hover:text-[#1A1D1F] dark:hover:text-foreground" : "opacity-0"
                      }`}
                      aria-label={isExpanded ? "Collapse" : "Expand"}
                      disabled={!hasChildren}
                    >
                      {hasChildren && (isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />)}
                    </button>
                    <button
                      onClick={() => toggleNode(leafGuids)}
                      disabled={leafGuids.length === 0}
                      className="flex flex-1 items-center gap-2 text-left disabled:opacity-50"
                    >
                      <div
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                          state === "all"
                            ? "border-[#6C9B8B] bg-[#6C9B8B]"
                            : state === "some"
                              ? "border-[#6C9B8B] bg-[#6C9B8B]/40"
                              : "border-[#D4DAE0] dark:border-border"
                        }`}
                      >
                        {state === "all" && <Check className="h-2.5 w-2.5 text-white" />}
                        {state === "some" && <Minus className="h-2.5 w-2.5 text-white" />}
                      </div>
                      <span className="min-w-0 flex-1 truncate text-sm text-[#1A1D1F] dark:text-foreground">
                        {node.name}
                      </span>
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
