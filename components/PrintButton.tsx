"use client";

import { usePathname } from "next/navigation";
import { useDocRightsForPath } from "@/components/AccessProvider";

// Shared by every report and voucher screen that offers a printout. It works
// out which screen it is standing on from the route, so the Access tab's Print
// right is honoured everywhere this button appears without each screen having
// to pass anything in. A route the Access tab doesn't name is not print-gated.
export default function PrintButton({ label = "🖨 Print / Save PDF" }: { label?: string }) {
  const path = usePathname();
  const { canPrint, denied } = useDocRightsForPath(path ?? "");
  return (
    <button onClick={() => window.print()} disabled={!canPrint} title={denied("print")}
      className="btn no-print text-sm disabled:opacity-40">{label}</button>
  );
}
