"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

export type MultiOption = {
  value: string;
  label: string;
  /** Shown small beside the label — also searched. */
  hint?: string;
  /** Optional heading this option sits under, the way <optgroup> works. */
  group?: string;
  /** Cannot be picked, with why shown as a tooltip — the option is still
      LISTED (it is real, it is just not choosable here), never hidden. */
  disabled?: boolean;
  disabledReason?: string;
};

/**
 * SearchSelect's multi-pick sibling: a searchable dropdown where several
 * options can be chosen at once, shown as removable chips in the closed
 * control instead of a fixed wall of toggle buttons. A screen offering many
 * voucher types, cost centres or staff members used to render every option
 * as its own always-visible chip — correct, but a rule with 40 staff to
 * choose from turned the form into a wall of buttons. This keeps every
 * option reachable (nothing is left out of the list) while only ever
 * showing what is actually picked.
 *
 * Same fixed-positioned panel as SearchSelect, for the same reason: most of
 * these sit inside a `card`, and an absolutely positioned panel gets clipped
 * by it.
 */
export default function MultiSearchSelect({
  value, onChange, options, placeholder = "Anyone / any", disabled, className = "", emptyText = "Nothing matches",
}: {
  value: string[];
  onChange: (value: string[]) => void;
  options: MultiOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; below: boolean } | null>(null);
  const btnRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const byValue = useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);
  const selected = useMemo(() => value.map((v) => byValue.get(v)).filter((o): o is MultiOption => !!o), [value, byValue]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    const starts: MultiOption[] = [], has: MultiOption[] = [];
    for (const o of options) {
      const hay = `${o.label} ${o.hint ?? ""}`.toLowerCase();
      if (hay.startsWith(needle)) starts.push(o);
      else if (hay.includes(needle)) has.push(o);
    }
    return [...starts, ...has];
  }, [options, q]);

  const place = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const space = window.innerHeight - b.bottom;
    const below = space > 260 || space > b.top;
    setRect({ left: b.left, width: Math.max(b.width, 240), below, top: below ? b.bottom + 4 : Math.max(8, b.top - 4) });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !listRef.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, place]);

  useEffect(() => { if (open) { setQ(""); setActive(0); inputRef.current?.focus(); } }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function toggle(o: MultiOption) {
    if (o.disabled) return;
    onChange(value.includes(o.value) ? value.filter((v) => v !== o.value) : [...value, o.value]);
  }
  function remove(v: string, e: React.MouseEvent) {
    e.stopPropagation();
    onChange(value.filter((x) => x !== v));
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(shown.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (shown[active]) toggle(shown[active]); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
    else if (e.key === "Backspace" && q === "" && value.length > 0) { onChange(value.slice(0, -1)); }
  }

  const rows = useMemo(() => {
    const out: ({ kind: "head"; label: string } | { kind: "opt"; o: MultiOption; idx: number })[] = [];
    let last: string | undefined;
    shown.forEach((o, idx) => {
      if (o.group && o.group !== last) { out.push({ kind: "head", label: o.group }); last = o.group; }
      out.push({ kind: "opt", o, idx });
    });
    return out;
  }, [shown]);

  return (
    <>
      <div
        ref={btnRef}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={`input flex min-h-[2.25rem] flex-wrap items-center gap-1.5 py-1.5 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"} ${className}`}
      >
        {selected.length === 0 && <span className="text-slate-400">{placeholder}</span>}
        {selected.map((o) => (
          <span key={o.value} className="flex items-center gap-1 rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand-700">
            {o.label}
            {!disabled && (
              <span role="button" tabIndex={-1} aria-label={`Remove ${o.label}`}
                onClick={(e) => remove(o.value, e)} className="text-brand-700/60 hover:text-brand-700">×</span>
            )}
          </span>
        ))}
      </div>

      {open && rect && (
        <div ref={listRef}
          style={{
            position: "fixed", left: rect.left, width: Math.max(rect.width, 260),
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
                <div key={`h${i}`} className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{r.label}</div>
              ) : (
                <div key={r.o.value} data-idx={r.idx} title={r.o.disabledReason}
                  onMouseEnter={() => setActive(r.idx)}
                  onClick={() => toggle(r.o)}
                  className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 ${
                    r.o.disabled ? "cursor-not-allowed text-slate-300"
                    : r.idx === active ? "bg-brand-50 text-brand-800" : "text-slate-700"}`}>
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                    value.includes(r.o.value) ? "border-brand bg-brand text-white" : "border-slate-300"}`}>
                    {value.includes(r.o.value) ? "✓" : ""}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{r.o.label}</span>
                  {r.o.hint && <span className="shrink-0 text-xs text-slate-400">{r.o.hint}</span>}
                </div>
              ))}
          </div>
          <div className="border-t border-slate-100 px-3 py-1 text-[10px] text-slate-400">
            {value.length} picked · click to toggle, Esc to close
          </div>
        </div>
      )}
    </>
  );
}
