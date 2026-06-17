"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type RT = { id: string; name: string; capacity: number };

export default function RoomTypeManager({
  hotelId,
  initial,
}: {
  hotelId: string;
  initial: RT[];
}) {
  const supabase = createClient();
  const [rows, setRows] = useState<RT[]>(initial);
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState(4);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { data, error } = await supabase
      .from("room_types")
      .insert({ hotel_id: hotelId, name, capacity })
      .select("id, name, capacity")
      .single();
    if (error) return setError(error.message);
    setRows([...rows, data as RT]);
    setName("");
    setCapacity(4);
  }

  return (
    <div className="card">
      <h2 className="mb-3 font-semibold">Room types</h2>
      {error && <div className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <ul className="mb-4 divide-y divide-slate-100">
        {rows.map((r) => (
          <li key={r.id} className="flex justify-between py-2 text-sm">
            <span>{r.name}</span>
            <span className="text-slate-400">cap {r.capacity}</span>
          </li>
        ))}
        {rows.length === 0 && <li className="py-2 text-sm text-slate-400">No room types yet.</li>}
      </ul>
      <form onSubmit={add} className="flex items-end gap-2">
        <div className="flex-1">
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Quad / Triple…" required />
        </div>
        <div className="w-24">
          <label className="label">Capacity</label>
          <input className="input" type="number" min={1} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} />
        </div>
        <button className="btn">Add</button>
      </form>
    </div>
  );
}
