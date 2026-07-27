"use client";

export default function PrintButton({ label = "🖨 Print / Save PDF" }: { label?: string }) {
  return (
    <button onClick={() => window.print()} className="btn no-print text-sm">{label}</button>
  );
}
