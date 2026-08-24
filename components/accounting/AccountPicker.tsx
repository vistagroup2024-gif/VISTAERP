"use client";

import { useMemo } from "react";

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
          if (id) onChange(id);
          else if (e.target.value === "") onChange(null);
        }}
        onBlur={(e) => { if (!byLabel.get(e.target.value) && e.target.value !== label) e.target.value = label; }}
      />
      <datalist id={listId}>
        {accounts.map((a) => <option key={a.id} value={`${a.code} · ${a.name}`} />)}
      </datalist>
    </>
  );
}
