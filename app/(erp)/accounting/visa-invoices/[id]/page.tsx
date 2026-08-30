import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import VisaInvoiceEditor from "./VisaInvoiceEditor";

export const dynamic = "force-dynamic";

export default async function VisaInvoicePage({ params }: { params: { id: string } }) {
  await guardStaffPage("accounting.view");
  const sb = createClient();
  const { data: inv } = await sb.from("visa_invoices").select("*").eq("id", params.id).maybeSingle();
  if (!inv) return <div className="card text-slate-500">Invoice not found. <Link href="/accounting/visa-invoices" className="text-brand hover:underline">Back</Link></div>;
  const v = inv as any;
  const [{ data: agent }, { data: supAcc }] = await Promise.all([
    v.agent_id ? sb.from("parties").select("name").eq("id", v.agent_id).maybeSingle() : Promise.resolve({ data: null }),
    v.supplier_account_id ? sb.from("accounts").select("name").eq("id", v.supplier_account_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return <VisaInvoiceEditor invoice={v} agentName={(agent as any)?.name ?? ""} supplierName={(supAcc as any)?.name ?? ""} />;
}
