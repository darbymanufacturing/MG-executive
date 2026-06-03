import { describe, it, expect } from 'vitest';
import {
  normalizeGreekLatin,
  hasGreek,
  cleanMerchantName,
  categorizationText,
} from '../normalizeGreekLatin.js';

describe('normalizeGreekLatin', () => {
  it('transliterates Latin names mangled into Greek look-alikes', () => {
    expect(normalizeGreekLatin('ΑΝΤΗRΟΡΙC')).toBe('ANTHROPIC');
    expect(normalizeGreekLatin('SΤΑRLΙΝΚ')).toBe('STARLINK');
    expect(normalizeGreekLatin('ΗΟΡΡ ΕΗF.')).toBe('HOPP EHF.');
  });

  it('leaves non-look-alike Greek letters untouched', () => {
    // Σ, Β stay Greek-context but Β is a look-alike → becomes B; Σ stays Σ.
    expect(normalizeGreekLatin('ΣΕΡΒΙΣ')).toBe('ΣEPBIΣ');
  });

  it('is a no-op for plain ASCII', () => {
    expect(normalizeGreekLatin('GOOGLE WORKSPACE')).toBe('GOOGLE WORKSPACE');
  });

  it('handles null/undefined/empty', () => {
    expect(normalizeGreekLatin(null)).toBe('');
    expect(normalizeGreekLatin(undefined)).toBe('');
    expect(normalizeGreekLatin('')).toBe('');
  });
});

describe('hasGreek', () => {
  it('detects genuine Greek text', () => {
    expect(hasGreek('ΣΕΡΒΙΣ')).toBe(true);
    expect(hasGreek('ANTHROPIC')).toBe(false);
  });
});

describe('cleanMerchantName', () => {
  it('cleans Latin-mangled names for display', () => {
    expect(cleanMerchantName('ΑΝΤΗRΟΡΙC')).toBe('ANTHROPIC');
    expect(cleanMerchantName('SΤΑRLΙΝΚ')).toBe('STARLINK');
  });

  it('preserves genuinely-Greek merchant names unchanged', () => {
    // ΣΕΡΒΙΣ still contains Σ after transliteration → keep the original.
    expect(cleanMerchantName('ΣΕΡΒΙΣ ΜΟΤΟ')).toBe('ΣΕΡΒΙΣ ΜΟΤΟ');
    expect(cleanMerchantName('ΔΕΗ')).toBe('ΔΕΗ');
  });

  it('trims and handles empties', () => {
    expect(cleanMerchantName('  ANTHROPIC  ')).toBe('ANTHROPIC');
    expect(cleanMerchantName(null)).toBe('');
  });
});

describe('categorizationText', () => {
  it('includes both raw and transliterated forms, upper-cased', () => {
    const t = categorizationText('ΑΝΤΗRΟΡΙC');
    expect(t).toContain('ANTHROPIC');
    expect(t).toContain('ΑΝΤΗRΟΡΙC');
  });

  it('keeps genuine Greek searchable on the raw form', () => {
    expect(categorizationText('ΣΕΡΒΙΣ')).toContain('ΣΕΡΒΙΣ');
  });
});
