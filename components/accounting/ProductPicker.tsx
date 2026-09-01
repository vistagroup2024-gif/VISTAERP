"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type PickProduct = { id: string; name: string; group?: string | null; uom?: string | null };

/**
 * Type-ahead picker over the Product Tree. Items are master data — this picker
 * only CHOOSES one, it never invents a name, so a voucher line can only ever
 * carry an item that really exists in the tree.
 */
export default function ProductPicker({
  products, value, onChange, placeholder = "Item…", className = "", onEnter,
}: {
  products: PickProduct[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string; className?: string; onEnter?: () => void;
}) {
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const selected = value ? byId.get(value) ?? null : null;

  const [text, setText] = useState(selected?.name ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  // Follow the value when it is set from outside (loading a saved document).
  useEffect(() => { setText(selected?.name ?? ""); }, [selected?.name]);

  useEffect(() => {
    function away(e: MouseEvent) { if (box.current && !box.current.contains(e.target as Node)) close(); }
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.name]);

  // Leaving the field always snaps back to the chosen item: half-typed text is
  // never kept, because it would not be an item.
  function close() { setOpen(false); setText(selected?.name ?? ""); }

  const matches = useMemo(() => {
    const q = text.trim().toLowerCase();
    const list = q ? products.filter((p) => p.name.toLowerCase().includes(q)) : products;
    return list.slice(0, 50);
  }, [products, text]);

  function choose(p: PickProduct) { onChange(p.id); setText(p.name); setOpen(false); onEnter?.(); }

  return (
    <div ref={box} className={`relative ${className}`}>
      <input
        className="input"
        value={text}
        placeholder={placeholder}
        onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, matches.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); if (open && matches[active]) choose(matches[active]); else onEnter?.(); }
          else if (e.key === "Escape") { close(); }
        }}
        onBlur={() => setTimeout(() => { if (!box.current?.contains(document.activeElement)) close(); }, 0)}
      />
      {value && (
        <button type="button" aria-label="Clear item" onClick={() => { onChange(null); setText(""); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">×</button>
      )}
      {open && (
        <div className="absolute z-30 mt-1 max-h-64 w-full min-w-56 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {matches.map((p, i) => (
            <button type="button" key={p.id} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(p)}
              className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm ${i === active ? "bg-brand-50" : "hover:bg-slate-50"}`}>
              <span className="truncate">{p.name}</span>
              {p.group && <span className="shrink-0 text-xs text-slate-400">{p.group}</span>}
            </button>
          ))}
          {matches.length === 0 && (
            <p className="px-3 py-3 text-sm text-slate-400">
              No such item. Items are added in Masters → Product Tree.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Turn a flat Product Tree read into picker options: the items only, each
 * labelled with the group it sits under. Resolved here rather than with a
 * self-referencing join, which is the one embed shape this codebase has never
 * relied on and which would silently return nothing if it did not resolve.
 */
export function productOptions(rows: { id: string; name: string; parent_id: string | null; is_group?: boolean }[]): PickProduct[] {
  const nameById = new Map(rows.map((r) => [r.id, r.name] as const));
  return rows
    .filter((r) => !r.is_group)
    .map((r) => ({ id: r.id, name: r.name, group: r.parent_id ? nameById.get(r.parent_id) ?? null : null }));
}
