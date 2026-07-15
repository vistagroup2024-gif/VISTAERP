"use client";

import { useEffect } from "react";

// Warns the user (browser dialog) before leaving/refreshing/closing the tab
// while a form has unsaved changes. Manual Save commits the data; this only
// guards accidental loss. Pass `dirty` = true when the form has edits.
export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}

// Confirm helper for in-app "Cancel/Back" buttons on dirty forms.
export function confirmDiscardIfDirty(dirty: boolean): boolean {
  if (!dirty) return true;
  return window.confirm("You have unsaved changes. Discard them and leave this page?");
}
