// Registry of the Inventory reports. Data only (no JSX, no functions), so a
// server page can import it and hand a client component the report KEY — the
// client resolves the config itself. Passing the config object across the
// server→client boundary would serialize fine today but breaks the moment a
// field becomes a function, so the key is the contract.

export type ColKind = "text" | "qty" | "money" | "date" | "pct" | "int" | "class";

export interface Col {
  key: string;
  label: string;
  kind?: ColKind;   // text (default) | qty | money | date | pct | int | class
  total?: boolean;  // summed in the footer
}

/** Which controls the report needs — also the RPC arguments it is called with. */
export type Param = "from" | "to" | "asof" | "items" | "warehouse" | "movedOnly" | "mode" | "limit";

export interface StockReportCfg {
  key: string;
  title: string;
  subtitle: string;
  rpc: string;
  params: Param[];
  mode?: "fast" | "slow";   // fixed p_mode for the fast/slow variants
  cols: Col[];
  empty: string;
}

/** RPC argument name for each control. */
export const PARAM_ARG: Record<Param, string> = {
  from: "p_from", to: "p_to", asof: "p_as_of", items: "p_items",
  warehouse: "p_wh", movedOnly: "p_moved_only", mode: "p_mode", limit: "p_limit",
};

const ITEM: Col = { key: "item", label: "Item" };
const UOM: Col = { key: "uom", label: "UOM" };
const WH: Col = { key: "warehouse", label: "Warehouse" };

export const STOCK_REPORTS: Record<string, StockReportCfg> = {
  opening: {
    key: "opening", title: "Opening Stocks Register",
    subtitle: "Quantity, rate and value held immediately before the chosen date.",
    rpc: "stock_opening_register", params: ["asof", "items", "warehouse"],
    cols: [ITEM, UOM, WH,
      { key: "qty", label: "Qty", kind: "qty", total: true },
      { key: "rate", label: "Rate", kind: "money" },
      { key: "value", label: "Value", kind: "money", total: true }],
    empty: "No stock was held on that date.",
  },
  statement: {
    key: "statement", title: "Stock Statement",
    subtitle: "Opening, receipts, issues and closing for every item in the period.",
    rpc: "stock_statement", params: ["from", "to", "items", "warehouse", "movedOnly"],
    cols: [ITEM, UOM,
      { key: "opening_qty", label: "Opening Qty", kind: "qty", total: true },
      { key: "opening_value", label: "Opening Value", kind: "money", total: true },
      { key: "in_qty", label: "Receipt Qty", kind: "qty", total: true },
      { key: "in_value", label: "Receipt Value", kind: "money", total: true },
      { key: "out_qty", label: "Issue Qty", kind: "qty", total: true },
      { key: "out_value", label: "Issue Value", kind: "money", total: true },
      { key: "closing_qty", label: "Closing Qty", kind: "qty", total: true },
      { key: "closing_value", label: "Closing Value", kind: "money", total: true }],
    empty: "Nothing moved and nothing was held in this period.",
  },
  movement: {
    key: "movement", title: "Stock Movement",
    subtitle: "Every stock voucher in the period, receipt and issue side by side.",
    rpc: "stock_movement_report", params: ["from", "to", "items", "warehouse"],
    cols: [{ key: "date", label: "Date", kind: "date" },
      { key: "doc_no", label: "Voucher No" },
      { key: "doc_type", label: "Type" },
      ITEM, WH, { key: "name", label: "Name" },
      { key: "in_qty", label: "Qty Rec", kind: "qty", total: true },
      { key: "out_qty", label: "Qty Issued", kind: "qty", total: true },
      { key: "rate", label: "Rate", kind: "money" },
      { key: "value", label: "Value", kind: "money", total: true }],
    empty: "No stock moved in this period.",
  },
  virtual: {
    key: "virtual", title: "Virtual Stock Analysis",
    subtitle: "What the warehouse will hold once the open paperwork lands: on hand + on order − committed.",
    rpc: "stock_virtual_analysis", params: ["warehouse", "items"],
    cols: [ITEM, UOM,
      { key: "on_hand", label: "On Hand", kind: "qty", total: true },
      { key: "on_order", label: "On Order", kind: "qty", total: true },
      { key: "committed", label: "Committed", kind: "qty", total: true },
      { key: "virtual", label: "Virtual Stock", kind: "qty", total: true },
      { key: "reorder_level", label: "Reorder Level", kind: "qty" },
      { key: "value", label: "Value", kind: "money", total: true }],
    empty: "Nothing on hand and nothing in the pipeline.",
  },
  valuation: {
    key: "valuation", title: "Stock Valuation",
    subtitle: "Quantity, average cost and value held, with each item's share of the total.",
    rpc: "stock_valuation_report", params: ["asof", "warehouse", "items"],
    cols: [ITEM, UOM, WH,
      { key: "qty", label: "Qty", kind: "qty", total: true },
      { key: "avg_cost", label: "Avg Cost", kind: "money" },
      { key: "value", label: "Value", kind: "money", total: true },
      { key: "share", label: "Share %", kind: "pct" }],
    empty: "No stock on hand.",
  },
  abc: {
    key: "abc", title: "ABC Analysis",
    subtitle: "Items ranked by consumption value: A is the top 80% of value, B the next 15%, C the rest.",
    rpc: "stock_abc_analysis", params: ["from", "to", "warehouse"],
    cols: [{ key: "rank", label: "#", kind: "int" }, ITEM, UOM,
      { key: "qty", label: "Consumed Qty", kind: "qty", total: true },
      { key: "value", label: "Consumed Value", kind: "money", total: true },
      { key: "pct", label: "% of Value", kind: "pct" },
      { key: "cum_pct", label: "Cumulative %", kind: "pct" },
      { key: "class", label: "Class", kind: "class" }],
    empty: "Nothing was consumed in this period.",
  },
  ageing: {
    key: "ageing", title: "Ageing Analysis",
    subtitle: "How long the stock on hand has been sitting, oldest receipts consumed first.",
    rpc: "stock_ageing_analysis", params: ["asof", "warehouse", "items"],
    cols: [ITEM, UOM,
      { key: "qty", label: "On Hand", kind: "qty", total: true },
      { key: "d0_30", label: "0–30 d", kind: "qty", total: true },
      { key: "d31_60", label: "31–60 d", kind: "qty", total: true },
      { key: "d61_90", label: "61–90 d", kind: "qty", total: true },
      { key: "d91_180", label: "91–180 d", kind: "qty", total: true },
      { key: "d180_plus", label: "Over 180 d", kind: "qty", total: true },
      { key: "value", label: "Value", kind: "money", total: true }],
    empty: "No stock on hand to age.",
  },
  reorder: {
    key: "reorder", title: "Reorder Report",
    subtitle: "Items at or below their reorder level, and how many to buy.",
    rpc: "stock_reorder_report", params: ["warehouse"],
    cols: [ITEM, UOM,
      { key: "qty", label: "On Hand", kind: "qty", total: true },
      { key: "reorder_level", label: "Reorder Level", kind: "qty" },
      { key: "shortfall", label: "Shortfall", kind: "qty", total: true },
      { key: "on_order", label: "On Order", kind: "qty", total: true },
      { key: "suggested", label: "Suggested Order", kind: "qty", total: true }],
    empty: "Nothing is below its reorder level.",
  },
  fast: {
    key: "fast", title: "Fast Moving Items",
    subtitle: "The items that left the warehouse most in the period.",
    rpc: "stock_moving_items", params: ["from", "to", "mode", "limit", "warehouse"], mode: "fast",
    cols: [ITEM, UOM,
      { key: "out_qty", label: "Issued Qty", kind: "qty", total: true },
      { key: "out_value", label: "Issued Value", kind: "money", total: true },
      { key: "issues", label: "Issues", kind: "int", total: true },
      { key: "last_issue", label: "Last Issue", kind: "date" },
      { key: "balance", label: "Balance Qty", kind: "qty", total: true },
      { key: "balance_value", label: "Balance Value", kind: "money", total: true }],
    empty: "Nothing moved in this period.",
  },
  slow: {
    key: "slow", title: "Slow Moving Items",
    subtitle: "The items that moved least — dead stock rises to the top.",
    rpc: "stock_moving_items", params: ["from", "to", "mode", "limit", "warehouse"], mode: "slow",
    cols: [ITEM, UOM,
      { key: "out_qty", label: "Issued Qty", kind: "qty", total: true },
      { key: "out_value", label: "Issued Value", kind: "money", total: true },
      { key: "days_idle", label: "Days Idle", kind: "int" },
      { key: "last_issue", label: "Last Issue", kind: "date" },
      { key: "balance", label: "Balance Qty", kind: "qty", total: true },
      { key: "balance_value", label: "Balance Value", kind: "money", total: true }],
    empty: "No stock items yet.",
  },
  peaklow: {
    key: "peaklow", title: "Peak / Low Balances",
    subtitle: "The highest and lowest quantity each item reached in the period, and when.",
    rpc: "stock_peak_low_balances", params: ["from", "to", "items", "warehouse"],
    cols: [ITEM, UOM,
      { key: "opening", label: "Opening", kind: "qty" },
      { key: "peak", label: "Peak Qty", kind: "qty" },
      { key: "peak_date", label: "Peak On", kind: "date" },
      { key: "low", label: "Low Qty", kind: "qty" },
      { key: "low_date", label: "Low On", kind: "date" },
      { key: "closing", label: "Closing", kind: "qty" }],
    empty: "No balances in this period.",
  },
};
