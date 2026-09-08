"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

export type SearchOption = {
  value: string;
  label: string;
  /** Shown small beside the label — a code, a balance, a unit. Also searched. */
  hint?: string;
  /** Optional heading this option sits under, the way <optgroup> works. */
  group?: string;
  disabled?: boolean;
};

/**
 * A <select> you can type into.
 *
 * The chart of accounts runs to a couple of hundred rows and the party list to
 * more; a native <select> makes you scroll all of it, because a browser's own
 * type-ahead only matches from the FIRST letter and forgets what you typed
 * after a second. Typing "ca" here narrows to everything containing "ca", with
 * the ones that START with it first — which is what the accounting packages do
 * and what people expect.
 *
 * It is a drop-in for the <select className="input"> pattern used everywhere in
 * this ERP: same look, same `value` / `onChange(value)` shape, same disabled
 * and required behaviour. `required` is carried by a hidden input so the form
 * validates the way it did before.
 *
 * The panel is positioned FIXED against the button's rect rather than absolutely
 * inside it, because most of these pickers sit inside a `card` or a table cell
 * with `overflow` set, and an absolutely positioned panel gets clipped by it.
 */
export default function SearchSelect({
  value, onChange, options, placeholder = "— select —", disabled, required,
  className = "", id, name, allowClear = true, emptyText = "Nothing matches",
}: {
  value: string;
  onChange: (value: string) => void;
  options: SearchOption[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  id?: string;
  name?: string;
  allowClear?: boolean;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; below: boolean } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => options.find((o) => o.value === value) ?? null, [options, value]);

  // Prefix matches first, then anything else that contains what was typed —
  // so "ca" puts CASH above PETTY CASH rather than burying it.
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    const starts: SearchOption[] = [], has: SearchOption[] = [];
    for (const o of options) {
      const hay = `${o.label} ${o.hint ?? ""}`.toLowerCase();
      if (hay.startsWith(needle) || o.label.toLowerCase().startsWith(needle)) starts.push(o);
      else if (hay.includes(needle)) has.push(o);
    }
    return [...starts, ...has];
  }, [options, q]);

  const place = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const space = window.innerHeight - b.bottom;
    const below = space > 260 || space > b.top;
    setRect({
      left: b.left, width: b.width, below,
      top: below ? b.bottom + 4 : Math.max(8, b.top - 4),
    });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !listRef.current?.contains(t)) setOpen(false);
    };
    // `true` so a scroll inside any container, not just the window, repositions.
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, place]);

  useEffect(() => {
    if (open) { setQ(""); setActive(Math.max(0, shown.findIndex((o) => o.value === value))); inputRef.current?.focus(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep the highlighted row on screen as the arrows move it.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function choose(o: SearchOption) {
    if (o.disabled) return;
    onChange(o.value);
    setOpen(false);
    btnRef.current?.focus();
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(shown.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(shown.length - 1); }
    else if (e.key === "Enter") { e.preventDefault(); if (shown[active]) choose(shown[active]); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); btnRef.current?.focus(); }
  }

  // Group headings, drawn in the order the options arrive.
  const rows = useMemo(() => {
    const out: ({ kind: "head"; label: string } | { kind: "opt"; o: SearchOption; idx: number })[] = [];
    let last: string | undefined;
    shown.forEach((o, idx) => {
      if (o.group && o.group !== last) { out.push({ kind: "head", label: o.group }); last = o.group; }
      out.push({ kind: "opt", o, idx });
    });
    return out;
  }, [shown]);

  return (
    <>
      <button
        ref={btnRef} type="button" id={id} disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (!open && (e.key === "ArrowDown" || e.key === "Enter")) { e.preventDefault(); setOpen(true); } }}
        className={`input flex items-center gap-2 text-left ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"} ${className}`}
        aria-haspopup="listbox" aria-expanded={open}
      >
        <span className={`min-w-0 flex-1 truncate ${selected ? "" : "text-slate-400"}`}>
          {selected ? selected.label : placeholder}
        </span>
        {selected && selected.hint && <span className="shrink-0 text-xs text-slate-400">{selected.hint}</span>}
        {allowClear && selected && !disabled && !required && (
          <span role="button" tabIndex={-1} aria-label="Clear"
            onClick={(e) => { e.stopPropagation(); onChange(""); }}
            className="shrink-0 text-slate-300 hover:text-slate-600">×</span>
        )}
        <span aria-hidden className="shrink-0 text-[10px] text-slate-400">▾</span>
      </button>

      {/* What the form validates on, so `required` behaves as it did with a
          native <select>. */}
      {name !== undefined || required ? (
        <input tabIndex={-1} aria-hidden name={name} required={required} value={value} readOnly
          onChange={() => {}} className="sr-only h-0 w-0 border-0 p-0"
          style={{ position: "absolute", opacity: 0, pointerEvents: "none" }} />
      ) : null}

      {open && rect && (
        <div ref={listRef}
          style={{
            position: "fixed", left: rect.left, width: Math.max(rect.width, 220),
            ...(rect.below ? { top: rect.top } : { bottom: window.innerHeight - rect.top }),
            zIndex: 60,
          }}
          className="rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 p-2">
            <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }}
              onKeyDown={onKey} placeholder="Type to search…"
              className="w-full rounded border border-slate-200 px-2 py-1 text-sm outline-none focus:border-brand" />
          </div>
          <div className="max-h-64 overflow-auto py-1 text-sm">
            {rows.length === 0 && <p className="px-3 py-4 text-center text-slate-400">{emptyText}</p>}
            {rows.map((r, i) =>
              r.kind === "head" ? (
                <div key={`h${i}`} className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  {r.label}
                </div>
              ) : (
                <div key={r.o.value} data-idx={r.idx}
                  onMouseEnter={() => setActive(r.idx)}
                  onClick={() => choose(r.o)}
                  className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 ${
                    r.o.disabled ? "cursor-not-allowed text-slate-300"
                    : r.idx === active ? "bg-brand-50 text-brand-800" : "text-slate-700"}`}>
                  <span className="min-w-0 flex-1 truncate">{r.o.label}</span>
                  {r.o.hint && <span className="shrink-0 text-xs text-slate-400">{r.o.hint}</span>}
                  {r.o.value === value && <span className="shrink-0 text-xs text-brand">✓</span>}
                </div>
              ))}
          </div>
          {options.length > 12 && (
            <div className="border-t border-slate-100 px-3 py-1 text-[10px] text-slate-400">
              {shown.length} of {options.length} · ↑↓ to move, Enter to pick
            </div>
          )}
        </div>
      )}
    </>
  );
}
