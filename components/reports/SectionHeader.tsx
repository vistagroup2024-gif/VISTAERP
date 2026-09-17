/** A report's own section title — a solid brand-green bar, deliberately
 *  darker than the light tint the grid header below it uses, so the two
 *  never compete and the section always reads as the more prominent of the
 *  two. Title only, on purpose: a report explains itself through its
 *  numbers and column labels, not a paragraph above them — don't add a
 *  subtitle prop back for report copy explaining how a figure works. */
export default function SectionHeader({ title }: { title: string }) {
  return (
    <h2 className="mb-2 rounded-md bg-brand-700 px-3 py-2 text-sm font-bold text-white">{title}</h2>
  );
}
