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
  /** Sits to the LEFT of Rate instead of after Amount. A ceiling is read while
   *  the rate is being typed, so it has to be beside it, not past the total. */
  beforeRate?: boolean;
}

/** Extra header field, stored in the document meta. */
export interface HeaderExtra {
  key: string;
  label: string;
  kind: "money" | "text" | "date" | "int" | "percent" | "account" | "check" | "product";
  /** Derived from the other values — shown read-only unless the user overrides it. */
  derived?: (v: Record<string, string>) => number;
  /** A `check` field that starts ticked. Without this a new voucher saves it
   *  as false, which for "Update Stocks" means the goods never move. */
  defaultOn?: boolean;
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
  /** A second kind of document this voucher can be raised from, outside the
   *  trade-document chain. trade_doc_pending / trade_doc_load already return it;
   *  this is what lets the SCREEN say so. */
  alsoLoadsFrom?: { title: string };
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
  /**
   * Hide the item grid on a car cost centre. A car sale is one vehicle at one
   * price, and both are already in the costing block — the grid underneath was
   * the same two numbers typed a second time, with nothing checking that they
   * agreed. The document still gets its line: it is built on save from the
   * header's Item / Vehicle and the Selling Price, because the line is what
   * carries the vehicle forward to the Car Invoice.
   */
  hideLinesForCar?: boolean;
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
//   Investment    = Total Cost (COGS) - Advance   (what Vista actually finances)
//   Margin Amount = Investment x Percentage% x Installment Months
//   Selling Price = Total Cost (COGS) + Margin Amount
// Each derived box stays editable — typing in it overrides the formula.
//
// Purchase Rate and Expenses used to sit above Total Cost and add up to it. They
// were the same two numbers the Purchase Voucher already carries, retyped on the
// sales side where nothing checks them, and a Total Cost that disagreed with the
// purchase was invisible. What the quotation needs is the one figure the margin
// is calculated from, so that is what it asks for, under the name the accounts
// use for it.
const CAR_COSTING: HeaderExtra[] = [
  { key: "total_cost", label: "Total Cost (COGS)", kind: "money" },
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

// Purchase Voucher columns for a car purchase.
//
// There used to be nine expense columns here — insurance, registration, camera,
// transport, customs, car inspection, agent, others, commission. They are gone,
// and they are now the Car Expense voucher (migration 305), raised against the
// vehicle as each cost arrives. Two reasons. Most of them are not knowable on
// the day the car is bought: registration and insurance land weeks later, and a
// column you cannot fill is a column left at zero. And they never reached the
// vehicle's cost anyway — car_vehicle_from_trade_doc splits the voucher TOTAL
// across the cars it creates, and the total is the supplier's billed amount, so
// the nine only ever moved the "landed cost" figure under the grid.
//
// Discount stays, because that one IS on the supplier's bill.
const PV_CAR_EXTRAS: LineExtra[] = [
  { key: "discount", label: "Discount" },
  { key: "remarks", label: "Remarks", kind: "text" },
];

export const TRADE_DOCS: Record<string, TradeDocCfg> = {
  purchase_order: {
    type: "purchase_order", prefix: "PO-", title: "Purchase Order", party: "supplier",
    loadsFrom: { type: "sale_order", title: "Sale Order" },
    showDue: true, showDelivery: true, showTerms: true, showMode: true, showTagArea: true,
    lineExtras: [
      // Before Rate: it is the ceiling the rate is checked against, so it reads
      // left-to-right as "allowed, then actual".
      { key: "so_purchase_rate", label: "SO Purchase Rate", beforeRate: true },
      { key: "remarks", label: "Remarks", kind: "text" },
    ],
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
      { key: "update_stock", label: "Update Stocks", kind: "check", defaultOn: true },
      { key: "raise_receipt", label: "Raise Receipt", kind: "check" },
    ],
  },
  mrn: {
    type: "mrn", prefix: "MRN-", title: "Material Receipt Note", party: "supplier",
    loadsFrom: { type: "purchase_order", title: "Purchase Order" },
    // No Tag Area: an MRN records that goods arrived. The tagging that matters
    // is done on the Purchase Voucher, which is the one that posts.
    showDelivery: true, showTagArea: false,
  },
  sales_quotation: {
    type: "sales_quotation", prefix: "SQ-", title: "Sales Quotation", party: "customer",
    showTerms: true, showTagArea: false, hideLinesForCar: true,
    // Item / Vehicle picks from the Product Tree rather than being typed: the
    // Car Invoice finds the car in the yard by this product, and free text
    // cannot be matched against anything.
    carHeaderExtras: [{ key: "item_id", label: "Item / Vehicle", kind: "product" }, ...CAR_COSTING],
  },
  sale_order: {
    type: "sale_order", prefix: "SO-", title: "Sale Order", party: "customer",
    loadsFrom: { type: "sales_quotation", title: "Sales Quotation" },
    showDelivery: true, showTerms: true, showMode: true, showTagArea: false, hideLinesForCar: true,
    carHeaderExtras: [
      { key: "item_id", label: "Item / Vehicle", kind: "product" },
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
      { key: "update_stock", label: "Update Stocks", kind: "check", defaultOn: true },
    ],
  },
  sales_invoice: {
    type: "sales_invoice", prefix: "SI-", title: "Sales Invoice", party: "customer",
    loadsFrom: { type: "sale_order", title: "Sale Order" },
    showDue: true, showDelivery: true, showTerms: true, showMode: true, showTagArea: true,
    // No "Update Stocks" choice: a Sales Invoice is what takes the goods off
    // the shelf, so it always does. See trade_doc_post.
    headerExtras: [{ key: "sale_account", label: "Sale Account", kind: "account" }],
    lineExtras: [{ key: "remarks", label: "Remarks", kind: "text" }],
  },
  delivery_note: {
    type: "delivery_note", prefix: "DN-", title: "Delivery Note", party: "customer",
    loadsFrom: { type: "sales_invoice", title: "Sales Invoice" },
    // A car is delivered against its Car Invoice, which lives in Car Sales
    // rather than in the trade-document chain.
    alsoLoadsFrom: { title: "Car Invoice" },
    showDelivery: true, showTagArea: true, hideRateAmount: true,
  },
};
