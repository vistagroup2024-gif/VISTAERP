"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import StaffPermissionPicker from "@/components/StaffPermissionPicker";
import ScopeTree, { type ScopeRow } from "@/components/settings/ScopeTree";
import DocRightsPicker from "@/components/settings/DocRightsPicker";
import DashboardCardsPicker from "@/components/settings/DashboardCardsPicker";
import type { DocRightsMap } from "@/lib/docRights";

type ScopeKind = "account" | "product" | "cost_center" | "tag_area";

const SCOPE_TABS: { kind: ScopeKind; title: string; note: string }[] = [
  { kind: "account",     title: "Accounts",     note: "No accounts added yet." },
  { kind: "product",     title: "Products",     note: "The Product Tree is empty." },
  { kind: "cost_center", title: "Cost Centers", note: "No cost centres added yet." },
  { kind: "tag_area",    title: "Tag Areas",    note: "No tag areas added yet." },
];

interface Props {
  userId: string; fullName: string; isActive: boolean;
  email: string; phone: string; department: string; designation: string;
  currentPerms: Record<string, boolean>; currentRoles?: string[];
  docRights: DocRightsMap;
  dashboardCards: Record<string, boolean>;
  scopes: Partial<Record<ScopeKind, string[]>>;
  scopeExclude: Partial<Record<ScopeKind, boolean>>;
  loginDateFrom: string; loginDateTo: string; loginTimeFrom: string; loginTimeTo: string;
  masters: Record<ScopeKind, ScopeRow[]>;
  // False for a user manager who holds users.edit but not users.manage_roles:
  // they may correct a name, not hand out access.
  canManageAccess: boolean;
}

const ALL_TABS = ["Account", "Restrict", "Access", "Dashboard", "Modules"] as const;
type Tab = (typeof ALL_TABS)[number];

// Times come back from Postgres as HH:MM:SS; <input type="time"> wants HH:MM.
const hhmm = (t: string) => (t ? t.slice(0, 5) : "");

export default function EditUserRoles({
  userId, fullName: initialName, isActive: initialActive, email: iEmail, phone: iPhone,
  department: iDept, designation: iDesig, currentPerms,
  docRights: iRights, dashboardCards: iCards, scopes: iScopes, scopeExclude: iExclude,
  loginDateFrom, loginDateTo, loginTimeFrom, loginTimeTo, masters, canManageAccess,
}: Props) {
  const router = useRouter();
  const supabase = createClient();

  const TABS: readonly Tab[] = canManageAccess ? ALL_TABS : ["Account"];
  const [tab, setTab] = useState<Tab>("Account");
  const [f, setF] = useState({ fullName: initialName, email: iEmail, phone: iPhone, department: iDept, designation: iDesig });
  const [isActive, setIsActive] = useState(initialActive);
  const [perms, setPerms] = useState<Record<string, boolean>>(currentPerms ?? {});
  const [rights, setRights] = useState<DocRightsMap>(iRights ?? {});
  const [cards, setCards] = useState<Record<string, boolean>>(iCards ?? {});
  const [scopes, setScopes] = useState<Record<ScopeKind, string[]>>({
    account: iScopes.account ?? [], product: iScopes.product ?? [],
    cost_center: iScopes.cost_center ?? [], tag_area: iScopes.tag_area ?? [],
  });
  const [exclude, setExclude] = useState<Record<ScopeKind, boolean>>({
    account: !!iExclude.account, product: !!iExclude.product,
    cost_center: !!iExclude.cost_center, tag_area: !!iExclude.tag_area,
  });
  const [login, setLogin] = useState({
    dateFrom: loginDateFrom, dateTo: loginDateTo,
    timeFrom: hhmm(loginTimeFrom), timeTo: hhmm(loginTimeTo),
  });
  const [scopeTab, setScopeTab] = useState<ScopeKind>("account");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [newPass, setNewPass] = useState("");
  const [pwMsg, setPwMsg] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null); setSuccess(false);

    const { error: err } = await supabase.rpc("update_staff_user", {
      p_id: userId, p_full_name: f.fullName, p_email: f.email, p_phone: f.phone,
      p_department: f.department, p_designation: f.designation, p_is_active: isActive,
      p_roles: [], p_permissions: perms,
    });
    if (err) { setSaving(false); return setError(err.message); }

    if (!canManageAccess) { setSaving(false); setSuccess(true); router.refresh(); return; }

    // Restrictions, rights and the login window save together, so the user is
    // never left half-restricted if one of them is rejected.
    const { error: err2 } = await supabase.rpc("staff_user_set_access", {
      p_id: userId,
      p_doc_rights: rights,
      p_scopes: Object.fromEntries(Object.entries(scopes).filter(([, v]) => v.length)),
      p_scope_exclude: Object.fromEntries(Object.entries(exclude).filter(([, v]) => v)),
      p_login_date_from: login.dateFrom || null,
      p_login_date_to: login.dateTo || null,
      p_login_time_from: login.timeFrom || null,
      p_login_time_to: login.timeTo || null,
      p_dashboard_cards: cards,
    });
    setSaving(false);
    if (err2) return setError(err2.message);
    setSuccess(true);
    router.refresh();
  }

  async function resetPassword() {
    setPwMsg(null);
    if (newPass.length < 6) return setPwMsg("Password must be at least 6 characters");
    const { error: err } = await supabase.rpc("reset_staff_password", { p_id: userId, p_password: newPass });
    if (err) return setPwMsg(err.message);
    setNewPass(""); setPwMsg("Password reset.");
  }

  const restrictCount = Object.values(scopes).reduce((a, v) => a + v.length, 0);
  const rightsCount = Object.keys(rights).length;
  const cardCount = Object.keys(cards).filter((k) => cards[k]).length;

  return (
    <form onSubmit={save} className="space-y-5">
      {error && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{error}</div>}
      {success && <div className="rounded bg-green-50 px-3 py-2 text-sm text-green-700">Saved successfully.</div>}

      {!canManageAccess && (
        <div className="rounded bg-slate-50 px-3 py-2 text-xs text-slate-500">
          You can edit this user’s details. Changing their modules, screen rights,
          restrictions or login window needs the “Give Access” permission.
        </div>
      )}

      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${
              tab === t ? "border-brand font-semibold text-brand" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            {t}
            {t === "Restrict" && restrictCount > 0 && <span className="ml-1.5 rounded-full bg-brand/10 px-1.5 text-[10px] text-brand">{restrictCount}</span>}
            {t === "Access" && rightsCount > 0 && <span className="ml-1.5 rounded-full bg-brand/10 px-1.5 text-[10px] text-brand">{rightsCount}</span>}
            {t === "Dashboard" && cardCount > 0 && <span className="ml-1.5 rounded-full bg-brand/10 px-1.5 text-[10px] text-brand">{cardCount}</span>}
          </button>
        ))}
      </div>

      {tab === "Account" && (
        <div className="space-y-5">
          <div className="card space-y-4">
            <h2 className="font-semibold text-slate-700">Account Details</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div><label className="label">Full name</label><input className="input" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></div>
              <div><label className="label">Email</label><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
              <div><label className="label">Mobile</label><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
              <div><label className="label">Department</label><input className="input" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} /></div>
              <div><label className="label">Designation</label><input className="input" value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} /></div>
            </div>
            <div className="flex items-center gap-3">
              <input id="active" type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-4 w-4" />
              <label htmlFor="active" className="text-sm font-medium text-slate-700">Account active (unticking blocks this user)</label>
            </div>
          </div>

          {canManageAccess && <div className="card space-y-4">
            <div>
              <h2 className="font-semibold text-slate-700">Login Restrictions</h2>
              <p className="text-xs text-slate-400">
                Saudi time. Outside these hours the user cannot sign in and cannot read any data —
                the database closes with the window, not just the screens. Leave blank for no limit.
                An end time earlier than the start time runs overnight (e.g. 22:00 → 06:00).
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div><label className="label">Valid from</label><input type="date" className="input" value={login.dateFrom} onChange={(e) => setLogin({ ...login, dateFrom: e.target.value })} /></div>
              <div><label className="label">Valid to</label><input type="date" className="input" value={login.dateTo} onChange={(e) => setLogin({ ...login, dateTo: e.target.value })} /></div>
              <div><label className="label">Start time</label><input type="time" className="input" value={login.timeFrom} onChange={(e) => setLogin({ ...login, timeFrom: e.target.value })} /></div>
              <div><label className="label">End time</label><input type="time" className="input" value={login.timeTo} onChange={(e) => setLogin({ ...login, timeTo: e.target.value })} /></div>
            </div>
            {(login.timeFrom || login.timeTo || login.dateFrom || login.dateTo) && (
              <button type="button" onClick={() => setLogin({ dateFrom: "", dateTo: "", timeFrom: "", timeTo: "" })}
                className="text-xs text-brand hover:underline">Clear login restrictions</button>
            )}
          </div>}

          <div className="card space-y-2">
            <h2 className="font-semibold text-slate-700">Reset Password</h2>
            <div className="flex flex-wrap items-end gap-2">
              <div><label className="label">New password</label><input className="input" type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} placeholder="Min. 6 characters" /></div>
              <button type="button" onClick={resetPassword} className="btn-outline text-sm">Reset password</button>
              {pwMsg && <span className="text-sm text-slate-600">{pwMsg}</span>}
            </div>
          </div>
        </div>
      )}

      {tab === "Restrict" && (
        <div className="card space-y-3">
          <div>
            <h2 className="font-semibold text-slate-700">Restrict</h2>
            <p className="text-xs text-slate-400">
              The accounts, products, cost centres and tag areas this user may work with. Ticking a
              group covers everything under it. Anything not covered is invisible everywhere —
              pickers, voucher lines, ledgers and reports alike. Leave a list empty for no restriction.
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            {SCOPE_TABS.map((s) => (
              <button key={s.kind} type="button" onClick={() => setScopeTab(s.kind)}
                className={`rounded-full px-3 py-1 text-xs ${
                  scopeTab === s.kind ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                {s.title}
                {scopes[s.kind].length > 0 && <span className="ml-1.5">({scopes[s.kind].length})</span>}
              </button>
            ))}
          </div>
          {SCOPE_TABS.filter((s) => s.kind === scopeTab).map((s) => (
            <ScopeTree key={s.kind} title={s.title} rows={masters[s.kind]} emptyNote={s.note}
              value={scopes[s.kind]} onChange={(v) => setScopes({ ...scopes, [s.kind]: v })}
              exclude={exclude[s.kind]} onExclude={(v) => setExclude({ ...exclude, [s.kind]: v })} />
          ))}
        </div>
      )}

      {tab === "Access" && (
        <div className="card space-y-3">
          <div>
            <h2 className="font-semibold text-slate-700">Access</h2>
            <p className="text-xs text-slate-400">
              What this user may do on each voucher and report: open it, enter one, change one,
              delete one, print one.
            </p>
          </div>
          <DocRightsPicker value={rights} onChange={setRights} />
        </div>
      )}

      {tab === "Dashboard" && (
        <div className="card space-y-3">
          <div>
            <h2 className="font-semibold text-slate-700">Dashboard</h2>
            <p className="text-xs text-slate-400">
              Which cards this user sees on the dashboard. This is the one setting where an empty
              list grants nothing: only an administrator sees every card.
            </p>
          </div>
          <DashboardCardsPicker value={cards} onChange={setCards} />
        </div>
      )}

      {tab === "Modules" && (
        <div className="card space-y-3">
          <h2 className="font-semibold text-slate-700">Modules</h2>
          <p className="text-xs text-slate-400">Which modules appear in this user’s menu. Leave everything unchecked for full access; ticking any box switches this user to restricted access.</p>
          <StaffPermissionPicker value={perms} onChange={setPerms} />
        </div>
      )}

      <div className="flex gap-2">
        <button className="btn" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
        <button type="button" className="btn-outline" onClick={() => router.push("/settings/users")}>Back to users</button>
      </div>
    </form>
  );
}
