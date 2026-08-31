// Groups related fields under a quiet section title with a divider — the
// standard form layout across the ERP (Basic / Financial / Details …). Children
// are laid out on a responsive 2-column grid by default.
export default function FormSection({
  title, description, children, cols = 2,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  cols?: 1 | 2 | 3;
}) {
  const grid = cols === 1 ? "sm:grid-cols-1" : cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2";
  return (
    <section className="border-b border-slate-100 pb-5 last:border-0 last:pb-0">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-slate-400">{description}</p>}
      </div>
      <div className={`grid grid-cols-1 gap-4 ${grid}`}>{children}</div>
    </section>
  );
}

// A single labelled field. `required` shows a subtle asterisk; `full` spans the
// whole grid row.
export function Field({
  label, required, full, hint, children,
}: {
  label: string;
  required?: boolean;
  full?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={full ? "sm:col-span-full" : ""}>
      <label className="label">
        {label}{required && <span className="ml-0.5 text-danger">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
