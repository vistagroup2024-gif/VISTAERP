"use client";

import { useState } from "react";
import CompanyRecommendation from "@/components/CompanyRecommendation";

// "Company Inquiry" button that opens the recommendation tool in a slide-over
// side panel. Lives next to the New Visa Group button on the Visa Groups page
// (both Admin and Agent portals). `agentView` hides all operational/inventory
// detail, showing the agent only the recommended company name.
export default function CompanyInquiryButton({
  endpoint, agentView = false, canRelease = false,
}: { endpoint: string; agentView?: boolean; canRelease?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-outline">Company Inquiry</button>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative z-10 flex h-full w-full max-w-xl flex-col bg-slate-50 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
              <h2 className="text-lg font-bold text-slate-800">Company Inquiry</h2>
              <button onClick={() => setOpen(false)} className="text-xl leading-none text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <p className="mb-4 text-sm text-slate-500">
                Enter the stay and pax to find which company to select in Nusuk Masar. Reserve the company to hold it while you create the group.
              </p>
              <CompanyRecommendation endpoint={endpoint} agentView={agentView} canRelease={canRelease} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
