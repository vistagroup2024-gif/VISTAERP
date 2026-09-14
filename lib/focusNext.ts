// Move the cursor on to the next field, so a voucher can be typed through
// without reaching for the mouse: pick an account and the amount is focused,
// press Enter in a field and the next one is. What counts as "next" is the
// next enabled input, select or textarea in the order they sit on the page —
// buttons are skipped, so Enter never lands on Save by accident.
const FIELDS = "input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea";

export function nextField(from: Element | null): HTMLElement | null {
  if (!from || typeof document === "undefined") return null;
  const all = Array.from(document.querySelectorAll<HTMLElement>(FIELDS)).filter((el) => {
    if ((el as HTMLInputElement).disabled || (el as HTMLInputElement).readOnly) return false;
    if (el.tabIndex < 0 || el.getAttribute("aria-hidden") === "true") return false;
    return el.offsetParent !== null; // visible
  });
  const i = all.indexOf(from as HTMLElement);
  return i >= 0 && i + 1 < all.length ? all[i + 1] : null;
}

export function focusNext(from: Element | null) {
  const el = nextField(from);
  if (!el) return;
  el.focus();
  if (el instanceof HTMLInputElement && el.type !== "date") el.select();
}

// Enter moves on, the way Tab does, except where the field handles Enter
// itself: a type-ahead list (a datalist input picks with Enter), a search
// dropdown, a textarea, and anything marked data-enter-keep.
export function enterMovesOn(e: React.KeyboardEvent) {
  if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target as HTMLElement;
  if (!(t instanceof HTMLInputElement || t instanceof HTMLSelectElement)) return;
  if (t instanceof HTMLInputElement && (t.list || t.type === "checkbox" || t.type === "radio")) return;
  if (t.closest("[data-searchselect], [data-enter-keep]")) return;
  e.preventDefault();
  focusNext(t);
}
