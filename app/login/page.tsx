"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // A plain user ID (no "@") is mapped to an internal email so users can
  // sign in with just an ID + password — e.g. "ADMIN" -> "admin@vista.local".
  function toLoginEmail(input: string) {
    const v = input.trim();
    return v.includes("@") ? v.toLowerCase() : `${v.toLowerCase()}@vista.local`;
  }

  // Universal login: one screen for everyone. We first try the staff/admin
  // Supabase credentials; if those don't match, we fall back to the B2B agent
  // login. After authentication the ERP resolves the user's role, permissions
  // and dashboard via the existing RBAC — there are no separate login types.
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const id = email.trim();

    // 1) Staff / Admin (Supabase auth).
    const { error: staffErr } = await supabase.auth.signInWithPassword({
      email: toLoginEmail(id),
      password,
    });
    if (!staffErr) {
      router.push("/dashboard");
      router.refresh();
      return;
    }

    // 2) B2B Agent (custom session) — only if the staff sign-in failed.
    const res = await fetch("/api/agent/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: id, password }),
    });
    if (res.ok) {
      window.location.href = "/agent";
      return;
    }

    // 3) Transport Vendor (custom session).
    const vres = await fetch("/api/vendor/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: id, password }),
    });
    if (vres.ok) {
      window.location.href = "/vendor";
      return;
    }

    // 4) Transport Driver (custom session).
    const dres = await fetch("/api/driver/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: id, password }),
    });
    if (dres.ok) {
      window.location.href = "/driver";
      return;
    }

    setLoading(false);
    setError("Invalid credentials. Please check your username and password.");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <Image src="/logo.svg" alt="Vista Group" width={120} height={140} priority />
          <h1 className="mt-4 text-lg font-bold tracking-tight text-slate-900">VISTA GROUP ERP</h1>
          <p className="mt-1 text-sm text-slate-500">Travel Operations Management System</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-card">
          {error && (
            <div className="rounded-md border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{error}</div>
          )}

          <div>
            <label className="label">Username / Email</label>
            <input className="input" type="text" placeholder="Enter your ID or email"
              autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="label">Password</label>
            <div className="relative">
              <input className="input pr-10" type={showPassword ? "text" : "password"} placeholder="Enter your password"
                value={password} onChange={(e) => setPassword(e.target.value)} required />
              <button type="button" onClick={() => setShowPassword((s) => !s)}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 transition-colors hover:text-slate-600"
                aria-label={showPassword ? "Hide password" : "Show password"}>
                {showPassword ? (
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M9.9 4.24A9.1 9.1 0 0112 4c7 0 10 8 10 8a18.5 18.5 0 01-2.16 3.19M6.6 6.6A18.5 18.5 0 002 12s3 8 10 8a9.1 9.1 0 005.4-1.76M1 1l22 22M9.9 9.9a3 3 0 004.2 4.2" /></svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8z" /><circle cx="12" cy="12" r="3" /></svg>
                )}
              </button>
            </div>
          </div>
          <button className="btn w-full" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-400">© {new Date().getFullYear()} Vista Group. All rights reserved.</p>
      </div>
    </main>
  );
}
