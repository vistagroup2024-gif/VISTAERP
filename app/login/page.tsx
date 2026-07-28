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

    setLoading(false);
    setError("Invalid credentials. Please check your username and password.");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-4">
        <div className="text-center">
          <div className="mb-3 flex justify-center">
            <Image src="/logo.svg" alt="Vista Group" width={150} height={175} priority />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-brand-dark">VISTA GROUP ERP</h1>
          <p className="mt-1 text-sm text-slate-500">Travel Operations Management System</p>
        </div>

        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div>
          <label className="label">Username / Email</label>
          <input className="input" type="text" placeholder="Enter your ID or email"
            autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="label">Password</label>
          <div className="relative">
            <input className="input pr-10" type={showPassword ? "text" : "password"} value={password}
              onChange={(e) => setPassword(e.target.value)} required />
            <button type="button" onClick={() => setShowPassword((s) => !s)}
              className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
              aria-label={showPassword ? "Hide password" : "Show password"}>
              {showPassword ? "🙈" : "👁"}
            </button>
          </div>
        </div>
        <button className="btn w-full" disabled={loading}>
          {loading ? "Signing in…" : "Login"}
        </button>
      </form>
    </main>
  );
}
