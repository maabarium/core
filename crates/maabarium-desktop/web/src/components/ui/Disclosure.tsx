import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export function CollapseToggle({ title, expanded, controls, onToggle }: {
  title: string;
  expanded: boolean;
  controls?: string;
  onToggle?: () => void;
}) {
  return <button type="button" aria-expanded={expanded} aria-controls={controls}
    aria-label={`${expanded ? "Collapse" : "Expand"} ${title}`} onClick={onToggle}
    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--subtle)]">
    <ChevronDown aria-hidden="true" size={14} className={expanded ? "rotate-180" : ""} />
  </button>;
}

export function Disclosure({ title, children, className = "", contentClassName = "", id, mountWhenExpanded = false, defaultExpanded = false }: {
  title: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  id?: string;
  mountWhenExpanded?: boolean;
  defaultExpanded?: boolean;
}) {
  const contentId = useId();
  const [expanded, setExpanded] = useState(defaultExpanded);
  return <div id={id} className={`rounded-xl border border-[var(--line)] ${className}`}>
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <span className="text-sm font-semibold">{title}</span>
      <CollapseToggle title={title} expanded={expanded} controls={contentId} onToggle={() => setExpanded(!expanded)} />
    </div>
    <div id={contentId} hidden={!expanded} className={`border-t border-[var(--line)] p-3 ${contentClassName}`}>
      {(!mountWhenExpanded || expanded) && children}
    </div>
  </div>;
}
