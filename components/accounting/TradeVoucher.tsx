"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import ProductPicker, { productOptions } from "./ProductPicker";
import LoadFromPicker from "./LoadFromPicker";
import { TRADE_DOCS, isCarCostCenter, type HeaderExtra, type LineExtra } from "@/lib/tradeDocs";
import type { DocRight } from "@/lib/docRights";
import { todaySA } from "@/lib/saudiTime";

type Row = {
  product_id: string | null; item_name: string; units: string; quantity: string; rate: string; amount: string;
  link1: string; extras: Record<string, string>;
};
/** What "Mode of Payment" may be. Free text let the same thing be written three
 *  ways and reported on as none of them. */
const PAYMENT_MODES = ["Cash", "Credit", "Bank Transfer", "Cheque", "Card"];

const blankRow = (): Row => ({ product_id: null, item_name: "", units: "", quantity: "", rate: "", amount: "", link1: "", extras: {} });
const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const num = (s: string) => (s?.trim?.() === "" || s == null ? 0 : Number(s) || 0);
const r2 = (n: number) => String(+n.toFixed(2));

// Takes the doc-type key rather than the config object: the config carries the
// derived-value functions for the car costing block, and functions cannot cross
// the server -> client component boundary. The client resolves it locally.
export default function TradeVoucher({ type, rights }: { type: string; rights?: Partial<Record<DocRight, boolean>> }) {
  const cfg = TRADE_DOCS[type];
  // Rights come resolved from the server page. Absent = unrestricted, which is
  // what an admin or a user with no Access rights configured gets.
  const may = (r: DocRight) => (rights ? !!rights[r] : true);
  // A posted voucher is not frozen, it is RESTRICTED. Changing or deleting one
  // makes the database unwind the ledger entry, the stock and any vehicles the
  // purchase created, so it takes the Edit/Delete Posted right on top of the
  // ordinary Edit or Delete. Admins have it; everybody else is ticked for it by
  // name. hasDocRight reads this one strictly, so a blank profile does NOT
  // arrive holding it.
  // What the Load button offers. A voucher may sit in the document chain
  // (loadsFrom), take a document from outside it (alsoLoadsFrom), or — like the
  // Sales Return, which exists to take a car back — only the second.
  const loadTitle = [cfg.loadsFrom?.title, cfg.alsoLoadsFrom?.title].filter(Boolean).join(" / ");
  const loadSourceTitle = [cfg.loadsFrom?.title, cfg.alsoLoadsFrom?.title].filter(Boolean).join(" or ");
  const mayUnpost = () => may("edit_posted");
  const postedLock = () => posted && !mayUnpost();
  const mayWrite = () => (id ? may("edit") && (!posted || mayUnpost()) : may("create"));
  const router = useRouter();
  const supabase = createClient();

  const [id, setId] = useState<string | null>(null);
  const [docNo, setDocNo] = useState("");
  const [date, setDate] = useState(() => todaySA());
  const [party, setParty] = useState("");
  const [costCenter, setCostCenter] = useState("");
  const [tagArea, setTagArea] = useState("");
  const [reference, setReference] = useState("");
  const [mode, setMode] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [terms, setTerms] = useState("");
  const [narration, setNarration] = useState("");
  const [roundOff, setRoundOff] = useState("");
  const [discount, setDiscount] = useState("");
  const [rows, setRows] = useState<Row[]>([blankRow()]);
  // Header extras (incl. the car costing block) live in the document meta.
  const [extras, setExtras] = useState<Record<string, string>>({});
  // Which derived boxes the user has typed into — those stop auto-calculating.
  const [overridden, setOverridden] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [parties, setParties] = useState<{ id: string; name: string }[]>([]);
  const [products, setProducts] = useState<{ id: string; name: string; group?: string | null; purchase_rate?: number | null }[]>([]);
  const [costCenters, setCostCenters] = useState<{ id: string; name: string }[]>([]);
  const [tagAreas, setTagAreas] = useState<{ id: string; name: string }[]>([]);
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);
  const [accounts, setAccounts] = useState<{ id: string; code: string; name: string }[]>([]);
  const [warehouse, setWarehouse] = useState("");
  const [posted, setPosted] = useState(false);
  const [awaiting, setAwaiting] = useState(false);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [sourceCar, setSourceCar] = useState<string | null>(null);
  const [sourceNo, setSourceNo] = useState<string | null>(null);
  // A car coming back. Set when a Car Invoice was loaded into this Sales
  // Return; it carries what the car sold for, so the return value can be typed
  // with that figure in front of the operator rather than looked up.
  const [carReturn, setCarReturn] = useState<{ vehicle_no?: string; sold_for?: number } | null>(null);
  const [loadOpen, setLoadOpen] = useState(false);
  // These trade documents post to the GL (+ stock); the rest are paperwork only.
  const canPost = ["purchase_voucher", "purchase_return", "sales_return", "sales_invoice"].includes(cfg.type);

  // Car-sales cost centres (CAR SALES INSTALLMENT / CAR TRADING) reveal the
  // costing block and the vehicle expense columns.
  const isCar = isCarCostCenter(costCenter);
  // A car sale is one vehicle at one price, both already in the costing block,
  // so the grid is not shown. The LINE is still written on save — it is what
  // carries the vehicle to the Car Invoice — it is just not typed by hand.
  const hideLines = isCar && !!cfg.hideLinesForCar;
  const headerExtras: HeaderExtra[] = useMemo(
    () => [...(cfg.headerExtras ?? []), ...(isCar ? cfg.carHeaderExtras ?? [] : [])],
    [cfg, isCar]);
  const lineExtras: LineExtra[] = useMemo(
    () => (isCar && cfg.carLineExtras ? cfg.carLineExtras : cfg.lineExtras ?? []),
    [cfg, isCar]);
  // Columns that sit left of Rate, and the rest that follow Amount.
  const preRateExtras = useMemo(() => lineExtras.filter((x) => x.beforeRate), [lineExtras]);
  const postExtras = useMemo(() => lineExtras.filter((x) => !x.beforeRate), [lineExtras]);
  const showRateAmount = !cfg.hideRateAmount;
  // A vehicle is one car, not a quantity of something — Units means nothing on a
  // car cost centre, so the column is not shown and nothing is stored in it.
  const showUnits = !isCar;

  useEffect(() => {
    (async () => {
      const types = cfg.party === "supplier" ? ["supplier"] : cfg.party === "customer" ? ["customer", "b2b_agent"] : ["customer", "supplier", "b2b_agent"];
      const [{ data: pa }, { data: pr }, { data: cc }, { data: ta }, { data: wh }, { data: ac }] = await Promise.all([
        supabase.from("parties").select("id, name").in("party_type", types).eq("is_active", true).order("name"),
        supabase.from("acct_products").select("id, name, parent_id, is_group, purchase_rate").eq("is_active", true).order("name"),
        supabase.from("acct_cost_centers").select("id, name").eq("is_active", true).eq("is_group", false).order("name"),
        supabase.from("acct_tag_areas").select("id, name").eq("is_active", true).eq("is_group", false).order("name"),
        supabase.from("warehouses").select("id, name").eq("is_active", true).order("name"),
        supabase.from("accounts").select("id, code, name").eq("is_postable", true).eq("is_group", false).order("code"),
      ]);
      setParties((pa as any[]) ?? []); setProducts(productOptions((pr as any[]) ?? []));
      setCostCenters((cc as any[]) ?? []); setTagAreas((ta as any[]) ?? []);
      setWarehouses((wh as any[]) ?? []); setAccounts((ac as any[]) ?? []);
    })();
  }, [supabase, cfg.party]);


  /** Ticked-by-default check boxes, as a starting set of extra values. */
  const extraDefaults = useCallback(() => Object.fromEntries(
    headerExtras.filter((f) => f.kind === "check" && f.defaultOn).map((f) => [f.key, "true"])
  ) as Record<string, string>, [headerExtras]);
  // Seed the ticked-by-default boxes on mount, and again if the cost centre
  // brings new fields in. A key already present is left alone, so a document
  // that was deliberately saved with the box unticked stays unticked.
  useEffect(() => {
    setExtras((cur) => {
      const d = extraDefaults();
      const next = { ...cur };
      let changed = false;
      for (const [k, v] of Object.entries(d)) if (!(k in next)) { next[k] = v; changed = true; }
      return changed ? next : cur;
    });
  }, [extraDefaults]);

  function resetNew(keepMessage?: string) {
    setId(null); setDocNo(""); setDone(keepMessage ?? null); setErr(null);
    setDate(todaySA()); setParty(""); setCostCenter(""); setTagArea("");
    setReference(""); setMode(""); setDueDate(""); setDeliveryDate(""); setTerms(""); setNarration(""); setRoundOff(""); setDiscount("");
    setRows([blankRow()]); setWarehouse(""); setPosted(false); setExtras(extraDefaults()); setOverridden({});
    setSourceId(null); setSourceNo(null); setSourceCar(null); setAwaiting(false); setCarReturn(null);
  }
  function setRow(i: number, patch: Partial<Row>) {
    setRows((rs) => {
      const next = rs.map((r, j) => (j === i ? { ...r, ...patch } : r));
      const r = next[i];
      // amount auto = qty*rate unless the user typed an amount directly
      if (patch.quantity !== undefined || patch.rate !== undefined) r.amount = String(+(num(r.quantity) * num(r.rate)).toFixed(2) || "");
      if (i === next.length - 1 && (patch.item_name || patch.product_id || patch.amount || patch.quantity)) next.push(blankRow());
      return next;
    });
  }
  function setRowExtra(i: number, key: string, value: string) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, extras: { ...r.extras, [key]: value } } : r)));
  }
  // The picker hands back an item id; the name is stored alongside it only so a
  // saved document still reads correctly if the item is later renamed.
  function pickItem(i: number, id: string | null) {
    const p = id ? products.find((x) => x.id === id) : null;
    setRow(i, { product_id: id, item_name: p?.name ?? "" });
    // On a Purchase Order the ceiling comes from the Product Tree, so choosing
    // the item fills it whether the order was loaded or typed from scratch.
    if (cfg.type === "purchase_order") {
      const rate = Number(p?.purchase_rate ?? 0);
      setRowExtra(i, "so_purchase_rate", rate > 0 ? String(rate) : "");
    }
  }
  function removeRow(i: number) { setRows((rs) => (rs.length <= 1 ? rs : rs.filter((_, j) => j !== i))); }

  // Derived header values recompute from what is typed, in declaration order, so
  // later formulas (Margin, Selling Price) see the earlier ones (Total Cost,
  // Investment). A box the user edited keeps their number.
  const extraValues = useMemo(() => {
    const v: Record<string, string> = { ...extras };
    for (const f of headerExtras) {
      if (!f.derived || overridden[f.key]) continue;
      v[f.key] = r2(f.derived(v));
    }
    return v;
  }, [extras, headerExtras, overridden]);

  function setExtra(f: HeaderExtra, value: string) {
    setExtras((e) => ({ ...e, [f.key]: value }));
    if (f.derived) setOverridden((o) => ({ ...o, [f.key]: value.trim() !== "" }));
  }

  const subtotal = useMemo(
    () => (hideLines ? num(extraValues.selling_price ?? "") : rows.reduce((s, r) => s + num(r.amount), 0)),
    [rows, hideLines, extraValues],
  );
  // The discount comes off before the round-off, so Net Total is what the
  // supplier is actually owed — and it is this figure that posts.
  const discountAmt = cfg.showDiscount ? num(discount) : 0;
  const total = subtotal - discountAmt + num(roundOff);
  // Landed cost = the line amounts plus every expense column flagged as a cost.
  const costColumns = useMemo(() => lineExtras.filter((x) => x.cost), [lineExtras]);
  /** Lines whose rate is above the SO Purchase Rate they were raised against. */
  const overCeiling = useMemo(() => {
    const bad = new Set<number>();
    rows.forEach((r, i) => {
      const cap = num(r.extras.so_purchase_rate ?? "");
      if (cap > 0 && num(r.rate) > cap + 0.005) bad.add(i);
    });
    return bad;
  }, [rows]);
  const landedCost = useMemo(
    () => rows.reduce((s, r) => s + num(r.amount) + costColumns.reduce((c, x) => c + num(r.extras[x.key]), 0), 0),
    [rows, costColumns]);
  const extraCosts = landedCost - subtotal;

  function fill(v: any) {
    setId(v.id); setDocNo(v.doc_no ?? ""); setDone(null); setErr(null);
    setDate(v.doc_date ?? ""); setParty(v.party_id ?? ""); setCostCenter(v.cost_center ?? ""); setTagArea(v.tag_area ?? "");
    setReference(v.reference ?? ""); setMode(v.mode_of_payment ?? ""); setDueDate(v.due_date ?? ""); setDeliveryDate(v.delivery_date ?? "");
    setTerms(v.terms ?? ""); setNarration(v.narration ?? ""); setRoundOff(v.round_off ? String(v.round_off) : "");
    setDiscount(v.meta?.discount ? String(v.meta.discount) : "");
    setWarehouse(v.warehouse_id ?? ""); setPosted(!!v.gl_entry); setAwaiting(v.status === "awaiting_approval");
    setSourceId(v.source_doc_id ?? null); setSourceCar(v.source_car_contract ?? null); setSourceNo(v.source_doc_no ?? null);
    const meta = (v.meta ?? {}) as Record<string, any>;
    setCarReturn(meta.car_return
      ? { vehicle_no: meta.vehicle_no ?? undefined, sold_for: Number(meta.sold_for ?? 0) || undefined }
      : null);
    const saved: Record<string, string> = { ...extraDefaults() };
    for (const [k, val] of Object.entries(meta)) saved[k] = val == null ? "" : String(val);
    setExtras(saved);
    // Saved numbers are authoritative — don't let a formula overwrite them.
    setOverridden(Object.fromEntries(Object.keys(saved).filter((k) => saved[k] !== "").map((k) => [k, true])));
    const ls: Row[] = (v.lines ?? []).map((l: any) => {
      const lm = (l.meta ?? {}) as Record<string, any>;
      const ex: Record<string, string> = {};
      for (const [k, val] of Object.entries(lm)) ex[k] = val == null ? "" : String(val);
      return {
        product_id: l.product_id ?? null, item_name: l.item_name ?? "", units: l.units ?? "",
        quantity: l.quantity ? String(Number(l.quantity)) : "", rate: l.rate ? String(Number(l.rate)) : "",
        amount: l.amount ? String(Number(l.amount)) : "", link1: l.link1 ?? "", extras: ex,
      };
    });
    setRows(ls.length ? [...ls, blankRow()] : [blankRow()]);
  }
  async function load(pid: string) {
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc("trade_doc_get", { p_id: pid });
    setBusy(false);
    if (error) return setErr(error.message);
    if (!data) return setErr("Document not found.");
    fill(data);
  }
  /**
   * Load an upstream document into this one. Everything the source holds that
   * this voucher also shows comes across — party, cost centre, terms, the item
   * lines and any matching extra field; what the earlier document could not
   * know is left empty to be typed. The document number stays blank because
   * this is a NEW voucher, and the link is kept so the source drops off the
   * pending list once this is saved.
   */
  async function loadFrom(pid: string) {
    setLoadOpen(false); setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc("trade_doc_load", { p_source: pid, p_target_type: cfg.type });
    setBusy(false);
    if (error) return setErr(error.message);
    const v = data as any;
    if (!v) return setErr("Document not found.");

    setId(null); setDocNo(""); setPosted(false); setDone(null);
    setDate(todaySA());
    setParty(v.party_id ?? ""); setCostCenter(v.cost_center ?? "");
    setTagArea(cfg.showTagArea === false ? "" : v.tag_area ?? "");
    setReference(v.doc_no ?? ""); setTerms(v.terms ?? ""); setNarration(v.narration ?? "");
    setMode(v.mode_of_payment ?? ""); setDeliveryDate(v.delivery_date ?? "");
    setDueDate(""); setRoundOff(""); setDiscount(""); setWarehouse("");

    // Which fields this voucher shows depends on the cost centre we have just
    // been handed, NOT the one that was on screen a moment ago. headerExtras is
    // a memo over the costCenter STATE, and setCostCenter above has not taken
    // effect yet in this pass — reading it here kept the old (usually empty)
    // cost centre, so loading a car Sales Quotation into a fresh Sale Order
    // matched none of the costing fields and silently dropped every one of
    // them. Resolve the field list from the incoming document instead.
    const srcIsCar = isCarCostCenter(v.cost_center);
    const nextHeaderExtras = [...(cfg.headerExtras ?? []), ...(srcIsCar ? cfg.carHeaderExtras ?? [] : [])];
    const nextLineExtras = srcIsCar && cfg.carLineExtras ? cfg.carLineExtras : cfg.lineExtras ?? [];

    // Only the extras this voucher actually shows: a Purchase Order has no use
    // for a quotation's car-costing boxes, and copying them would leave stale
    // values on a document that never displays them.
    const src = (v.meta ?? {}) as Record<string, any>;
    const keep: Record<string, string> = { ...extraDefaults() };
    for (const f of nextHeaderExtras) {
      const val = src[f.key];
      if (val !== undefined && val !== null && val !== "") keep[f.key] = String(val);
    }
    setExtras(keep);
    setOverridden(Object.fromEntries(Object.keys(keep).map((k) => [k, true])));

    const ls: Row[] = (v.lines ?? []).map((l: any) => {
      const lm = (l.meta ?? {}) as Record<string, any>;
      const ex: Record<string, string> = {};
      for (const x of nextLineExtras) {
        const val = lm[x.key];
        if (val !== undefined && val !== null && val !== "") ex[x.key] = String(val);
      }
      if (cfg.tagAreaInLine && lm.tag_area) ex.tag_area = String(lm.tag_area);
      return {
        product_id: l.product_id ?? null, item_name: l.item_name ?? "", units: l.units ?? "",
        quantity: l.quantity ? String(Number(l.quantity)) : "",
        rate: l.rate ? String(Number(l.rate)) : "",
        amount: l.amount ? String(Number(l.amount)) : "",
        link1: l.link1 ?? "", extras: ex,
      };
    });
    // The Purchase Order's ceiling. A car Sale Order says what the vehicle costs
    // us — Total Cost (COGS), the figure the whole margin is calculated from —
    // so paying the supplier more than that eats the margin the customer was
    // quoted on. The SO Purchase Rate column has been on this voucher all along
    // with nothing to fill it; this is what fills it.
    if (cfg.type === "purchase_order") {
      // The ceiling is what the ITEM costs to buy, read from the Product Tree.
      // It used to be the Sale Order's Total Cost (COGS) — but that figure
      // includes the expenses that land on the vehicle later (registration,
      // insurance, transport), so checking a supplier's price against it
      // allowed paying the supplier the expenses too.
      for (const r of ls) {
        const rate = r.product_id ? Number(products.find((p) => p.id === r.product_id)?.purchase_rate ?? 0) : 0;
        if (rate > 0) r.extras.so_purchase_rate = String(rate);
        else delete r.extras.so_purchase_rate;
      }
      // The Sale Order's rate is what we SELL for. Carrying it over as the
      // Purchase Order's rate quietly proposed paying the supplier the selling
      // price. What we pay is a negotiation, so the buyer types it — with the
      // ceiling above sitting next to the box.
      for (const r of ls) { r.rate = ""; r.amount = ""; }
    }
    setRows(ls.length ? [...ls, blankRow()] : [blankRow()]);

    if (v.source_kind === "car") { setSourceCar(v.id); setSourceId(null); }
    else { setSourceId(v.id); setSourceCar(null); }
    setCarReturn(src.car_return
      ? { vehicle_no: src.vehicle_no ?? undefined, sold_for: Number(src.sold_for ?? 0) || undefined }
      : null);
    setSourceNo(v.doc_no ?? null);
    setDone(`loaded from ${v.doc_no}`);
  }

  async function nav(dir: "prev" | "next") {
    setBusy(true);
    const { data, error } = await supabase.rpc("trade_doc_nav", { p_type: cfg.type, p_id: id, p_dir: dir });
    setBusy(false);
    if (error) return setErr(error.message);
    if (!data) return setErr(dir === "prev" ? "This is the first document." : "This is the last document.");
    await load(data as string);
  }
  async function loadByNo() {
    setBusy(true);
    const { data, error } = await supabase.rpc("trade_doc_find", { p_type: cfg.type, p_no: docNo.trim() });
    setBusy(false);
    if (error) return setErr(error.message);
    if (!data) return setErr(`No ${cfg.title} with document no. ${docNo.trim()}.`);
    await load(data as string);
  }
  async function del() {
    if (!may("delete")) return;
    if (!id) return;
    if (posted && !mayUnpost()) return;
    const warning = posted
      ? `Delete ${cfg.title} ${docNo}?\n\nIt is posted, so deleting it also undoes what it did:\n`
        + "  • its ledger entry is removed, so the party balance goes back\n"
        + "  • the stock it moved is put back, at what it was booked at\n"
        + "  • any vehicle this purchase created is removed\n\n"
        + "This cannot be undone."
      : `Delete ${cfg.title} ${docNo}? This cannot be undone.`;
    if (!confirm(warning)) return;
    setBusy(true);
    const { error } = await supabase.rpc("trade_doc_delete", { p_id: id });
    setBusy(false);
    if (error) return setErr(error.message);
    resetNew(`deleted ${docNo}`); router.refresh();
  }
  function printDoc() { if (id) window.open(`/accounting/trade/${id}`, "_blank"); }

  async function save() {
    if (!mayWrite()) return;
    if (posted && !confirm(
      `${docNo} is posted. Saving re-does it from what is on screen now:\n\n`
      + "  • the old ledger entry is replaced\n"
      + "  • the stock it moved goes back and is re-applied at the new figures\n"
      + "  • any vehicle this purchase created is re-created from the lines\n\n"
      + "It happens in one step, so if anything refuses, nothing changes.")) return;
    setErr(null);
    if (overCeiling.size) {
      const n1 = Array.from(overCeiling).map((i) => i + 1).join(", ");
      return setErr(`Line ${n1}: the rate is above the Purchase Rate on the item's Product Tree record. Lower the rate, or raise the item's purchase rate in Masters → Products first.`);
    }
    // Only persist the extras this voucher/cost-centre actually shows, so
    // switching cost centre doesn't leave stale car fields on the document.
    const meta: Record<string, any> = {};
    for (const f of headerExtras) {
      const val = (extraValues[f.key] ?? "").trim();
      if (f.kind === "check") { if (val === "true") meta[f.key] = true; else meta[f.key] = false; continue; }
      if (val !== "") meta[f.key] = val;
    }
    const header = {
      doc_date: date, party_id: party || null, cost_center: costCenter || null,
      tag_area: cfg.showTagArea === false ? null : tagArea || null,
      reference: reference || null, mode_of_payment: mode || null, due_date: dueDate || null, delivery_date: deliveryDate || null,
      terms: terms || null, narration: narration || null, round_off: num(roundOff),
      meta: {
        ...meta,
        ...(cfg.showDiscount ? { discount: discountAmt } : {}),
        // A car return remembers where it came from, so re-opening it shows the
        // same figures the operator decided against.
        ...(carReturn
          ? { car_return: true, vehicle_no: carReturn.vehicle_no ?? null,
              sold_for: carReturn.sold_for ?? null, update_stock: false }
          : {}),
      },
      source_doc_id: sourceId, source_car_contract: sourceCar,
    };
    // With the grid hidden the document still needs its line, because that line
    // is what the Car Invoice reads the vehicle from and what the totals are
    // built from. One line, from the header: the Item / Vehicle at the Selling
    // Price the costing block worked out.
    const carLine = (() => {
      const pid = (extraValues.item_id ?? "").trim() || null;
      const price = num(extraValues.selling_price ?? "");
      return [{
        product_id: pid,
        item_name: pid ? (products.find((p) => p.id === pid)?.name ?? null) : null,
        units: "NOS", quantity: 1, rate: price, amount: price, link1: null, meta: {},
      }];
    })();

    const lines = hideLines ? carLine : rows.filter((r) => (r.item_name.trim() || r.product_id) || num(r.amount))
      .map((r) => {
        const lm: Record<string, any> = {};
        if (cfg.tagAreaInLine && r.extras.tag_area) lm.tag_area = r.extras.tag_area;
        for (const x of lineExtras) {
          const val = (r.extras[x.key] ?? "").trim();
          if (val !== "") lm[x.key] = x.kind === "text" ? val : num(val);
        }
        return {
          product_id: r.product_id, item_name: r.item_name.trim() || null, units: r.units || null,
          quantity: num(r.quantity), rate: num(r.rate), amount: num(r.amount), link1: r.link1 || null, meta: lm,
        };
      });
    if (hideLines) {
      if (!lines[0].product_id) return setErr("Choose the Item / Vehicle.");
      if (!(lines[0].amount > 0)) return setErr("Enter the costing — the Selling Price is zero.");
    } else if (lines.length === 0) return setErr("Enter at least one item line.");
    setBusy(true);
    const { data, error } = await supabase.rpc("trade_doc_save", {
      p_type: cfg.type, p_prefix: cfg.prefix, p_id: id,
      // The warehouse has to be on the document before the save posts it.
      p_header: { ...header, warehouse_id: cfg.showWarehouse ? warehouse || null : null },
      p_lines: lines,
    });
    if (error) { setBusy(false); return setErr(error.message); }
    const r = data as any;
    setBusy(false);
    // Saving posts the voucher, unless its type needs authorising — then it
    // goes to the approvers and posts itself when they authorise it.
    const msg = r.pending ? `${r.doc_no} sent for authorisation`
      : r.posted ? `${r.doc_no} posted (${r.entry_no ?? ""})`
      : `saved ${r.doc_no}`;
    // Then straight into the next blank voucher. Entry is done in runs — one
    // supplier's bills, one morning's orders — so the screen a clerk wants
    // after saving is an empty one, not the document they have just finished.
    // The saved voucher is a keystroke away: type its number in Document No.
    // and press Enter, or step back with ‹ Previous.
    resetNew(`${msg} — new ${cfg.title} ready`);
    router.refresh();
  }

  function headerField(f: HeaderExtra) {
    const val = extraValues[f.key] ?? "";
    if (f.kind === "check") {
      return (
        <div key={f.key} className="flex items-end">
          <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
            <input type="checkbox" checked={val === "true"} onChange={(e) => setExtra(f, e.target.checked ? "true" : "false")} />
            {f.label}
          </label>
        </div>
      );
    }
    if (f.kind === "account") {
      return (
        <div key={f.key}><label className="label">{f.label}</label>
          <select className="input" value={val} onChange={(e) => setExtra(f, e.target.value)}>
            <option value="">— default —</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select></div>
      );
    }
    if (f.kind === "date") {
      return <div key={f.key}><label className="label">{f.label}</label>
        <input type="date" className="input" value={val} onChange={(e) => setExtra(f, e.target.value)} /></div>;
    }
    if (f.kind === "text") {
      return <div key={f.key}><label className="label">{f.label}</label>
        <input className="input" value={val} onChange={(e) => setExtra(f, e.target.value)} /></div>;
    }
    if (f.kind === "product") {
      return <div key={f.key}><label className="label">{f.label}</label>
        <ProductPicker products={products} value={val || null}
          onChange={(id) => setExtra(f, id ?? "")} placeholder="Item / product" /></div>;
    }
    const derived = !!f.derived && !overridden[f.key];
    return (
      <div key={f.key}>
        <label className="label">
          {f.label}
          {f.hint && <span className="ml-1 font-normal normal-case text-slate-400">({f.hint})</span>}
          {derived && <span className="ml-1 font-normal normal-case text-slate-400">· auto</span>}
        </label>
        <input className={`input text-right tabular-nums ${derived ? "bg-slate-50 text-slate-600" : ""}`} inputMode="decimal"
          value={val} onChange={(e) => setExtra(f, e.target.value)}
          placeholder={f.kind === "percent" ? "0.00" : f.kind === "int" ? "0" : "0.00"} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">{cfg.title}</h1>
        {isCar && <span className="rounded-full bg-brand/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-brand">car sales</span>}
        {done && <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700 capitalize">{done}</span>}
      </div>

      <div className="card flex flex-wrap items-center gap-2 py-2">
        <button onClick={() => resetNew()} disabled={busy} className="btn-outline text-sm">＋ New</button>
        <button onClick={() => nav("prev")} disabled={busy} className="btn-outline text-sm">‹ Previous</button>
        <button onClick={() => nav("next")} disabled={busy} className="btn-outline text-sm">Next ›</button>
        {loadTitle && (
          <button onClick={() => setLoadOpen(true)} disabled={busy || posted || awaiting} className="btn text-sm disabled:opacity-40">
            ⤓ Load {loadTitle}
          </button>
        )}
        {sourceNo && (
          <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
            from {sourceNo}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {posted && <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium uppercase text-green-700">posted</span>}
          {awaiting && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium uppercase text-amber-700">awaiting authorisation</span>}
          <button onClick={printDoc} disabled={!id || !may("print")} title={may("print") ? undefined : "You don't have Print rights on this voucher"} className="btn-outline text-sm disabled:opacity-40">🖨 Print</button>
          <button onClick={del} disabled={!id || busy || postedLock() || awaiting || !may("delete")}
            title={!may("delete") ? "You don't have Delete rights on this voucher"
              : postedLock() ? "This voucher is posted. Deleting it needs the Edit/Delete Posted right, which an administrator grants."
              : undefined}
            className="btn-outline text-sm text-red-600 disabled:opacity-40">🗑 Delete</button>
        </div>
      </div>

      {loadOpen && loadTitle && (
        <LoadFromPicker targetType={cfg.type} sourceTitle={loadSourceTitle}
          onPick={loadFrom} onClose={() => setLoadOpen(false)} />
      )}

      {carReturn && (
        <div className="rounded border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">
          <span className="font-medium">
            Vehicle {carReturn.vehicle_no ?? ""} coming back{sourceNo ? ` against ${sourceNo}` : ""}.
          </span>{" "}
          {carReturn.sold_for ? <>It was sold for <strong>{money(carReturn.sold_for)}</strong>. </> : null}
          Type what it is worth on the way back — that amount comes off the customer&apos;s account, and the
          balance there decides whether they still owe or we owe them a refund. The car goes back into stock at
          its own cost, flagged as returned.
        </div>
      )}

      {posted && mayUnpost() && (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span className="font-medium">This voucher is already in the ledger.</span>{" "}
          Saving it again replaces its ledger entry and re-applies the stock at the new figures; deleting it
          takes both back out. Anything raised from it has to go first.
        </div>
      )}

      {err && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}

      <div className="card space-y-4">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div><label className="label">Document No.</label>
            <input className="input font-mono" value={docNo} placeholder="Auto" onChange={(e) => setDocNo(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); loadByNo(); } }} /></div>
          <div><label className="label">Date</label><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          {/* Purchase / Sale Account sits right after Date. */}
          {headerExtras.filter((f) => f.kind === "account").map(headerField)}
          {cfg.party && (
            <div><label className="label">{cfg.party === "supplier" ? "Vendor" : "Customer"}</label>
              <select className="input" value={party} onChange={(e) => setParty(e.target.value)}>
                <option value="">— select —</option>{parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></div>
          )}
          <div><label className="label">Cost Center</label>
            <select className="input" value={costCenter} onChange={(e) => setCostCenter(e.target.value)}>
              <option value="">—</option>{costCenters.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select></div>
          {cfg.showTagArea !== false && (
            <div><label className="label">Tag Area</label>
              <select className="input" value={tagArea} onChange={(e) => setTagArea(e.target.value)}>
                <option value="">—</option>{tagAreas.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select></div>
          )}
          <div><label className="label">Reference</label><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} /></div>
          {canPost && cfg.showWarehouse && (
            <div><label className="label">Warehouse</label>
              <select className="input" value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
                <option value="">— none (no stock) —</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select></div>
          )}
          {cfg.showMode && (
            <div><label className="label">Mode of Payment</label>
              <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="">—</option>
                {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select></div>
          )}
          {cfg.showDue && <div><label className="label">Due Date</label><input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>}
          {cfg.showDelivery && <div><label className="label">Delivery Date</label><input type="date" className="input" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} /></div>}
          {headerExtras.filter((f) => f.kind === "check" && !(carReturn && f.key === "update_stock")).map(headerField)}
          {cfg.showTerms && <div className="md:col-span-2"><label className="label">Terms</label><input className="input" value={terms} onChange={(e) => setTerms(e.target.value)} /></div>}
          <div className="md:col-span-2"><label className="label">Narration</label><input className="input" value={narration} onChange={(e) => setNarration(e.target.value)} /></div>
        </div>

        {/* Car-sales costing block — only for CAR SALES INSTALLMENT / CAR TRADING. */}
        {isCar && (cfg.carHeaderExtras?.length ?? 0) > 0 && (
          <div className="rounded-lg border border-brand/20 bg-brand/[0.03] p-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand">Car Sales Details</div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {(cfg.carHeaderExtras ?? []).map(headerField)}
            </div>
          </div>
        )}

        {!hideLines && (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-2 py-2 text-left">#</th>
                {cfg.tagAreaInLine && <th className="px-2 py-2 text-left">Tag Area</th>}
                <th className="px-2 py-2 text-left">Item</th>
                {showUnits && <th className="px-2 py-2 text-left">Units</th>}
                <th className="px-2 py-2 text-right">{cfg.qtyLabel ?? "Quantity"}</th>
                {preRateExtras.map((x) => <th key={x.key} className={`px-2 py-2 ${x.kind === "text" ? "text-left" : "text-right"}`}>{x.label}</th>)}
                {showRateAmount && <th className="px-2 py-2 text-right">Rate</th>}
                {showRateAmount && <th className="px-2 py-2 text-right">Amount</th>}
                {postExtras.map((x) => <th key={x.key} className={`px-2 py-2 ${x.kind === "text" ? "text-left" : "text-right"}`}>{x.label}</th>)}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-2 py-1 text-slate-400">{i + 1}</td>
                  {cfg.tagAreaInLine && (
                    <td className="px-2 py-1">
                      <select className="input w-32" value={r.extras.tag_area ?? ""} onChange={(e) => setRowExtra(i, "tag_area", e.target.value)}>
                        <option value="">—</option>{tagAreas.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                      </select>
                    </td>
                  )}
                  <td className="px-2 py-1 min-w-[220px]">
                    <ProductPicker products={products} value={r.product_id} onChange={(id) => pickItem(i, id)} placeholder="Item / product" />
                  </td>
                  {showUnits && <td className="px-2 py-1"><input className="input w-24" value={r.units} onChange={(e) => setRow(i, { units: e.target.value })} /></td>}
                  <td className="px-2 py-1"><input className="input w-28 text-right tabular-nums" inputMode="decimal" value={r.quantity} onChange={(e) => setRow(i, { quantity: e.target.value })} /></td>
                  {preRateExtras.map((x) => (
                    <td key={x.key} className="px-2 py-1">
                      <input className={`input ${x.kind === "text" ? "w-56" : "w-36 text-right tabular-nums"}`}
                        inputMode={x.kind === "text" ? undefined : "decimal"}
                        value={r.extras[x.key] ?? ""} onChange={(e) => setRowExtra(i, x.key, e.target.value)} />
                    </td>
                  ))}
                  {showRateAmount && (
                    <td className="px-2 py-1">
                      <input
                        className={`input w-36 text-right tabular-nums ${overCeiling.has(i) ? "border-red-400 bg-red-50 text-red-700" : ""}`}
                        title={overCeiling.has(i) ? `Above the item's Purchase Rate (${r.extras.so_purchase_rate})` : undefined}
                        inputMode="decimal" value={r.rate} onChange={(e) => setRow(i, { rate: e.target.value })} />
                    </td>
                  )}
                  {showRateAmount && <td className="px-2 py-1"><input className="input w-40 text-right tabular-nums" inputMode="decimal" value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} /></td>}
                  {postExtras.map((x) => (
                    <td key={x.key} className="px-2 py-1">
                      <input className={`input ${x.kind === "text" ? "w-56" : "w-36 text-right tabular-nums"}`}
                        inputMode={x.kind === "text" ? undefined : "decimal"}
                        value={r.extras[x.key] ?? ""} onChange={(e) => setRowExtra(i, x.key, e.target.value)} />
                    </td>
                  ))}
                  <td className="px-1 text-center"><button onClick={() => removeRow(i)} className="text-slate-300 hover:text-red-500" title="Remove">×</button></td>
                </tr>
              ))}
            </tbody>
            {showRateAmount && (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                  <td />
                  {/* Everything from Tag Area through Rate, so Subtotal lands under Amount. */}
                  <td className="px-2 py-2 text-slate-500"
                      colSpan={(cfg.tagAreaInLine ? 1 : 0) + 1 + (showUnits ? 1 : 0) + 1 + preRateExtras.length + 1}>
                    Subtotal
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{money(subtotal)}</td>
                  {postExtras.map((x) => (
                    <td key={x.key} className="px-2 py-2 text-right tabular-nums text-slate-500">
                      {x.kind === "text" ? "" : money(rows.reduce((s, r) => s + num(r.extras[x.key]), 0))}
                    </td>
                  ))}
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        )}

        <div className="flex flex-wrap items-end justify-end gap-6">
          {costColumns.length > 0 && extraCosts !== 0 && (
            <div className="mr-auto text-sm">
              <span className="text-slate-500">Expenses on lines</span>
              <span className="ml-2 font-semibold tabular-nums text-slate-700">{money(extraCosts)}</span>
              <span className="ml-4 text-slate-500">Landed cost</span>
              <span className="ml-2 font-semibold tabular-nums text-slate-700">{money(landedCost)}</span>
              <div className="text-xs text-slate-400">Recorded on the lines for costing; the document total below stays the supplier&apos;s billed amount.</div>
            </div>
          )}
          {showRateAmount && cfg.showDiscount && (
            <div>
              <label className="label">Discount</label>
              <input className="input w-32 text-right tabular-nums" inputMode="decimal" value={discount}
                onChange={(e) => setDiscount(e.target.value)} placeholder="0.00" />
            </div>
          )}
          {showRateAmount && <div><label className="label">Round Off</label><input className="input w-28 text-right tabular-nums" inputMode="decimal" value={roundOff} onChange={(e) => setRoundOff(e.target.value)} placeholder="0.00" /></div>}
          {showRateAmount && (
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide text-slate-400">Net Total</div>
              <div className="text-2xl font-bold text-brand">{money(total)}</div>
              {discountAmt !== 0 && (
                <div className="text-xs text-slate-400">{money(subtotal)} &minus; {money(discountAmt)} discount</div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button onClick={save} disabled={busy || postedLock() || awaiting || !mayWrite()} className="btn disabled:opacity-40">
            {busy ? "Saving…" : postedLock() ? "Posted (locked)" : awaiting ? "Awaiting authorisation"
              : !mayWrite() ? (id ? "No Edit rights" : "No Create rights")
              : posted ? "Re-post changes" : id ? "Save changes" : "Save"}
          </button>
          {!hideLines && <button onClick={() => setRows((r) => [...r, blankRow()])} className="btn-outline text-sm">+ Line</button>}
          <span className="ml-auto text-xs text-slate-400">{id ? `Editing ${docNo}` : "New document — number auto-assigned on save."}</span>
        </div>
      </div>
    </div>
  );
}
