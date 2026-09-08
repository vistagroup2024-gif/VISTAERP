import { SkeletonPageHeader, SkeletonTable } from "@/components/ui/Skeleton";

/**
 * The B2B agent portal. Its own sidebar and header come from the portal layout,
 * which is outside this boundary, so an agent sees their chrome immediately and
 * only the panel below it fills in.
 */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonTable cols={6} rows={8} />
    </div>
  );
}
