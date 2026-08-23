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

// Build "TRP<last 3 digits of booking no> <Haji first name>".
export function voucherFileName(bookingNo: string | null | undefined, passengerName: string | null | undefined) {
  const digits = (bookingNo ?? "").replace(/\D/g, "");
  const last3 = digits.slice(-3) || digits || "000";
  const first = (passengerName ?? "")
    .replace(/^\s*(mr|mrs|ms|miss|dr|mstr|master)\.?\s+/i, "")
    .trim().split(/\s+/)[0] || "Guest";
  return `TRP${last3} ${first}`;
}
