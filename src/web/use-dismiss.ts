import type { RefObject } from 'react';
import { useEffect } from 'react';

/**
 * While `open`, calls `close` on Escape, returning focus to `trigger`, and on a click or focus outside `container`, e.g.
 * tabbing past its last control.
 */
export function useDismiss(
  open: boolean,
  container: RefObject<HTMLElement | null>,
  trigger: RefObject<HTMLElement | null>,
  close: () => void,
): void {
  useEffect(() => {
    if (!open) {
      return;
    }
    function onOutside(event: Event) {
      if (event.target instanceof Node && !container.current?.contains(event.target)) {
        close();
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') {
        return;
      }
      close();
      trigger.current?.focus();
    }
    document.addEventListener('focusin', onOutside);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onOutside);
    return () => {
      document.removeEventListener('focusin', onOutside);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onOutside);
    };
  }, [close, container, open, trigger]);
}
