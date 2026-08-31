import Link from "next/link";
import BackButton from "@/components/BackButton";
import Icon from "@/components/ui/Icon";

// Shared page header used across the ERP. Title + optional subtitle on the left,
// actions on the right. Restrained: a single quiet rule separates it from the
// content, no card or heavy chrome.
export default function PageHeader({
  title,
  subtitle,
  action,
  children,
  hideBack = false,
}: {
  title: string;
  subtitle?: string;
  action?: { href: string; label: string };
  children?: React.ReactNode;
  hideBack?: boolean;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
      <div className="flex items-start gap-3">
        {!hideBack && <BackButton />}
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        {action && (
          <Link href={action.href} className="btn">
            {/* The button draws its own plus, so drop one the caller also typed
                rather than showing "+ + New". */}
            <Icon name="plus" size={16} /> {action.label.replace(/^\s*[+＋]\s*/, "")}
          </Link>
        )}
      </div>
    </div>
  );
}
