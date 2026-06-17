"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const STATUSES = ["pending", "applied", "issued", "rejected"];
const COLOR: Record<string, string> = {
  pending: "bg-slate-100 text-slate-600",
  applied: "bg-amber-100 text-amber-700",
  issued: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

export default function VisaRow({
  id,
  name,
  passport,
  nationality,
  visaType,
  bookingNo,
  status: initial,
}: {
  id: string;
  name: string;
  passport: string | null;
  nationality: string | null;
  visaType: string | null;
  bookingNo: string | null;
  status: string;
}) {
  const supabase = createClient();
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function change(s: string) {
    setBusy(true);
    await supabase.from("booking_pax").update({ visa_status: s }).eq("id", id);
    setStatus(s);
    setBusy(false);
  }

  return (
    <tr className="border-t border-slate-100">
      <td className="td font-medium">{name}</td>
      <td className="td">{passport ?? "—"}</td>
      <td className="td">{nationality ?? "—"}</td>
      <td className="td">{visaType ?? "—"}</td>
      <td className="td font-mono">{bookingNo ?? "—"}</td>
      <td className="td">
        <select
          className={`badge ${COLOR[status]} cursor-pointer border-0`}
          value={status}
          disabled={busy}
          onChange={(e) => change(e.target.value)}
        >
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </td>
    </tr>
  );
}
