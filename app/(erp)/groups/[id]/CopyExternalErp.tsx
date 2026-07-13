"use client";

import { useMemo, useState } from "react";
import { TEMPLATES, buildExport, ExtGroup, ExtHotel } from "@/lib/externalErp";

export default function CopyExternalErp({
  group, hotels,
}: { group: ExtGroup; hotels: ExtHotel[] }) {
  const [templateId, setTemplateId] = useState(TEMPLATES[0].id);
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const payload = useMemo(() => buildExport(templateId, group, hotels), [templateId, group, hotels]);

  async function copy() {
    await navigator.clipboard.writeText(payload);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-700">📤 External ERP Export</h2>
      </div>
      <p className="text-sm text-slate-500">
        Copies this group + its allocated hotels formatted for the destination ERP. Open the other ERP, create a new record, click the first field, and paste.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Destination template</label>
          <select className="input w-auto" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <button className="btn" onClick={copy}>{copied ? "✓ Copied" : "📋 Copy for External ERP"}</button>
        <button className="btn-outline text-sm" onClick={() => setShowPreview((s) => !s)}>
          {showPreview ? "Hide preview" : "Preview"}
        </button>
      </div>
      <p className="text-xs text-slate-400">{TEMPLATES.find((t) => t.id === templateId)?.description}</p>
      {showPreview && (
        <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800">{payload}</pre>
      )}
    </div>
  );
}
