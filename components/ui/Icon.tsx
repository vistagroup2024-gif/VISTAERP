import type { SVGProps } from "react";

// Lightweight inline line-icon set (Lucide-style, 24×24, 1.75 stroke). No
// runtime dependency — paths are embedded so the whole app shares one
// consistent, professional icon language in place of emoji.
export type IconName =
  | "dashboard" | "visa" | "inventory" | "sales" | "hotel" | "transport"
  | "car" | "purchase" | "masters" | "accounting" | "store" | "payroll"
  | "users" | "settings" | "bell" | "search" | "chevronRight" | "chevronDown"
  | "menu" | "close" | "logout" | "plus" | "collapse" | "expand" | "external"
  | "trendUp" | "trendDown" | "wallet" | "receipt" | "clock" | "check";

const P: Record<IconName, string> = {
  dashboard: "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z",
  visa: "M4 4h16v16H4zM4 9h16M8 14h4M8 17h6",
  inventory: "M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10",
  sales: "M6 2l1.5 2h9L18 2M5 4h14l-1 16H6zM9 9h6M9 13h6",
  hotel: "M3 21V5a1 1 0 011-1h9a1 1 0 011 1v16M14 21V9h6a1 1 0 011 1v11M7 8h3M7 12h3M18 13h.01M18 17h.01M3 21h18",
  transport: "M3 6h13v10H3zM16 9h3l2 3v4h-5zM6 19a2 2 0 104 0M15 19a2 2 0 104 0M3 16h13",
  car: "M5 11l1.5-4.5A2 2 0 018.4 5h7.2a2 2 0 011.9 1.5L19 11M5 11h14v5H5zM5 16v2M19 16v2M7.5 13.5h.01M16.5 13.5h.01",
  purchase: "M3 3h2l2.4 12.3a1 1 0 001 .7h9.2a1 1 0 001-.8L21 7H6M9 21a1 1 0 100-2 1 1 0 000 2M18 21a1 1 0 100-2 1 1 0 000 2",
  masters: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z",
  accounting: "M4 5a2 2 0 012-2h13v18H6a2 2 0 01-2-2zM8 3v18M12 8h5M12 12h5",
  store: "M4 9h16l-1-5H5zM4 9v10a1 1 0 001 1h14a1 1 0 001-1V9M9 20v-6h6v6",
  payroll: "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M22 21v-2a4 4 0 00-3-3.87M16 3.13A4 4 0 0116 11",
  users: "M17 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-2.9 1.31 2 2 0 01-4 0 1.65 1.65 0 00-2.9-1.31l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a2 2 0 010-4 1.65 1.65 0 001.51-2.44l-.06-.06A2 2 0 118.88 5.67l.06.06A1.65 1.65 0 0012 5.4a2 2 0 014 0 1.65 1.65 0 002.9 1.31l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 11a2 2 0 010 4z",
  bell: "M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0",
  search: "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3",
  chevronRight: "M9 18l6-6-6-6",
  chevronDown: "M6 9l6 6 6-6",
  menu: "M3 6h18M3 12h18M3 18h18",
  close: "M18 6L6 18M6 6l12 12",
  logout: "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9",
  plus: "M12 5v14M5 12h14",
  collapse: "M11 17l-5-5 5-5M18 17l-5-5 5-5",
  expand: "M13 17l5-5-5-5M6 17l5-5-5-5",
  external: "M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3",
  trendUp: "M3 17l6-6 4 4 8-8M21 7v6M21 7h-6",
  trendDown: "M3 7l6 6 4-4 8 8M21 17v-6M21 17h-6",
  wallet: "M19 7H5a2 2 0 00-2 2v8a2 2 0 002 2h14a2 2 0 002-2v-8a2 2 0 00-2-2zM3 9V7a2 2 0 012-2h11M17 13h.01",
  receipt: "M5 3v18l2-1 2 1 2-1 2 1 2-1 2 1V3l-2 1-2-1-2 1-2-1-2 1zM9 8h6M9 12h6",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2",
  check: "M20 6L9 17l-5-5",
};

export default function Icon({
  name, size = 18, className, ...rest
}: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size} fill="none"
      stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden="true" {...rest}
    >
      <path d={P[name]} />
    </svg>
  );
}
