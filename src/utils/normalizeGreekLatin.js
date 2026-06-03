/**
 * normalizeGreekLatin — FF-2 bank import.
 *
 * Alpha Bank's CSV export renders many Latin merchant names using Greek
 * look-alike code points: e.g. "ΑΝΤΗRΟΡΙC" is really "ANTHROPIC", "SΤΑRLΙΝΚ" is
 * "STARLINK". Left alone, description-based category matching silently fails and
 * the cleaned name shown to the founder looks like gibberish.
 *
 * We transliterate ONLY the unambiguous capital look-alikes — the Greek letters
 * whose glyph is identical to a Latin capital. Genuinely-Greek letters
 * (Σ Δ Λ Γ Φ Ψ Ω Θ Ξ Π and lowercase) are left untouched so real Greek words
 * (ΣΕΡΒΙΣ, ΕΝΟΙΚΙΟ, ΔΕΗ) remain detectable by the Greek-keyword rules.
 *
 * Single biggest correctness risk in the FF-2 importer (FUTURE_FEATURES §FF-2).
 */

// Greek capital → identical-looking Latin capital.
const GREEK_TO_LATIN = {
  Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M',
  Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T', Υ: 'Y', Χ: 'X',
};

// Any Greek/Coptic or extended-Greek code point (used to tell "Latin mangled into
// Greek glyphs" apart from genuinely-Greek text).
const GREEK_RANGE = /[Ͱ-Ͽἀ-῿]/;

/** Swap every capital look-alike Greek glyph for its Latin twin. Pure transliteration. */
export function normalizeGreekLatin(str) {
  if (str == null) return '';
  let out = '';
  for (const ch of String(str)) out += GREEK_TO_LATIN[ch] ?? ch;
  return out;
}

/** True when the string contains any Greek code point. */
export function hasGreek(str) {
  return GREEK_RANGE.test(String(str ?? ''));
}

/**
 * Display-safe cleaner. Returns the transliterated form ONLY when the input was a
 * Latin name mangled into Greek look-alikes (i.e. it becomes fully non-Greek after
 * transliteration). Genuinely-Greek text (still has Greek letters afterwards) is
 * returned unchanged so we never corrupt a real Greek merchant name.
 */
export function cleanMerchantName(str) {
  const raw = String(str ?? '').trim();
  if (!raw) return '';
  const normalized = normalizeGreekLatin(raw);
  if (normalized !== raw && !hasGreek(normalized)) return normalized;
  return raw;
}

/**
 * Build the searchable haystack for category matching: both the raw text and its
 * transliteration, upper-cased, so a rule matches whether the source is genuine
 * Greek (ΣΕΡΒΙΣ) or Latin mangled into Greek glyphs (ΑΝΤΗRΟΡΙC → ANTHROPIC).
 */
export function categorizationText(str) {
  const raw = String(str ?? '');
  const normalized = normalizeGreekLatin(raw);
  return (raw === normalized ? raw : `${raw} ${normalized}`).toUpperCase();
}
