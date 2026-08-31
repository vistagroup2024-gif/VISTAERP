"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { dateStr } from "@/lib/format";

interface Row {
  booking_id: string; booking_no: string; guest_name: string; hotel: string | null; city: string | null;
  check_in: string | null; check_out: string | null; beds: number | null; status: string;
  agreement_no: string | null; group_company_id: string | null; group_company: string | null; brn_id: string | null;
}
interface Company { id: string; name: string }

const STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: "Pending", tone: "bg-amber-100 text-amber-700" },
  sent: { label: "Sent to Hotel", tone: "bg-blue-100 text-blue-700" },
  completed: { label: "Completed", tone: "bg-green-100 text-green-700" },
};

export default function NusukAgreementsTable({ rows, companies }: { rows: Row[]; companies: Company[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"pending" | "completed">("pending");
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<Row | null>(null);
  const [form, setForm] = useState<any>({});
  const [err, setErr] = useState<string | null>(null);

  const counts = useMemo(() => ({
    pending: rows.filter((r) => r.status !== "completed").length,
    completed: rows.filter((r) => r.status === "completed").length,
  }), [rows]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab === "completed" ? r.status !== "completed" : r.status === "completed") return false;
      if (!s) return true;
      return [r.booking_no, r.guest_name, r.hotel, r.agreement_no].some((v) => String(v ?? "").toLowerCase().includes(s));
    });
  }, [rows, q, tab]);

  async function createAgreement(r: Row) {
    setBusy(true);
    const { error } = await supabase.rpc("nusuk_agreement_create", { p_booking: r.booking_id });
    setBusy(false);
    if (error) return alert(error.message);
    router.refresh();
  }

  function openDetails(r: Row) {
    setErr(null);
    setForm({
      agreement_no: r.agreement_no ?? "", hotel_name: r.hotel ?? "", city: r.city ?? "",
      check_in: r.check_in ?? "", check_out: r.check_out ?? "", beds: r.beds ?? "",
      group_company_id: r.group_company_id ?? "",
    });
    setModal(r);
  }

  async function submitDetails() {
    if (!modal) return;
    setErr(null);
    if (!form.agreement_no?.trim()) return setErr("Agreement No is required.");
    if (!form.group_company_id) return setErr("Company is required.");
    if (!form.check_in || !form.check_out) return setErr("Check-in and check-out are required.");
    if (!(Number(form.beds) > 0)) return setErr("Beds must be greater than zero.");
    setBusy(true);
    const { error } = await supabase.rpc("nusuk_agreement_complete", {
      p_booking: modal.booking_id, p_agreement_no: form.agreement_no.trim(), p_hotel_name: form.hotel_name,
      p_city: form.city, p_check_in: form.check_in, p_check_out: form.check_out,
      p_beds: Number(form.beds), p_group_company: form.group_company_id,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setModal(null); router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
          {(["pending", "completed"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize ${tab === t ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-50"}`}>
              {t} <span className={tab === t ? "opacity-80" : "text-slate-400"}>({counts[t]})</span>
            </button>
          ))}
        </div>
        <input className="input max-w-xs" placeholder="Search booking, guest, hotel, agreement…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[900px]">
          <thead className="bg-slate-50"><tr>
            <th className="th">Guest</th><th className="th">Hotel</th><th className="th">Check-in</th><th className="th">Check-out</th>
            <th className="th">Beds</th><th className="th">Agreement No</th><th className="th">Company</th><th className="th">Status</th><th className="th">Action</th>
          </tr></thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.booking_id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="td"><Link href={`/hotels/bookings/${r.booking_id}`} className="font-medium text-brand hover:underline">{r.guest_name}</Link><div className="text-xs text-slate-400">{r.booking_no}</div></td>
                <td className="td">{r.hotel ?? "—"}<div className="text-xs text-slate-400 capitalize">{r.city ?? ""}</div></td>
                <td className="td">{dateStr(r.check_in)}</td>
                <td className="td">{dateStr(r.check_out)}</td>
                <td className="td">{r.beds ?? "—"}</td>
                <td className="td">{r.agreement_no ?? "—"}</td>
                <td className="td">{r.group_company ?? "—"}</td>
                <td className="td"><span className={`badge ${STATUS[r.status]?.tone ?? "bg-slate-100"}`}>{STATUS[r.status]?.label ?? r.status}</span></td>
                <td className="td">
                  {r.status === "pending" && <button disabled={busy} onClick={() => createAgreement(r)} className="btn text-xs">Create Agreement</button>}
                  {r.status === "sent" && <button disabled={busy} onClick={() => openDetails(r)} className="btn text-xs">Add Agreement Details</button>}
                  {r.status === "completed" && (r.brn_id
                    ? <Link href="/inventory/brn" className="text-xs text-brand hover:underline">BRN created ✓</Link>
                    : <span className="text-xs text-slate-400">✓</span>)}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td className="td text-slate-400" colSpan={9}>No hotel bookings.</td></tr>}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setModal(null)}>
          <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 font-semibold text-slate-800">Agreement Details — {modal.guest_name}</h3>
            {err && <div className="mb-2 rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Agreement No *</label><input className="input" value={form.agreement_no} onChange={(e) => setForm({ ...form, agreement_no: e.target.value })} /></div>
              <div><label className="label">Hotel Name</label><input className="input" value={form.hotel_name} onChange={(e) => setForm({ ...form, hotel_name: e.target.value })} /></div>
              <div><label className="label">Check-in *</label><input type="date" className="input" value={form.check_in} onChange={(e) => setForm({ ...form, check_in: e.target.value })} /></div>
              <div><label className="label">Check-out *</label><input type="date" className="input" value={form.check_out} onChange={(e) => setForm({ ...form, check_out: e.target.value })} /></div>
              <div><label className="label">Beds Purchased *</label><input type="number" min={1} className="input" value={form.beds} onChange={(e) => setForm({ ...form, beds: e.target.value })} /></div>
              <div><label className="label">City</label><input className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
              <div className="col-span-2"><label className="label">Company *</label>
                <select className="input" value={form.group_company_id} onChange={(e) => setForm({ ...form, group_company_id: e.target.value })}>
                  <option value="">— select company —</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-500">Completing this adds a BRN ({form.beds || "—"} beds) to inventory for visa groups.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-outline text-sm" onClick={() => setModal(null)}>Cancel</button>
              <button disabled={busy} className="btn text-sm" onClick={submitDetails}>{busy ? "Saving…" : "Complete & Create BRN"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
