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
  kind?: "money" | "text" | "date";  // money (default) right-aligns and totals; text and date do not
  cost?: boolean;            // counts toward the landed-cost figure under the grid
  /** Sits to the LEFT of Rate instead of after Amount. A ceiling is read while
   *  the rate is being typed, so it has to be beside it, not past the total. */
  beforeRate?: boolean;
  /** Worked out from the row rather than typed — Supplier Amount is Quantity x
   *  Supplier Rate, and a column the operator has to multiply by hand is a
   *  column that will eventually disagree with the two numbers beside it. Shown
   *  read-only and stored as the computed figure. */
  derived?: (ctx: { qty: number; rate: number; amount: number; extras: Record<string, string> }) => number;
}

/** Extra header field, stored in the document meta. */
export interface HeaderExtra {
  key: string;
  label: string;
  kind: "money" | "text" | "date" | "int" | "percent" | "account" | "check" | "product" | "party";
  /** For kind "party": which side of the master to offer. A document with BOTH
   *  a customer and a supplier — an air ticket bought from a consolidator and
   *  sold on — cannot express its second party through the one party_id column,
   *  so it rides in the meta and picks from here. */
  partyType?: "supplier" | "customer";
  /** Derived from the other values — shown read-only unless the user overrides it. */
  derived?: (v: Record<string, string>) => number;
  /** A `check` field that starts ticked. Without this a new voucher saves it
   *  as false, which for "Update Stocks" means the goods never move. */
  defaultOn?: boolean;
  /** What a NEW voucher starts this field at. The user can type over it — it is
   *  a starting point, not a lock. Percentage is 3 because that is the rate the
   *  business actually quotes; leaving it blank meant it was retyped every time
   *  and occasionally forgotten. */
  defaultValue?: string;
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
  /** What this voucher is loaded from ON A CAR COST CENTRE, when that differs.
   *  A car has no warehouse to be received into, so its Purchase Voucher comes
   *  straight from the Purchase Order. The database decides this in
   *  trade_doc_source_type_for(); this is only so the button says the right
   *  word — a Load button offering "Material Receipt Note" on a car voucher
   *  would be naming a document the picker is not going to show. */
  carLoadsFrom?: { type: string; title: string };
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
  /** No Round Off box. A purchase document is the supplier's bill and is worth
   *  what the bill says — rounding it is how the ledger and the bill stop
   *  agreeing. Sales documents keep it. */
  hideRoundOff?: boolean;
  /** An instalment schedule on a car document: when each payment falls due and
   *  for how much. Agreed at the ORDER, so the Car Invoice raised from it starts
   *  with the schedule the customer actually signed up to rather than one
   *  regenerated from round numbers weeks later. Stored in the document meta. */
  carSchedule?: boolean;
  /** Shows the Delivered tick once the document is saved. A Delivery Note says
   *  the goods LEFT; this is what says they ARRIVED, and it is what the Monthly
   *  Service Charge is billed from. */
  showDelivered?: boolean;
  /** A whole-document Discount box under the grid. Net Total = Subtotal - Discount
   *  + Round Off, and that net is what the document posts. */
  showDiscount?: boolean;
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
  /** What the Amount column is called. An air ticket invoice calls it Gross,
   *  because the figure the passenger is billed is gross of what it cost. */
  amountLabel?: string;
  /** Currency name and conversion rate in the header. The grid is typed in the
   *  document's own currency; the LEDGER is posted in the company's, at the rate
   *  on the document. Left at 1 (or blank) nothing is converted, which is what
   *  every SAR document wants. */
  showCurrency?: boolean;
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
  { key: "percentage", label: "Percentage", kind: "percent", hint: "% per month", defaultValue: "3" },
  { key: "margin_amount", label: "Margin Amount", kind: "money",
    derived: (v) => n(v, "investment") * (n(v, "percentage") / 100) * n(v, "installment_months") },
  { key: "selling_price", label: "Selling Price", kind: "money", derived: (v) => n(v, "total_cost") + n(v, "margin_amount") },
  // MEGA INSTALLMENTS. A car deal often carries one or two large lump payments
  // partway through, on top of the monthly figure. Say how many and that many
  // amount boxes appear — TradeVoucher expands this key into mega_1..mega_N,
  // because the number of them is not knowable when this list is written.
  { key: "mega_qty", label: "Mega Installment Quantity", kind: "int" },
  // What the customer pays EACH MONTH: what is left after the advance and the
  // mega instalments, spread over the instalment months.
  //
  // Divided by zero months it would be an infinity, and an infinity written into
  // a quotation is worse than a blank — so with no months set it stays empty
  // until one is. The box is editable like every other derived field, so an
  // agreed round figure can still be typed over the arithmetic.
  { key: "monthly_installment", label: "Monthly Installment", kind: "money",
    derived: (v) => {
      const months = n(v, "installment_months");
      if (months <= 0) return 0;
      return (n(v, "selling_price") - n(v, "advance") - megaTotal(v)) / months;
    } },
];

/** Sum of the mega instalment boxes that are actually SHOWING.
 *
 *  Only up to the quantity: turning 3 down to 1 hides two boxes, and a hidden
 *  box must stop counting immediately. Summing every mega_* key still in the
 *  document would leave Monthly Installment reading two amounts nobody can see
 *  — and they are not saved either, so the figure on screen would not survive a
 *  reload. */
export function megaTotal(v: Record<string, string>): number {
  let t = 0;
  for (let i = 1; i <= megaCount(v); i++) t += Number(v[`mega_${i}`]) || 0;
  return t;
}

/** How many mega instalment boxes a document is asking for. Capped: the boxes
 *  are rendered, and a quantity typed with an extra zero would otherwise build
 *  a thousand inputs and stop the browser. */
export const MAX_MEGA = 24;
export const megaCount = (v: Record<string, string>) =>
  Math.max(0, Math.min(MAX_MEGA, parseInt(v.mega_qty ?? "") || 0));

// Purchase Voucher cost columns shared by every cost centre.
//
// Discount is NOT here any more. It was a per-line column, which meant a bill
// with one discount on the bottom had to be spread across the lines by hand,
// and the document total ignored it either way. It is a single box under the
// grid now (`showDiscount`), and the Net Total — the figure that posts — is
// Subtotal minus it.
const PV_COMMON_EXTRAS: LineExtra[] = [
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
  { key: "remarks", label: "Remarks", kind: "text" },
];

export const TRADE_DOCS: Record<string, TradeDocCfg> = {
  purchase_order: {
    type: "purchase_order", prefix: "PO-", title: "Purchase Order", party: "supplier",
    loadsFrom: { type: "sale_order", title: "Sale Order" },
    showDue: true, showDelivery: true, showTerms: true, showMode: true, showTagArea: true,
    hideRoundOff: true,
    // A header Remarks, beside the per-line one. What is being asked of the
    // supplier for the order as a whole ("deliver to the yard, not the office")
    // belongs to the document, and had nowhere to go but a line.
    headerExtras: [{ key: "remarks", label: "Remarks", kind: "text" }],
    lineExtras: [
      // Before Rate: it is the ceiling the rate is checked against, so it reads
      // left-to-right as "allowed, then actual". The value comes from the item's
      // Product Tree purchase rate — what the thing costs to buy — not from the
      // Sale Order's Total Cost, which also carries the expenses that land on it
      // afterwards.
      { key: "so_purchase_rate", label: "Purchase Rate", beforeRate: true },
      { key: "remarks", label: "Remarks", kind: "text" },
    ],
  },
  purchase_voucher: {
    type: "purchase_voucher", prefix: "PV-", title: "Purchase Voucher", party: "supplier",
    loadsFrom: { type: "mrn", title: "Material Receipt Note" },
    carLoadsFrom: { type: "purchase_order", title: "Purchase Order" },
    showDue: true, showMode: true, showTagArea: false, tagAreaInLine: true, showWarehouse: false,
    showDiscount: true, hideRoundOff: true,
    // No Purchase Account. It only ever reached the NON-STOCK part of a bill —
    // a stock line debits Inventory and a car debits Vehicle Inventory whatever
    // is chosen — so it was a header control that silently did nothing on most
    // vouchers, and it was one account for a whole document either way. The
    // non-stock part goes to Purchases; splitting a bill across expense
    // accounts is a Journal, which can say a different account per line.
    lineExtras: PV_COMMON_EXTRAS, carLineExtras: PV_CAR_EXTRAS,
  },
  purchase_return: {
    type: "purchase_return", prefix: "PRN-", title: "Purchase Return", party: "supplier",
    showTagArea: true, showWarehouse: false,
    headerExtras: [
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
    // The grid is hidden on a car Sale Order, as it is on the Quotation. It was
    // kept for a while so the price could be adjusted at the point of ordering,
    // but the same two numbers appearing twice — once in the costing block and
    // once in a one-row grid underneath — is what it actually amounted to, with
    // nothing checking that they agreed. The document still gets its line: it is
    // built on save from the header's Item / Vehicle and Selling Price, which is
    // what the Car Invoice reads.
    showDelivery: true, showTerms: true, showMode: true, showTagArea: false,
    hideLinesForCar: true, carSchedule: true,
    carHeaderExtras: [
      { key: "item_id", label: "Item / Vehicle", kind: "product" },
      ...CAR_COSTING,
      { key: "advance_due_date", label: "Advance Due Date", kind: "date" },
    ],
  },
  sales_return: {
    type: "sales_return", prefix: "SRN-", title: "Sales Return", party: "customer",
    showTagArea: true, showWarehouse: false,
    // A Sales Return has no step in the document chain — goods coming back are
    // typed. A CAR coming back is not: it is returned against the Car Invoice
    // that sold it, which is where the vehicle, the customer and the cost are.
    alsoLoadsFrom: { title: "Car Invoice" },
    headerExtras: [
      { key: "update_stock", label: "Update Stocks", kind: "check", defaultOn: true },
    ],
  },
  sales_invoice: {
    type: "sales_invoice", prefix: "SI-", title: "Sales Invoice", party: "customer",
    loadsFrom: { type: "sale_order", title: "Sale Order" },
    showDue: true, showDelivery: true, showTerms: true, showMode: true, showTagArea: true,
    // No "Update Stocks" choice: a Sales Invoice is what takes the goods off
    // the shelf, so it always does. See trade_doc_post.
    //
    // And no Sale Account. Unlike Purchase Account it DID work — it chose the
    // revenue account the whole invoice was credited to — but one account for a
    // whole document is the wrong grain for that question: an invoice carrying
    // two kinds of revenue could not be split by it, and every invoice raised so
    // far left it on "— default —" anyway. Revenue now credits Sales, and a sale
    // that has to reach different revenue accounts is a Journal, which can name
    // one per line. The COGS side never listened to it regardless: goods leaving
    // book against Inventory on rules the posting owns.
    lineExtras: [{ key: "remarks", label: "Remarks", kind: "text" }],
  },
  // ── AIR TICKET INVOICE ──────────────────────────────────────────────────
  // A back-to-back document: the ticket is bought from a consolidator and sold
  // to the passenger, and BOTH sides belong on the one voucher because they are
  // one transaction with one margin. That is why it carries a supplier as well
  // as a customer — the only trade document that does — and why it posts four
  // legs rather than two:
  //
  //     Dr the customer      gross          Cr Air Ticket Sales   gross
  //     Dr Air Ticket Cost   supplier       Cr the supplier       supplier
  //
  // So the customer stands as a receivable and the consolidator as a payable,
  // and the margin falls out of the two revenue/cost accounts without anybody
  // typing it.
  //
  // It moves NO STOCK. A ticket is not a thing on a shelf: the line's item is
  // there to say what was sold and to reach the Product Tree, not to be issued
  // from a warehouse. trade_doc_post_now's air-ticket branch never enters the
  // stock loop.
  //
  // Ticket No. and PNR are not in the field list that was asked for, and they
  // are here because an air ticket without them cannot be found again: a void,
  // a refund, a reissue and every supplier query start from one or the other.
  // They are ordinary line columns, so leaving them blank costs nothing.
  air_ticket_invoice: {
    type: "air_ticket_invoice", prefix: "ATI-", title: "Air Ticket Invoice", party: "customer",
    showDue: true, showMode: true, showTagArea: true, showCurrency: true,
    amountLabel: "Gross",
    headerExtras: [
      { key: "supplier_id", label: "Supplier", kind: "party", partyType: "supplier" },
      { key: "haji_name", label: "Haji Name", kind: "text" },
      { key: "booking_via", label: "Booking Via", kind: "text" },
    ],
    lineExtras: [
      { key: "supplier_rate", label: "Supplier Rate" },
      // Quantity x Supplier Rate. Read-only, because the moment it is typed by
      // hand it is a third number that can disagree with the first two.
      { key: "supplier_amount", label: "Supplier Amount",
        derived: ({ qty, extras }) => qty * (Number(extras.supplier_rate) || 0) },
      { key: "airline", label: "Airline", kind: "text" },
      { key: "sector", label: "Sector", kind: "text" },
      { key: "travel_date", label: "Travel Date", kind: "date" },
      { key: "ticket_no", label: "Ticket No.", kind: "text" },
      { key: "pnr", label: "PNR", kind: "text" },
    ],
  },
  delivery_note: {
    type: "delivery_note", prefix: "DN-", title: "Delivery Note", party: "customer",
    loadsFrom: { type: "sales_invoice", title: "Sales Invoice" },
    // A car is delivered against its Car Invoice, which lives in Car Sales
    // rather than in the trade-document chain.
    alsoLoadsFrom: { title: "Car Invoice" },
    showDelivery: true, showTagArea: true, hideRateAmount: true,
    showDelivered: true,
  },
};
