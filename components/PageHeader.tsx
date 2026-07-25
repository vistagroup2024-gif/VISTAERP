import Link from "next/link";

export default function PageHeader({
  title,
  action,
  children,
}: {
  title: string;
  action?: { href: string; label: string };
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex items-center justify-between gap-2">
      <h1 className="text-2xl font-bold text-slate-800">{title}</h1>
      <div className="flex items-center gap-2">
        {children}
        {action && (
          <Link href={action.href} className="btn">
            {action.label}
          </Link>
        )}
      </div>
    </div>
  );
}
