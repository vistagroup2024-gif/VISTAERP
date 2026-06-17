import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import RoomTypeManager from "./RoomTypeManager";

export const dynamic = "force-dynamic";

export default async function HotelDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: hotel } = await supabase
    .from("hotels")
    .select("*")
    .eq("id", params.id)
    .single();
  if (!hotel) notFound();

  const { data: roomTypes } = await supabase
    .from("room_types")
    .select("id, name, capacity")
    .eq("hotel_id", params.id)
    .order("name");

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{hotel.name}</h1>
        <p className="capitalize text-slate-500">
          {hotel.city} · {hotel.rating ? `${hotel.rating}★` : "unrated"}
          {hotel.distance_haram_m ? ` · ${hotel.distance_haram_m} m to Haram` : ""}
        </p>
      </div>
      <RoomTypeManager hotelId={hotel.id} initial={roomTypes ?? []} />
    </div>
  );
}
