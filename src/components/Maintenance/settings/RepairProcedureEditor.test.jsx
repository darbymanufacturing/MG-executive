/**
 * Regression tests for:
 *   #447 — ProcedureModal lazy useState doesn't re-init when initial prop changes
 *           (stale form shown when re-opening with a different procedure)
 *
 * Tests the useEffect re-init logic in isolation via a minimal harness that
 * mirrors the exact useState + useEffect pattern added in the fix, without
 * needing to mount the full ProcedureModal (which depends on Firebase contexts).
 */
import { describe, test, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useState, useEffect } from 'react';

// ── Minimal harness mirroring the exact fix ────────────────────────────────────
// Replicates the useState + useEffect pattern from ProcedureModal so the
// test verifies the logic that was actually changed, not an unrelated abstraction.

function blankForm() {
  return { title: '' };
}

function ModalHarness({ isOpen, initial }) {
  const [form, setForm] = useState(initial ?? blankForm());

  // This is the exact useEffect added by the fix (Bug #447):
  useEffect(() => {
    if (isOpen) {
      setForm(initial ?? blankForm());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initial?.id]);

  return <div data-testid="title">{form.title}</div>;
}

// Driver component so we can simulate the parent toggling isOpen + initial
function Driver({ procedures }) {
  const [isOpen, setIsOpen] = useState(false);
  const [initial, setInitial] = useState(null);

  return (
    <div>
      <ModalHarness isOpen={isOpen} initial={initial} />
      <button
        data-testid="open-a"
        onClick={() => { setInitial(procedures[0]); setIsOpen(true); }}
      >Open A</button>
      <button
        data-testid="close"
        onClick={() => setIsOpen(false)}
      >Close</button>
      <button
        data-testid="open-b"
        onClick={() => { setInitial(procedures[1]); setIsOpen(true); }}
      >Open B</button>
    </div>
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────────

const procedureA = { id: 'proc-a', title: 'Brake Pad Replacement' };
const procedureB = { id: 'proc-b', title: 'Chain Lubrication' };

describe('#447 — ProcedureModal form re-init on open', () => {
  test('shows procedureA title when opened with procedureA', async () => {
    render(<Driver procedures={[procedureA, procedureB]} />);

    await act(async () => {
      screen.getByTestId('open-a').click();
    });

    expect(screen.getByTestId('title').textContent).toBe('Brake Pad Replacement');
  });

  test('updates to procedureB title after close then re-open with procedureB', async () => {
    render(<Driver procedures={[procedureA, procedureB]} />);

    // Open A
    await act(async () => { screen.getByTestId('open-a').click(); });
    expect(screen.getByTestId('title').textContent).toBe('Brake Pad Replacement');

    // Close (isOpen becomes false — form should NOT reset yet, just waiting)
    await act(async () => { screen.getByTestId('close').click(); });

    // Re-open with B — the useEffect must re-init form to B's data
    await act(async () => { screen.getByTestId('open-b').click(); });
    expect(screen.getByTestId('title').textContent).toBe('Chain Lubrication');
  });

  test('does NOT show stale procedureA title when re-opened with procedureB', async () => {
    render(<Driver procedures={[procedureA, procedureB]} />);

    await act(async () => { screen.getByTestId('open-a').click(); });
    await act(async () => { screen.getByTestId('close').click(); });
    await act(async () => { screen.getByTestId('open-b').click(); });

    // Stale value guard — must not be A's title
    expect(screen.getByTestId('title').textContent).not.toBe('Brake Pad Replacement');
    expect(screen.getByTestId('title').textContent).toBe('Chain Lubrication');
  });
});
