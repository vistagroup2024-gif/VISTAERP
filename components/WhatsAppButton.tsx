"use client";

import { waHref } from "@/lib/waLink";

// Reusable WhatsApp send button. Drop it anywhere there is a person/company with a
// stored phone/WhatsApp number. When no valid number exists it renders a disabled
// state with a clear message instead of an invalid link.
export default function WhatsAppButton({
  phone, message, label = "WhatsApp", size = "sm", className = "",
}: {
  phone: string | null | undefined;
  message?: string | null;
  label?: string;
  size?: "sm" | "md" | "icon";
  className?: string;
}) {
  const href = waHref(phone, message);
  const base = "inline-flex items-center gap-1.5 rounded-md font-medium transition";
  const pad = size === "icon" ? "p-2" : size === "md" ? "px-4 py-2 text-sm" : "px-3 py-1.5 text-xs";
  const icon = (
    <svg viewBox="0 0 32 32" className={size === "icon" ? "h-5 w-5" : "h-4 w-4"} fill="currentColor" aria-hidden>
      <path d="M16 3C9.4 3 4 8.4 4 15c0 2.1.6 4.1 1.6 5.9L4 29l8.3-2.2c1.7.9 3.6 1.4 5.7 1.4 6.6 0 12-5.4 12-12S22.6 3 16 3zm0 21.8c-1.8 0-3.5-.5-5-1.4l-.4-.2-4.9 1.3 1.3-4.8-.2-.4c-1-1.6-1.5-3.4-1.5-5.3 0-5.5 4.5-10 10-10s10 4.5 10 10-4.5 10-10 10zm5.5-7.4c-.3-.2-1.8-.9-2-1s-.5-.2-.7.2c-.2.3-.8 1-1 1.2-.2.2-.4.2-.7.1-.3-.2-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6.1-.1.3-.4.5-.5.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5-.1-.2-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.3 5.2 4.6.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.5.3-.7.3-1.4.2-1.5-.1-.2-.3-.3-.6-.4z"/>
    </svg>
  );

  if (!href) {
    return (
      <span className={`${base} ${pad} cursor-not-allowed bg-slate-100 text-slate-400 ${className}`} title="No WhatsApp number available">
        {icon}{size !== "icon" && <span>No number</span>}
      </span>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className={`${base} ${pad} bg-[#25D366] text-white hover:bg-[#1ebe5b] ${className}`}
      title="Send WhatsApp">
      {icon}{size !== "icon" && <span>{label}</span>}
    </a>
  );
}
