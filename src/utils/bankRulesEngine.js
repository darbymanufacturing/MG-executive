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
// Ordered specific→general; first match wins. Patterns run against raw + transliterated
// text (categorizationText), so both genuine Greek (ΑΝΑΛΗΨΗ) and Latin-mangled-into-Greek
// glyphs (SΤΑRLΙΝΚ→STARLINK) fire. Categories are the owner-bookkeeping keys (ADR-0026);
// these are *defaults* — the bank-import review table lets the owner correct any row.
export const DEFAULT_CATEGORY_RULES = [
  // ── Loans: interest before principal ──
  { pattern: /ΕΚΤΟΚΙΣΜ|ΤΟΚΟΙ|CREDIT ?PROTECTION|\bINTEREST\b/i,        category: 'Loan Interest' },
  { pattern: /989004|ΔΟΣΗ ?ΔΑΝΕΙ|ΔΑΝΕΙ|\bLOAN\b|ANNUITY/i,            category: 'Bank loans' },
  // ── Government taxes & statutory duties ──
  { pattern: /ΕΚΤΕΛΩΝΙΣΜ|CUSTOMS|ΔΑΣΜ|ΤΕΛΩΝΕΙ/i,                       category: 'Customs' },
  { pattern: /ΓΕΜΗ|\bGEMI\b/i,                                        category: 'ΓΕΜΗ' },
  { pattern: /ΦΠΑ|\bVAT\b|ΒΕΒΟΦ/i,                                    category: 'VAT' }, // ΒΕΒΟΦ defaults to VAT; correct the registration/payroll ones in review
  // ── Professional / admin ──
  { pattern: /ΛΟΓΙΣΤ|ACCOUNT|WORKADU|ΔΙΚΗΓΟΡ|\bLEGAL\b/i,             category: 'Accounting and Legal services' },
  { pattern: /ΕΝΤΠΛ|PAYROLL|ΜΙΣΘΟΔΟΣ/i,                               category: 'Payroll Fees' },
  { pattern: /ΜΙΣΘΟΣ ?ΔΙΑΧ/i,                                         category: 'CEO' },
  // ── Software / ops / app ──
  { pattern: /OTORIDE/i,                                              category: 'App Development Fee' },
  { pattern: /STARLINK|VODAFONE|COSMOTE|\bNOVA\b|\bWIND\b|ΤΗΛΕΦ|ΣΥΝΔΡΟΜ/i, category: 'SW subscriptions, Telco charges' },
  { pattern: /ANTHROPIC|GOOGLE|OPENAI|TWILIO|PATREON|DOMAIN|\bAWS\b|VERCEL|SUPABASE|CLOUD|APPLE\.COM/i, category: 'Operations & computing services' },
  // ── Logistics / utilities / rent ──
  { pattern: /\bACS\b|\bELTA\b|ΕΛΤΑ|ΤΑΧΥΔΡΟΜ|COURIER|CARGO|ΜΕΤΑΦΟΡΙΚ/i, category: 'Logistics services' },
  { pattern: /ΔΕΗ|ΔΕΔΔΗΕ|\bPPC\b|ELECTRICITY|ΗΛΕΚΤΡ|ELECTR|ZENITH|ΕΥΔΑΠ|\bΔΕΥΑ/i, category: 'Electricity Bill' },
  { pattern: /ΕΝΟΙΚΙ|ΜΙΣΘΩΜ|\bRENT\b|LEASE|ΜΙΣΘ/i,                     category: 'Space rent' },
  { pattern: /INSURANCE|ΑΣΦΑΛ|AM\.?XP|ΑΜ\.?ΧΡ/i,                       category: 'Insurance' },
  // ── Variable operating ──
  { pattern: /FUEL|ΒΕΝΖ|PETROL|ΚΑΥΣΙΜ|ΚΑFSΙΜ|SHELL|REVOIL|NOTOS|AVIN|\bEKO\b|CHARGING|ΦΟΡΤ/i, category: 'Fuel' },
  { pattern: /SKROUTZ|BAMBULAB|JUMBO|\bIKEA\b|PRAKTIKER|LEROY|ΕΡΓΑΛΕΙ|\bTOOL/i, category: 'Equipment and Tools' },
  { pattern: /SERVICE|REPAIR|ΣΕΡΒΙΣ|MAINTENANCE|ΣΥΝΤΗΡ|ΕΠΙΣΚΕΥ/i,     category: 'Repairs & maintenance' },
  // ── Money movement & bank fees ──
  { pattern: /ΑΝΑΛΗΨΗ|ΚΑΤΑΘΕΣΗ|ΠΛΗΡ ?ΔΙΑΧ|ΠΛΗΡΩΜΗ ?ΔΙΑΧ|REVOLUT|WITHDRAW|TRANSFER|ΕΜΒΑΣΜ|ΙΝSΤΑΝΤ ?ΤRΑΝS/i, category: 'Transfer, withdraw' },
  { pattern: /ΕΞΟΔΑ ?ΕΝΤΟΛΗΣ|ΕΞΟΔΑ ?ΙΝSΤΑΝΤ|ΠΡΟΜΗΘΕΙΑ|ΠΡΟΜ\.|ΕΞΔ\.?ΤΗΡ|ΔΙΑΦΟΡΕΣ ?ΠΛΗΡΩΜΕΣ|\bFEE\b|CHARGE/i, category: 'Transaction Fees' },
  { pattern: /CREDIT.?CARD|ΠΙΣΤΩΤ/i,                                  category: 'credit-card' },
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
