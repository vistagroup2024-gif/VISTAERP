import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import OutboxTable from "./OutboxTable";

export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const sb = createClient();
  const { data } = await sb.from("transport_outbox").select("id, booking_id, channel, to_addr, body, status, created_at, sent_at").order("created_at", { ascending: false }).limit(300);
  return (
    <div className="max-w-4xl">
      <PageHeader title="Confirmations Outbox" />
      <p className="mb-4 text-sm text-slate-500">
        WhatsApp / SMS booking confirmations queued from bookings. This is the delivery queue: connect a
        WhatsApp Business API or SMS gateway to auto-send <b>queued</b> messages; until then, mark them sent manually.
      </p>
      <OutboxTable initial={(data as any[]) ?? []} />
    </div>
  );
}
