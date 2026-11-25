const STOPWORDS = new Set(
  (
    "a an and are as at be been but by can could did do does for from had has have how i if in into is it its " +
    "may me might my no not of on or our should so some such than that the their them then there these they this " +
    "those to too us was we were what when where which while who why will with would you your also just only very " +
    "about after again all any because before being both each few more most other over same under until up yours"
  ).split(" "),
);

/** Lowercase content words with light suffix stripping, so "policies" matches "policy". */
export function contentTokens(text: string): string[] {
  return (text.toLowerCase().normalize("NFKD").match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((t) => !STOPWORDS.has(t) && (t.length > 1 || /\d/.test(t)))
    .map(stem);
}

export function stem(word: string): string {
  if (/^\d+$/.test(word) || word.length <= 3) return word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("sses")) return word.slice(0, -2);
  for (const suffix of ["ing", "edly", "ed", "ly", "es", "s"]) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3 && !word.endsWith("ss")) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

/** Split prose into sentences, keeping decimals ("2.5") and common abbreviations intact. */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(\[])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Numbers that appear in a text, normalised ("1,200" -> "1200", "30%" -> "30"). */
export function extractNumbers(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ""));
}
