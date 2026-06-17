import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";

export const dynamic = "force-dynamic";

const TYPE_COLOR: Record<string, string> = {
  asset: "bg-blue-100 text-blue-700",
  liability: "bg-amber-100 text-amber-700",
  equity: "bg-purple-100 text-purple-700",
  income: "bg-green-100 text-green-700",
  expense: "bg-red-100 text-red-700",
};

export default async function AccountsPage() {
  const supabase = createClient();
  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, code, name, type, is_postable")
    .order("code");

  return (
    <div>
      <PageHeader title="Chart of Accounts" action={{ href: "/accounting/accounts/new", label: "+ New Account" }} />
      <div className="card overflow-hidden p-0">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Code</th>
              <th className="th">Account</th>
              <th className="th">Type</th>
              <th className="th">Postable</th>
            </tr>
          </thead>
          <tbody>
            {(accounts ?? []).map((a) => (
              <tr key={a.id} className="border-t border-slate-100">
                <td className="td font-mono">{a.code}</td>
                <td className="td font-medium">{a.name}</td>
                <td className="td"><span className={`badge ${TYPE_COLOR[a.type]}`}>{a.type}</span></td>
                <td className="td">{a.is_postable ? "Yes" : "—"}</td>
              </tr>
            ))}
            {(accounts ?? []).length === 0 && (
              <tr><td className="td text-slate-400" colSpan={4}>No accounts. They are seeded automatically on first accounting action.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
