// Registry of grid-style "trade" vouchers (header + item lines). Each shares the
// one TradeVoucher editor and the trade_documents engine; only the config differs.
//
// Fields that exist on trade_documents get their own flag; everything added per
// voucher type or per cost centre rides in the document's `meta` jsonb (header)
// or the line's `meta` (columns), so no schema change is needed to add a field.
export type TradeParty = "supplier" | "customer" | null;

/** Extra numeric/text column appended to the item grid, stored in the line meta. */
export interface LineExtra {
  key: string;
  label: string;
  kind?: "money" | "text";   // money (default) right-aligns and totals; text does not
  cost?: boolean;            // counts toward the landed-cost figure under the grid
}

/** Extra header field, stored in the document meta. */
export interface HeaderExtra {
  key: string;
  label: string;
  kind: "money" | "text" | "date" | "int" | "percent" | "account" | "check";
  /** Derived from the other values — shown read-only unless the user overrides it. */
  derived?: (v: Record<string, string>) => number;
  hint?: string;
}

export interface TradeDocCfg {
  type: string;        // trade_documents.doc_type
  /**
   * The voucher this one is LOADED from — pick a pending upstream document and
   * its fields come across, leaving only what it cannot know to be typed.
   * Must match trade_doc_source_type() in the database, which is the authority.
   */
  loadsFrom?: { type: string; title: string };
  prefix: string;      // document-number prefix
  title: string;
  party: TradeParty;   // whose picker to show (b2b agents count as customers)
  showDue?: boolean;
  showDelivery?: boolean;
  showTerms?: boolean;
  showMode?: boolean;
  showTagArea?: boolean;      // header Tag Area picker (default true)
  tagAreaInLine?: boolean;    // Tag Area as the grid's first column instead
  showWarehouse?: boolean;    // warehouse picker on GL-posting vouchers
  hideRateAmount?: boolean;   // delivery note records what left, not what it cost
  qtyLabel?: string;
  headerExtras?: HeaderExtra[];     // always shown
  carHeaderExtras?: HeaderExtra[];  // shown only for a car-sales cost centre
  lineExtras?: LineExtra[];         // always shown
  carLineExtras?: LineExtra[];      // shown only for a car-sales cost centre
}

/** Cost centres that turn on the car-sales fields (Masters → Cost Center). */
export const CAR_COST_CENTERS = ["CAR SALES INSTALLMENT", "CAR TRADING"];
export const isCarCostCenter = (cc: string | null | undefined) =>
  CAR_COST_CENTERS.includes((cc ?? "").trim().toUpperCase());

const n = (v: Record<string, string>, k: string) => Number(v[k]) || 0;

// Car installment maths. Percentage is a MONTHLY rate, so the margin grows with
// the number of instalment months:
//   Total Cost    = Purchase Rate + Expenses
//   Investment    = Total Cost - Advance          (what Vista actually finances)
//   Margin Amount = Investment x Percentage% x Installment Months
//   Selling Price = Total Cost + Margin Amount
// Each derived box stays editable — typing in it overrides the formula.
const CAR_COSTING: HeaderExtra[] = [
  { key: "purchase_rate", label: "Purchase Rate", kind: "money" },
  { key: "expenses", label: "Expenses", kind: "money" },
  { key: "total_cost", label: "Total Cost", kind: "money", derived: (v) => n(v, "purchase_rate") + n(v, "expenses") },
  { key: "advance", label: "Advance", kind: "money" },
  { key: "investment", label: "Investment", kind: "money", derived: (v) => n(v, "total_cost") - n(v, "advance") },
  { key: "installment_months", label: "Installment Months", kind: "int" },
  { key: "percentage", label: "Percentage", kind: "percent", hint: "% per month" },
  { key: "margin_amount", label: "Margin Amount", kind: "money",
    derived: (v) => n(v, "investment") * (n(v, "percentage") / 100) * n(v, "installment_months") },
  { key: "selling_price", label: "Selling Price", kind: "money", derived: (v) => n(v, "total_cost") + n(v, "margin_amount") },
];

// Purchase Voucher cost columns shared by every cost centre.
const PV_COMMON_EXTRAS: LineExtra[] = [
  { key: "discount", label: "Discount" },
  { key: "freight", label: "Freight", cost: true },
  { key: "others", label: "Others", cost: true },
  { key: "commission", label: "Commission", cost: true },
  { key: "remarks", label: "Remarks", kind: "text" },
];

// Purchase Voucher cost columns for a car purchase — every expense that makes up
// the landed cost of the vehicle.
const PV_CAR_EXTRAS: LineExtra[] = [
  { key: "insurance", label: "Insurance", cost: true },
  { key: "registration", label: "Registration", cost: true },
  { key: "camera", label: "Camera", cost: true },
  { key: "transport", label: "Transport", cost: true },
  { key: "customs", label: "Customs", cost: true },
  { key: "car_inspection", label: "Car Inspection", cost: true },
  { key: "agent", label: "Agent", cost: true },
  { key: "others", label: "Others", cost: true },
  { key: "commission", label: "Commission", cost: true },
  { key: "remarks", label: "Remarks", kind: "text" },
];

export const TRADE_DOCS: Record<string, TradeDocCfg> = {
  purchase_order: {
    type: "purchase_order", prefix: "PO-", title: "Purchase Order", party: "supplier",
    loadsFrom: { type: "sale_order", title: "Sale Order" },
    showDue: true, showDelivery: true, showTerms: true, showMode: true, showTagArea: true,
    lineExtras: [{ key: "so_purchase_rate", label: "SO Purchase Rate" }, { key: "remarks", label: "Remarks", kind: "text" }],
  },
  purchase_voucher: {
    type: "purchase_voucher", prefix: "PV-", title: "Purchase Voucher", party: "supplier",
    loadsFrom: { type: "mrn", title: "Material Receipt Note" },
    showDue: true, showMode: true, showTagArea: false, tagAreaInLine: true, showWarehouse: false,
    headerExtras: [{ key: "purchase_account", label: "Purchase Account", kind: "account" }],
    lineExtras: PV_COMMON_EXTRAS, carLineExtras: PV_CAR_EXTRAS,
  },
  purchase_return: {
    type: "purchase_return", prefix: "PRN-", title: "Purchase Return", party: "supplier",
    showTagArea: true, showWarehouse: false,
    headerExtras: [
      { key: "purchase_account", label: "Purchase Account", kind: "account" },
      { key: "update_stock", label: "Update Stocks", kind: "check" },
      { key: "raise_receipt", label: "Raise Receipt", kind: "check" },
    ],
  },
  mrn: {
    type: "mrn", prefix: "MRN-", title: "Material Receipt Note", party: "supplier",
    loadsFrom: { type: "purchase_order", title: "Purchase Order" },
    showDelivery: true, showTagArea: true,
  },
  sales_quotation: {
    type: "sales_quotation", prefix: "SQ-", title: "Sales Quotation", party: "customer",
    showTerms: true, showTagArea: false,
    carHeaderExtras: [{ key: "item_name", label: "Item Name", kind: "text" }, ...CAR_COSTING],
  },
  sale_order: {
    type: "sale_order", prefix: "SO-", title: "Sale Order", party: "customer",
    loadsFrom: { type: "sales_quotation", title: "Sales Quotation" },
    showDelivery: true, showTerms: true, showMode: true, showTagArea: false,
    carHeaderExtras: [
      ...CAR_COSTING,
      { key: "advance_due_date", label: "Advance Due Date", kind: "date" },
      { key: "mega_installment", label: "Mega Installment", kind: "text" },
    ],
  },
  sales_return: {
    type: "sales_return", prefix: "SRN-", title: "Sales Return", party: "customer",
    showTagArea: true, showWarehouse: false,
    headerExtras: [
      { key: "sale_account", label: "Sale Account", kind: "account" },
      { key: "update_stock", label: "Update Stocks", kind: "check" },
    ],
  },
  sales_invoice: {
    type: "sales_invoice", prefix: "SI-", title: "Sales Invoice", party: "customer",
    loadsFrom: { type: "sale_order", title: "Sale Order" },
    showDue: true, showDelivery: true, showTerms: true, showMode: true, showTagArea: true,
    headerExtras: [
      { key: "sale_account", label: "Sale Account", kind: "account" },
      { key: "update_stock", label: "Update Stocks", kind: "check" },
    ],
    lineExtras: [{ key: "remarks", label: "Remarks", kind: "text" }],
  },
  delivery_note: {
    type: "delivery_note", prefix: "DN-", title: "Delivery Note", party: "customer",
    loadsFrom: { type: "sales_invoice", title: "Sales Invoice" },
    showDelivery: true, showTagArea: true, hideRateAmount: true,
  },
};
