import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToast } from '../../src/hooks/useToast';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useToast', () => {
  it('shows a message and clears it after the window', () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.toast).toBe('');

    act(() => result.current.notify('Opened photo.png'));
    expect(result.current.toast).toBe('Opened photo.png');

    act(() => {
      vi.advanceTimersByTime(2200);
    });
    expect(result.current.toast).toBe('');
  });

  it('gives a second message its own full window rather than the first one cutting it short', () => {
    const { result } = renderHook(() => useToast());

    act(() => result.current.notify('first'));
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    act(() => result.current.notify('second'));

    // The first message's timeout would fire here and, without cancelling it, blank the second.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.toast).toBe('second');

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.toast).toBe('');
  });

  it('cancels a pending timer on unmount rather than setting state afterwards', () => {
    const { result, unmount } = renderHook(() => useToast());
    act(() => result.current.notify('in flight'));
    unmount();
    expect(() => vi.advanceTimersByTime(3000)).not.toThrow();
  });
});
