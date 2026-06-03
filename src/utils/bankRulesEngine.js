/**
 * bankRulesEngine — FF-2 categorization (shared by the live Salt Edge path and the
 * Alpha Bank CSV path).
 *
 * `inferCategoryFromText(text, rules)` returns `{ category, matched }`:
 *   - matched=false  → no rule fired; we default to 'variable' and the UI flags the
 *                      row as "needs attention" (the `~rule` marker).
 *
 * Rules are evaluated in order. Two rule shapes are supported:
 *   - { pattern: RegExp, category }      ← the built-in defaults (Greek+Latin alternation)
 *   - { contains: string, category }     ← founder-editable rules (Phase B, plain language)
 *
 * Matching runs against `categorizationText()` (raw + transliterated, upper-cased),
 * so a rule fires whether the source is genuine Greek (ΣΕΡΒΙΣ) or Latin mangled into
 * Greek glyphs (ΑΝΤΗRΟΡΙC → ANTHROPIC).
 */
import { categorizationText } from './normalizeGreekLatin.js';

// The built-in rule set (was inline in bankTransactionMapper.js pre-FF-2).
// In Phase B these seed the founder-editable `bankRules` collection.
export const DEFAULT_CATEGORY_RULES = [
  { pattern: /SERVICE|REPAIR|ΣΕΡΒΙΣ|MAINTENANCE|ΣΥΝΤΗΡ/i, category: 'variable' },
  { pattern: /ΔΕΗ|ΔΕΔΔΗΕ|PPC|ELECTRICITY|ΗΛΕΚΤΡ|ELECTR/i, category: 'fixed' },
  { pattern: /ΜΙΣΘΩΜ|ΕΝΟΙΚΙ|RENT|LEASE|ΜΙΣΘ/i,            category: 'fixed' },
  { pattern: /INSURANCE|ΑΣΦΑΛ/i,                            category: 'fixed' },
  { pattern: /LOAN|ΔΑΝΕΙ|ANNUITY/i,                         category: 'loan' },
  { pattern: /CREDIT.?CARD|ΠΙΣΤΩΤ/i,                        category: 'credit-card' },
  { pattern: /FUEL|ΒΕΝΖ|PETROL|CHARGING|ΦΟΡΤ/i,            category: 'variable' },
];

function ruleMatches(rule, haystack) {
  if (!rule) return false;
  if (rule.pattern instanceof RegExp) return rule.pattern.test(haystack);
  if (rule.contains) return haystack.includes(String(rule.contains).toUpperCase());
  return false;
}

/**
 * @param {string} text  raw description (payee + memo); Greek glyphs handled internally
 * @param {Array}  rules ordered rules; defaults to the built-in set
 * @returns {{ category: string, matched: boolean }}
 */
export function inferCategoryFromText(text, rules = DEFAULT_CATEGORY_RULES) {
  const haystack = categorizationText(text);
  for (const rule of rules) {
    if (ruleMatches(rule, haystack)) return { category: rule.category, matched: true };
  }
  return { category: 'variable', matched: false };
}

/** Count how many of the supplied descriptions a single rule would match (Phase B "test a rule"). */
export function countRuleMatches(rule, descriptions = []) {
  return descriptions.reduce(
    (n, d) => (ruleMatches(rule, categorizationText(d)) ? n + 1 : n),
    0,
  );
}

/**
 * Phase B — the effective rule list: the org's founder-editable rules (evaluated
 * first, ordered by ascending `priority`), then the built-in defaults as a
 * fallback. So a custom rule overrides a built-in, but unmatched descriptions
 * still get the Greek/Latin keyword defaults. Pass the result to
 * `inferCategoryFromText(text, buildRules(orgRules))`.
 */
export function buildRules(orgRules = []) {
  const sorted = [...orgRules].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  return [...sorted, ...DEFAULT_CATEGORY_RULES];
}
