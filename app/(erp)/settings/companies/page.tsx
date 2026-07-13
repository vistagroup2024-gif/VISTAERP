import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import DeleteButton from "@/components/DeleteButton";
import AddCompany from "./AddCompany";

export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  const supabase = createClient();
  const { data: rows } = await supabase
    .from("group_companies")
    .select("id, name, is_active, created_at")
    .order("name");

  return (
    <div className="max-w-2xl">
      <PageHeader title="Companies" />
      <p className="mb-4 text-sm text-slate-500">
        These company names appear in the <b>Company</b> dropdown on the Visa Group form. Add as many as you need.
      </p>
      <div className="mb-5"><AddCompany /></div>
      <div className="card overflow-hidden p-0">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Company</th>
              <th className="th">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="td font-medium">{c.name}</td>
                <td className="td">
                  <DeleteButton rpc="delete_group_company" paramName="p_id" id={c.id}
                    confirmText={`Delete company "${c.name}"?`} />
                </td>
              </tr>
            ))}
            {(rows ?? []).length === 0 && (
              <tr><td className="td text-slate-400" colSpan={2}>No companies yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
