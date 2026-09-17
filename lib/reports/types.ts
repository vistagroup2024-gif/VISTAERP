// Registry contract for every report outside Inventory (which keeps its own
// narrower Param/Col in lib/stockReports.ts, retyped as a specialisation of
// these). Data only — no JSX, no functions — so a server page can import a
// registry and hand a client component the report KEY, the same convention
// StockReport already uses and for the same reason: the config crosses the
// server→client boundary as a plain string, never as an object that could
// grow a function field and silently stop serialising.

export type ColKind = "text" | "qty" | "money" | "date" | "pct" | "int" | "class";

export interface Col {
  key: string;
  label: string;
  kind?: ColKind;       // text (default) | qty | money | date | pct | int | class
  total?: boolean;      // summed in the footer
  sortable?: boolean;   // default true for text/date, true for numeric kinds
  hideByDefault?: boolean;
  /** Drill-down: when set, the cell's text is wrapped in a link to this
   *  href. Returning null/undefined for a given row leaves it plain text —
   *  a report drills down where there is something to drill into, not on
   *  every row unconditionally. */
  href?: (row: any) => string | null | undefined;
}

/** Every filter control a report can ask for. Existing accounting/transport
 *  RPCs were not all written with one shared naming convention the way the
 *  Inventory ones were, so a Need's RPC argument name is only a DEFAULT
 *  (NEED_ARG) — a report whose RPC spells it differently overrides it in its
 *  own `argMap`, rather than every RPC being forced to match one shape. */
export type Need =
  | "from" | "to" | "asof" | "month" | "year"
  | "items" | "itemGroup" | "warehouse" | "movedOnly" | "mode" | "limit"
  | "costCenter" | "costCenterName" | "tagArea" | "tagAreaName"
  | "account" | "accountGroup" | "party" | "product" | "productGroup"
  | "vehicle" | "driver" | "route" | "status" | "txnType" | "currency" | "search";

/** Default RPC argument name for each Need. */
export const NEED_ARG: Record<Need, string> = {
  from: "p_from", to: "p_to", asof: "p_as_of", month: "p_month", year: "p_year",
  items: "p_items", itemGroup: "p_item_group", warehouse: "p_wh",
  movedOnly: "p_moved_only", mode: "p_mode", limit: "p_limit",
  costCenter: "p_cost_center_ids", costCenterName: "p_cost_centers",
  tagArea: "p_tag_area_ids", tagAreaName: "p_tag_areas",
  account: "p_account_ids", accountGroup: "p_account_group_ids",
  party: "p_party_ids", product: "p_product_ids", productGroup: "p_product_group_ids",
  vehicle: "p_vehicle_ids", driver: "p_driver_ids", route: "p_route_ids",
  status: "p_status", txnType: "p_txn_type", currency: "p_currency", search: "p_search",
};

export interface ReportCfg {
  key: string;
  title: string;
  /** Deliberately optional — a report screen explains itself through its
   *  title and columns, not a paragraph above them. Don't add one back for
   *  report copy explaining how a figure works. */
  subtitle?: string;
  rpc: string;
  params: Need[];
  /** Overrides NEED_ARG for a Need this RPC's own signature names differently
   *  (e.g. acct_ledger_multi's `p_account_ids`, ar_ap_aging's `p_kind`). */
  argMap?: Partial<Record<Need, string>>;
  /** Sent on every call regardless of filters — company id, a fixed p_kind.
   *  Static values only; a report needing the CURRENT date computes it in
   *  its own page/wrapper, not here. */
  fixedArgs?: Record<string, any>;
  /** Fixed p_mode for a report that is really one RPC run two ways (Fast
   *  Moving / Slow Moving off `stock_moving_items`). */
  mode?: string;
  /** "grouped" is the Ledger shape — one block per account/entity, each with
   *  its own rows and subtotal — vs "flat", one row per record. Drives which
   *  DataTable rendering path is used. Default "flat". */
  shape?: "flat" | "grouped";
  /** When set, this report's period comes from the header's PeriodDropdown
   *  (Year+Months) instead of its own asof/from/to box in the filter bar —
   *  "asof" resolves to one date (asOfFromYearMonths), "range" to the
   *  bounding {from,to} of the months picked (monthRanges()'s first..last).
   *  A report with no real period concept (Virtual Stock, Reorder — "what
   *  is true right now", no date to pick) leaves this unset. */
  period?: "asof" | "range";
  cols: Col[];
  empty: string;
}
