import { describe, it, expect } from 'vitest';
import {
  inferCategoryFromText,
  countRuleMatches,
  buildRules,
  DEFAULT_CATEGORY_RULES,
} from '../bankRulesEngine.js';

describe('inferCategoryFromText (built-in rules)', () => {
  it('matches genuine Greek keywords', () => {
    expect(inferCategoryFromText('ΔΕΗ ΛΟΓΑΡΙΑΣΜΟΣ')).toEqual({ category: 'fixed', matched: true });
    expect(inferCategoryFromText('ΣΕΡΒΙΣ ΜΟΤΟ')).toEqual({ category: 'variable', matched: true });
    expect(inferCategoryFromText('ΕΝΟΙΚΙΟ ΓΡΑΦΕΙΟΥ')).toEqual({ category: 'fixed', matched: true });
    expect(inferCategoryFromText('ΔΑΝΕΙΟ ΔΟΣΗ')).toEqual({ category: 'loan', matched: true });
  });

  it('matches Latin keywords', () => {
    expect(inferCategoryFromText('ACME INSURANCE LTD')).toEqual({ category: 'fixed', matched: true });
  });

  it('flags unmatched descriptions as needs-attention (variable + matched:false)', () => {
    expect(inferCategoryFromText('ANTHROPIC')).toEqual({ category: 'variable', matched: false });
    expect(inferCategoryFromText('ΑΝΤΗRΟΡΙC')).toEqual({ category: 'variable', matched: false });
  });

  it('supports plain "contains" rules (Phase B shape) on transliterated text', () => {
    const rules = [{ contains: 'ANTHROPIC', category: 'fixed' }];
    // Source is mangled Greek glyphs; the contains rule still fires via transliteration.
    expect(inferCategoryFromText('ΑΝΤΗRΟΡΙC', rules)).toEqual({ category: 'fixed', matched: true });
  });

  it('respects rule order (first match wins)', () => {
    const rules = [
      { contains: 'STARLINK', category: 'fixed' },
      { contains: 'STAR', category: 'variable' },
    ];
    expect(inferCategoryFromText('SΤΑRLΙΝΚ', rules).category).toBe('fixed');
  });
});

describe('buildRules (org rules first, then built-in fallback)', () => {
  it('puts org rules before the defaults, sorted by priority', () => {
    const org = [
      { contains: 'B', category: 'fixed', priority: 2 },
      { contains: 'A', category: 'variable', priority: 1 },
    ];
    const built = buildRules(org);
    expect(built[0]).toMatchObject({ contains: 'A' });
    expect(built[1]).toMatchObject({ contains: 'B' });
    expect(built.length).toBe(org.length + DEFAULT_CATEGORY_RULES.length);
  });

  it('lets a custom org rule override a built-in keyword', () => {
    // ΣΕΡΒΙΣ defaults to 'variable'; an org rule reclassifies it to 'fixed'.
    const org = [{ contains: 'ΣΕΡΒΙΣ', category: 'fixed', priority: 1 }];
    expect(inferCategoryFromText('ΣΕΡΒΙΣ ΜΟΤΟ', buildRules(org))).toEqual({ category: 'fixed', matched: true });
  });

  it('falls back to defaults for descriptions no org rule covers', () => {
    const org = [{ contains: 'ZZZ', category: 'loan', priority: 1 }];
    expect(inferCategoryFromText('ΔΕΗ', buildRules(org)).category).toBe('fixed'); // built-in electricity rule, not the org 'loan'
  });

  it('empty org rules == defaults', () => {
    expect(buildRules([])).toEqual(DEFAULT_CATEGORY_RULES);
  });
});

describe('countRuleMatches', () => {
  it('counts how many descriptions a rule would match', () => {
    const rule = DEFAULT_CATEGORY_RULES.find((r) => r.category === 'fixed');
    const descs = ['ΔΕΗ', 'ΣΕΡΒΙΣ', 'INSURANCE CO', 'RANDOM SHOP'];
    expect(countRuleMatches(rule, descs)).toBe(1); // only ΔΕΗ for the first 'fixed' rule (electricity)
  });
});
