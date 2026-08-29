import { useCallback, useEffect, useRef, useState } from 'react';

const TOAST_DURATION_MS = 2200;

/**
 * The transient status message shown at the bottom of the editor.
 *
 * The timer is kept in a ref so a second notification replaces the first. Without that, the
 * first message's timeout still fires on schedule and clears the second one early — two
 * notifications in quick succession left the second visible for only the remainder of the
 * first's window. The same ref lets the timer be cancelled on unmount.
 */
export function useToast() {
  const [toast, setToast] = useState('');
  const timerRef = useRef<number | null>(null);

  const notify = useCallback((message: string) => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    setToast(message);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setToast('');
    }, TOAST_DURATION_MS);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  return { toast, notify };
}
