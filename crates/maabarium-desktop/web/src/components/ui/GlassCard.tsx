import type { ReactNode } from "react";
import { CollapseToggle } from "./Disclosure";
import type { LucideIcon } from "lucide-react";

export function GlassCard({
  children,
  className = "",
  title,
  icon: Icon,
  glow = false,
  headerActions,
  allowOverflow = false,
  collapsible = false,
  collapsed = false,
  onToggleCollapsed,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  icon?: LucideIcon;
  glow?: boolean;
  headerActions?: ReactNode;
  allowOverflow?: boolean;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const collapseLabel = title ?? "section";

  return (
    <div className={`relative group transition-all duration-500 ${className}`}>
      {glow && (
        <div className="absolute -inset-0.5 bg-gradient-to-r from-teal-500/40 to-amber-400/40 rounded-xl blur opacity-20 group-hover:opacity-35 transition duration-1000" />
      )}
      <div
        className={`workspace-card relative h-full border rounded-xl ${allowOverflow ? "overflow-visible" : "overflow-hidden"}`}
      >
        {(title || Icon) && (
          <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between bg-gradient-to-r from-white/5 to-transparent">
            {/* Same heading style as Disclosure titles, so collapsible cards
                and disclosures read as one family. */}
            <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--ink,#edf5f0)]">
              {Icon ? <Icon size={14} className="text-teal-300" aria-hidden="true" /> : null}
              {title}
            </h3>
            {headerActions || collapsible ? (
              <div className="flex items-center gap-3">
                {headerActions}
                {collapsible ? (
                  <CollapseToggle title={collapseLabel} expanded={!collapsed} onToggle={onToggleCollapsed} />
                ) : null}
              </div>
            ) : (
              <div className="flex gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-slate-700" />
                <div className="w-1.5 h-1.5 rounded-full bg-slate-700" />
              </div>
            )}
          </div>
        )}
        {!collapsed ? <div className="p-5">{children}</div> : null}
      </div>
    </div>
  );
}
