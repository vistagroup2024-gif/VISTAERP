/**
 * The shapes a page draws while its data is on the way.
 *
 * A navigation used to hold the old screen until the whole server render had
 * finished — every query, every await — so a click looked like nothing had
 * happened for two or three seconds. These are what the route's `loading.tsx`
 * shows in that gap instead, and they are deliberately the SAME markup as the
 * real thing with the text taken out: the same `.card`, the same `.th`/`.td`,
 * the same PageHeader rule. Nothing moves when the real content replaces them.
 *
 * They are pure layout — no state, no timers, no fake delay. The skeleton is on
 * screen for exactly as long as the data takes and not a millisecond longer.
 */

// Widths are fixed per column rather than random: a `loading.tsx` is rendered on
// the server and hydrated on the client, and a random width would differ between
// the two. This also keeps the shimmer from looking like noise.
const CELL_W = ["w-24", "w-32", "w-16", "w-28", "w-20", "w-36", "w-14", "w-24", "w-20", "w-28", "w-16", "w-32"];

/** The bar every list and detail screen opens with (mirrors PageHeader). */
export function SkeletonPageHeader({ withAction = true, withSubtitle = false }: {
  withAction?: boolean; withSubtitle?: boolean;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
      <div>
        <div className="skeleton h-7 w-52" />
        {withSubtitle && <div className="skeleton mt-1.5 h-4 w-72" />}
      </div>
      {withAction && <div className="skeleton h-9 w-32" />}
    </div>
  );
}

/** A table inside the flush card the list screens use. */
export function SkeletonTable({ cols = 7, rows = 12 }: { cols?: number; rows?: number }) {
  const c = Array.from({ length: cols });
  return (
    <div className="card overflow-hidden p-0">
      <table className="w-full">
        <thead className="bg-slate-50">
          <tr>
            {c.map((_, i) => (
              <th key={i} className="th"><div className="skeleton h-3 w-16" /></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {c.map((_, i) => (
                <td key={i} className="td">
                  <div className={`skeleton h-4 ${CELL_W[(r + i) % CELL_W.length]}`} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The filter/toolbar strip that sits above most tables. */
export function SkeletonToolbar({ items = 4 }: { items?: number }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {Array.from({ length: items }).map((_, i) => (
        <div key={i} className="skeleton h-8" style={{ width: `${5 + (i % 3) * 1.5}rem` }} />
      ))}
    </div>
  );
}

/** Dashboard card grid (mirrors DashboardCard's article). */
export function SkeletonCards({ count = 8, cells = 3 }: { count?: number; cells?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <article key={i} className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <header className="flex items-center justify-between gap-2 border-b border-brand-100 bg-brand-50/70 px-3 py-1.5">
            <div className="skeleton h-3 w-28 bg-brand-200/70" />
          </header>
          <div className="flex flex-1 flex-wrap">
            {Array.from({ length: cells }).map((_, j) => (
              <div key={j} className={`min-w-[4.75rem] flex-1 basis-0 px-2.5 py-2 ${j > 0 ? "border-l border-slate-100" : ""}`}>
                <div className="skeleton h-2.5 w-12" />
                <div className="skeleton mt-1.5 h-6 w-16" />
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

/** A block of labelled fields, as the detail and form screens lay them out. */
export function SkeletonFields({ count = 8, cols = 4 }: { count?: number; cols?: number }) {
  const grid = cols === 2 ? "grid-cols-1 sm:grid-cols-2" : cols === 3
    ? "grid-cols-2 md:grid-cols-3" : "grid-cols-2 md:grid-cols-4";
  return (
    <div className={`grid gap-4 ${grid}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i}>
          <div className="skeleton h-2.5 w-20" />
          <div className="skeleton mt-1.5 h-9 w-full" />
        </div>
      ))}
    </div>
  );
}

/**
 * The voucher shell: title, record toolbar, header fields, line grid, totals.
 * Every voucher screen in the ERP is built this way, so one shape covers them.
 */
export function SkeletonVoucher({ lines = 5 }: { lines?: number }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 pb-4">
        <div className="skeleton h-7 w-48" />
      </div>

      <div className="panel flex flex-wrap items-center gap-2 px-3 py-2">
        <div className="skeleton h-7 w-16" />
        <div className="skeleton h-7 w-24" />
        <div className="skeleton h-7 w-20" />
        <div className="ml-auto flex items-center gap-2">
          <div className="skeleton h-7 w-16" />
          <div className="skeleton h-7 w-16" />
        </div>
      </div>

      <div className="card space-y-4">
        <SkeletonFields count={4} cols={4} />
        <div className="overflow-hidden rounded-md border border-slate-200">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>{Array.from({ length: 5 }).map((_, i) => (
                <th key={i} className="th"><div className="skeleton h-3 w-16" /></th>
              ))}</tr>
            </thead>
            <tbody>
              {Array.from({ length: lines }).map((_, r) => (
                <tr key={r}>{Array.from({ length: 5 }).map((_, i) => (
                  <td key={i} className="td"><div className={`skeleton h-4 ${CELL_W[(r + i) % CELL_W.length]}`} /></td>
                ))}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end gap-6">
          <div className="skeleton h-5 w-28" />
          <div className="skeleton h-5 w-28" />
        </div>
      </div>
    </div>
  );
}

/** A report's filter bar over its result table. */
export function SkeletonReport({ cols = 6, rows = 10 }: { cols?: number; rows?: number }) {
  return (
    <div>
      <SkeletonPageHeader withAction={false} withSubtitle />
      <div className="card mb-4 flex flex-wrap items-end gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="min-w-[9rem] flex-1">
            <div className="skeleton h-2.5 w-16" />
            <div className="skeleton mt-1.5 h-9 w-full" />
          </div>
        ))}
        <div className="skeleton h-9 w-24" />
      </div>
      <SkeletonTable cols={cols} rows={rows} />
    </div>
  );
}
