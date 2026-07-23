"use client";

export default function AgentLogout() {
  async function logout() {
    await fetch("/api/agent/logout", { method: "POST" });
    window.location.href = "/login";
  }
  return <button onClick={logout} className="rounded bg-slate-100 px-3 py-1 text-slate-600 hover:bg-slate-200">Logout</button>;
}
