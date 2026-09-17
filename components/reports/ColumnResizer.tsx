"use client";

import { useEffect } from "react";

// Excel-style "drag the line between two columns" resize for every
// report-grid table on the page — mounted once in the ERP shell
// (app/(erp)/layout.tsx) so it reaches every report without each screen
// wiring anything itself, DataTable's own tables included (its <table>
// carries the report-grid class too).
//
// A native CSS `resize: horizontal` handle was tried first and dropped: it
// draws a small grip icon in one corner of the cell, and only that corner
// is the actual drag hotspot — not what "resize the column" means to
// someone used to a spreadsheet, where you grab the border itself, anywhere
// along its height. This attaches a thin invisible strip over the right
// edge of every leaf column header instead (a colSpan header — a group
// title over several columns — has nothing single to grab, so it's
// skipped). MutationObserver-driven rather than a one-shot scan on mount,
// since most reports render their table only after an async fetch
// resolves, well after this component's own effect has already run.
export default function ColumnResizer() {
  useEffect(() => {
    const PROCESSED = "data-col-resize-done";

    function attach(th: HTMLTableCellElement) {
      if (th.hasAttribute(PROCESSED) || th.colSpan > 1) return;
      th.setAttribute(PROCESSED, "1");
      if (getComputedStyle(th).position === "static") th.style.position = "relative";

      const handle = document.createElement("div");
      handle.className = "col-resize-handle";
      th.appendChild(handle);

      let startX = 0;
      let startWidth = 0;
      const onMove = (e: PointerEvent) => {
        th.style.width = `${Math.max(32, startWidth + (e.clientX - startX))}px`;
      };
      const onUp = () => {
        handle.classList.remove("dragging");
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
      };
      handle.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        startX = e.clientX;
        startWidth = th.getBoundingClientRect().width;
        handle.classList.add("dragging");
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
      });
    }

    const SELECTOR = "table.report-grid thead th";
    function scan(root: ParentNode) {
      root.querySelectorAll<HTMLTableCellElement>(SELECTOR).forEach(attach);
    }

    scan(document);
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches(SELECTOR)) attach(node as HTMLTableCellElement);
          scan(node);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
