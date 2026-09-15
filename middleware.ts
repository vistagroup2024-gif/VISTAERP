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
  const embed = request.nextUrl.searchParams.get("embed") === "1";
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
