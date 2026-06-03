import { useEffect, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import styles from './Modal.module.css';

// #31 — module-level counter so nested modals don't clobber overflow
let _openModalCount = 0;

export default function Modal({ isOpen, onClose, title, children, width = 520 }) {
  const modalRef = useRef(null);
  // #32 — store the element that had focus before the modal opened, restore on close
  const triggerRef = useRef(typeof document !== 'undefined' ? document.activeElement : null);
  const titleId = useId();

  // #280 — normalize width to always be a valid CSS string
  const maxW = typeof width === 'number' ? width + 'px' : (width || '640px');

  // #31 — overflow counter; #286 — inert on background content
  useEffect(() => {
    if (!isOpen) return;
    _openModalCount++;
    if (_openModalCount === 1) document.body.style.overflow = 'hidden';

    // #286 — inert attribute on app root hides background content from AT
    const root = document.getElementById('root');
    if (root) {
      if ('inert' in HTMLElement.prototype) {
        root.setAttribute('inert', '');
      } else {
        root.setAttribute('aria-hidden', 'true');
      }
    }

    return () => {
      _openModalCount--;
      if (_openModalCount === 0) document.body.style.overflow = '';
      if (root) {
        root.removeAttribute('inert');
        root.removeAttribute('aria-hidden');
      }
    };
  }, [isOpen]);

  // #32 — restore focus to triggering element on close
  useEffect(() => {
    if (!isOpen) return;
    const trigger = triggerRef.current;
    return () => {
      if (trigger?.focus) trigger.focus();
    };
  }, [isOpen]);

  // #32 — focus the modal container on open
  useEffect(() => {
    if (isOpen) {
      // defer one frame so the DOM is painted
      const id = requestAnimationFrame(() => modalRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [isOpen]);

  // #32 — ESC closes + Tab trap
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key !== 'Tab') return;
    const focusable = modalRef.current?.querySelectorAll(
      'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  };

  if (!isOpen) return null;

  // #286 sets `inert` on #root to hide background content. The modal MUST be portaled
  // to document.body (OUTSIDE #root) — otherwise the modal, being a descendant of the
  // inerted #root, becomes inert itself and the whole dialog is unclickable in browsers
  // that support `inert` (e.g. Chrome). Portaling keeps the background-inert a11y win
  // while leaving the dialog interactive.
  return createPortal(
    <div
      className={styles.overlay}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={handleKeyDown}
    >
      {/* #32 — role="dialog" aria-modal, labelledby title, tabIndex so container is focusable */}
      <div
        ref={modalRef}
        className={styles.modal}
        style={{ maxWidth: maxW }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
      >
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>{title}</h2>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
