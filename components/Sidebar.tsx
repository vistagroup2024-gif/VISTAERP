"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import NotificationBell from "@/components/NotificationBell";
import Icon from "@/components/ui/Icon";
import { GROUPS, SECTIONS, DASHBOARD, VISTA_AI, navAllows, type NavItem as Item, type NavGroup as Group, type StaffNavAccess } from "@/lib/nav";

export type { StaffNavAccess };

// How well `href` matches the current path: exact hit or a "/"-boundary prefix
// hit returns the href length (longer = more specific); no match returns -1.
// The sidebar picks the single longest match so a parent route (e.g. /transport)
// never highlights alongside its child (/transport/operations).
function matchLen(path: string, href: string, exact?: boolean) {
  if (path === href) return href.length;
  if (!exact && path.startsWith(href + "/")) return href.length;
  return -1;
}

function NavLink({ href, label, icon, activeHref, onClick }: Item & { activeHref: string | null; onClick?: () => void }) {
  const active = activeHref === href;
  return (
    <Link href={href} onClick={onClick}
      className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
        active ? "bg-brand-50 font-semibold text-brand-700 shadow-[inset_3px_0_0_#e63c13]" : "font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      }`}>
      {icon
        ? <Icon name={icon} size={18} className={active ? "text-brand-600" : "text-slate-400"} />
        : <span className={`ml-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${active ? "bg-brand-orange" : "bg-slate-300"}`} />}
      <span className="truncate">{label}</span>
    </Link>
  );
}

// Accordion group: `open` and `onToggle` are controlled by the sidebar so only
// one group is expanded at a time. `hasActive` (a child on the current route)
// drives the parent highlight.
function CollapsibleGroup({ group, open, onToggle, onClose, activeHref }: { group: Group; open: boolean; onToggle: () => void; onClose?: () => void; activeHref: string | null }) {
  const hasActive = group.items.some((i) => i.href === activeHref);

  return (
    <div>
      <button onClick={onToggle}
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
          {group.items.map((i) => <NavLink key={i.href} {...i} activeHref={activeHref} onClick={onClose} />)}
        </div>
      )}
    </div>
  );
}

// A section is a second accordion level: the parent shows its modules, each of
// which is itself collapsible. Only one module inside a section is open at a
// time, matching the behaviour of the top-level groups.
function CollapsibleSection({ label, icon, groups, open, onToggle, openGroup, onToggleGroup, onClose, activeHref }: {
  label: string; icon: Group["icon"]; groups: Group[]; open: boolean; onToggle: () => void;
  openGroup: string | null; onToggleGroup: (l: string) => void; onClose?: () => void; activeHref: string | null;
}) {
  const hasActive = groups.some((g) => g.items.some((i) => i.href === activeHref));
  return (
    <div>
      <button onClick={onToggle}
        className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
          hasActive ? "text-brand-700" : "text-slate-700 hover:bg-slate-100"
        }`}>
        <Icon name={icon} size={18} className={hasActive ? "text-brand-600" : "text-slate-400"} />
        <span className="flex-1 truncate text-left">{label}</span>
        <Icon name="chevronRight" size={14}
          className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="ml-4 mt-0.5 space-y-0.5 border-l border-slate-200 pl-2">
          {groups.map((g) => (
            <CollapsibleGroup key={g.label} group={g} onClose={onClose} activeHref={activeHref}
              open={openGroup === g.label} onToggle={() => onToggleGroup(g.label)} />
          ))}
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

function SidebarContent({ access, onClose, onCollapse }: { access?: StaffNavAccess; onClose?: () => void; onCollapse?: () => void }) {
  const router = useRouter();
  const supabase = createClient();
  const path = usePathname();
  const groups = visibleGroups(access);
  // Resolve exactly ONE active link: the longest matching href across every nav
  // item, so a parent route never lights up together with its child.
  const allItems = [DASHBOARD, VISTA_AI, ...groups.flatMap((g) => g.items)];
  let activeHref: string | null = null; let best = -1;
  for (const it of allItems) {
    const l = matchLen(path, it.href, it.exact);
    if (l > best) { best = l; activeHref = it.href; }
  }
  // Accordion: open the group that owns the active link; re-open on navigation.
  const activeLabel = groups.find((g) => g.items.some((i) => i.href === activeHref))?.label ?? null;
  const [openGroup, setOpenGroup] = useState<string | null>(activeLabel);
  useEffect(() => { if (activeLabel) setOpenGroup(activeLabel); }, [activeLabel]);

  // Sections keep their place in the sidebar: a section sits where its first
  // module was declared, so the overall order of the nav is unchanged.
  const sectionOf = new Map(SECTIONS.map((x) => [x.label, x]));
  const rendered = new Set<string>();
  const entries: ({ kind: "group"; group: Group } | { kind: "section"; label: string; icon: Group["icon"]; groups: Group[] })[] = [];
  for (const g of groups) {
    const sec = g.section ? sectionOf.get(g.section) : undefined;
    if (!sec) { entries.push({ kind: "group", group: g }); continue; }
    if (rendered.has(sec.label)) continue;
    rendered.add(sec.label);
    entries.push({ kind: "section", label: sec.label, icon: sec.icon, groups: groups.filter((x) => x.section === sec.label) });
  }
  // Open the section that owns the active link.
  const activeSection = groups.find((g) => g.items.some((i) => i.href === activeHref))?.section ?? null;
  const [openSection, setOpenSection] = useState<string | null>(activeSection);
  useEffect(() => { if (activeSection) setOpenSection(activeSection); }, [activeSection]);

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
          {/* The signed-in user is named next to the search bar in the header;
              one place is enough, so this is just the company. */}
          <p className="text-base font-bold leading-tight text-slate-800">Vista Group</p>
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
          <NavLink {...DASHBOARD} activeHref={activeHref} onClick={onClose} />
        )}
        {navAllows(access, VISTA_AI.perm) && (
          <NavLink {...VISTA_AI} activeHref={activeHref} onClick={onClose} />
        )}
        {entries.map((e) =>
          e.kind === "group" ? (
            <CollapsibleGroup key={e.group.label} group={e.group} onClose={onClose} activeHref={activeHref}
              open={openGroup === e.group.label}
              onToggle={() => setOpenGroup((o) => (o === e.group.label ? null : e.group.label))} />
          ) : (
            <CollapsibleSection key={e.label} label={e.label} icon={e.icon} groups={e.groups}
              onClose={onClose} activeHref={activeHref}
              open={openSection === e.label}
              onToggle={() => setOpenSection((o) => (o === e.label ? null : e.label))}
              openGroup={openGroup}
              onToggleGroup={(l) => setOpenGroup((o) => (o === l ? null : l))} />
          )
        )}
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

export default function Sidebar({ access }: { name?: string; access?: StaffNavAccess }) {
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
          <SidebarContent access={access} onCollapse={toggleCollapsed} />
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
            <SidebarContent access={access} onClose={() => setOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
