"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Sidebar, { type StaffNavAccess } from "@/components/Sidebar";
import AppHeader from "@/components/AppHeader";
import PushNudge from "@/components/PushNudge";
import Icon from "@/components/ui/Icon";
import { ShellNavProvider } from "@/lib/shell";
import { navItemFor } from "@/lib/nav";

type Tab = { id: string; url: string; label: string; pinned?: boolean };
const HOME: Tab = { id: "home", url: "/dashboard", label: "Home", pinned: true };
const STORAGE_KEY = "erp:tabs:v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Strips this shell's own embed/tabId params but keeps everything else,
 *  hash included — what a tab's own `url` is stored as, so its iframe still
 *  lands on whatever anchor a link meant (e.g. the trip-alert bell's
 *  `#trip-alerts`). Hash is kept LAST, after the query string — appending
 *  `?embed=1&tabId=…` onto a URL blindly (after any `#` was already there)
 *  put the embed marker INSIDE the fragment, which a browser never sends to
 *  the server at all: the iframe's real request then carried no `embed=1`,
 *  so the page could not tell it should render bare and drew the whole
 *  shell again, nested inside itself. */
function cleanUrl(href: string): string {
  const hashIdx = href.indexOf("#");
  const hash = hashIdx === -1 ? "" : href.slice(hashIdx);
  const beforeHash = hashIdx === -1 ? href : href.slice(0, hashIdx);
  const [path0, qs0] = beforeHash.split("?");
  const path = path0.length > 1 ? path0.replace(/\/+$/, "") : path0;
  if (!qs0) return path + hash;
  const qs = new URLSearchParams(qs0);
  qs.delete("embed");
  qs.delete("tabId");
  const rest = qs.toString();
  return (rest ? `${path}?${rest}` : path) + hash;
}

/** A stable key for "is this the same screen" — no trailing slash, no hash
 *  (an anchor within the page, not a different screen — the trip-alert
 *  bell's `#trip-alerts` should reuse an already-open Operations tab, not
 *  open a second one), and the embed/tabId params this shell adds for its
 *  own iframes stripped, so a link into the app and the tab it opened
 *  compare equal. */
function normalize(href: string): string {
  return cleanUrl(href).split("#")[0];
}

/** What to call a tab before its own page has had a chance to say (via
 *  EmbedBridge's title). The nav model names most screens; a route it does
 *  not know — a voucher opened by id, a report drilled into — falls back to
 *  the last named path segment. */
function labelFor(href: string): string {
  const path = href.split("#")[0].split("?")[0];
  const item = navItemFor(path);
  if (item) return item.label;
  const seg = path.split("/").filter(Boolean);
  const last = seg[seg.length - 1] || "Screen";
  const named = UUID_RE.test(last) && seg.length > 1 ? seg[seg.length - 2] : last;
  return named.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function cleanTitle(t: string): string {
  return t.replace(/\s*[·|-]\s*Vista ERP\s*$/i, "").trim() || t;
}

function embedSrc(tab: Tab): string {
  // tab.url can still carry a hash (cleanUrl keeps it) — embed=1&tabId= must
  // land in the query string, before the hash, or the browser swallows it
  // into the fragment and never sends it to the server. See cleanUrl above.
  const hashIdx = tab.url.indexOf("#");
  const base = hashIdx === -1 ? tab.url : tab.url.slice(0, hashIdx);
  const hash = hashIdx === -1 ? "" : tab.url.slice(hashIdx);
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}embed=1&tabId=${tab.id}${hash}`;
}

/**
 * The tab shell — Sidebar and the header drawn once, a strip of open
 * screens beside a pinned Home, and one hidden `<iframe>` per open tab so
 * switching away from one and back never loses what was on it. Each tab is
 * a real, separate page load of its own route (with `?embed=1`, which
 * tells the ERP layout to draw that route bare, no chrome of its own) —
 * same-origin, so it shares this session without any extra wiring, and the
 * browser itself keeps a hidden iframe's page alive exactly like a real
 * tab.
 */
export default function TabShell({ name, access, initialPath }: {
  name: string; access: StaffNavAccess; initialPath: string;
}) {
  const [tabs, setTabs] = useState<Tab[]>([HOME]);
  const [activeId, setActiveId] = useState("home");
  const ready = useRef(false);
  // One iframe per open tab, same-origin, so Back can reach straight into
  // the active one's own history — the parent frame itself never navigates.
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const goBack = useCallback(() => {
    frames.current.get(activeId)?.contentWindow?.postMessage(
      { type: "erp-tab", action: "back" }, window.location.origin);
  }, [activeId]);

  // Home is pinned so it is always a way back to /dashboard — but a click
  // INSIDE the Home tab's own iframe (a dashboard card) is not caught by
  // onChromeClick below (that only sees clicks in the chrome OUTSIDE the
  // iframes; a click inside one never bubbles across the frame boundary), so
  // it navigates the Home tab's iframe itself to the card's report. The tab
  // strip's own label is protected from changing for a pinned tab
  // (updateTab below), so the strip keeps saying "Home" — but the iframe
  // really did leave /dashboard, and nothing ever sent it back, so clicking
  // "Home" again just reshowed whatever it had drifted to. Telling that
  // iframe to go back to /dashboard every time Home is selected is what
  // keeps the pinned tab's label and its actual content in agreement.
  const goHome = useCallback(() => {
    setActiveId("home");
    frames.current.get("home")?.contentWindow?.postMessage(
      { type: "erp-tab", action: "goto", url: HOME.url }, window.location.origin);
  }, []);

  const openTab = useCallback((href: string) => {
    const norm = normalize(href);
    if (!norm || norm === "/") return;
    if (normalize(HOME.url) === norm) { goHome(); return; }
    setTabs((ts) => {
      const existing = ts.find((t) => normalize(t.url) === norm);
      if (existing) { setActiveId(existing.id); return ts; }
      const id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      setActiveId(id);
      const url = cleanUrl(href);
      return [...ts, { id, url, label: labelFor(url) }];
    });
  }, [goHome]);

  // Restore what was open last, then reconcile with whatever route actually
  // brought us here this time — a bookmark, a link followed from outside
  // the ERP, a plain refresh.
  useEffect(() => {
    if (ready.current) return;
    ready.current = true;
    let restored: Tab[] = [HOME];
    let restoredActive = "home";
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const saved = raw ? JSON.parse(raw) : null;
      if (Array.isArray(saved?.tabs) && saved.tabs.length) {
        restored = [HOME, ...saved.tabs.filter((t: Tab) => t && t.id && t.id !== "home" && t.url)];
        if (saved.activeId) restoredActive = saved.activeId;
      }
    } catch {}
    const norm = normalize(initialPath);
    if (norm && norm !== "/" && normalize(HOME.url) !== norm) {
      const existing = restored.find((t) => normalize(t.url) === norm);
      if (existing) restoredActive = existing.id;
      else {
        const id = `t${Date.now().toString(36)}`;
        restored = [...restored, { id, url: norm, label: labelFor(norm) }];
        restoredActive = id;
      }
    }
    setTabs(restored);
    setActiveId(restored.some((t) => t.id === restoredActive) ? restoredActive : "home");
  }, [initialPath]);

  // A navigation the click interceptor below did not catch — a stray Link
  // or router.push somewhere in the chrome this was not updated for — still
  // ends up here rather than losing every open tab, because Next.js keeps a
  // shared layout's own client tree across a sibling route change; only the
  // initialPath prop this reads changes, not this component's identity.
  const seenPath = useRef(initialPath);
  useEffect(() => {
    if (!ready.current || initialPath === seenPath.current) return;
    seenPath.current = initialPath;
    openTab(initialPath);
  }, [initialPath, openTab]);

  useEffect(() => {
    if (!ready.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs: tabs.filter((t) => t.id !== "home"), activeId }));
    } catch {}
  }, [tabs, activeId]);

  const closeTab = useCallback((id: string) => {
    if (id === "home") return;
    setTabs((ts) => {
      const i = ts.findIndex((t) => t.id === id);
      const next = ts.filter((t) => t.id !== id);
      setActiveId((cur) => (cur !== id ? cur : (next[i - 1] ?? next[i] ?? HOME).id));
      return next;
    });
  }, []);

  // A tab's own url/title, kept live by its EmbedBridge — a tab can
  // navigate on its own (a voucher link inside a report), and the strip
  // should say so.
  const updateTab = useCallback((id: string, patch: Partial<Pick<Tab, "url" | "label">>) => {
    setTabs((ts) => ts.map((t) => (t.id === id && !t.pinned ? { ...t, ...patch } : t)));
  }, []);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const d = e.data;
      if (!d || d.type !== "erp-tab") return;
      if (d.action === "nav" && typeof d.tabId === "string" && typeof d.url === "string") {
        const url = normalize(d.url);
        const title = d.title ? cleanTitle(d.title) : "";
        // No page in this app sets its own <title> — the root layout's is a
        // flat "Vista ERP", so document.title never carries a real screen
        // name. Trusting it anyway overwrote every tab's good, nav-derived
        // label with that same useless string the instant its tab reported
        // in. Fall back to the nav model instead, exactly like the tab's own
        // initial label already does — and once a page DOES set a real
        // title, this starts preferring it automatically, no further change.
        updateTab(d.tabId, { url, label: title && title !== "Vista ERP" ? title : labelFor(url) });
      } else if (d.action === "home") {
        setActiveId("home");
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [updateTab]);

  // Cosmetic only: the address bar follows the active tab, so a refresh or
  // a copied link lands back on it. It is history.replaceState, never a
  // router call — it must not trigger a Next.js navigation of its own.
  useEffect(() => {
    const t = tabs.find((x) => x.id === activeId);
    if (!t || typeof window === "undefined") return;
    if (window.location.pathname + window.location.search !== t.url) {
      window.history.replaceState(null, "", t.url);
    }
  }, [activeId, tabs]);

  const nav = useMemo(() => ({
    activePath: tabs.find((t) => t.id === activeId)?.url ?? HOME.url,
    openTab,
  }), [tabs, activeId, openTab]);

  // Every plain click on a link anywhere in the chrome opens a tab instead
  // of navigating this page away — ONE place that catches Sidebar, the
  // header's menus and search, the notification bell, the push nudge and
  // anything drawn here later, rather than patching each one by hand. A
  // modified click (new-tab, new-window) is left alone so the browser's own
  // "open in new tab" still works.
  //
  // CAPTURE phase, not bubble: Next's own <Link> attaches its click handler
  // on the anchor itself and, unless the event already arrives with
  // defaultPrevented, calls preventDefault() and does ITS OWN client-side
  // navigation there — before a bubble-phase handler up here would even
  // run. A bubble handler's own "if (e.defaultPrevented) return" then saw
  // Link's preventDefault already set and did nothing — the click fell
  // through to a real Next.js navigation, which this layout discards
  // entirely outside embed mode (it renders only the shell, never the
  // routed page), so nothing appeared until a hard refresh re-ran the
  // layout from a clean request. Capturing first means THIS is what calls
  // preventDefault, and Link sees that and skips its own navigation.
  function onChromeClick(e: React.MouseEvent) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
    if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
    const href = a.getAttribute("href") || "";
    if (!href.startsWith("/") || href.startsWith("//")) return;
    e.preventDefault();
    openTab(href);
  }

  return (
    <ShellNavProvider value={nav}>
      <PushNudge />
      <div className="flex h-screen" onClickCapture={onChromeClick}>
        <Sidebar name={name} access={access} />
        <div className="flex h-full min-w-0 flex-1 flex-col pt-14 lg:pt-0">
          <AppHeader name={name} access={access} />
          <TabStrip tabs={tabs} activeId={activeId} onSelect={(id) => (id === "home" ? goHome() : setActiveId(id))} onClose={closeTab} onBack={goBack} />
          <div className="relative min-h-0 flex-1">
            {tabs.map((t) => (
              <iframe key={t.id} src={embedSrc(t)} title={t.label}
                ref={(el) => { if (el) frames.current.set(t.id, el); else frames.current.delete(t.id); }}
                className={`absolute inset-0 h-full w-full border-0 ${t.id === activeId ? "" : "hidden"}`} />
            ))}
          </div>
        </div>
      </div>
    </ShellNavProvider>
  );
}

function TabStrip({ tabs, activeId, onSelect, onClose, onBack }: {
  tabs: Tab[]; activeId: string; onSelect: (id: string) => void; onClose: (id: string) => void; onBack: () => void;
}) {
  return (
    <div className="no-print flex items-center gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 px-2 py-1.5">
      <button type="button" onClick={onBack} aria-label="Back" title="Back"
        className="shrink-0 rounded-md p-1.5 text-slate-500 transition-colors hover:bg-white/70 hover:text-slate-800">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75"
             strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
      </button>
      {tabs.map((t) => (
        <div key={t.id}
          onClick={() => onSelect(t.id)}
          role="tab" aria-selected={t.id === activeId} title={t.label}
          className={`group flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md py-1.5 pl-3 text-sm transition-colors ${
            t.pinned ? "px-2.5" : "pr-1.5"} ${
            t.id === activeId ? "bg-white font-medium text-slate-800 shadow-sm" : "text-slate-500 hover:bg-white/70"}`}>
          {t.pinned && <Icon name="dashboard" size={14} className={t.id === activeId ? "text-brand-600" : "text-slate-400"} />}
          <span className="max-w-[9rem] truncate">{t.label}</span>
          {!t.pinned && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onClose(t.id); }}
              aria-label={`Close ${t.label}`}
              className="rounded p-0.5 text-slate-400 opacity-0 transition-opacity hover:bg-slate-200 hover:text-slate-700 group-hover:opacity-100">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5"
                   strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
