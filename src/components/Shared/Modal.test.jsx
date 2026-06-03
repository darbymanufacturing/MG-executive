/**
 * Modal — bug #555 regression.
 *
 * The dialog MUST be portaled to document.body, OUTSIDE #root. The #286 a11y fix sets
 * `inert` (or aria-hidden) on #root to hide the background app while a modal is open.
 * Because the modal used to render INSIDE #root (no portal), that `inert` disabled the
 * modal itself — every modal in the app was unclickable in browsers that honour `inert`
 * (e.g. Chrome). Portaling the dialog out of #root keeps the background-inert win while
 * leaving the dialog interactive. jsdom does not enforce `inert` interaction-blocking,
 * so the guard here is structural: assert the dialog is NOT a descendant of #root.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import Modal from './Modal.jsx';

function mountRoot() {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
  return root;
}

describe('Modal — #555 portal keeps the dialog clickable while #root is inert', () => {
  afterEach(() => { cleanup(); document.getElementById('root')?.remove(); });

  it('portals the dialog to document.body, OUTSIDE #root (so #root[inert] cannot disable it)', () => {
    const root = mountRoot();
    render(
      <Modal isOpen onClose={() => {}} title="Add Cost"><button>Add Cost</button></Modal>,
      { container: root },
    );
    const dialog = screen.getByRole('dialog');
    // THE FIX: the dialog lives in <body>, never inside the inerted #root.
    expect(root.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
    expect(dialog.closest('#root')).toBe(null);
    expect(screen.getByRole('button', { name: 'Add Cost' }).closest('#root')).toBe(null);
    // #286 still hides the background app while open.
    expect(root.hasAttribute('inert') || root.hasAttribute('aria-hidden')).toBe(true);
  });

  it('clears the #root inert / aria-hidden when the modal closes', () => {
    const root = mountRoot();
    const { rerender } = render(
      <Modal isOpen onClose={() => {}} title="T"><span>x</span></Modal>,
      { container: root },
    );
    expect(root.hasAttribute('inert') || root.hasAttribute('aria-hidden')).toBe(true);
    rerender(<Modal isOpen={false} onClose={() => {}} title="T"><span>x</span></Modal>);
    expect(root.hasAttribute('inert')).toBe(false);
    expect(root.hasAttribute('aria-hidden')).toBe(false);
  });
});
