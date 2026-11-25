import { contentTokens, extractNumbers, splitSentences } from "./text.js";

export interface Source {
  id: string;
  text: string;
}

export interface GroundingOptions {
  /** Share of a sentence's content words that must appear in one source. Default 0.6. */
  threshold?: number;
  /** Share of sentences that must be supported for the answer to pass. Default 1 (all). */
  minSupportedRatio?: number;
  /** Sentences with fewer content words than this are skipped (e.g. "Sure!"). Default 3. */
  minTokens?: number;
}

export interface SentenceCheck {
  sentence: string;
  supported: boolean;
  /** Best token coverage found across sources, 0..1. */
  coverage: number;
  sourceId: string | null;
  /** Numbers in the sentence that no source contains, a strong hallucination signal. */
  unsupportedNumbers: string[];
  /** Citation markers like [2] that point at a source id that does not exist. */
  invalidCitations: string[];
  skipped: boolean;
}

export interface GroundingReport {
  grounded: boolean;
  score: number;
  sentences: SentenceCheck[];
}

/**
 * Check that every claim in an answer is backed by the retrieved sources.
 * Lexical and deterministic: cheap enough to run on every response, and a
 * useful first gate before (or instead of) an LLM-as-judge check.
 */
export function checkGrounding(answer: string, sources: Source[], options: GroundingOptions = {}): GroundingReport {
  const threshold = options.threshold ?? 0.6;
  const minRatio = options.minSupportedRatio ?? 1;
  const minTokens = options.minTokens ?? 3;

  const indexed = sources.map((s) => ({
    id: s.id,
    tokens: new Set(contentTokens(s.text)),
    numbers: new Set(extractNumbers(s.text)),
  }));
  const allNumbers = new Set(indexed.flatMap((s) => [...s.numbers]));
  const ids = new Set(sources.map((s) => s.id));

  const sentences = splitSentences(answer).map((sentence): SentenceCheck => {
    const citations = [...sentence.matchAll(/\[([^\]\s]{1,40})\]/g)].map((m) => m[1]!);
    const invalidCitations = citations.filter((c) => !ids.has(c));
    const clean = sentence.replace(/\[[^\]\s]{1,40}\]/g, " ");
    const tokens = [...new Set(contentTokens(clean))];
    const unsupportedNumbers = extractNumbers(clean).filter((n) => !allNumbers.has(n));

    if (tokens.length < minTokens) {
      return {
        sentence, supported: unsupportedNumbers.length === 0 && invalidCitations.length === 0,
        coverage: 1, sourceId: null, unsupportedNumbers, invalidCitations, skipped: true,
      };
    }

    // Prefer cited sources when the sentence cites any; otherwise search all.
    const cited = indexed.filter((s) => citations.includes(s.id));
    const candidates = cited.length ? cited : indexed;
    let best = { coverage: 0, id: null as string | null };
    for (const source of candidates) {
      const hits = tokens.filter((t) => source.tokens.has(t)).length;
      const coverage = hits / tokens.length;
      if (coverage > best.coverage) best = { coverage, id: source.id };
    }

    return {
      sentence,
      supported: best.coverage >= threshold && unsupportedNumbers.length === 0 && invalidCitations.length === 0,
      coverage: round(best.coverage),
      sourceId: best.id,
      unsupportedNumbers,
      invalidCitations,
      skipped: false,
    };
  });

  const checked = sentences.filter((s) => !s.skipped || !s.supported);
  const supported = checked.filter((s) => s.supported).length;
  const score = checked.length ? supported / checked.length : 1;
  return { grounded: score >= minRatio, score: round(score), sentences };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
