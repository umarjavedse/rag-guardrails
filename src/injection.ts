export interface InjectionRule {
  id: string;
  weight: number;
  pattern: RegExp;
  description: string;
}

/** Heuristics for instructions hidden in retrieved documents or user input. */
export const DEFAULT_RULES: InjectionRule[] = [
  {
    id: "ignore-instructions",
    weight: 0.9,
    pattern: /\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|system|your)\b[^.\n]{0,20}\b(instructions?|prompts?|rules|guidelines|directions)\b/i,
    description: "Tries to cancel the system or developer instructions",
  },
  {
    id: "role-override",
    weight: 0.6,
    pattern: /\b(you are now|from now on,? you|act as|pretend (to be|you are)|roleplay as|new persona)\b/i,
    description: "Tries to give the model a new role",
  },
  {
    id: "reveal-prompt",
    weight: 0.7,
    pattern: /\b(reveal|print|show|repeat|output|leak|tell me)\b[^.\n]{0,40}\b(system prompt|hidden (instructions?|prompt)|initial (instructions?|prompt)|your instructions)\b/i,
    description: "Asks the model to reveal its instructions",
  },
  {
    id: "fake-system-tag",
    weight: 0.6,
    pattern: /(<\/?\s*(system|assistant|instructions?)\s*>|\[\/?(system|inst)\]|^\s*(system|assistant)\s*:)/im,
    description: "Fake chat-role markers or system tags",
  },
  {
    id: "jailbreak",
    weight: 0.7,
    pattern: /\b(DAN mode|developer mode|jailbreak|do anything now|no (restrictions|limitations|filters))\b/i,
    description: "Known jailbreak phrasing",
  },
  {
    id: "exfil-link",
    weight: 0.7,
    pattern: /!\[[^\]]*\]\(https?:\/\/[^)\s]+\?[^)\s]*(\{|%7B|data|q|secret|token|key)=?/i,
    description: "Markdown image with a query string, a common data-exfiltration trick",
  },
  {
    id: "tool-coercion",
    weight: 0.5,
    pattern: /\b(call|invoke|use|run|execute)\b[^.\n]{0,20}\b(tool|function|api)\b[^.\n]{0,40}\b(send|email|transfer|delete|post|upload)\b/i,
    description: "Instructs the model to trigger side-effecting tools",
  },
  {
    id: "hidden-text",
    weight: 0.5,
    pattern: /[\u200B-\u200F\u2060-\u2064\uFEFF]|\u{E0000}|[\u{E0020}-\u{E007F}]/u,
    description: "Invisible Unicode characters that can hide instructions",
  },
  {
    id: "encoded-payload",
    weight: 0.3,
    pattern: /\b(base64|rot13|decode (this|the following))\b|[A-Za-z0-9+/]{80,}={0,2}/i,
    description: "Encoded blobs or requests to decode them",
  },
];

export interface InjectionMatch {
  rule: string;
  description: string;
  excerpt: string;
}

export interface InjectionReport {
  flagged: boolean;
  /** Combined risk, 0..1: 1 - Π(1 - weight) over matched rules. */
  score: number;
  matches: InjectionMatch[];
}

export function detectPromptInjection(
  text: string,
  options: { threshold?: number; rules?: InjectionRule[] } = {},
): InjectionReport {
  const threshold = options.threshold ?? 0.5;
  const rules = options.rules ?? DEFAULT_RULES;
  const matches: InjectionMatch[] = [];
  let safe = 1;
  for (const rule of rules) {
    const match = rule.pattern.exec(text);
    if (!match) continue;
    safe *= 1 - rule.weight;
    const start = Math.max(0, match.index - 20);
    matches.push({
      rule: rule.id,
      description: rule.description,
      excerpt: text.slice(start, match.index + match[0].length + 20).replace(/\s+/g, " ").trim(),
    });
  }
  const score = Math.round((1 - safe) * 1000) / 1000;
  return { flagged: score >= threshold, score, matches };
}

/**
 * Drop retrieved chunks that look like prompt injections before they reach
 * the model, and wrap the rest in clear data delimiters.
 */
export function sanitizeContext<T extends { id: string; text: string }>(
  chunks: T[],
  options: { threshold?: number } = {},
): { kept: T[]; dropped: { chunk: T; report: InjectionReport }[]; prompt: string } {
  const kept: T[] = [];
  const dropped: { chunk: T; report: InjectionReport }[] = [];
  for (const chunk of chunks) {
    const report = detectPromptInjection(chunk.text, options);
    if (report.flagged) dropped.push({ chunk, report });
    else kept.push(chunk);
  }
  const prompt = kept
    .map((c) => `<source id="${escapeAttr(c.id)}">\n${c.text.replace(/<\/?source\b[^>]*>/gi, "")}\n</source>`)
    .join("\n");
  return { kept, dropped, prompt };
}

function escapeAttr(value: string): string {
  return value.replace(/[&"<>]/g, (ch) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[ch]!);
}
