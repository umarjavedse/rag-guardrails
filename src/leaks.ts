export interface LeakFinding {
  type: string;
  value: string;
  index: number;
}

interface Detector {
  type: string;
  pattern: RegExp;
  validate?: (match: string) => boolean;
}

const DETECTORS: Detector[] = [
  { type: "private_key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { type: "anthropic_key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { type: "openai_key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { type: "aws_access_key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { type: "github_token", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{50,}/g },
  { type: "slack_token", pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { type: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { type: "connection_string", pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:@/]+:[^\s@/]+@[^\s]+/g },
  { type: "email", pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { type: "credit_card", pattern: /\b(?:\d[ -]?){13,19}\b/g, validate: (m) => luhn(m.replace(/\D/g, "")) },
];

/** Find secrets and personal data in model output before it reaches a user or a log. */
export function findLeaks(text: string, options: { types?: string[] } = {}): LeakFinding[] {
  const wanted = options.types ? new Set(options.types) : null;
  const findings: LeakFinding[] = [];
  const taken: [number, number][] = [];
  for (const detector of DETECTORS) {
    if (wanted && !wanted.has(detector.type)) continue;
    for (const match of text.matchAll(detector.pattern)) {
      const start = match.index!;
      const end = start + match[0].length;
      // More specific detectors run first; skip overlapping weaker matches.
      if (taken.some(([s, e]) => start < e && end > s)) continue;
      if (detector.validate && !detector.validate(match[0])) continue;
      taken.push([start, end]);
      findings.push({ type: detector.type, value: match[0], index: start });
    }
  }
  return findings.sort((a, b) => a.index - b.index);
}

/** Replace every finding with a typed placeholder like [REDACTED:openai_key]. */
export function redactLeaks(text: string, options: { types?: string[] } = {}): { text: string; findings: LeakFinding[] } {
  const findings = findLeaks(text, options);
  let out = text;
  for (const f of [...findings].reverse()) {
    out = out.slice(0, f.index) + `[REDACTED:${f.type}]` + out.slice(f.index + f.value.length);
  }
  return { text: out, findings };
}

function luhn(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}
