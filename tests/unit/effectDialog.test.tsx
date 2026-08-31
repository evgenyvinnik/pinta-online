import { act, cleanup, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EffectDialog, type EffectDialogProps } from '../../src/components/dialogs/effect/EffectDialog';
import { EFFECT_BY_ID } from '../../src/effects/types';

function props(overrides: Partial<EffectDialogProps> = {}): EffectDialogProps {
  const empty = () => new Array<number>(256).fill(0);
  return {
    effect: EFFECT_BY_ID.sepia,
    busy: false,
    histogram: { red: empty(), green: empty(), blue: empty() },
    imageWidth: 8,
    imageHeight: 6,
    thumbnailUrl: '',
    onCancel: vi.fn(),
    onPreview: vi.fn(async () => true),
    onPreviewError: vi.fn(),
    onSubmit: vi.fn(async () => undefined),
    ...overrides,
  };
}

async function flushPreviewTimer() {
  await act(async () => {
    vi.advanceTimersByTime(100);
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('EffectDialog preview lifecycle', () => {
  it('routes asynchronous preview failures to the dialog host', async () => {
    const failure = new Error('preview worker failed');
    const onPreviewError = vi.fn();
    render(
      <StrictMode>
        <EffectDialog {...props({ onPreview: vi.fn(async () => Promise.reject(failure)), onPreviewError })} />
      </StrictMode>,
    );

    await flushPreviewTimer();

    expect(onPreviewError).toHaveBeenCalledTimes(1);
    expect(onPreviewError).toHaveBeenCalledWith(failure);
  });

  it('also contains a synchronous preview exception', async () => {
    const failure = new Error('synchronous preview failure');
    const onPreviewError = vi.fn();
    render(
      <EffectDialog
        {...props({
          onPreview: () => {
            throw failure;
          },
          onPreviewError,
        })}
      />,
    );

    await flushPreviewTimer();

    expect(onPreviewError).toHaveBeenCalledWith(failure);
  });

  it('does not restart a preview only because callback identities changed', async () => {
    const firstPreview = vi.fn(async () => true);
    const view = render(<EffectDialog {...props({ onPreview: firstPreview })} />);
    await flushPreviewTimer();
    expect(firstPreview).toHaveBeenCalledTimes(1);

    const replacementPreview = vi.fn(async () => true);
    view.rerender(<EffectDialog {...props({ onPreview: replacementPreview })} />);
    await act(async () => vi.advanceTimersByTime(500));

    expect(replacementPreview).not.toHaveBeenCalled();
  });

  it('reports a started preview failure after the dialog enters its busy state', async () => {
    let rejectPreview: (error: Error) => void = () => undefined;
    const preview = new Promise<boolean>((_resolve, reject) => {
      rejectPreview = reject;
    });
    const onPreviewError = vi.fn();
    const view = render(<EffectDialog {...props({ onPreview: () => preview, onPreviewError })} />);
    await flushPreviewTimer();
    view.rerender(<EffectDialog {...props({ busy: true, onPreview: () => preview, onPreviewError })} />);

    const failure = new Error('late worker failure');
    await act(async () => {
      rejectPreview(failure);
      await Promise.resolve();
    });

    expect(onPreviewError).toHaveBeenCalledWith(failure);
  });

  it('ignores a superseded preview failure after the dialog closes', async () => {
    let rejectPreview: (error: Error) => void = () => undefined;
    const preview = new Promise<boolean>((_resolve, reject) => {
      rejectPreview = reject;
    });
    const onPreviewError = vi.fn();
    const view = render(<EffectDialog {...props({ onPreview: () => preview, onPreviewError })} />);
    await flushPreviewTimer();

    view.unmount();
    await act(async () => {
      rejectPreview(new Error('late preview error'));
      await Promise.resolve();
    });

    expect(onPreviewError).not.toHaveBeenCalled();
  });
});
