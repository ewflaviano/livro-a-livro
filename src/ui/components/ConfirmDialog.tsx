import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function ConfirmDialog({ title, children, confirmLabel, onCancel, onConfirm, busy = false }: {
  title: string; children: ReactNode; confirmLabel: string; onCancel: () => void;
  onConfirm: () => void; busy?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const cancel = useRef(onCancel);
  const pending = useRef(busy);
  cancel.current = onCancel;
  pending.current = busy;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const containFocus = (event: FocusEvent) => {
      if (!ref.current?.contains(event.target as Node)) ref.current?.focus();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); if (!pending.current) cancel.current(); }
      if (event.key === 'Tab') {
        const buttons = ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
        if (!buttons?.length) { event.preventDefault(); return; }
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) {
          event.preventDefault(); first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('focusin', containFocus);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('focusin', containFocus);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return createPortal(<div className="dialog-backdrop"><div className="confirm-dialog" ref={ref} tabIndex={-1}
    role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={busy}>
    <h2 id={titleId}>{title}</h2><div id={descriptionId}>{children}</div>
    <div className="form-actions"><button className="button button-secondary" disabled={busy} onClick={onCancel}>Cancelar</button>
      <button className="button button-danger" disabled={busy} onClick={onConfirm}>{busy ? 'Aguarde…' : confirmLabel}</button></div>
  </div></div>, document.body);
}
