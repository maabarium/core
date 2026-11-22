/** Longest experiment title shown before it is shortened. */
export const TITLE_LIMIT = 110;

/**
 * Shorten long text at a word boundary and mark the cut with an ellipsis,
 * so a heading never ends mid-word or mid-thought without a cue.
 */
export function shortTitle(text: string, limit = TITLE_LIMIT): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–-]+$/, "")}…`;
}

/** Label a research job by the plan step in its id, not its list position. */
export function researchStepLabel(jobId: string): string {
  const part = jobId.slice(jobId.lastIndexOf(":") + 1);
  if (part === "review") return "AI review";
  return /^\d+$/.test(part) ? `Step ${part}` : "Research step";
}
