import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PaidPanel from './PaidPanel.jsx';
import { formatEUR } from '../../utils/formatters.js';

// Testing Library collapses whitespace (incl. the non-breaking space el-GR puts before €).
const eur = (n) => formatEUR(n).replace(/\s+/g, ' ');

// #712 — "What we paid" is evidence (ticks, bank debits, actual records). It reads
// against what falls due in the same month, never against the month's costs.
describe('PaidPanel', () => {
  it('shows what was paid against what is due', () => {
    render(<PaidPanel total={250} byCategory={{ fixed: 250 }} due={750} label="this month" />);
    expect(screen.getAllByText(eur(250)).length).toBeGreaterThan(0);
    expect(screen.getByText(`this month · of ${eur(750)} due`)).toBeInTheDocument();
  });

  it('says so plainly when nothing has been marked paid yet', () => {
    render(<PaidPanel total={0} byCategory={{}} due={750} label="this month" />);
    expect(screen.getByText('Nothing marked paid this month yet.')).toBeInTheDocument();
  });

  it('keeps the plain wording when no due figure is given', () => {
    render(<PaidPanel total={0} byCategory={{}} label="this month" />);
    expect(screen.getByText('No spend recorded this month.')).toBeInTheDocument();
    expect(screen.getByText('this month')).toBeInTheDocument();
  });
});
