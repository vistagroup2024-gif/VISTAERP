"use client";

import { createContext, useContext, useMemo } from "react";
import { docForPath, hasDocRight, type DocRight, type DocRightsMap } from "@/lib/docRights";

interface Access { isAdmin: boolean; docRights: DocRightsMap }

const Ctx = createContext<Access>({ isAdmin: false, docRights: {} });

// The signed-in user's screen rights, provided once by the ERP layout.
//
// The two shared voucher components take their rights as a prop from their
// server page. Everything else — a client screen several levels down that owns
// its own Save and Delete buttons — reads them from here instead, so a screen
// gates its buttons without every page in between having to pass them along.
export function AccessProvider({ value, children }: { value: Access; children: React.ReactNode }) {
  const v = useMemo(() => value, [value.isAdmin, JSON.stringify(value.docRights)]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}

/**
 * Rights for one screen. Returns a `may(right)` test plus the common ones
 * ready to drop straight onto a button's `disabled`.
 *
 *   const { may, canCreate, canDelete } = useDocRights("pdc");
 *   <button disabled={!canCreate}>Save</button>
 *
 * An unconfigured user (nothing ticked in the Access tab) and an admin get
 * everything, matching the convention the rest of the access model uses.
 */
export function useDocRights(doc: string) {
  const { isAdmin, docRights } = useContext(Ctx);
  const may = (right: DocRight) => hasDocRight(docRights, isAdmin, doc, right);
  return {
    may,
    canAccess: may("access"), canCreate: may("create"), canEdit: may("edit"),
    canDelete: may("delete"), canPrint: may("print"),
    // Why a button is off, ready for a title attribute.
    denied: (right: DocRight) => (may(right) ? undefined : `You don't have ${right.replace("_", " ")} rights on this screen`),
  };
}

/** Rights for the screen a route belongs to, when the caller only knows the path. */
export function useDocRightsForPath(path: string) {
  return useDocRights(docForPath(path) ?? "");
}
