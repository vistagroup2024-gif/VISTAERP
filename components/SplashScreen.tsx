"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

// Branded launch screen for the installed app (PWA). On a cold open in
// standalone display mode it shows the Vista logo with the app name and tagline
// below it, then fades into the ERP. On a normal browser tab it renders nothing,
// so desktop/web is unaffected.
export default function SplashScreen() {
  const [show, setShow] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let standalone = false;
    try {
      standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as any).standalone === true;
    } catch { /* ignore */ }
    if (!standalone) return;
    try { if (sessionStorage.getItem("splash:seen") === "1") return; } catch { /* ignore */ }
    setShow(true);
    const fade = setTimeout(() => setLeaving(true), 1000);
    const done = setTimeout(() => {
      setShow(false);
      try { sessionStorage.setItem("splash:seen", "1"); } catch { /* ignore */ }
    }, 1400);
    return () => { clearTimeout(fade); clearTimeout(done); };
  }, []);

  if (!show) return null;

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-white transition-opacity duration-500 ${leaving ? "opacity-0" : "opacity-100"}`}
      aria-hidden
    >
      <Image src="/logo.svg" alt="Vista Group" width={120} height={140} priority />
      <h1 className="mt-5 text-lg font-bold tracking-tight text-slate-900">VISTA GROUP ERP</h1>
      <p className="mt-1 text-sm text-slate-500">Travel Operations Management System</p>
      <div className="mt-6 h-1 w-24 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full w-1/2 animate-pulse rounded-full bg-brand-600" />
      </div>
    </div>
  );
}
