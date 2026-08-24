import { loadPartyAccounts, loadPickAccounts } from "@/lib/accounting";
import SettleEditor from "./SettleEditor";

export const dynamic = "force-dynamic";

export default async function SettlePage() {
  const [partyAccounts, { cashBank }] = await Promise.all([loadPartyAccounts(), loadPickAccounts()]);
  return <SettleEditor partyAccounts={partyAccounts as any} cashBank={cashBank} />;
}
