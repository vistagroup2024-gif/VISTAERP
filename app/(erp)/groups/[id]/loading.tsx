import { SkeletonPageHeader, SkeletonFields, SkeletonTable } from "@/components/ui/Skeleton";

// A group opens as a block of facts over its allocation table.
export default function Loading() {
  return (
    <div className="space-y-4">
      <SkeletonPageHeader withSubtitle />
      <div className="card"><SkeletonFields count={12} cols={4} /></div>
      <SkeletonTable cols={6} rows={6} />
    </div>
  );
}
