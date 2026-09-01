// ============================================================
// Unified RBAC — Internal Staff permission catalog. Same shape as the B2B agent
// catalog (lib/permissions.ts): a flat set of {key,label} grouped by module,
// stored as a jsonb map {perm_key: true} on profiles.permissions. Add a module
// or permission here — no schema change.
// ============================================================

export interface StaffPermGroup { module: string; perms: { key: string; label: string }[] }

export const STAFF_PERMISSION_CATALOG: StaffPermGroup[] = [
  { module: "Dashboard", perms: [
    { key: "dashboard.view", label: "View Dashboard" },
  ] },
  { module: "Visa", perms: [
    { key: "visa.view", label: "View Visa Groups" },
    { key: "visa.create", label: "Create Visa Groups" },
    { key: "visa.edit", label: "Edit Visa Groups" },
    { key: "visa.delete", label: "Delete Visa Groups" },
    { key: "visa.allocate_brn", label: "Allocate BRNs" },
    { key: "visa.erp_create", label: "ERP Creation" },
    { key: "visa.package_update", label: "Package Updates" },
    { key: "visa.mark_issued", label: "Mark Visa Issued" },
    { key: "visa.invoices", label: "Visa Invoices (accounting ledger)" },
  ] },
  { module: "BRN Inventory", perms: [
    { key: "brn.view", label: "View Inventory" },
    { key: "brn.add", label: "Add BRNs" },
    { key: "brn.edit", label: "Edit BRNs" },
    { key: "brn.delete", label: "Delete BRNs" },
    { key: "brn.planning", label: "Purchase Planning" },
  ] },
  { module: "Transport", perms: [
    { key: "transport.masters", label: "Masters" },
    { key: "transport.bookings", label: "Bookings" },
    { key: "transport.operations", label: "Operations" },
    { key: "transport.driver_assign", label: "Driver Assignment" },
    { key: "transport.vehicles", label: "Vehicle Management" },
    { key: "transport.reports", label: "Reports" },
    { key: "transport.trip_ledger", label: "Trip Ledger Report (supplier/fare)" },
  ] },
  { module: "Hotels", perms: [
    { key: "hotels.masters", label: "Masters (Hotels / Rooms / Rates)" },
    { key: "hotels.bookings", label: "Bookings (view/create/edit)" },
    { key: "hotels.cancel", label: "Cancel Bookings" },
    { key: "hotels.suppliers", label: "Suppliers" },
    { key: "hotels.purchase", label: "View Purchase / Vendor Booking" },
    { key: "hotels.purchase_rate", label: "View Purchase Rate" },
    { key: "hotels.profit", label: "View Profit / Margin" },
    { key: "hotels.hcn", label: "Manage HCN (capture / share)" },
    { key: "hotels.voucher", label: "Download / Print Voucher" },
    { key: "hotels.payable", label: "Post Supplier Payable" },
    { key: "hotels.reports", label: "Reports & Dashboard" },
  ] },
  { module: "Sales & Accounting", perms: [
    { key: "parties.manage", label: "Customers / Suppliers (add & edit only)" },
    { key: "sales.view", label: "Sales Orders & Invoices" },
    { key: "accounting.view", label: "Accounting" },
    { key: "accounting.authorize", label: "Authorise / Approve Vouchers" },
    { key: "purchase.view", label: "Supplier Bills & Payments" },
  ] },
  { module: "Reports", perms: [
    { key: "reports.view", label: "View Reports" },
    { key: "reports.export", label: "Export Reports" },
  ] },
  { module: "Car Sales", perms: [
    { key: "carsales.view", label: "View Car Sales" },
    { key: "carsales.vehicles", label: "Manage Vehicles / Stock" },
    { key: "carsales.purchase", label: "Purchase Orders / Vouchers" },
    { key: "carsales.sales", label: "Quotations & Sale Orders" },
    { key: "carsales.installments", label: "Installment Contracts & Schedules" },
    { key: "carsales.receipts", label: "Receipts & Allocation" },
    { key: "carsales.charges", label: "Monthly Service Charges" },
    { key: "carsales.ownership", label: "Delivery / Holding / Transfer" },
    { key: "carsales.cost", label: "View Cost & Profit" },
    { key: "carsales.accounting", label: "Post to Accounting" },
    { key: "carsales.reports", label: "Reports & Dashboard" },
    { key: "carsales.manage", label: "Approvals & Price/Schedule Changes" },
  ] },
  { module: "Vista AI", perms: [
    { key: "ai.use", label: "Use Vista AI (ask questions, read own modules)" },
    { key: "ai.actions", label: "Allow Vista AI to perform actions (still confirmed, still per-module)" },
    { key: "ai.dev", label: "Commission ERP development tasks" },
  ] },
  { module: "User Management", perms: [
    { key: "users.view", label: "View Users" },
    { key: "users.create", label: "Create Users" },
    { key: "users.edit", label: "Edit Users" },
    { key: "users.delete", label: "Delete Users" },
    { key: "users.reset_password", label: "Reset Passwords" },
    { key: "users.manage_roles", label: "Manage Roles & Permissions" },
  ] },
  { module: "System Settings", perms: [
    { key: "system.companies", label: "Companies" },
    { key: "system.masters", label: "Masters" },
    { key: "system.notifications", label: "Notifications" },
    { key: "system.config", label: "Configuration" },
    { key: "system.audit", label: "Audit Logs" },
  ] },
];

export const ALL_STAFF_PERM_KEYS = STAFF_PERMISSION_CATALOG.flatMap((g) => g.perms.map((p) => p.key));
