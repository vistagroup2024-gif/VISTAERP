import { SkeletonCards } from "@/components/ui/Skeleton";

// The dashboard is a grid of cards, not a table. Its two metric RPCs are the
// slowest call in the ERP, so this is the skeleton users see most often.
export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="skeleton h-6 w-32" />
          <div className="skeleton h-7 w-28" />
        </div>
        <div className="skeleton h-4 w-56" />
      </div>
      <SkeletonCards count={8} />
    </div>
  );
}
