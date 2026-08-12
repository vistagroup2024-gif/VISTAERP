"use client";

import { useEffect, useRef, useState } from "react";

export interface RowMenuItem { label: string; onClick: () => void; danger?: boolean }

// Three-dot row action menu. Positioned with fixed coordinates so it is not
// clipped by a table's horizontal-scroll container.
export default function RowMenu({ items }: { items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  function toggle() {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const est = Math.max(1, items.length) * 34 + 12;
      const spaceBelow = window.innerHeight - r.bottom - 8;
      const top = spaceBelow >= est ? r.bottom + 4 : Math.max(8, r.top - est - 4);
      setPos({ top, left: Math.max(8, r.right - 208) });
    }
    setOpen((o) => !o);
  }
  return (
    <>
      <button ref={btnRef} onClick={toggle} aria-label="Actions" className="rounded px-1.5 text-lg leading-none text-slate-500 hover:bg-slate-100">⋮</button>
      {open && pos && (
        <div ref={menuRef} className="fixed z-50 w-52 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg" style={{ top: pos.top, left: pos.left, maxHeight: "calc(100vh - 16px)" }}>
          {items.length === 0 && <div className="px-3 py-1.5 text-sm text-slate-400">No actions available</div>}
          {items.map((it, i) => (
            <button key={i} onClick={() => { setOpen(false); it.onClick(); }}
              className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50 ${it.danger ? "text-red-600" : "text-slate-700"}`}>{it.label}</button>
          ))}
        </div>
      )}
    </>
  );
}
