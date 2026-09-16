"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";

const HOME = "/dashboard";

/**
 * Runs inside every tab's own content, invisibly. It tells the shell what
 * this tab is showing now, every time that changes — the moment it opens,
 * and again on any navigation the tab makes on its own (a "view" link
 * inside a report, a voucher number in the ledger, Load-from on a voucher).
 * Without this the tab strip would freeze at whatever the tab first opened
 * to, and clicking around inside a tab would silently stop matching what
 * its own label and closing-behaviour think it is showing.
 *
 * It also takes the shell's one Back button (there is no per-tab Back/Home
 * row any more — see NavButtons' removal) and runs it against THIS tab's
 * own history, because only the tab itself has one; the parent frame never
 * navigates.
 */
export default function EmbedBridge({ tabId }: { tabId: string }) {
  const router = useRouter();
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

  useEffect(() => {
    if (typeof window === "undefined" || window.parent === window) return;
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "erp-tab" && e.data.action === "back") {
        if (window.history.length > 1) router.back();
        else router.push(HOME);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [router]);

  return null;
}
