"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";

export default function NewAllotmentPage() {
  const router = useRouter();
  const supabase = createClient();
  const [hotels, setHotels] = useState<any[]>([]);
  const [roomTypes, setRoomTypes] = useState<any[]>([]);
  const [form, setForm] = useState({
    hotel_id: "",
    room_type_id: "",
    rooms_held: 10,
    start_date: "",
    end_date: "",
    release_date: "",
    cost_price: 0,
    currency: "SAR",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("hotels").select("id, name").order("name").then(({ data }) => setHotels(data ?? []));
  }, [supabase]);

  useEffect(() => {
    if (!form.hotel_id) return setRoomTypes([]);
    supabase.from("room_types").select("id, name").eq("hotel_id", form.hotel_id).then(({ data }) => setRoomTypes(data ?? []));
  }, [form.hotel_id, supabase]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { error } = await supabase.from("allotments").insert({
      company_id: COMPANY_ID,
      hotel_id: form.hotel_id,
      room_type_id: form.room_type_id,
      rooms_held: Number(form.rooms_held),
      start_date: form.start_date,
      end_date: form.end_date,
      release_date: form.release_date || null,
      cost_price: Number(form.cost_price),
      currency: form.currency,
    });
    setSaving(false);
    if (error) return setError(error.message);
    router.push("/allotments");
    router.refresh();
  }

  return (
    <div className="max-w-lg">
      <h1 className="mb-6 text-2xl font-bold">New Allotment</h1>
      <form onSubmit={save} className="card space-y-4">
        {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div>
          <label className="label">Hotel</label>
          <select className="input" value={form.hotel_id} onChange={(e) => setForm({ ...form, hotel_id: e.target.value, room_type_id: "" })} required>
            <option value="">Select…</option>
            {hotels.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Room type</label>
          <select className="input" value={form.room_type_id} onChange={(e) => setForm({ ...form, room_type_id: e.target.value })} required>
            <option value="">Select…</option>
            {roomTypes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Rooms held</label>
            <input className="input" type="number" value={form.rooms_held} onChange={(e) => setForm({ ...form, rooms_held: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">Cost / night</label>
            <input className="input" type="number" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: Number(e.target.value) })} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="label">Start</label>
            <input className="input" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} required />
          </div>
          <div>
            <label className="label">End</label>
            <input className="input" type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} required />
          </div>
          <div>
            <label className="label">Release by</label>
            <input className="input" type="date" value={form.release_date} onChange={(e) => setForm({ ...form, release_date: e.target.value })} />
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
