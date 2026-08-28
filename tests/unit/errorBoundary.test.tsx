import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../../src/components/ErrorBoundary';

function Throws({ message = 'probe failure' }: { message?: string }): never {
  throw new Error(message);
}

/** React logs caught render errors; silence that so the output stays readable. */
function withQuietConsole(run: () => void) {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    run();
  } finally {
    error.mockRestore();
  }
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(<ErrorBoundary region="application"><p>canvas</p></ErrorBoundary>);
    expect(screen.getByText('canvas')).toBeTruthy();
  });

  it('replaces a thrown tree with a recoverable panel instead of nothing', () => {
    withQuietConsole(() => {
      render(<ErrorBoundary region="application"><Throws /></ErrorBoundary>);
    });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Pinta Online could not continue')).toBeTruthy();
    // The failure message has to reach the user; a generic apology is not recoverable.
    expect(screen.getByText('probe failure')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload without restoring' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download a copy' })).toBeTruthy();
  });

  it('offers only the region-appropriate recovery for inner failures', () => {
    withQuietConsole(() => {
      render(<ErrorBoundary region="canvas"><Throws /></ErrorBoundary>);
    });

    expect(screen.getByText('The drawing area stopped responding')).toBeTruthy();
    // Skipping restore is an application-level escape; it makes no sense for one panel.
    expect(screen.queryByRole('button', { name: 'Reload without restoring' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download a copy' })).toBeNull();
  });

  it('arms the skip-restore flag before reloading, so a poison pill is escapable', () => {
    withQuietConsole(() => {
      render(<ErrorBoundary region="application"><Throws /></ErrorBoundary>);
    });

    expect(sessionStorage.getItem('pinta-online-skip-restore')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reload without restoring' }));
    expect(sessionStorage.getItem('pinta-online-skip-restore')).toBe('1');
  });

  it('clears the failure and notifies the owner when dismissed', () => {
    const onDismiss = vi.fn();
    withQuietConsole(() => {
      render(
        <ErrorBoundary region="dialog" onDismiss={onDismiss}>
          <Throws message="dialog failure" />
        </ErrorBoundary>,
      );
    });

    expect(screen.getByText('This dialog stopped responding')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('reports the failure so a crash is visible in production', () => {
    const gtag = vi.fn();
    Object.defineProperty(window, 'gtag', { configurable: true, writable: true, value: gtag });
    withQuietConsole(() => {
      render(<ErrorBoundary region="application"><Throws message="reported failure" /></ErrorBoundary>);
    });

    expect(gtag).toHaveBeenCalledWith('event', 'exception', expect.objectContaining({
      description: expect.stringContaining('render: reported failure'),
      fatal: true,
    }));
  });
});
