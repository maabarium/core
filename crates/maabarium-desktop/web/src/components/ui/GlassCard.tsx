import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function GlassCard({
  children,
  className = "",
  title,
  icon: Icon,
  glow = false,
  headerActions,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  icon?: LucideIcon;
  glow?: boolean;
  headerActions?: ReactNode;
}) {
  return (
    <div className={`relative group transition-all duration-500 ${className}`}>
      {glow && (
        <div className="absolute -inset-0.5 bg-gradient-to-r from-teal-500/40 to-amber-400/40 rounded-xl blur opacity-20 group-hover:opacity-35 transition duration-1000" />
      )}
      <div className="relative h-full bg-[#0d1117]/88 backdrop-blur-2xl border border-slate-800/70 rounded-xl overflow-hidden shadow-2xl before:absolute before:left-0 before:top-0 before:h-full before:w-px before:bg-gradient-to-b before:from-teal-500/70 before:via-amber-400/20 before:to-transparent before:opacity-70 after:absolute after:left-0 after:right-0 after:top-0 after:h-px after:bg-gradient-to-r after:from-teal-500/70 after:via-amber-400/40 after:to-transparent after:opacity-70">
        {(title || Icon) && (
          <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between bg-gradient-to-r from-white/5 to-transparent">
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.22em] flex items-center gap-2">
              {Icon ? <Icon size={14} className="text-teal-300" /> : null}
              {title}
            </h3>
            {headerActions ? (
              <div className="flex items-center gap-3">{headerActions}</div>
            ) : (
              <div className="flex gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-slate-700" />
                <div className="w-1.5 h-1.5 rounded-full bg-slate-700" />
              </div>
            )}
          </div>
        )}
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
