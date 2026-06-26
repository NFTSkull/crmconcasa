"use client";

import { useState, type ReactNode } from "react";

export type MesaAccordionSectionProps = Readonly<{
  id: string;
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}>;

export function MesaAccordionSection({
  id,
  title,
  summary,
  defaultOpen = false,
  children,
}: MesaAccordionSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <button
        type="button"
        id={`${id}-trigger`}
        className="flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left transition hover:bg-gray-50/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          {summary ? (
            <p className="mt-0.5 text-xs leading-snug text-gray-600">{summary}</p>
          ) : null}
        </div>
        <span className="mt-0.5 shrink-0 text-[10px] font-medium uppercase tracking-wide text-gray-400">
          {open ? "Ocultar" : "Ver"}
        </span>
      </button>
      {open ? (
        <div id={`${id}-panel`} role="region" aria-labelledby={`${id}-trigger`} className="border-t border-gray-100">
          {children}
        </div>
      ) : null}
    </section>
  );
}
