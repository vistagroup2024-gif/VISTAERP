"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import TreePickList, { type TreeNode } from "./TreePickList";

/** The tag-area tree as a filter (vehicles, hotel/visa tag groups, …). Like
 *  CostCenterPickTree, resolving checked ids to names for a transaction-level
 *  filter is ReportRunner's job, not this component's — journal_lines.tag_area
 *  is TEXT, not this id. */
export default function TagAreaPickTree({ checked, onChange }: {
  checked: Set<string>; onChange: (next: Set<string>) => void;
}) {
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  useEffect(() => {
    const supabase = createClient();
    fetchAllRows<TreeNode>((from, to) => supabase.from("acct_tag_areas")
      .select("id, parent_id, name, is_group").eq("is_active", true).order("id").range(from, to))
      .then(({ data }) => setNodes(data));
  }, []);
  return <TreePickList nodes={nodes} checked={checked} onChange={onChange} searchPlaceholder="Search tag areas…" />;
}
