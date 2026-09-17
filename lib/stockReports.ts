// Registry of the Inventory reports — the first user of, and now a plain
// specialisation of, the generic registry contract in lib/reports/types.ts
// (Param/Col/StockReportCfg are the same shapes, narrowed to what Inventory's
// own purpose-built RPCs actually take). Data only (no JSX, no functions), so
// a server page can import it and hand a client component the report KEY —
// the client resolves the config itself, the same convention every other
// report registry now follows.
import type { Col as GenericCol, Need, ReportCfg } from "@/lib/reports/types";
import { NEED_ARG } from "@/lib/reports/types";

export type ColKind = GenericCol["kind"];
export type Col = GenericCol;

/** Which controls the report needs — also the RPC arguments it is called with. */
export type Param = Extract<Need, "from" | "to" | "asof" | "items" | "warehouse" | "movedOnly" | "mode" | "limit">;

export interface StockReportCfg extends Omit<ReportCfg, "params" | "mode" | "shape"> {
  params: Param[];
  mode?: "fast" | "slow";   // fixed p_mode for the fast/slow variants
}

/** RPC argument name for each control. */
export const PARAM_ARG: Record<Param, string> = {
  from: NEED_ARG.from, to: NEED_ARG.to, asof: NEED_ARG.asof, items: NEED_ARG.items,
  warehouse: NEED_ARG.warehouse, movedOnly: NEED_ARG.movedOnly, mode: NEED_ARG.mode, limit: NEED_ARG.limit,
};

const ITEM: Col = { key: "item", label: "Item" };
const UOM: Col = { key: "uom", label: "UOM" };
const WH: Col = { key: "warehouse", label: "Warehouse" };
// Valuation and Ageing (migration 432) carry the item's id now, so their own
// item column can drill into that item's own Stock Movement instead of
// staying plain text — the rest of ITEM's shape is unchanged.
const ITEM_LINKED: Col = { key: "item", label: "Item", href: (row) => row.item_id ? `/stock/movement?item=${row.item_id}` : null };

export const STOCK_REPORTS: Record<string, StockReportCfg> = {
  opening: {
    key: "opening", title: "Opening Stocks Register",
    rpc: "stock_opening_register", params: ["asof", "items", "warehouse"], period: "asof",
    cols: [ITEM, UOM, WH,
      { key: "qty", label: "Qty", kind: "qty", total: true },
      { key: "rate", label: "Rate", kind: "money" },
      { key: "value", label: "Value", kind: "money", total: true }],
    empty: "No stock was held on that date.",
  },
  statement: {
    key: "statement", title: "Stock Statement",
    rpc: "stock_statement", params: ["from", "to", "items", "warehouse", "movedOnly"], period: "range",
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
    rpc: "stock_movement_report", params: ["from", "to", "items", "warehouse"], period: "range",
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
    rpc: "stock_valuation_report", params: ["asof", "warehouse", "items"], period: "asof",
    cols: [ITEM_LINKED, UOM, WH,
      { key: "qty", label: "Qty", kind: "qty", total: true },
      { key: "avg_cost", label: "Avg Cost", kind: "money" },
      { key: "value", label: "Value", kind: "money", total: true },
      { key: "share", label: "Share %", kind: "pct" }],
    empty: "No stock on hand.",
  },
  abc: {
    key: "abc", title: "ABC Analysis",
    rpc: "stock_abc_analysis", params: ["from", "to", "warehouse"], period: "range",
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
    rpc: "stock_ageing_analysis", params: ["asof", "warehouse", "items"], period: "asof",
    cols: [ITEM_LINKED, UOM,
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
    rpc: "stock_moving_items", params: ["from", "to", "mode", "limit", "warehouse"], mode: "fast", period: "range",
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
    rpc: "stock_moving_items", params: ["from", "to", "mode", "limit", "warehouse"], mode: "slow", period: "range",
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
    rpc: "stock_peak_low_balances", params: ["from", "to", "items", "warehouse"], period: "range",
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
