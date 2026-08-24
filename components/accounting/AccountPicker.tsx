"use client";

import { useMemo } from "react";

// Remember the accounts this user picks so the picker can surface them first
// (spec automation #4 — smart account suggestion by history).
function recordRecent(id: string) {
  try {
    const k = "acct:recent";
    const cur: string[] = JSON.parse(localStorage.getItem(k) || "[]");
    const next = [id, ...cur.filter((x) => x !== id)].slice(0, 12);
    localStorage.setItem(k, JSON.stringify(next));
  } catch {}
}
function getRecent(): string[] {
  try { return JSON.parse(localStorage.getItem("acct:recent") || "[]"); } catch { return []; }
}

export type PickAccount = { id: string; code: string; name: string; subtype: string | null; nature: string };

// Keyboard-friendly type-ahead account picker backed by a native datalist so the
// operator can type a code or name and pick without leaving the keyboard.
export default function AccountPicker({
  accounts, value, onChange, placeholder = "Account…", className = "", autoFocus,
}: {
  accounts: PickAccount[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string; className?: string; autoFocus?: boolean;
}) {
  const listId = useMemo(() => "acc-" + Math.random().toString(36).slice(2), []);
  const byLabel = useMemo(() => new Map(accounts.map((a) => [`${a.code} · ${a.name}`, a.id])), [accounts]);
  // Recent accounts first so the operator's common picks are at the top of the list.
  const ordered = useMemo(() => {
    const recent = getRecent();
    const rank = new Map(recent.map((id, i) => [id, i]));
    return [...accounts].sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));
  }, [accounts]);
  const label = useMemo(() => {
    const a = accounts.find((x) => x.id === value);
    return a ? `${a.code} · ${a.name}` : "";
  }, [accounts, value]);

  return (
    <>
      <input
        list={listId}
        defaultValue={label}
        key={value ?? "empty"}
        autoFocus={autoFocus}
        placeholder={placeholder}
        className={`input ${className}`}
        onChange={(e) => {
          const id = byLabel.get(e.target.value);
          if (id) { onChange(id); recordRecent(id); }
          else if (e.target.value === "") onChange(null);
        }}
        onBlur={(e) => { if (!byLabel.get(e.target.value) && e.target.value !== label) e.target.value = label; }}
      />
      <datalist id={listId}>
        {ordered.map((a) => <option key={a.id} value={`${a.code} · ${a.name}`} />)}
      </datalist>
    </>
  );
}
