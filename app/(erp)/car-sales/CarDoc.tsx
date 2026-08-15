import PrintButton from "@/components/PrintButton";
import { VISTA } from "@/lib/voucherBrand";

// Shared print-friendly document shell for Car Sales documents (browser print -> PDF).
export default function CarDoc({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="no-print mb-4 flex justify-end"><PrintButton /></div>
      <div className="print-doc mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-8 text-sm text-slate-800">
        <div className="mb-6 flex items-start justify-between border-b border-slate-200 pb-4">
          <div>
            <div className="text-xl font-bold text-slate-900">{VISTA.name}</div>
            <div className="text-xs text-slate-500">{VISTA.tagline}</div>
            <div className="mt-1 text-xs text-slate-500">{VISTA.address} · {VISTA.mobile} · {VISTA.email}</div>
          </div>
          <div className="text-right">
            <div className="text-lg font-semibold text-slate-800">{title}</div>
            {subtitle && <div className="text-xs text-slate-500">{subtitle}</div>}
          </div>
        </div>
        {children}
        <div className="mt-10 grid grid-cols-2 gap-8 text-xs text-slate-500">
          <div className="border-t border-slate-300 pt-2">Customer signature</div>
          <div className="border-t border-slate-300 pt-2">For {VISTA.name}</div>
        </div>
      </div>
    </div>
  );
}

export function Field({ l, v }: { l: string; v: any }) {
  return (
    <div className="flex justify-between border-b border-slate-100 py-1">
      <span className="text-slate-500">{l}</span><span className="font-medium">{v ?? "—"}</span>
    </div>
  );
}
