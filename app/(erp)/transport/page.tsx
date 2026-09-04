import { redirect } from "next/navigation";

// The Transport dashboard was removed — every card it carried is on the one
// dashboard now (see lib/dashboardCards.ts). The route stays so links,
// bookmarks and the restricted-user landing targets keep working.
export default function TransportDashboard() {
  redirect("/dashboard");
}
