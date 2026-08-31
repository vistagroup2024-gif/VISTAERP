"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import NotificationBell from "@/components/NotificationBell";
import Icon from "@/components/ui/Icon";
import { GROUPS, DASHBOARD, type NavItem as Item, type NavGroup as Group, type StaffNavAccess } from "@/lib/nav";

export type { StaffNavAccess };

function isActive(path: string, href: string, exact?: boolean) {
  if (exact) return path === href;
  return path === href || path.startsWith(href + "/");
}

function NavLink({ href, label, icon, exact, onClick }: Item & { onClick?: () => void }) {
  const path = usePathname();
  const active = isActive(path, href, exact);
  return (
    <Link href={href} onClick={onClick}
      className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
        active ? "bg-brand-50 font-semibold text-brand-700" : "font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      }`}>
      {icon
        ? <Icon name={icon} size={18} className={active ? "text-brand-600" : "text-slate-400"} />
        : <span className={`ml-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${active ? "bg-brand-600" : "bg-slate-300"}`} />}
      <span className="truncate">{label}</span>
    </Link>
  );
}

function CollapsibleGroup({ group, onClose }: { group: Group; onClose?: () => void }) {
  const path = usePathname();
  // A child on the current route decides both the initial expand and the parent
  // highlight. `hasActive` is deterministic on server + client (usePathname),
  // so there is no hydration mismatch; sessionStorage is applied after mount.
  const hasActive = group.items.some((i) => isActive(path, i.href, i.exact));
  const [open, setOpen] = useState(hasActive);

  useEffect(() => {
    const stored = sessionStorage.getItem("nav:" + group.label);
    if (stored !== null) setOpen(stored === "1");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-expand when navigating into this group.
  useEffect(() => { if (hasActive) setOpen(true); }, [hasActive]);

  function toggle() {
    setOpen((o) => {
      const n = !o;
      try { sessionStorage.setItem("nav:" + group.label, n ? "1" : "0"); } catch {}
      return n;
    });
  }

  return (
    <div>
      <button onClick={toggle}
        className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
          hasActive ? "text-brand-700" : "text-slate-700 hover:bg-slate-100"
        }`}>
        <Icon name={group.icon} size={18} className={hasActive ? "text-brand-600" : "text-slate-400"} />
        <span className="flex-1 truncate text-left">{group.label}</span>
        <Icon name="chevronRight" size={14}
          className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="ml-4 mt-0.5 space-y-0.5 border-l border-slate-200 pl-2">
          {group.items.map((i) => <NavLink key={i.href} {...i} onClick={onClose} />)}
        </div>
      )}
    </div>
  );
}

function visibleGroups(access?: StaffNavAccess) {
  if (!access || access.unrestricted) return GROUPS;
  return GROUPS
    // Hide links the user has no permission for, then drop now-empty groups.
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.perm || i.perm.some((k) => access.permissions[k])) }))
    .filter((g) => (!g.perm || g.perm.some((k) => access.permissions[k])) && g.items.length > 0);
}

function SidebarContent({ name, access, onClose, onCollapse }: { name: string; access?: StaffNavAccess; onClose?: () => void; onCollapse?: () => void }) {
  const router = useRouter();
  const supabase = createClient();

  async function signOut() {
    // Local scope: end only THIS device's session, leaving the user's other
    // devices signed in. (Default scope is "global" and revokes every session.)
    await supabase.auth.signOut({ scope: "local" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Image src="/icon.svg" alt="Vista Group" width={34} height={34} className="shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-bold leading-tight text-slate-800">Vista Group</p>
            <p className="truncate text-xs leading-tight text-slate-400">{name}</p>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <NotificationBell endpoint="/api/notifications" groupBase="/groups" realtime />
          {onCollapse && (
            <button onClick={onCollapse} title="Collapse sidebar" aria-label="Collapse sidebar"
              className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600">
              <Icon name="collapse" size={16} />
            </button>
          )}
          {onClose && (
            <button onClick={onClose} aria-label="Close menu"
              className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600">
              <Icon name="close" size={18} />
            </button>
          )}
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
        {(!access || access.unrestricted || access.permissions["dashboard.view"]) && (
          <NavLink {...DASHBOARD} onClick={onClose} />
        )}
        {visibleGroups(access).map((g) => <CollapsibleGroup key={g.label} group={g} onClose={onClose} />)}
      </nav>
      <div className="border-t border-slate-200 p-3">
        <button onClick={signOut}
          className="btn-outline w-full">
          <Icon name="logout" size={16} /> Sign out
        </button>
      </div>
    </div>
  );
}

export default function Sidebar({ name, access }: { name: string; access?: StaffNavAccess }) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem("sidebar:collapsed") === "1"); } catch {}
  }, []);
  function toggleCollapsed() {
    setCollapsed((c) => { const n = !c; try { localStorage.setItem("sidebar:collapsed", n ? "1" : "0"); } catch {} return n; });
  }

  return (
    <>
      {/* Desktop sidebar — sticky full-height so its nav scrolls independently */}
      {collapsed ? (
        <div className="no-print sticky top-0 hidden h-screen w-12 shrink-0 flex-col items-center border-r border-slate-200 bg-white py-3 lg:flex">
          <button onClick={toggleCollapsed} title="Expand sidebar" aria-label="Expand sidebar"
            className="rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700">
            <Icon name="expand" size={18} />
          </button>
        </div>
      ) : (
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
          <SidebarContent name={name} access={access} onCollapse={toggleCollapsed} />
        </aside>
      )}

      {/* Mobile top bar */}
      <div className="no-print fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 lg:hidden">
        <div className="flex items-center gap-2">
          <Image src="/icon.svg" alt="Vista Group" width={30} height={30} />
          <p className="text-base font-bold text-slate-800">Vista Group</p>
        </div>
        <div className="flex items-center gap-1">
          <NotificationBell endpoint="/api/notifications" groupBase="/groups" realtime />
          <button onClick={() => setOpen(true)} className="rounded-md p-2 text-slate-600 transition-colors hover:bg-slate-100" aria-label="Open menu">
            <Icon name="menu" size={22} />
          </button>
        </div>
      </div>

      {/* Mobile drawer overlay */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-72 bg-white shadow-xl">
            <SidebarContent name={name} access={access} onClose={() => setOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
