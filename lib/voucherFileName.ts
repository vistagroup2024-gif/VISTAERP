// Build "TRP<last 3 digits of booking no> <Haji first name>" for the PDF file name.
// Plain (server-safe) helper — kept out of the "use client" SetDocTitle module so it
// can be called during server rendering without becoming a client-reference stub.
export function voucherFileName(bookingNo: string | null | undefined, passengerName: string | null | undefined) {
  const digits = (bookingNo ?? "").replace(/\D/g, "");
  const last3 = digits.slice(-3) || digits || "000";
  const first = (passengerName ?? "")
    .replace(/^\s*(mr|mrs|ms|miss|dr|mstr|master)\.?\s+/i, "")
    .trim().split(/\s+/)[0] || "Guest";
  return `TRP${last3} ${first}`;
}
