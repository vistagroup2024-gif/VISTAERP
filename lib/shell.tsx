"use client";

import { createContext, useContext } from "react";
import { useRouter, usePathname } from "next/navigation";

/**
 * What the chrome (Sidebar, the header, anything else drawn once around
 * every tab) needs from the tab shell: which screen counts as "current" for
 * highlighting, and the one door every nav click goes through instead of a
 * normal navigation — opening a screen as a tab beside whatever else is
 * open, rather than replacing it.
 */
export type ShellNav = {
  /** The active tab's own URL — not the browser's real pathname, which does
   *  not change as tabs are switched (switching a tab never re-navigates
   *  this page). */
  activePath: string;
  /** Opens a screen: switches to it if it is already an open tab, otherwise
   *  opens a new one beside the others and switches to that. */
  openTab: (href: string) => void;
};

const Ctx = createContext<ShellNav | null>(null);

export function ShellNavProvider({ value, children }: { value: ShellNav; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Falls back to a normal client-side navigation when there is no tab shell
 *  around this component. That is not a hypothetical: NotificationBell is
 *  shared with the agent portal, which has no shell at all, and it must
 *  keep routing the way it always did there — a soft push, not a hard
 *  reload — rather than assuming every caller lives inside the staff ERP. */
export function useShellNav(): ShellNav {
  const ctx = useContext(Ctx);
  const router = useRouter();
  const pathname = usePathname();
  if (ctx) return ctx;
  return { activePath: pathname, openTab: (href: string) => router.push(href) };
}
