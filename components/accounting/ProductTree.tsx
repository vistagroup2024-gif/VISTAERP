"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";

type Node = { id: string; parent_id: string | null; name: string; is_group: boolean; is_active: boolean; sort: number };

export default function ProductTree({ initial }: { initial: Node[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState("");
  const [parent, setParent] = useState<string>("");
  const [isGroup, setIsGroup] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => initial.filter((n) => n.is_group), [initial]);
  const byParent = useMemo(() => {
    const m = new Map<string | null, Node[]>();
    for (const n of initial) { const k = n.parent_id; if (!m.has(k)) m.set(k, []); m.get(k)!.push(n); }
    m.forEach((arr) => arr.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)));
    return m;
  }, [initial]);

  async function add(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    if (!name.trim()) return setErr("Name is required");
    setBusy(true);
    const { error } = await supabase.from("acct_products").insert({
      company_id: COMPANY_ID, name: name.trim(), parent_id: parent || null, is_group: isGroup,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setName(""); router.refresh();
  }
  async function rename(n: Node) {
    const v = prompt("Rename:", n.name); if (v === null) return;
    if (!v.trim()) return;
    await supabase.from("acct_products").update({ name: v.trim() }).eq("id", n.id); router.refresh();
  }
  async function del(n: Node) {
    if ((byParent.get(n.id)?.length ?? 0) > 0) return setErr(`"${n.name}" has children — remove them first.`);
    if (!confirm(`Delete "${n.name}"?`)) return;
    const { error } = await supabase.from("acct_products").delete().eq("id", n.id);
    if (error) return setErr(error.message);
    router.refresh();
  }

  function Row({ n, depth }: { n: Node; depth: number }) {
    const kids = byParent.get(n.id) ?? [];
    const isOpen = open[n.id] ?? true;
    return (
      <div>
        <div className="flex items-center gap-2 border-b border-slate-50 py-1.5 hover:bg-slate-50" style={{ paddingLeft: 8 + depth * 18 }}>
          {n.is_group && kids.length > 0
            ? <button onClick={() => setOpen((o) => ({ ...o, [n.id]: !isOpen }))} className="w-4 text-slate-400">{isOpen ? "▾" : "▸"}</button>
            : <span className="w-4" />}
          <span className={n.is_group ? "font-semibold text-slate-700" : "text-slate-600"}>{n.name}</span>
          {n.is_group && <span className="rounded bg-slate-100 px-1.5 text-[10px] uppercase text-slate-500">group</span>}
          {!n.is_active && <span className="rounded bg-slate-200 px-1.5 text-[10px] uppercase text-slate-500">inactive</span>}
          <span className="ml-auto flex gap-2 pr-3 text-xs">
            <button onClick={() => rename(n)} className="text-brand hover:underline">Rename</button>
            <button onClick={() => supabase.from("acct_products").update({ is_active: !n.is_active }).eq("id", n.id).then(() => router.refresh())} className="text-slate-500 hover:underline">{n.is_active ? "Disable" : "Enable"}</button>
            <button onClick={() => del(n)} className="text-red-600 hover:underline">Delete</button>
          </span>
        </div>
        {n.is_group && isOpen && kids.map((k) => <Row key={k.id} n={k} depth={depth + 1} />)}
      </div>
    );
  }

  const roots = byParent.get(null) ?? [];
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">A hierarchical catalogue of products / service items. Create groups, then items under them.</p>
      <form onSubmit={add} className="card grid grid-cols-1 gap-3 sm:grid-cols-6">
        <div className="sm:col-span-2"><label className="label">Name *</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="sm:col-span-2"><label className="label">Under group</label>
          <select className="input" value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">— top level —</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select></div>
        <div className="flex items-end"><label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={isGroup} onChange={(e) => setIsGroup(e.target.checked)} /> Is a group</label></div>
        <div className="flex items-end"><button className="btn w-full" disabled={busy}>{busy ? "…" : "+ Add"}</button></div>
        {err && <p className="text-sm text-red-600 sm:col-span-6">{err}</p>}
      </form>
      <div className="card p-0 text-sm">
        {roots.length === 0 ? <p className="p-4 text-slate-400">No products yet.</p> : roots.map((n) => <Row key={n.id} n={n} depth={0} />)}
      </div>
    </div>
  );
}
