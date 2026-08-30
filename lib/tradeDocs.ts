// Registry of grid-style "trade" vouchers (header + item lines). Each shares the
// one TradeVoucher editor and the trade_documents engine; only the config differs.
export type TradeParty = "supplier" | "customer" | null;
export interface TradeDocCfg {
  type: string;        // trade_documents.doc_type
  prefix: string;      // document-number prefix
  title: string;
  party: TradeParty;   // whose picker to show (b2b agents count as customers)
  showDue?: boolean;
  showDelivery?: boolean;
  showTerms?: boolean;
  showMode?: boolean;
  qtyLabel?: string;
}

export const TRADE_DOCS: Record<string, TradeDocCfg> = {
  purchase_order:   { type: "purchase_order",   prefix: "PO-",  title: "Purchase Order",      party: "supplier", showDue: true, showDelivery: true, showTerms: true, showMode: true },
  purchase_voucher: { type: "purchase_voucher", prefix: "PV-",  title: "Purchase Voucher",    party: "supplier", showDue: true, showMode: true },
  purchase_return:  { type: "purchase_return",  prefix: "PRN-", title: "Purchase Return",     party: "supplier" },
  mrn:              { type: "mrn",              prefix: "MRN-", title: "Material Receipt Note", party: "supplier", showDelivery: true },
  sales_quotation:  { type: "sales_quotation",  prefix: "SQ-",  title: "Sales Quotation",     party: "customer", showTerms: true },
  sale_order:       { type: "sale_order",       prefix: "SO-",  title: "Sale Order",          party: "customer", showDelivery: true, showTerms: true, showMode: true },
  sales_return:     { type: "sales_return",     prefix: "SRN-", title: "Sales Return",        party: "customer" },
  delivery_note:    { type: "delivery_note",    prefix: "DN-",  title: "Delivery Note",       party: "customer", showDelivery: true },
};
