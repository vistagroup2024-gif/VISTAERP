import Link from "next/link";
import BackButton from "@/components/BackButton";

export default function PageHeader({
  title,
  action,
  children,
  hideBack = false,
}: {
  title: string;
  action?: { href: string; label: string };
  children?: React.ReactNode;
  hideBack?: boolean;
}) {
  return (
    <div className="mb-6 flex items-center justify-between gap-2">
      <div className="flex items-center gap-3">
        {!hideBack && <BackButton />}
        <h1 className="text-2xl font-bold text-slate-800">{title}</h1>
      </div>
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
