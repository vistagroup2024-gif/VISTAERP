"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export default function CompanyFilter({
  companies, value,
}: { companies: { id: string; name: string }[]; value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function go(company: string) {
    const p = new URLSearchParams(params.toString());
    if (company) p.set("company", company); else p.delete("company");
    router.push(`${pathname}?${p.toString()}`);
  }

  return (
    <div className="mb-4 flex items-center gap-2">
      <label className="text-sm font-medium text-slate-600">Company:</label>
      <select className="input w-auto" value={value} onChange={(e) => go(e.target.value)}>
        <option value="">All companies</option>
        {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </div>
  );
}
