"use client";

import { useEffect } from "react";

// Sets document.title so "Save as PDF" defaults the file name. Restores the prior
// title on unmount so navigation elsewhere isn't affected.
export default function SetDocTitle({ title }: { title: string }) {
  useEffect(() => {
    const prev = document.title;
    document.title = title;
    return () => { document.title = prev; };
  }, [title]);
  return null;
}
