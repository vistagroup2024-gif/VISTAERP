"use client";

import { useRouter, usePathname } from "next/navigation";

const HOME = "/dashboard";

// Back and Home, as one control.
//
// Rendered in exactly ONE place: the ERP layout, above every page's content.
// It used to live in PageHeader, which covered the 137 screens that use one and
// missed the 46 that draw their own title bar — the voucher shells among them.
// From the layout it reaches all of them, and no page can show a second pair
// because no page renders it at all. A screen that wants a "back to the list"
// link of its own should not add one beside this.
//
// Home hides itself on the dashboard, because a button to the page you are
// already on is noise rather than navigation.
export default function NavButtons({ fallbackHref = HOME }: { fallbackHref?: string }) {
  const router = useRouter();
  const path = usePathname();
  const atHome = path === HOME;

  const cls =
    "inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:border-slate-400 hover:bg-slate-50 hover:text-slate-800";

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        aria-label="Go back"
        title="Back"
        onClick={() => {
          // History, so it returns where they actually came from; the fallback
          // covers a tab opened straight onto this URL, which has none.
          if (typeof window !== "undefined" && window.history.length > 1) router.back();
          else router.push(fallbackHref);
        }}
        className={cls}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75"
             strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        <span className="hidden sm:inline">Back</span>
      </button>
      {!atHome && (
        <button
          type="button"
          aria-label="Go to dashboard"
          title="Dashboard"
          onClick={() => router.push(HOME)}
          className={cls}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75"
               strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.8V21h14V9.8" /><path d="M9.5 21v-6h5v6" />
          </svg>
          <span className="hidden sm:inline">Home</span>
        </button>
      )}
    </div>
  );
}
