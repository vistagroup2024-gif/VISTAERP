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

    // The middleware tells ?embed=1 apart from a fresh top-level visit by
    // the query string, or — for a router.push()/<Link>, which never
    // reloads the document and so never resends ?embed=1 itself — the
    // Referer of the request that's asking. Both read what THIS document's
    // OWN address bar says right now, and a router.push changes the
    // pathname to whatever the link targeted and drops every query param
    // that link didn't carry — embed and tabId included. That held past the
    // FIRST such navigation only: the tab's address bar was left with
    // neither, so the very next one had no ?embed=1 anywhere to read — not
    // in its own request, not in the Referer of the one after it — and the
    // ERP layout drew the whole shell again, nested inside the tab that
    // already had one. Restoring embed/tabId onto this document's own
    // address bar after EVERY navigation, not only the very first, is what
    // closes that for good: whatever this tab navigates to next, the
    // Referer the browser sends for it is always this document's current
    // location, which always still carries them. A no-op history entry,
    // never a Next.js navigation of its own — same as the shell's own
    // address-bar sync in TabShell.
    const embedQs = new URLSearchParams(search);
    embedQs.set("embed", "1");
    embedQs.set("tabId", tabId);
    const embedUrl = `${pathname}?${embedQs.toString()}`;
    if (window.location.pathname + window.location.search !== embedUrl) {
      window.history.replaceState(null, "", embedUrl);
    }

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
      if (e.data?.type !== "erp-tab") return;
      if (e.data.action === "back") {
        if (window.history.length > 1) router.back();
        else router.push(HOME);
      } else if (e.data.action === "goto" && typeof e.data.url === "string") {
        // The shell telling this tab (Home, when its own click inside the
        // iframe drifted it to a dashboard card's report) to go back to a
        // specific route — used to keep the pinned Home tab's real content
        // in agreement with its label, which never changes.
        router.push(e.data.url);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [router]);

  return null;
}
