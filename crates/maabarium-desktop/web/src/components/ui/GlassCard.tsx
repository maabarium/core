import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
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
        className={`relative h-full bg-[#0d1117]/88 backdrop-blur-2xl border border-slate-800/70 rounded-xl shadow-2xl before:absolute before:left-0 before:top-0 before:h-full before:w-px before:bg-gradient-to-b before:from-teal-500/70 before:via-amber-400/20 before:to-transparent before:opacity-70 after:absolute after:left-0 after:right-0 after:top-0 after:h-px after:bg-gradient-to-r after:from-teal-500/70 after:via-amber-400/40 after:to-transparent after:opacity-70 ${allowOverflow ? "overflow-visible" : "overflow-hidden"}`}
      >
        {(title || Icon) && (
          <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between bg-gradient-to-r from-white/5 to-transparent">
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.22em] flex items-center gap-2">
              {Icon ? <Icon size={14} className="text-teal-300" /> : null}
              {title}
            </h3>
            {headerActions || collapsible ? (
              <div className="flex items-center gap-3">
                {headerActions}
                {collapsible ? (
                  <button
                    type="button"
                    aria-expanded={!collapsed}
                    aria-label={`${collapsed ? "Expand" : "Collapse"} ${collapseLabel}`}
                    onClick={onToggleCollapsed}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-white/5 text-slate-400 transition hover:bg-white/10 hover:text-slate-200"
                  >
                    <ChevronDown
                      size={14}
                      className={`transition-transform ${collapsed ? "rotate-0" : "rotate-180"}`}
                    />
                  </button>
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
