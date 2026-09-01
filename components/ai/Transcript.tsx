"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import Icon from "@/components/ui/Icon";

// The conversation itself, plus the tool activity inline so the user can see
// exactly what was read to answer them. An answer with no visible source is
// how an assistant loses trust in an accounting system.

export interface ToolEvent {
  name: string;
  status: "running" | "done" | "failed";
  summary?: string | null;
  link?: string | null;
}

export interface Turn {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools?: ToolEvent[];
  error?: string | null;
  streaming?: boolean;
}

export default function Transcript({ turns, busy }: { turns: Turn[]; busy: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  if (turns.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <p className="text-sm font-medium text-slate-700">How can I help?</p>
        <p className="mt-1 max-w-sm text-sm text-slate-500">
          Ask about outstanding balances, a customer&apos;s ledger, a voucher, or today&apos;s
          bookings. I read the same data your screens do.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 px-1 py-2">
      {turns.map((t) => (t.role === "user" ? <UserTurn key={t.id} turn={t} /> : <AiTurn key={t.id} turn={t} />))}
      <div ref={endRef} />
    </div>
  );
}

function UserTurn({ turn }: { turn: Turn }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-lg rounded-br-sm bg-brand px-3.5 py-2.5 text-sm text-white">
        {turn.text}
      </div>
    </div>
  );
}

function AiTurn({ turn }: { turn: Turn }) {
  return (
    <div className="space-y-2">
      {!!turn.tools?.length && (
        <div className="space-y-1">
          {turn.tools.map((tool, i) => (
            <ToolLine key={`${tool.name}-${i}`} tool={tool} />
          ))}
        </div>
      )}

      {turn.text && (
        <div className="max-w-[92%] whitespace-pre-wrap rounded-lg rounded-bl-sm bg-slate-100 px-3.5 py-2.5 text-sm leading-relaxed text-slate-800">
          {turn.text}
          {turn.streaming && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-slate-400 align-text-bottom" />}
        </div>
      )}

      {turn.error && (
        <div className="max-w-[92%] rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-sm text-danger-fg">
          {turn.error}
        </div>
      )}
    </div>
  );
}

// One line per ERP lookup: what she read, and a way to go and see it.
function ToolLine({ tool }: { tool: ToolEvent }) {
  const label = tool.name.replace(/_/g, " ");
  return (
    <div className="flex items-center gap-2 text-xs text-slate-500">
      {tool.status === "running" ? (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-info" />
      ) : tool.status === "failed" ? (
        <span className="h-1.5 w-1.5 rounded-full bg-danger" />
      ) : (
        <Icon name="check" size={13} className="text-success" />
      )}
      <span className={tool.status === "failed" ? "text-danger-fg" : ""}>
        {tool.summary || label}
      </span>
      {tool.link && tool.status === "done" && (
        <Link href={tool.link} className="text-brand hover:underline">
          open
        </Link>
      )}
    </div>
  );
}
