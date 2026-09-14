// Every number series the ERP issues, with the name a person knows it by.
//
// The database keeps them in doc_sequences (prefix, digits, next number) and
// issues from there through next_doc_number(); this is only the catalogue that
// puts a voucher's name and its place in the list beside each series. A series
// the database has that is not listed here still shows, under its key, in
// "Other" — nothing is hidden by being unnamed.
//
// Two families. A DOCUMENT number is the one the voucher itself carries (the
// number typed to find it again, the one on the print). A LEDGER ENTRY number
// is what the journal entry behind a posting gets, and is what the Voucher
// Register and the ledger show. The trade vouchers have one of each; the
// accounting vouchers (Receipt, Payment, ...) are the entry, so they have only
// the second. Whether a trade voucher's entry carries the document's own
// number instead of its own series is a setting on the numbering screen.
export type SeriesKind = "document" | "ledger";

export interface SeriesDef {
  key: string;             // doc_sequences.doc_type
  label: string;
  kind: SeriesKind;
  defaultPrefix: string;
  defaultPadding: number;
  /** The ledger series that the entry behind this document is numbered from. */
  ledger?: string;
  note?: string;
}

export const DOC_SERIES: SeriesDef[] = [
  // ── documents ────────────────────────────────────────────────────────────
  { key: "trade_sales_quotation",   label: "Sales Quotation",       kind: "document", defaultPrefix: "SQ-",  defaultPadding: 5 },
  { key: "trade_sale_order",        label: "Sale Order",            kind: "document", defaultPrefix: "SO-",  defaultPadding: 5 },
  { key: "trade_sales_invoice",     label: "Sales Invoice",         kind: "document", defaultPrefix: "SI-",  defaultPadding: 5, ledger: "gl_trade_sales_invoice" },
  { key: "trade_delivery_note",     label: "Delivery Note",         kind: "document", defaultPrefix: "DN-",  defaultPadding: 5 },
  { key: "trade_sales_return",      label: "Sales Return",          kind: "document", defaultPrefix: "SRN-", defaultPadding: 5, ledger: "gl_trade_sales_return" },
  { key: "trade_purchase_order",    label: "Purchase Order",        kind: "document", defaultPrefix: "PO-",  defaultPadding: 5 },
  { key: "trade_mrn",               label: "Material Receipt Note", kind: "document", defaultPrefix: "MRN-", defaultPadding: 5 },
  { key: "trade_purchase_voucher",  label: "Purchase Voucher",      kind: "document", defaultPrefix: "PV-",  defaultPadding: 5, ledger: "gl_trade_purchase_voucher" },
  { key: "trade_purchase_return",   label: "Purchase Return",       kind: "document", defaultPrefix: "PRN-", defaultPadding: 5, ledger: "gl_trade_purchase_return" },
  { key: "trade_air_ticket_invoice",label: "Air Ticket Invoice",    kind: "document", defaultPrefix: "ATI-", defaultPadding: 5, ledger: "gl_trade_air_ticket_invoice" },
  { key: "trade_visa_invoice",      label: "Visa Invoice",          kind: "document", defaultPrefix: "VI-",  defaultPadding: 5, ledger: "gl_trade_visa_invoice" },
  { key: "trade_transport_invoice", label: "Transport Invoice",     kind: "document", defaultPrefix: "TI-",  defaultPadding: 5, ledger: "gl_trade_transport_invoice" },
  { key: "trade_hotel_invoice",     label: "Hotel Invoice",         kind: "document", defaultPrefix: "HI-",  defaultPadding: 5, ledger: "gl_trade_hotel_invoice" },
  { key: "car_contract",            label: "Car Invoice",           kind: "document", defaultPrefix: "CI-",  defaultPadding: 6, ledger: "journal" },
  { key: "car_receipt",             label: "Car Receipt",           kind: "document", defaultPrefix: "RCP-", defaultPadding: 6, ledger: "journal" },
  { key: "car_expense",             label: "Car Expense",           kind: "document", defaultPrefix: "CEX-", defaultPadding: 5, ledger: "journal" },
  { key: "car_scharge_month",       label: "Monthly Charges",       kind: "document", defaultPrefix: "MSC-", defaultPadding: 5 },
  { key: "bill",                    label: "Bill Record",           kind: "document", defaultPrefix: "BIL-", defaultPadding: 5 },
  { key: "stock_receipt",           label: "Stock Receipt",         kind: "document", defaultPrefix: "REC-", defaultPadding: 5, ledger: "gl_stock_in" },
  { key: "stock_issue",             label: "Stock Issue",           kind: "document", defaultPrefix: "ISS-", defaultPadding: 5, ledger: "gl_stock_out" },
  // ── ledger entries ───────────────────────────────────────────────────────
  { key: "gl_receipt",  label: "Receipt",    kind: "ledger", defaultPrefix: "RCT-", defaultPadding: 5 },
  { key: "gl_payment",  label: "Payment",    kind: "ledger", defaultPrefix: "PMT-", defaultPadding: 5 },
  { key: "gl_journal",  label: "Journal",    kind: "ledger", defaultPrefix: "JRN-", defaultPadding: 5 },
  { key: "gl_contra",   label: "Contra",     kind: "ledger", defaultPrefix: "CNT-", defaultPadding: 5 },
  { key: "gl_petty",    label: "Petty Cash", kind: "ledger", defaultPrefix: "Pty:", defaultPadding: 5 },
  { key: "gl_pdc",      label: "PDC",        kind: "ledger", defaultPrefix: "PDC-", defaultPadding: 5 },
  { key: "gl_payroll",  label: "Payroll",    kind: "ledger", defaultPrefix: "Pay:", defaultPadding: 5 },
  { key: "journal",     label: "System journals", kind: "ledger", defaultPrefix: "JOU-", defaultPadding: 5,
    note: "Postings the ERP raises by itself that carry no document of their own (a charge payment, a commission)" },
  { key: "gl_sales",    label: "Bill Record — invoice", kind: "ledger", defaultPrefix: "Inv:", defaultPadding: 1 },
  { key: "gl_purchase", label: "Bill Record — bill",    kind: "ledger", defaultPrefix: "Bil:", defaultPadding: 1 },
  { key: "gl_stock_in",  label: "Stock Receipt — entry", kind: "ledger", defaultPrefix: "StI:", defaultPadding: 5 },
  { key: "gl_stock_out", label: "Stock Issue — entry",   kind: "ledger", defaultPrefix: "StO:", defaultPadding: 5 },
  { key: "gl_trade_sales_invoice",      label: "Sales Invoice — entry",      kind: "ledger", defaultPrefix: "JSI-", defaultPadding: 5 },
  { key: "gl_trade_sales_return",       label: "Sales Return — entry",       kind: "ledger", defaultPrefix: "JSR-", defaultPadding: 5 },
  { key: "gl_trade_purchase_voucher",   label: "Purchase Voucher — entry",   kind: "ledger", defaultPrefix: "JPV-", defaultPadding: 5 },
  { key: "gl_trade_purchase_return",    label: "Purchase Return — entry",    kind: "ledger", defaultPrefix: "JPR-", defaultPadding: 5 },
  { key: "gl_trade_air_ticket_invoice", label: "Air Ticket Invoice — entry", kind: "ledger", defaultPrefix: "JAT-", defaultPadding: 5 },
  { key: "gl_trade_visa_invoice",       label: "Visa Invoice — entry",       kind: "ledger", defaultPrefix: "JVI-", defaultPadding: 5 },
  { key: "gl_trade_transport_invoice",  label: "Transport Invoice — entry",  kind: "ledger", defaultPrefix: "JTI-", defaultPadding: 5 },
  { key: "gl_trade_hotel_invoice",      label: "Hotel Invoice — entry",      kind: "ledger", defaultPrefix: "JHI-", defaultPadding: 5 },
  { key: "gl_commission_accrual",       label: "Commission accrual",         kind: "ledger", defaultPrefix: "Com:", defaultPadding: 5 },
  // ── legacy: the per-module posters replaced by migration 377 ─────────────
  { key: "gl_transport",  label: "Transport trip entry (old)", kind: "ledger",   defaultPrefix: "Trp:", defaultPadding: 5 },
  { key: "gl_visa_cost",  label: "Visa cost entry (old)",      kind: "ledger",   defaultPrefix: "Vsa:", defaultPadding: 5 },
  { key: "visa_invoice",  label: "Visa Invoice (old table)",   kind: "document", defaultPrefix: "VI-",  defaultPadding: 5 },
  { key: "billpay",       label: "Bill payment (old)",         kind: "document", defaultPrefix: "BIL-", defaultPadding: 5 },
  { key: "umrah_group",   label: "Umrah group (old)",          kind: "document", defaultPrefix: "VG-",  defaultPadding: 5 },
];

/** How a number reads with this prefix and padding. */
export function seriesPreview(prefix: string, padding: number, n: number): string {
  const s = String(Math.max(1, n));
  return `${prefix}${s.padStart(Math.max(padding, s.length), "0")}`;
}
