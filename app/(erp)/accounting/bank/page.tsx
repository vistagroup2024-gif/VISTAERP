import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import BankClient from "./BankClient";

export const dynamic = "force-dynamic";

export default async function BankPage({ searchParams }: { searchParams: { statement?: string } }) {
  const sb = createClient();
  const [{ data: banks }, { data: contras }, { data: statements }] = await Promise.all([
    sb.from("accounts").select("id, code, name, subtype").eq("is_postable", true).in("subtype", ["Bank", "Cash"]).order("code"),
    sb.from("accounts").select("id, code, name, subtype").eq("is_postable", true).in("type", ["income", "expense"]).order("code"),
    sb.from("bank_statements").select("id, statement_date, bank_account_id, accounts!bank_account_id(code,name)").order("created_at", { ascending: false }).limit(20),
  ]);

  let statement: any = null; let lines: any[] = [];
  if (searchParams.statement) {
    const { data: s } = await sb.from("bank_statements").select("id, bank_account_id, statement_date").eq("id", searchParams.statement).maybeSingle();
    statement = s;
    const { data: l } = await sb.from("bank_lines").select("id, line_date, description, ref, amount, status").eq("statement_id", searchParams.statement).order("line_date");
    lines = l ?? [];
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Bank Reconciliation" />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/accounting/bank" className="rounded-full bg-slate-100 px-3 py-1 text-slate-600 hover:bg-slate-200">+ New import</Link>
        {(statements ?? []).map((s: any) => (
          <Link key={s.id} href={`/accounting/bank?statement=${s.id}`}
            className={`rounded-full px-3 py-1 ${statement?.id === s.id ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {s.accounts?.name ?? "Bank"} · {s.statement_date}
          </Link>
        ))}
      </div>
      <BankClient banks={(banks ?? []) as any} contras={(contras ?? []) as any} statement={statement} lines={lines as any} />
    </div>
  );
}
