import type { ReactNode } from "react";

type BadgeColor = "blue" | "emerald" | "rose" | "slate";

export function Badge({
  children,
  color = "blue",
}: {
  children: ReactNode;
  color?: BadgeColor;
}) {
  const colors: Record<BadgeColor, string> = {
    blue: "bg-teal-500/10 text-teal-300 border-teal-500/20",
    emerald: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
    rose: "bg-rose-500/10 text-rose-400 border-rose-500/20",
    slate: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  };

  return (
    <span
      className={`px-2 py-0.5 rounded border text-[10px] font-black uppercase tracking-[0.16em] ${colors[color]}`}
    >
      {children}
    </span>
  );
}
