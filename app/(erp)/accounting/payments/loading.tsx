import { SkeletonVoucher } from "@/components/ui/Skeleton";

// Voucher screens all share one shell: title, record toolbar, header fields,
// line grid, totals. Drawing that shape means nothing shifts when the real
// editor arrives.
export default function Loading() {
  return <SkeletonVoucher />;
}
