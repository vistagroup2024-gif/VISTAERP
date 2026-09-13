// Who sees the trip alerts: the users who run operations, because they are the
// ones who can fix a trip sitting in the wrong status.
//
// This lives in a plain module on purpose. It was first exported from the
// client component that draws the banner, and a server component (the
// dashboard page) imported it from there — Next.js hands a server component a
// client REFERENCE for anything a "use client" file exports, so calling
// .some() on it threw "Attempted to call some() from the server but some is on
// the client", and every user opening the dashboard got "Application error".
// A constant a server component reads must come from a file with no directive.
export const TRIP_ALERT_PERMS = ["transport.operations", "transport.driver_assign"];
