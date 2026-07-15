"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { dateStr } from "@/lib/format";
import GroupActions from "./GroupActions";

export interface GroupRow {
  id: string;
  group_no: string;
  group_date: string;
  group_name: string;
  company: string;
  agent: string;
  pax: number;
  arrival_date: string;
  departure_date: string;
  total_nights: number;
  brn_status: string;
  visa_status: string;
  package_status: string | null;
  visa_label: string;
  package_label: string;
}

const PKG_CLS: Record<string, string> = {
  "Complete Package": "bg-green-100 text-green-700",
  "Package Update Required": "bg-orange-100 text-orange-700",
  "Package Updated": "bg-blue-100 text-blue-700",
};
const VISA_CLS: Record<string, string> = {
  "Visa Issued": "bg-emerald-600 text-white",
  "BRN Allocated": "bg-green-100 text-green-700",
  "Pending": "bg-yellow-100 text-yellow-800",
};

export default function GroupsTable({ rows, isAdmin }: { rows: GroupRow[]; isAdmin: boolean }) {
  const [f, setF] = useState({
    group_no: "", group_name: "", company: "", agent: "",
    visa_label: "", package_label: "", arrival: "", departure: "",
  });

  const uniq = (v: string[]) => Array.from(new Set(v.filter(Boolean))).sort();
  const companies = useMemo(() => uniq(rows.map((r) => r.company)), [rows]);
  const agents = useMemo(() => uniq(rows.map((r) => r.agent)), [rows]);
  const groupNos = useMemo(() => uniq(rows.map((r) => r.group_no)), [rows]);
  const names = useMemo(() => uniq(rows.map((r) => r.group_name)), [rows]);
  const visaLabels = ["Pending", "BRN Allocated", "Visa Issued"];
  const pkgLabels = ["Complete Package", "Package Update Required", "Package Updated"];

  const filtered = useMemo(() => rows.filter((r) =>
    (!f.group_no || r.group_no.toLowerCase().includes(f.group_no.toLowerCase())) &&
    (!f.group_name || r.group_name.toLowerCase().includes(f.group_name.toLowerCase())) &&
    (!f.company || r.company === f.company) &&
    (!f.agent || r.agent === f.agent) &&
    (!f.visa_label || r.visa_label === f.visa_label) &&
    (!f.package_label || r.package_label === f.package_label) &&
    (!f.arrival || r.arrival_date >= f.arrival) &&
    (!f.departure || r.departure_date <= f.departure)
  ), [rows, f]);

  function reset() { setF({ group_no: "", group_name: "", company: "", agent: "", visa_label: "", package_label: "", arrival: "", departure: "" }); }

  return (
    <div className="space-y-3">
      <div className="card grid grid-cols-2 gap-3 md:grid-cols-4">
        <div><label className="label">Group No</label>
          <input className="input" list="g-nos" value={f.group_no} onChange={(e) => setF({ ...f, group_no: e.target.value })} placeholder="All" />
          <datalist id="g-nos">{groupNos.map((x) => <option key={x} value={x} />)}</datalist></div>
        <div><label className="label">Group Name</label>
          <input className="input" list="g-names" value={f.group_name} onChange={(e) => setF({ ...f, group_name: e.target.value })} placeholder="All" />
          <datalist id="g-names">{names.map((x) => <option key={x} value={x} />)}</datalist></div>
        <div><label className="label">Company</label>
          <input className="input" list="g-cos" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} placeholder="All" />
          <datalist id="g-cos">{companies.map((x) => <option key={x} value={x} />)}</datalist></div>
        <div><label className="label">Agent</label>
          <input className="input" list="g-agents" value={f.agent} onChange={(e) => setF({ ...f, agent: e.target.value })} placeholder="All" />
          <datalist id="g-agents">{agents.map((x) => <option key={x} value={x} />)}</datalist></div>
        <div><label className="label">Visa Status</label>
          <select className="input" value={f.visa_label} onChange={(e) => setF({ ...f, visa_label: e.target.value })}>
            <option value="">All</option>{visaLabels.map((x) => <option key={x}>{x}</option>)}</select></div>
        <div><label className="label">Package Status</label>
          <select className="input" value={f.package_label} onChange={(e) => setF({ ...f, package_label: e.target.value })}>
            <option value="">All</option>{pkgLabels.map((x) => <option key={x}>{x}</option>)}</select></div>
        <div><label className="label">Arrival from</label>
          <input className="input" type="date" value={f.arrival} onChange={(e) => setF({ ...f, arrival: e.target.value })} /></div>
        <div><label className="label">Departure to</label>
          <input className="input" type="date" value={f.departure} onChange={(e) => setF({ ...f, departure: e.target.value })} /></div>
        <div className="col-span-2 flex items-end md:col-span-4">
          <button onClick={reset} className="btn-outline text-sm">Reset filters</button>
          <span className="ml-3 self-center text-sm text-slate-400">{filtered.length} of {rows.length}</span>
        </div>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[1080px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Date</th><th className="th">Group No</th><th className="th">Company</th><th className="th">Name</th>
              <th className="th">Agent</th><th className="th">Pax</th><th className="th">Arrival</th><th className="th">Departure</th>
              <th className="th">Nights</th><th className="th">Visa Status</th><th className="th">Package</th><th className="th">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((g) => (
              <tr key={g.id} className="border-t border-slate-100">
                <td className="td text-sm">{dateStr(g.group_date)}</td>
                <td className="td font-mono font-medium"><Link href={`/groups/${g.id}`} className="text-brand hover:underline">{g.group_no}</Link></td>
                <td className="td text-slate-500">{g.company || "—"}</td>
                <td className="td">{g.group_name || "—"}</td>
                <td className="td text-slate-500">{g.agent || "—"}</td>
                <td className="td font-medium">{g.pax}</td>
                <td className="td text-sm">{dateStr(g.arrival_date)}</td>
                <td className="td text-sm">{dateStr(g.departure_date)}</td>
                <td className="td">{g.total_nights}</td>
                <td className="td"><span className={`badge ${VISA_CLS[g.visa_label] ?? "bg-slate-100"}`}>{g.visa_label}</span></td>
                <td className="td">{g.package_status ? <span className={`badge ${PKG_CLS[g.package_label] ?? "bg-slate-100 text-slate-600"}`}>{g.package_label}</span> : <span className="text-slate-300">—</span>}</td>
                <td className="td"><GroupActions groupId={g.id} brnStatus={g.brn_status} visaStatus={g.visa_status} isAdmin={isAdmin} /></td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td className="td text-slate-400" colSpan={12}>No matching groups.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
