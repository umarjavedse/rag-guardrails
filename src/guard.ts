import { checkGrounding, type GroundingOptions, type GroundingReport, type Source } from "./grounding.js";
import { detectPromptInjection, type InjectionReport } from "./injection.js";
import { redactLeaks, type LeakFinding } from "./leaks.js";

export interface GuardOptions {
  grounding?: GroundingOptions;
  /** Text returned when the answer is blocked. */
  fallback?: string;
}

export interface GuardResult {
  allowed: boolean;
  /** The answer to show: redacted when allowed, the fallback when blocked. */
  answer: string;
  reasons: string[];
  grounding: GroundingReport;
  injection: InjectionReport;
  leaks: LeakFinding[];
}

/**
 * One call to gate a RAG answer: block it when it is not grounded in the
 * sources or echoes an injection, and redact any secrets or personal data.
 */
export function guardAnswer(answer: string, sources: Source[], options: GuardOptions = {}): GuardResult {
  const fallback = options.fallback ?? "Sorry, I couldn't find a reliable answer to that in our documentation.";
  const grounding = checkGrounding(answer, sources, options.grounding);
  const injection = detectPromptInjection(answer);
  const { text: redacted, findings: leaks } = redactLeaks(answer);

  const reasons: string[] = [];
  if (!grounding.grounded) reasons.push(`not grounded (score ${grounding.score})`);
  if (injection.flagged) reasons.push(`injection markers: ${injection.matches.map((m) => m.rule).join(", ")}`);
  if (leaks.length) reasons.push(`redacted ${leaks.length} sensitive value(s)`);

  const allowed = grounding.grounded && !injection.flagged;
  return { allowed, answer: allowed ? redacted : fallback, reasons, grounding, injection, leaks };
}
