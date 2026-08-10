import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getAgent } from "@/lib/agentSession";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const COLOR: Record<string, string> = {
  Pending: "bg-amber-100 text-amber-700", Processing: "bg-blue-100 text-blue-700",
  Confirmed: "bg-indigo-100 text-indigo-700", "HCN Received": "bg-teal-100 text-teal-700",
  Completed: "bg-green-100 text-green-700", Cancelled: "bg-red-100 text-red-700",
};

export default async function AgentHotelView({ params }: { params: { id: string } }) {
  const agent = await getAgent();
  if (!agent) redirect("/login");
  const sb = createClient();
  const { data, error } = await sb.rpc("b2b_hotel_get", { p_token: agent.token, p_id: params.id });
  if (error || !data) notFound();
  const v = data as any;
  const Row = ({ l, val }: { l: string; val: any }) => (
    <div className="flex justify-between border-b border-slate-100 py-1.5 text-sm"><span className="text-slate-500">{l}</span><span className="font-medium">{val || "—"}</span></div>
  );
  return (
    <div className="max-w-2xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">{v.booking_no}</h1>
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${COLOR[v.status] ?? "bg-slate-200"}`}>{v.status}</span>
      </div>
      <div className="card">
        <div className="grid gap-x-8 md:grid-cols-2">
          <div>
            <Row l="Guest / Group" val={v.guest_name} />
            <Row l="Group No." val={v.group_no} />
            <Row l="Mobile" val={v.mobile} />
            <Row l="Nationality" val={v.nationality} />
            <Row l="City" val={v.city ? String(v.city).replace(/^\w/, (c: string) => c.toUpperCase()) : "—"} />
            <Row l="Hotel" val={v.hotel} />
          </div>
          <div>
            <Row l="Check-in" val={v.check_in} />
            <Row l="Check-out" val={v.check_out} />
            <Row l="Nights" val={v.nights} />
            <Row l="Room Type" val={v.room_type} />
            <Row l="Rooms / Guests" val={`${v.rooms} / ${v.guests}`} />
            <Row l="Meal Plan" val={v.meal_plan} />
          </div>
        </div>
        {v.special_requests && <p className="mt-3 text-sm text-slate-500">📝 {v.special_requests}</p>}
        <div className="mt-4 rounded-lg border-2 border-dashed border-slate-300 p-3 text-center">
          <div className="text-xs uppercase tracking-wide text-slate-400">Hotel Confirmation Number (HCN)</div>
          <div className="text-2xl font-bold tracking-widest">{v.hcn || "Pending"}</div>
        </div>
        {v.hcn && v.public_token && (
          <div className="mt-4 text-center">
            <Link href={`/hv/${v.public_token}`} target="_blank" className="btn-outline">🏨 View / Download Voucher</Link>
          </div>
        )}
      </div>
    </div>
  );
}
