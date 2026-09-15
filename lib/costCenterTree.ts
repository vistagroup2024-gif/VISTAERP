// Cascading filters (2/2) — a Product Tree item or an account with no cost
// centre of its own belongs to its nearest tagged ANCESTOR GROUP's, walking
// up parent_id. Resolved here, once, from a tree already loaded client-side
// (ProductPicker/AccountPicker already work from an in-memory list) rather
// than a round trip to the database per pick.

export type CCTreeNode = { id: string; parent_id: string | null; cost_center_id?: string | null };

/** Every node's own cost centre, or its nearest tagged ancestor's — id → id,
 *  null where nothing in the chain (including the node itself) is tagged. */
export function resolveCostCenters<T extends CCTreeNode>(nodes: T[]): Map<string, string | null> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const cache = new Map<string, string | null>();

  function resolve(id: string, seen: Set<string>): string | null {
    if (cache.has(id)) return cache.get(id)!;
    if (seen.has(id)) return null; // a cycle — the tree should never have one, but never hang on it
    seen.add(id);
    const n = byId.get(id);
    const own = n?.cost_center_id ?? null;
    const result = own ?? (n?.parent_id ? resolve(n.parent_id, seen) : null);
    cache.set(id, result);
    return result;
  }

  for (const n of nodes) resolve(n.id, new Set());
  return cache;
}
