import { useCallback, useState } from 'react';

const TOAST_DURATION_MS = 2200;

/** The transient status message shown at the bottom of the editor. */
export function useToast() {
  const [toast, setToast] = useState('');

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), TOAST_DURATION_MS);
  }, []);

  return { toast, notify };
}
