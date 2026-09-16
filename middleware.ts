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
  // nested inside the tab that already had one. Sec-Fetch-Dest is the
  // browser's own, unspoofable answer to "is this navigation happening
  // inside an iframe": every browser sends `iframe` for it and `document`
  // for a real top-level visit, so it catches this for every page's own
  // links everywhere, not just the one that was first noticed — instead of
  // hunting down and fixing every internal link by hand. tabId still rides
  // only on the explicit query param (there is no other way to know WHICH
  // tab), so a page reached this way updates its own content correctly but
  // the tab strip's label/url tracking for it goes quiet until the next
  // navigation that does carry one.
  const embed = request.nextUrl.searchParams.get("embed") === "1"
    || request.headers.get("sec-fetch-dest") === "iframe";
  const tabId = request.nextUrl.searchParams.get("tabId") ?? "";
  if (embed) {
    request.headers.set("x-erp-embed", "1");
    request.headers.set("x-erp-tab", tabId);
  }
  request.headers.set("x-erp-path", request.nextUrl.pathname + strippedSearch(request));
  return await updateSession(request);
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
