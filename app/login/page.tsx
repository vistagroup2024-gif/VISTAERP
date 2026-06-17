"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // A plain user ID (no "@") is mapped to an internal email so users can
  // sign in with just an ID + password — e.g. "ADMIN" -> "admin@vista.local".
  function toLoginEmail(input: string) {
    const v = input.trim();
    return v.includes("@") ? v.toLowerCase() : `${v.toLowerCase()}@vista.local`;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: toLoginEmail(email),
      password,
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-4">
        <div className="text-center">
          <div className="flex justify-center mb-3">
            <Image src="/logo.svg" alt="Vista Group" width={160} height={120} priority />
          </div>
          <p className="text-sm text-slate-500 mt-1">Staff sign in</p>
        </div>
        {error && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <div>
          <label className="label">User ID</label>
          <input
            className="input"
            type="text"
            placeholder="e.g. ADMIN"
            autoCapitalize="none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">Password</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button className="btn w-full" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
        <p className="text-center text-sm text-slate-500">
          No account?{" "}
          <Link href="/signup" className="text-brand hover:underline">
            Create one
          </Link>
        </p>
      </form>
    </main>
  );
}
