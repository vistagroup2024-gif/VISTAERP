import { SkeletonPageHeader, SkeletonTable } from "@/components/ui/Skeleton";

/**
 * Shown for every ERP screen that has not declared a closer shape of its own.
 *
 * The sidebar, the header bar and Back/Home are drawn by the layout, which sits
 * OUTSIDE this boundary — so they stay on screen and only the page body swaps.
 * Most screens here are a title and a table, so that is what this draws.
 */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonTable cols={7} rows={12} />
    </div>
  );
}
