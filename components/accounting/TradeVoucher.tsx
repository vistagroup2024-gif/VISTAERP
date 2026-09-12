"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import ProductPicker, { productOptions } from "./ProductPicker";
import LoadFromPicker from "./LoadFromPicker";
import { TRADE_DOCS, isCarCostCenter, megaCount, type HeaderExtra, type LineExtra } from "@/lib/tradeDocs";
import type { DocRight } from "@/lib/docRights";
import SearchSelect from "@/components/ui/SearchSelect";
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
// Wall-clock month arithmetic, UTC-anchored so the viewer's zone cannot move a
// due date across a day boundary. It never asks what time it is.
function addMonthsISO(iso: string, n: number) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, d)).toISOString().slice(0, 10);
}

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
  // Round Off is a tick, not a number to work out by hand. Ticking it rounds the
  // document to the nearest whole riyal; the amount it took to get there is what
  // gets stored in round_off, exactly as if it had been typed.
  const [roundOffOn, setRoundOffOn] = useState(false);
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
  // A second party list, for the one document that has two sides. Fetched only
  // when a `party` header field asks for it, so no other voucher pays for it.
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  // The document's own currency and what it converts to base at. Blank / 1 for
  // everything priced in SAR, which is nearly everything.
  const [currency, setCurrency] = useState("");
  const [fxRate, setFxRate] = useState("");
  const [products, setProducts] = useState<{ id: string; name: string; group?: string | null; purchase_rate?: number | null; total_cost?: number | null }[]>([]);
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
  // A Delivery Note says the goods LEFT. This is what says they ARRIVED — a
  // separate event, days apart on a car, and the one the Monthly Service Charge
  // is billed from.
  const [delivered, setDelivered] = useState(false);
  const [deliveredDate, setDeliveredDate] = useState("");
  // The instalment schedule agreed at the ORDER. The Car Invoice raised from it
  // starts with the dates and amounts the customer signed up to, rather than a
  // schedule regenerated from round numbers weeks later.
  const [sched, setSched] = useState<{ due_date: string; amount: string; notes: string }[]>([]);
  const [schedStart, setSchedStart] = useState(() => todaySA());
  const [loadOpen, setLoadOpen] = useState(false);
  // These trade documents post to the GL (+ stock); the rest are paperwork only.
  const canPost = ["purchase_voucher", "purchase_return", "sales_return", "sales_invoice"].includes(cfg.type);

  // Car-sales cost centres (CAR SALES INSTALLMENT / CAR TRADING) reveal the
  // costing block and the vehicle expense columns.
  const isCar = isCarCostCenter(costCenter);
  // What the Load button is called. On a car cost centre a Purchase Voucher is
  // raised from the Purchase Order rather than an MRN — a car has no warehouse
  // to be received into — so the button has to say so. The DATABASE decides
  // which document is actually accepted (trade_doc_source_type_for); this is
  // only the wording, and getting it wrong would name a document the picker is
  // not going to show.
  const loadsFrom = (isCar && cfg.carLoadsFrom) || cfg.loadsFrom;
  const loadTitle = [loadsFrom?.title, cfg.alsoLoadsFrom?.title].filter(Boolean).join(" / ");
  const loadSourceTitle = [loadsFrom?.title, cfg.alsoLoadsFrom?.title].filter(Boolean).join(" or ");
  // A car sale is one vehicle at one price, both already in the costing block,
  // so the grid is not shown. The LINE is still written on save — it is what
  // carries the vehicle to the Car Invoice — it is just not typed by hand.
  const hideLines = isCar && !!cfg.hideLinesForCar;
  /* A car document that keeps its grid AND carries the costing block above it —
     the Sale Order. Its single line is the car being sold, so the line writes
     itself from the header rather than being typed twice. */
  const carGrid = isCar && !hideLines && (cfg.carHeaderExtras?.length ?? 0) > 0;
  // Set once the amount on that line has been typed by hand: from then on the
  // header's Selling Price stops overwriting it, because the line is what the
  // Car Invoice reads and a price agreed at ordering has to survive.
  const [carAmountTouched, setCarAmountTouched] = useState(false);
  // The list is not fixed: Mega Installment Quantity decides how many amount
  // boxes follow it, so the boxes are generated from what has been typed rather
  // than declared up front. Everything downstream — what gets saved, what the
  // derived Monthly Installment reads — works off this list, so generating them
  // here is enough; nothing else has to know they are dynamic.
  const headerExtras: HeaderExtra[] = useMemo(() => {
    const base = [...(cfg.headerExtras ?? []), ...(isCar ? cfg.carHeaderExtras ?? [] : [])];
    const at = base.findIndex((f) => f.key === "mega_qty");
    if (at < 0) return base;
    const many = megaCount(extras);
    const boxes: HeaderExtra[] = Array.from({ length: many }, (_, i) => ({
      key: `mega_${i + 1}`, label: `Mega Installment ${i + 1} Amount`, kind: "money" as const,
    }));
    return [...base.slice(0, at + 1), ...boxes, ...base.slice(at + 1)];
  }, [cfg, isCar, extras]);
  const lineExtras: LineExtra[] = useMemo(
    () => (isCar && cfg.carLineExtras ? cfg.carLineExtras : cfg.lineExtras ?? []),
    [cfg, isCar]);
  // Columns that sit left of Rate, and the rest that follow Amount.
  const preRateExtras = useMemo(() => lineExtras.filter((x) => x.beforeRate), [lineExtras]);
  const postExtras = useMemo(() => lineExtras.filter((x) => !x.beforeRate), [lineExtras]);
  const showRateAmount = !cfg.hideRateAmount;

  /** What an extra column shows for a row. A derived column (Supplier Amount)
   *  is worked out from the row; everything else is what was typed. One
   *  function, so the cell, the column total and the save cannot disagree. */
  const extraCell = useCallback((x: LineExtra, r: Row): string => {
    if (!x.derived) return r.extras[x.key] ?? "";
    const v = x.derived({ qty: num(r.quantity), rate: num(r.rate), amount: num(r.amount), extras: r.extras });
    return Number.isFinite(v) && v !== 0 ? String(Math.round(v * 100) / 100) : v === 0 ? "0" : "";
  }, []);
  // A vehicle is one car, not a quantity of something — Units means nothing on a
  // car cost centre, so the column is not shown and nothing is stored in it.
  const showUnits = !isCar;

  useEffect(() => {
    (async () => {
      const types = cfg.party === "supplier" ? ["supplier"] : cfg.party === "customer" ? ["customer", "b2b_agent"] : ["customer", "supplier", "b2b_agent"];
      const [{ data: pa }, { data: pr }, { data: cc }, { data: ta }, { data: wh }, { data: ac }] = await Promise.all([
        supabase.from("parties").select("id, name").in("party_type", types).eq("is_active", true).order("name"),
        supabase.from("acct_products").select("id, name, parent_id, is_group, purchase_rate, total_cost").eq("is_active", true).order("name"),
        supabase.from("acct_cost_centers").select("id, name").eq("is_active", true).eq("is_group", false).order("name"),
        supabase.from("acct_tag_areas").select("id, name").eq("is_active", true).eq("is_group", false).order("name"),
        supabase.from("warehouses").select("id, name").eq("is_active", true).order("name"),
        supabase.from("accounts").select("id, code, name").eq("is_postable", true).eq("is_group", false).order("code"),
      ]);
      setParties((pa as any[]) ?? []); setProducts(productOptions((pr as any[]) ?? []));
      // Only when the voucher declares a second party. Asking for it on every
      // voucher would be a query nobody reads.
      if ((cfg.headerExtras ?? []).some((f) => f.kind === "party")) {
        const { data: sp } = await supabase.from("parties")
          .select("id, name").eq("party_type", "supplier").eq("is_active", true).order("name");
        setSuppliers((sp as any[]) ?? []);
      }
      setCostCenters((cc as any[]) ?? []); setTagAreas((ta as any[]) ?? []);
      setWarehouses((wh as any[]) ?? []); setAccounts((ac as any[]) ?? []);
    })();
  }, [supabase, cfg.party, cfg.headerExtras]);


  /** What a new voucher's extra fields start at: ticked check boxes, and any
   *  field carrying a defaultValue (Percentage, which is 3). */
  const extraDefaults = useCallback(() => Object.fromEntries(
    headerExtras
      .filter((f) => (f.kind === "check" && f.defaultOn) || f.defaultValue != null)
      .map((f) => [f.key, f.kind === "check" ? "true" : f.defaultValue!])
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
    setReference(""); setMode(""); setDueDate(""); setDeliveryDate(""); setTerms(""); setNarration(""); setRoundOff(""); setRoundOffOn(false); setDiscount("");
    setCurrency(""); setFxRate("");
    setRows([blankRow()]); setWarehouse(""); setPosted(false); setExtras(extraDefaults()); setOverridden({}); setCarAmountTouched(false);
    setSourceId(null); setSourceNo(null); setSourceCar(null); setAwaiting(false); setCarReturn(null);
    setDelivered(false); setDeliveredDate(""); setSched([]); setSchedStart(todaySA());
  }
  // Confirming a delivery is a change to the SAVED note, not part of the form,
  // so it goes straight to the database rather than waiting for Save. A note
  // that has not been saved yet has no delivery to confirm.
  async function markDelivered(on: boolean) {
    if (!id) return;
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc("trade_doc_mark_delivered", {
      p_id: id, p_delivered: on, p_date: on ? (deliveredDate || todaySA()) : null,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setDelivered(on);
    setDeliveredDate(on ? ((data as any)?.delivered_date ?? deliveredDate ?? todaySA()) : "");
    setDone(on ? "Marked delivered." : "Delivery confirmation removed.");
  }

  function setRow(i: number, patch: Partial<Row>) {
    setRows((rs) => {
      const next = rs.map((r, j) => (j === i ? { ...r, ...patch } : r));
      const r = next[i];
      // amount auto = qty*rate unless the user typed an amount directly
      if (patch.quantity !== undefined || patch.rate !== undefined) r.amount = String(+(num(r.quantity) * num(r.rate)).toFixed(2) || "");
      if (!carGrid && i === next.length - 1 && (patch.item_name || patch.product_id || patch.amount || patch.quantity)) next.push(blankRow());
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
    // On a car document the Selling Price IS the document total — there is no
    // grid under it — so rounding has to reach the Selling Price itself, not sit
    // beside it as a separate adjustment. Rounding here means the price the
    // customer is quoted, the line the Car Invoice reads and the Net Total are
    // all the one rounded figure, instead of the first two disagreeing with the
    // third. Recomputed rather than written back, so changing the cost still
    // re-derives the price and re-rounds it.
    if (roundOffOn && hideLines && v.selling_price != null && v.selling_price !== "") {
      v.selling_price = r2(Math.round(Number(v.selling_price) || 0));
    }
    return v;
  }, [extras, headerExtras, overridden, roundOffOn, hideLines]);

  function setExtra(f: HeaderExtra, value: string) {
    setExtras((e) => ({ ...e, [f.key]: value }));
    if (f.derived) setOverridden((o) => ({ ...o, [f.key]: value.trim() !== "" }));
  }

  const showSchedule = isCar && !!cfg.carSchedule;
  const schedTotal = useMemo(() => sched.reduce((t, r) => t + num(r.amount), 0), [sched]);
  // What the schedule is SUPPOSED to add up to. The Car Invoice enforces
  // advance + instalments = net payable, so an order whose schedule does not
  // reach it is an order that cannot be invoiced without being retyped. Shown
  // here rather than refused: an order is still being negotiated.
  const schedTarget = useMemo(
    () => num(extraValues.selling_price ?? "") - num(extraValues.advance ?? ""),
    [extraValues]);
  const schedDiff = useMemo(() => +(schedTarget - schedTotal).toFixed(2), [schedTarget, schedTotal]);

  /** Build the schedule from the costing block: the mega instalments first, on
   *  their own months, then the monthly figure for the rest. */
  function generateSchedule() {
    const months = Math.max(0, parseInt(extraValues.installment_months ?? "") || 0);
    if (months <= 0) { setErr("Set the Installment Months first."); return; }
    const monthly = num(extraValues.monthly_installment ?? "");
    const megas = megaCount(extraValues);
    const rows2: { due_date: string; amount: string; notes: string }[] = [];
    for (let i = 0; i < months; i++) {
      rows2.push({ due_date: addMonthsISO(schedStart, i), amount: r2(monthly), notes: "" });
    }
    // A mega instalment is an EXTRA payment in its month, not a replacement for
    // that month's instalment, so it is its own row.
    for (let i = 1; i <= megas; i++) {
      const amt = num(extraValues[`mega_${i}`] ?? "");
      if (amt <= 0) continue;
      rows2.push({ due_date: addMonthsISO(schedStart, Math.min(i * 6, Math.max(months - 1, 0))),
                   amount: r2(amt), notes: `Mega instalment ${i}` });
    }
    rows2.sort((a, b) => a.due_date.localeCompare(b.due_date));
    setErr(null);
    setSched(rows2);
  }


  // Choosing the Item / Vehicle fills Total Cost (COGS) from the Product Tree.
  //
  // That figure is the base of the whole costing block — Investment, Margin and
  // Selling Price are all worked out from it — and it used to be typed from
  // memory on every quotation. It is knowable: the item's Purchase Rate plus its
  // Expenses, which is exactly what acct_products.total_cost adds up.
  //
  // It stays an ordinary editable box. Typing over it wins, because a particular
  // car can cost something the catalogue does not know; picking a different
  // vehicle fills it again, because that is a different car.
  function pickHeaderProduct(f: HeaderExtra, id: string | null) {
    setExtra(f, id ?? "");
    // A different vehicle is a different price, so a hand-typed line amount is
    // no longer the agreed one — let it fill from the new car's costing.
    setCarAmountTouched(false);
    if (!headerExtras.some((x) => x.key === "total_cost")) return;
    const cost = Number(products.find((p) => p.id === id)?.total_cost ?? 0);
    setExtras((e) => ({ ...e, total_cost: cost > 0 ? String(cost) : "" }));
  }

  /* The line is the car: the Item / Vehicle from the header, one of it, at the
     Selling Price the costing block worked out. It is a real grid line, so the
     amount can be adjusted — and because trade_doc_save writes it and the Car
     Invoice reads it, that adjusted figure is the one that gets invoiced. */
  useEffect(() => {
    if (!carGrid) return;
    const pid = (extraValues.item_id ?? "").trim() || null;
    const price = num(extraValues.selling_price ?? "");
    const priceStr = price > 0 ? String(price) : "";
    setRows((rs) => {
      const r0 = rs[0] ?? blankRow();
      const next: Row = {
        ...r0,
        product_id: pid ?? r0.product_id,
        item_name: pid ? (products.find((p) => p.id === pid)?.name ?? r0.item_name) : r0.item_name,
        quantity: r0.quantity || "1",
        ...(carAmountTouched ? {} : { rate: priceStr, amount: priceStr }),
      };
      const same = next.product_id === r0.product_id && next.item_name === r0.item_name
        && next.quantity === r0.quantity && next.rate === r0.rate && next.amount === r0.amount;
      return same ? rs : [next, ...rs.slice(1)];
    });
  }, [carGrid, extraValues.item_id, extraValues.selling_price, products, carAmountTouched]);

  /* What a Sale Order takes from the Sales Quotation it was loaded from is the
     quotation's answer, not a second place to change it — change the costing and
     the quotation the customer holds no longer says what the order says. Those
     boxes are shown, and locked. Everything the quotation does NOT carry (the
     Advance Due Date, the Mega Installment, and the line amount) stays open. */
  const lockedHeaderKeys = useMemo(() => {
    if (!sourceId || !loadsFrom?.type) return new Set<string>();
    const src = TRADE_DOCS[loadsFrom.type];
    const keys = new Set((src?.carHeaderExtras ?? []).map((x) => x.key));
    // The mega instalment boxes are generated, so they are not in the source's
    // declared list — but they came across from the quotation with everything
    // else and must lock with it. Locking the quantity while leaving the amounts
    // open would let the order quietly disagree with the quotation the customer
    // is holding, which is the whole point of locking these.
    if (keys.has("mega_qty")) for (let i = 1; i <= megaCount(extras); i++) keys.add(`mega_${i}`);
    return keys;
  }, [sourceId, loadsFrom?.type, extras]);

  const subtotal = useMemo(
    () => (hideLines ? num(extraValues.selling_price ?? "") : rows.reduce((s, r) => s + num(r.amount), 0)),
    [rows, hideLines, extraValues],
  );
  // The discount comes off before the round-off, so Net Total is what the
  // supplier is actually owed — and it is this figure that posts.
  const discountAmt = cfg.showDiscount ? num(discount) : 0;
  const baseTotal = subtotal - discountAmt;
  // With the tick on, the round-off is whatever it takes to reach a whole riyal.
  // On a car document the Selling Price above has already been rounded, so that
  // difference is zero and nothing is added twice.
  const roundOffAmt = roundOffOn
    ? +(Math.round(baseTotal) - baseTotal).toFixed(2)
    : num(roundOff);
  const total = baseTotal + roundOffAmt;
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
    // "SAR" is what trade_doc_save defaults to, so showing it back is showing a
    // value nobody typed; the box says SAR as its placeholder already.
    setCurrency(v.currency && v.currency !== "SAR" ? v.currency : "");
    setFxRate(v.meta?.fx_rate ? String(v.meta.fx_rate) : "");
    setRoundOffOn(!!v.meta?.round_off_auto);
    setDiscount(v.meta?.discount ? String(v.meta.discount) : "");
    setWarehouse(v.warehouse_id ?? ""); setPosted(!!v.gl_entry); setAwaiting(v.status === "awaiting_approval");
    setSourceId(v.source_doc_id ?? null); setSourceCar(v.source_car_contract ?? null); setSourceNo(v.source_doc_no ?? null);
    // A saved order keeps the amount it was saved with, whatever the header says.
    setCarAmountTouched(true);
    const meta = (v.meta ?? {}) as Record<string, any>;
    setDelivered(!!v.delivered);
    setDeliveredDate(v.delivered_date ?? "");
    setSched(Array.isArray(v.meta?.installments)
      ? (v.meta.installments as any[]).map((r) => ({
          due_date: r.due_date ?? "", amount: String(r.amount ?? ""), notes: r.notes ?? "" }))
      : []);
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
    // Loading a quotation re-prices the line from its costing; nothing has been
    // agreed on this order yet.
    setCarAmountTouched(false);
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
      terms: terms || null, narration: narration || null, round_off: roundOffAmt,
      ...(cfg.showCurrency ? { currency: currency.trim() || "SAR" } : {}),
      meta: {
        ...meta,
        // The rate the ledger converts at. Stored only when the voucher asks
        // for a currency, and only when it is a real rate — an absent one means
        // 1, which is what the posting reads it as.
        ...(cfg.showCurrency && num(fxRate) > 0 ? { fx_rate: num(fxRate) } : {}),
        ...(cfg.showDiscount ? { discount: discountAmt } : {}),
        // so re-opening the document shows the tick, not a number nobody typed
        round_off_auto: roundOffOn,
        // Only rows with both a date and an amount: a half-typed row would
        // become an instalment of zero on the Car Invoice.
        ...(showSchedule
          ? { installments: sched
              .filter((r) => r.due_date && num(r.amount) > 0)
              .map((r) => ({ due_date: r.due_date, amount: num(r.amount), notes: r.notes || null })) }
          : {}),
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
          const val = extraCell(x, r).trim();
          if (val !== "") lm[x.key] = x.kind === "text" || x.kind === "date" ? val : num(val);
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
    if (carGrid) {
      if (!lines[0]?.product_id) return setErr("Choose the Item / Vehicle.");
      if (!(Number(lines[0]?.amount) > 0)) return setErr("The line amount is zero — enter the price this car is being sold at.");
    }
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

  const lockNote = (
    <span className="ml-1 font-normal normal-case text-slate-400" title="Set on the Sales Quotation this order was loaded from">· from quotation</span>
  );

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
    if (f.kind === "party") {
      const list = f.partyType === "customer" ? parties : suppliers;
      return (
        <div key={f.key}><label className="label">{f.label}</label>
          <SearchSelect value={val} onChange={(v) => setExtra(f, v)} placeholder="—"
            options={list.map((p) => ({ value: p.id, label: p.name }))} /></div>
      );
    }
    if (f.kind === "account") {
      return (
        <div key={f.key}><label className="label">{f.label}</label>
          <SearchSelect value={val} onChange={(v) => setExtra(f, v)} placeholder="— default —"
            options={accounts.map((a) => ({ value: a.id, label: a.name }))} /></div>
      );
    }
    if (f.kind === "date") {
      return <div key={f.key}><label className="label">{f.label}{lockedHeaderKeys.has(f.key) && lockNote}</label>
        <input type="date" className={`input ${lockedHeaderKeys.has(f.key) ? "bg-slate-50 text-slate-600" : ""}`}
          value={val} readOnly={lockedHeaderKeys.has(f.key)} onChange={(e) => setExtra(f, e.target.value)} /></div>;
    }
    if (f.kind === "text") {
      return <div key={f.key}><label className="label">{f.label}{lockedHeaderKeys.has(f.key) && lockNote}</label>
        <input className={`input ${lockedHeaderKeys.has(f.key) ? "bg-slate-50 text-slate-600" : ""}`}
          value={val} readOnly={lockedHeaderKeys.has(f.key)} onChange={(e) => setExtra(f, e.target.value)} /></div>;
    }
    const locked = lockedHeaderKeys.has(f.key);
    if (f.kind === "product") {
      return <div key={f.key}><label className="label">{f.label}{locked && lockNote}</label>
        {locked
          ? <div className="input flex items-center bg-slate-50 text-slate-600">{products.find((p) => p.id === val)?.name ?? "—"}</div>
          : <ProductPicker products={products} value={val || null}
              onChange={(id) => pickHeaderProduct(f, id)} placeholder="Item / product" />}</div>;
    }
    const derived = !!f.derived && !overridden[f.key];
    return (
      <div key={f.key}>
        <label className="label">
          {f.label}
          {f.hint && <span className="ml-1 font-normal normal-case text-slate-400">({f.hint})</span>}
          {derived && !locked && <span className="ml-1 font-normal normal-case text-slate-400">· auto</span>}
          {locked && lockNote}
        </label>
        <input className={`input text-right tabular-nums ${derived || locked ? "bg-slate-50 text-slate-600" : ""}`} inputMode="decimal"
          value={val} readOnly={locked} onChange={(e) => setExtra(f, e.target.value)}
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
              <SearchSelect value={party} onChange={setParty}
                options={parties.map((p) => ({ value: p.id, label: p.name }))} /></div>
          )}
          <div><label className="label">Cost Center</label>
            <SearchSelect value={costCenter} onChange={setCostCenter} placeholder="—"
              options={costCenters.map((c) => ({ value: c.name, label: c.name }))} /></div>
          {cfg.showTagArea !== false && (
            <div><label className="label">Tag Area</label>
              <SearchSelect value={tagArea} onChange={setTagArea} placeholder="—"
                options={tagAreas.map((t) => ({ value: t.name, label: t.name }))} /></div>
          )}
          <div><label className="label">Reference</label><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} /></div>
          {canPost && cfg.showWarehouse && (
            <div><label className="label">Warehouse</label>
              <SearchSelect value={warehouse} onChange={setWarehouse} placeholder="— none (no stock) —"
                options={warehouses.map((w) => ({ value: w.id, label: w.name }))} /></div>
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
          {/* Everything else the voucher declares. Account sits after Date and
              the tick boxes sit here by kind; ordinary fields — Supplier, Haji
              Name, Booking Via, a header Remarks — had NO slot at all, so they
              were configured and then never rendered. This is that slot. Car
              fields are excluded: they have their own block below. */}
          {(cfg.headerExtras ?? [])
            .filter((f) => f.kind !== "account" && f.kind !== "check")
            .map(headerField)}
          {cfg.showCurrency && (
            <>
              <div><label className="label">Currency Name</label>
                <input className="input" value={currency} placeholder="SAR"
                  onChange={(e) => setCurrency(e.target.value)} /></div>
              <div><label className="label">Currency Conv.
                  <span className="ml-1 font-normal normal-case text-slate-400">(to SAR)</span></label>
                <input className="input text-right tabular-nums" inputMode="decimal" value={fxRate}
                  placeholder="1.00" onChange={(e) => setFxRate(e.target.value)} /></div>
            </>
          )}
          {headerExtras.filter((f) => f.kind === "check" && !(carReturn && f.key === "update_stock")).map(headerField)}
          {cfg.showTerms && <div className="md:col-span-2"><label className="label">Terms</label><input className="input" value={terms} onChange={(e) => setTerms(e.target.value)} /></div>}
          <div className="md:col-span-2"><label className="label">Narration</label><input className="input" value={narration} onChange={(e) => setNarration(e.target.value)} /></div>
        </div>

        {/* THE INSTALMENT SCHEDULE, agreed here rather than at the invoice. */}
        {showSchedule && (
          <div className="rounded-lg border border-brand/20 bg-brand/[0.03] p-4">
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-brand">Installment Schedule</div>
              <div className="ml-auto flex items-end gap-2">
                <div>
                  <label className="label">First Due</label>
                  <input type="date" className="input" value={schedStart}
                    onChange={(e) => setSchedStart(e.target.value)} disabled={!mayWrite()} />
                </div>
                <button onClick={generateSchedule} disabled={!mayWrite()}
                  className="btn-outline text-sm disabled:opacity-40">Generate</button>
                <button onClick={() => setSched((r) => [...r, { due_date: "", amount: "", notes: "" }])}
                  disabled={!mayWrite()} className="btn-outline text-sm disabled:opacity-40">+ Row</button>
              </div>
            </div>

            {sched.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-2 py-2 text-left">#</th>
                      <th className="px-2 py-2 text-left">Due Date</th>
                      <th className="px-2 py-2 text-right">Amount</th>
                      <th className="px-2 py-2 text-left">Notes</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {sched.map((r, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-2 py-1 text-slate-400">{i + 1}</td>
                        <td className="px-2 py-1">
                          <input type="date" className="input" value={r.due_date} disabled={!mayWrite()}
                            onChange={(e) => setSched((a) => a.map((x, j) => j === i ? { ...x, due_date: e.target.value } : x))} />
                        </td>
                        <td className="px-2 py-1">
                          <input className="input w-36 text-right tabular-nums" inputMode="decimal" value={r.amount} disabled={!mayWrite()}
                            onChange={(e) => setSched((a) => a.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
                        </td>
                        <td className="px-2 py-1">
                          <input className="input" value={r.notes} disabled={!mayWrite()}
                            onChange={(e) => setSched((a) => a.map((x, j) => j === i ? { ...x, notes: e.target.value } : x))} />
                        </td>
                        <td className="px-2 py-1 text-right">
                          <button onClick={() => setSched((a) => a.filter((_, j) => j !== i))}
                            disabled={!mayWrite()} className="text-slate-300 hover:text-red-500 disabled:opacity-40">✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                    <tr>
                      <td className="px-2 py-2 text-slate-500" colSpan={2}>Scheduled</td>
                      <td className="px-2 py-2 text-right tabular-nums">{money(schedTotal)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {/* The Car Invoice REFUSES a schedule that does not add up to the
                net payable, so an order that does not reach it is an order that
                has to be retyped at the invoice. Said here, where it can still
                be fixed — but not refused: an order is still being negotiated. */}
            {sched.length > 0 && schedDiff !== 0 && (
              <p className="mt-2 text-xs text-amber-700">
                The schedule comes to {money(schedTotal)}, but Selling Price less Advance is {money(schedTarget)} —
                a difference of <b>{money(Math.abs(schedDiff))}</b>. The Car Invoice will not accept it until they agree.
              </p>
            )}
            {sched.length === 0 && (
              <p className="text-xs text-slate-400">
                Set the Installment Months and Percentage above, then Generate — or add rows by hand.
                The Car Invoice raised from this order starts with whatever is here.
              </p>
            )}
          </div>
        )}

        {/* DELIVERED. The note above says the goods were sent; this says the
            customer got them, and it is what the Monthly Service Charge is
            billed from — so it is on the note rather than buried in a report.
            Only on a saved note: there is nothing to confirm before that. */}
        {cfg.showDelivered && id && (
          <div className={`rounded-lg border p-4 ${delivered ? "border-emerald-300 bg-emerald-50/60" : "border-slate-200 bg-slate-50"}`}>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Delivery</div>
                <div className={`mt-1 text-sm font-medium ${delivered ? "text-emerald-700" : "text-slate-600"}`}>
                  {delivered ? "Delivered to the customer" : "Dispatched — not yet confirmed as delivered"}
                </div>
              </div>
              <div>
                <label className="label">Delivered On</label>
                <input type="date" className="input" value={deliveredDate || todaySA()}
                  disabled={!mayWrite()}
                  onChange={(e) => setDeliveredDate(e.target.value)} />
              </div>
              <button
                onClick={() => markDelivered(!delivered)}
                disabled={busy || !mayWrite()}
                className={`${delivered ? "btn-outline" : "btn"} text-sm disabled:opacity-40`}>
                {delivered ? "Undo delivered" : "Mark delivered"}
              </button>
              <p className="w-full text-xs text-slate-400">
                The date is the day the customer actually received the goods, not the day this was
                ticked — the first Monthly Service Charge is worked out from it.
              </p>
            </div>
          </div>
        )}

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
        <div className="space-y-2">
        {!carGrid && (
          <div className="flex justify-end">
            {/* Beside the grid, not down beside Save. Adding a line is something
                you do while reading the lines; having to scroll past the totals
                to a button next to Save — and risk pressing Save — was the wrong
                place for it. */}
            <button onClick={() => setRows((r) => [...r, blankRow()])}
                    className="btn-outline text-sm">+ Line</button>
          </div>
        )}
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-2 py-2 text-left">#</th>
                {cfg.tagAreaInLine && <th className="px-2 py-2 text-left">Tag Area</th>}
                <th className="px-2 py-2 text-left">Item</th>
                {showUnits && <th className="px-2 py-2 text-left">Units</th>}
                <th className="px-2 py-2 text-right">{cfg.qtyLabel ?? "Quantity"}</th>
                {preRateExtras.map((x) => <th key={x.key} className={`px-2 py-2 ${x.kind === "text" || x.kind === "date" ? "text-left" : "text-right"}`}>{x.label}</th>)}
                {showRateAmount && <th className="px-2 py-2 text-right">Rate</th>}
                {showRateAmount && <th className="px-2 py-2 text-right">{cfg.amountLabel ?? "Amount"}</th>}
                {postExtras.map((x) => <th key={x.key} className={`px-2 py-2 ${x.kind === "text" || x.kind === "date" ? "text-left" : "text-right"}`}>{x.label}</th>)}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-2 py-1 text-slate-400">{i + 1}</td>
                  {cfg.tagAreaInLine && (
                    <td className="px-2 py-1">
                      <SearchSelect value={r.extras.tag_area ?? ""} onChange={(v) => setRowExtra(i, "tag_area", v)} className="w-32" placeholder="—" options={tagAreas.map((t) => ({ value: t.name, label: t.name }))} />
                    </td>
                  )}
                  <td className="px-2 py-1 min-w-[220px]">
                    <ProductPicker products={products} value={r.product_id} onChange={(id) => pickItem(i, id)} placeholder="Item / product" />
                  </td>
                  {showUnits && <td className="px-2 py-1"><input className="input w-24" value={r.units} onChange={(e) => setRow(i, { units: e.target.value })} /></td>}
                  <td className="px-2 py-1"><input className="input w-28 text-right tabular-nums" inputMode="decimal" value={r.quantity} onChange={(e) => setRow(i, { quantity: e.target.value })} /></td>
                  {preRateExtras.map((x) => (
                    <td key={x.key} className="px-2 py-1">
                      <input
                        type={x.kind === "date" ? "date" : undefined}
                        className={`input ${x.kind === "text" ? "w-56" : x.kind === "date" ? "w-40" : "w-36 text-right tabular-nums"} ${x.derived ? "bg-slate-50 text-slate-600" : ""}`}
                        inputMode={x.kind === "text" || x.kind === "date" ? undefined : "decimal"}
                        readOnly={!!x.derived}
                        title={x.derived ? "Worked out from Quantity and Supplier Rate" : undefined}
                        value={extraCell(x, r)} onChange={(e) => setRowExtra(i, x.key, e.target.value)} />
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
                  {showRateAmount && <td className="px-2 py-1"><input className="input w-40 text-right tabular-nums" inputMode="decimal" value={r.amount}
                    onChange={(e) => { if (carGrid) setCarAmountTouched(true); setRow(i, { amount: e.target.value }); }} /></td>}
                  {postExtras.map((x) => (
                    <td key={x.key} className="px-2 py-1">
                      <input
                        type={x.kind === "date" ? "date" : undefined}
                        className={`input ${x.kind === "text" ? "w-56" : x.kind === "date" ? "w-40" : "w-36 text-right tabular-nums"} ${x.derived ? "bg-slate-50 text-slate-600" : ""}`}
                        inputMode={x.kind === "text" || x.kind === "date" ? undefined : "decimal"}
                        readOnly={!!x.derived}
                        title={x.derived ? "Worked out from Quantity and Supplier Rate" : undefined}
                        value={extraCell(x, r)} onChange={(e) => setRowExtra(i, x.key, e.target.value)} />
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
                      {x.kind === "text" || x.kind === "date" ? ""
                        : money(rows.reduce((s, r) => s + num(extraCell(x, r)), 0))}
                    </td>
                  ))}
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
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
          {showRateAmount && !cfg.hideRoundOff && (
            <div>
              <label className="label">Round Off</label>
              <label className="flex h-[38px] cursor-pointer items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={roundOffOn} onChange={(e) => setRoundOffOn(e.target.checked)} />
                <span>Round to the nearest riyal</span>
              </label>
            </div>
          )}
          {showRateAmount && (
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide text-slate-400">Net Total</div>
              <div className="text-2xl font-bold text-brand">{money(total)}</div>
              {discountAmt !== 0 && (
                <div className="text-xs text-slate-400">{money(subtotal)} &minus; {money(discountAmt)} discount</div>
              )}
              {roundOffOn && roundOffAmt !== 0 && (
                <div className="text-xs text-slate-400">includes {money(roundOffAmt)} round off</div>
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
          <span className="ml-auto text-xs text-slate-400">{id ? `Editing ${docNo}` : "New document — number auto-assigned on save."}</span>
        </div>
      </div>
    </div>
  );
}
