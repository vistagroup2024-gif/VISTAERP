// ============================================================
// B2B Agent RBAC catalog. Flexible, additive framework: to add a new module or
// permission, add an entry here — no schema change (permissions are stored as a
// jsonb map {perm_key: true} on b2b_agents). Every permission is an individual
// checkbox in the admin User Management screen.
// ============================================================

export interface PermGroup { module: string; perms: { key: string; label: string }[] }

export const PERMISSION_CATALOG: PermGroup[] = [
  { module: "Dashboard", perms: [{ key: "dashboard.view", label: "View Dashboard" }] },
  { module: "Visa Module", perms: [
    { key: "visa.create", label: "Create Visa Groups" },
    { key: "visa.view_own", label: "View Own Visa Groups" },
    { key: "visa.edit_pending", label: "Edit Pending Groups" },
    { key: "visa.delete", label: "Delete Visa Groups" },
    { key: "visa.view_status", label: "View Visa Status" },
    { key: "visa.view_attachments", label: "View Attachments" },
    { key: "visa.upload_docs", label: "Upload Attachments" },
    { key: "visa.recommend", label: "Company Inquiry / Recommendation" },
    { key: "visa.reservations", label: "Reservations" },
    { key: "visa.hotel_details", label: "Hotel Details" },
    { key: "visa.long_stay", label: "Long Stay Visa" },
    { key: "visa.arrival_service", label: "Set Arrival Service (Transport/Tafweej)" },
  ] },
  { module: "BRN Module", perms: [
    { key: "brn.view_own", label: "View BRN Details" },
    { key: "brn.add_agent", label: "Edit Masar BRN (before Package Assigned)" },
  ] },
  { module: "Transportation", perms: [
    { key: "transport.request", label: "Create Booking" },
    { key: "transport.view", label: "View Bookings" },
    { key: "transport.modify_own", label: "Edit Booking" },
    { key: "transport.cancel", label: "Cancel Booking" },
    { key: "transport.schedule", label: "View Transport Schedule" },
    { key: "transport.voucher_view", label: "View Voucher" },
    { key: "transport.voucher_print", label: "Print Voucher" },
    { key: "transport.voucher_download", label: "Download Voucher" },
  ] },
  { module: "Hotels", perms: [
    { key: "hotel.search", label: "Search Hotels" },
    { key: "hotel.create", label: "Create Hotel Booking" },
    { key: "hotel.view_own", label: "View Own Hotel Bookings" },
  ] },
  { module: "Flights", perms: [
    { key: "flight.create", label: "Create Flight Booking" },
    { key: "flight.view", label: "View Flight Bookings" },
  ] },
  { module: "Reports", perms: [
    { key: "reports.view", label: "View Reports" },
    { key: "reports.download", label: "Download Reports" },
  ] },
  { module: "Financial", perms: [
    { key: "fin.wallet", label: "View Wallet Balance" },
    { key: "fin.statement", label: "View Statement" },
    { key: "fin.invoices", label: "View Invoices" },
    { key: "fin.payments", label: "Make Payments" },
    { key: "fin.credit", label: "Credit Limit Information" },
  ] },
  { module: "Package Updates", perms: [
    { key: "pkg.view_status", label: "View Package Status" },
    { key: "pkg.notifications", label: "Receive Update Notifications" },
  ] },
  { module: "Profile", perms: [
    { key: "profile.edit", label: "Edit Own Profile" },
    { key: "profile.password", label: "Change Password" },
  ] },
];

export const ALL_PERM_KEYS = PERMISSION_CATALOG.flatMap((g) => g.perms.map((p) => p.key));
