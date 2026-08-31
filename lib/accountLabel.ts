// Account codes are hidden throughout the ERP — an account is identified to the
// user by its name alone.
//
// Names are NOT unique: a party can exist on both sides of the ledger (the same
// person as a receivable and as a payable), and the legacy numeric chart overlaps
// the Vista one (e.g. "Bank Charges" is both 5-04 and 6200). Anywhere a typed
// label has to be resolved back to an account, dropping the code would make that
// lookup ambiguous and could post to the wrong account — so build labels with
// this helper, which qualifies a repeated name by its subtype/nature instead of
// bringing the code back.
export type LabelledAccount = {
  id: string; name: string;
  subtype?: string | null; type?: string | null; nature?: string | null;
};

/** Plain display label. Safe where the value carried is the account id. */
export const accountLabel = (a: { name: string }) => a.name;

/** id -> unique label, for pickers that resolve a typed label back to an account. */
export function accountLabelMap<T extends LabelledAccount>(accounts: T[]): Map<string, string> {
  const seen = new Map<string, number>();
  for (const a of accounts) seen.set(a.name, (seen.get(a.name) ?? 0) + 1);
  const taken = new Set<string>();
  const byId = new Map<string, string>();
  for (const a of accounts) {
    let label = a.name;
    if ((seen.get(a.name) ?? 0) > 1) {
      const q = a.subtype || a.type || a.nature;
      if (q) label = `${a.name} (${q})`;
    }
    // A qualifier can still collide; keep labels unique so the reverse lookup
    // always resolves to exactly one account.
    let unique = label;
    for (let i = 2; taken.has(unique); i++) unique = `${label} ${i}`;
    taken.add(unique);
    byId.set(a.id, unique);
  }
  return byId;
}
