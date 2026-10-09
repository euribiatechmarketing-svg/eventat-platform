'use client';
// Form errors for screen readers (WCAG 3.3.1, 4.1.2, 4.1.3): a field with an error is aria-invalid and
// described by its error line, and after a refused submit focus moves to the first such field, so its
// label and its error are read out.
import { useEffect, type RefObject } from 'react';

/** Props of a field whose error line carries the id `${id}-err`. */
export const errorProps = (id: string, error?: string | null) =>
  (error ? { 'aria-invalid': true as const, 'aria-describedby': `${id}-err` } : {});

/** After every answer that has field errors, focus the first invalid field inside `root`. */
export function useFocusInvalid(root: RefObject<HTMLElement | null>, answer: unknown) {
  useEffect(() => {
    if (!answer) return;
    root.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [answer, root]);
}
