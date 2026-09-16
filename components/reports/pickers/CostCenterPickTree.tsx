"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import TreePickList, { type TreeNode } from "./TreePickList";

/** The cost-centre tree as a filter — same table Masters → Cost Center edits,
 *  RLS-scoped to the caller's own company/restrictions like every other read
 *  of it. Reports that filter transaction-level rows (journal_lines.cost_center
 *  is a plain TEXT column, not this id) resolve the checked ids back to names
 *  themselves before calling their RPC — see ReportRunner. */
export default function CostCenterPickTree({ checked, onChange }: {
  checked: Set<string>; onChange: (next: Set<string>) => void;
}) {
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  useEffect(() => {
    const supabase = createClient();
    fetchAllRows<TreeNode>((from, to) => supabase.from("acct_cost_centers")
      .select("id, parent_id, name, is_group").eq("is_active", true).order("id").range(from, to))
      .then(({ data }) => setNodes(data));
  }, []);
  return <TreePickList nodes={nodes} checked={checked} onChange={onChange} searchPlaceholder="Search cost centres…" />;
}
