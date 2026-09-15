"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Runs inside every tab's own content, invisibly. It tells the shell what
 * this tab is showing now, every time that changes — the moment it opens,
 * and again on any navigation the tab makes on its own (a "view" link
 * inside a report, a voucher number in the ledger, Load-from on a voucher).
 * Without this the tab strip would freeze at whatever the tab first opened
 * to, and clicking around inside a tab would silently stop matching what
 * its own label and closing-behaviour think it is showing.
 */
export default function EmbedBridge({ tabId }: { tabId: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();

  useEffect(() => {
    if (typeof window === "undefined" || window.parent === window || !tabId) return;
    const qs = new URLSearchParams(search);
    qs.delete("embed");
    qs.delete("tabId");
    const rest = qs.toString();
    const url = rest ? `${pathname}?${rest}` : pathname;
    // A microtask lets this navigation's own <title> (if the page sets one)
    // land before it is read, rather than posting the previous tab's title.
    queueMicrotask(() => {
      window.parent.postMessage(
        { type: "erp-tab", tabId, action: "nav", url, title: document.title },
        window.location.origin,
      );
    });
  }, [pathname, search, tabId]);

  return null;
}
