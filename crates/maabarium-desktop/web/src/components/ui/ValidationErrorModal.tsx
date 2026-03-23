import { AlertCircle } from "lucide-react";

type ValidationErrorModalProps = {
  title: string;
  heading: string;
  description: string;
  message: string | null;
  onClose: () => void;
};

export function ValidationErrorModal({
  title,
  heading,
  description,
  message,
  onClose,
}: ValidationErrorModalProps) {
  if (!message) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/80 px-4 py-8 backdrop-blur-sm">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-rose-500/30 bg-slate-950/95 shadow-2xl shadow-rose-950/40">
        <div className="border-b border-white/5 bg-rose-500/10 px-6 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-full border border-rose-400/30 bg-rose-400/10 p-2 text-rose-300">
              <AlertCircle size={18} />
            </div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.24em] text-rose-200">
                {title}
              </div>
              <h2 className="mt-2 text-xl font-black tracking-tight text-white">
                {heading}
              </h2>
              <p className="mt-2 text-sm text-slate-300">{description}</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5">
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/8 px-4 py-4 font-mono text-sm leading-relaxed text-rose-100 whitespace-pre-wrap">
            {message}
          </div>

          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-slate-200 transition hover:bg-white/10"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
