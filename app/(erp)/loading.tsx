/**
 * What every ERP screen shows while its server render is still running.
 *
 * Next.js renders this the instant a navigation starts, in place of the page,
 * inside the ERP layout — so the sidebar, the header and Back / Home stay put
 * and live, and only the content area is replaced. Without it the browser sits
 * on the previous screen with no sign anything is happening, which is what made
 * a first visit feel frozen rather than slow.
 *
 * It is deliberately dumb: a server component, no "use client", no JavaScript,
 * no state, no timers. The only movement is the pulse already defined by the
 * `.skeleton` class in globals.css, switched off for anyone who has asked their
 * system for reduced motion.
 *
 * The shape is the shape most ERP screens actually have — a title bar with an
 * action, a filter row, a few figures, then a table. It is a placeholder, not a
 * promise: a screen that turns out to be a voucher form simply replaces it.
 *
 * To remove this entirely, delete this file. Nothing imports it and nothing
 * else changes.
 */

const ROWS = 8;      // about a screenful on a laptop
const COLS = 5;

function Bar({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`skeleton motion-reduce:animate-none ${className}`} />;
}

export default function ErpLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading…</span>

      {/* Title bar — the same rule and spacing PageHeader draws. */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
        <div className="space-y-2">
          <Bar className="h-6 w-52" />
          <Bar className="h-3.5 w-72 max-w-full" />
        </div>
        <Bar className="h-9 w-28 rounded-md" />
      </div>

      {/* Filters / search. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Bar className="h-9 w-full rounded-md sm:w-64" />
        <Bar className="h-9 w-32 rounded-md" />
        <Bar className="h-9 w-32 rounded-md" />
        <Bar className="ml-auto hidden h-4 w-24 sm:block" />
      </div>

      {/* A few figures across the top, as most list and dashboard screens have. */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card space-y-3 p-4">
            <Bar className="h-3 w-20" />
            <Bar className="h-6 w-28" />
          </div>
        ))}
      </div>

      {/* The table. */}
      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr>
                {Array.from({ length: COLS }).map((_, c) => (
                  <th key={c} className="th">
                    <Bar className={`h-3 ${c === 0 ? "w-24" : c === COLS - 1 ? "ml-auto w-16" : "w-20"}`} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: ROWS }).map((_, r) => (
                <tr key={r}>
                  {Array.from({ length: COLS }).map((_, c) => (
                    <td key={c} className="td">
                      <Bar
                        className={
                          c === 0 ? "h-3.5 w-28"
                          : c === COLS - 1 ? "ml-auto h-3.5 w-16"
                          : "h-3.5 w-20"
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
