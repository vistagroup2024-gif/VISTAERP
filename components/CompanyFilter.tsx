"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import SearchSelect from "@/components/ui/SearchSelect";

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
      <SearchSelect value={value} onChange={go} className="w-auto" placeholder="All companies" options={companies.map((c) => ({ value: c.id, label: c.name }))} />
    </div>
  );
}
