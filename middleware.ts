import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  // The tab shell's own iframes carry ?embed=1 (and their own ?tabId=) so
  // the ERP layout knows to draw that route bare, no sidebar or header of
  // its own. Layouts are not handed the request's query string directly —
  // this is the one place that can read it — so it rides in as a header,
  // readable downstream via headers(). x-erp-path is the route the shell
  // should treat as "what got us here" for its very first render: the path
  // actually requested, embed params stripped, whether or not this hit was
  // itself embedded.
  //
  // A page's OWN internal link — a filter, a mode switch, "Open plan →" —
  // does not know about ?embed=1/?tabId= and does not carry them, so a
  // click on one navigates that same tab's iframe to a URL with neither.
  // Read literally, that looks like a fresh top-level visit, so the layout
  // drew the WHOLE shell again — sidebar, header, tab strip, all of it —
  // nested inside the tab that already had one, and that nested shell then
  // opened ITS OWN tab for the URL — which is what a click inside an
  // already-open screen looked like from the outside: "opening a new tab".
  //
  // A plain <a href> is a real document load, and Sec-Fetch-Dest is the
  // browser's own, unspoofable answer to "is this navigation happening
  // inside an iframe": every browser sends `iframe` for it and `document`
  // for a real top-level visit, so it catches this for every page's own
  // links everywhere, not just the one first noticed — instead of hunting
  // down and fixing every internal link by hand. But a control built on
  // Next's router (`router.push()`, `<Link>`) never reloads the document at
  // all — it fetches the next segment's data with `fetch()`, which carries
  // Sec-Fetch-Dest: empty, same as any other same-origin fetch, so it slips
  // straight past that check. CompanyFilter's `router.push(pathname +
  // params)` on Purchase Planning's own company selector is exactly this
  // shape, and so is every other in-page filter built the same way.
  //
  // Both kinds of navigation share one thing Sec-Fetch-Dest cannot see:
  // Referer is the URL of the document that is navigating, whether or not
  // that navigation reloads it — and that document's own URL still carries
  // this tab's ?embed=1&tabId=, because that is how it was loaded into its
  // iframe to begin with. Reading embed and tabId back out of a same-origin
  // Referer, whenever the request's own query string and Sec-Fetch-Dest do
  // not already answer it, catches router.push/<Link> the same way
  // Sec-Fetch-Dest catches a plain <a> — and recovers tabId along with it,
  // so the tab strip's own label/url tracking no longer goes quiet for a
  // navigation that never carried an explicit tabId of its own.
  let embed = request.nextUrl.searchParams.get("embed") === "1"
    || request.headers.get("sec-fetch-dest") === "iframe";
  let tabId = request.nextUrl.searchParams.get("tabId") ?? "";
  if (!embed) {
    const fromRef = embedFromReferrer(request);
    if (fromRef) {
      embed = true;
      tabId = fromRef.tabId;
    }
  }
  if (embed) {
    request.headers.set("x-erp-embed", "1");
    request.headers.set("x-erp-tab", tabId);
  }
  request.headers.set("x-erp-path", request.nextUrl.pathname + strippedSearch(request));
  return await updateSession(request);
}

/** Same-origin Referer whose own URL carries ?embed=1&tabId= — i.e. this
 *  request was made BY a document that is itself one of the shell's
 *  embedded tabs, regardless of whether the browser calls the request a
 *  fresh document (Sec-Fetch-Dest: iframe already caught it) or a fetch
 *  (Next's router navigations, which never set Sec-Fetch-Dest: iframe). */
function embedFromReferrer(request: NextRequest): { tabId: string } | null {
  const ref = request.headers.get("referer");
  if (!ref) return null;
  let u: URL;
  try { u = new URL(ref); } catch { return null; }
  if (u.origin !== request.nextUrl.origin) return null;
  if (u.searchParams.get("embed") !== "1") return null;
  return { tabId: u.searchParams.get("tabId") ?? "" };
}

function strippedSearch(request: NextRequest): string {
  const qs = new URLSearchParams(request.nextUrl.search);
  qs.delete("embed");
  qs.delete("tabId");
  const rest = qs.toString();
  return rest ? `?${rest}` : "";
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
