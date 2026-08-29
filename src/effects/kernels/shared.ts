/**
 * State and primitives shared by every effect kernel.
 *
 * The progress reporter is module-level mutable state, which is why it lives here rather than
 * being threaded through every kernel: ES modules are single instances, so each kernel module
 * importing `reportLoop` reports into the same range the dispatcher set up with
 * `withProgressRange`. Splitting the kernels into separate files does not change that.
 */
import type { EffectParameters } from '../types';

export const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
export const clampTruncatedByte = (value: number) => Math.max(0, Math.min(255, Math.trunc(value)));
export const value = (parameters: EffectParameters, key: string, fallback: number) => parameters[key] ?? fallback;

export type EffectProgressReporter = (progress: number) => void;

let activeProgressReporter: EffectProgressReporter | undefined;
let progressRangeStart = 0;
let progressRangeEnd = 1;
let lastReportedProgress = -1;

export function reportProgress(progress: number, force = false) {
  if (!activeProgressReporter) return;
  const normalized = Math.max(0, Math.min(1, progress));
  const absolute = progressRangeStart + (progressRangeEnd - progressRangeStart) * normalized;
  if (!force && absolute < 1 && absolute - lastReportedProgress < 0.01) return;
  if (absolute < lastReportedProgress) return;
  lastReportedProgress = absolute;
  activeProgressReporter(absolute);
}

export function reportLoop(completed: number, total: number, start = 0, end = 1) {
  reportProgress(start + (end - start) * completed / Math.max(1, total));
}

export function reportPixels(index: number, byteLength: number, start = 0, end = 1) {
  const pixel = index / 4 + 1;
  const pixels = Math.max(1, byteLength / 4);
  const interval = Math.max(1, Math.floor(pixels / 100));
  if (pixel === pixels || pixel % interval === 0) reportLoop(pixel, pixels, start, end);
}

export function withProgressRange<T>(start: number, end: number, operation: () => T): T {
  const previousStart = progressRangeStart;
  const previousEnd = progressRangeEnd;
  const span = previousEnd - previousStart;
  progressRangeStart = previousStart + span * start;
  progressRangeEnd = previousStart + span * end;
  try {
    return operation();
  } finally {
    progressRangeStart = previousStart;
    progressRangeEnd = previousEnd;
  }
}

/**
 * Installs the reporter for one run and resets the range. An imported binding cannot be assigned
 * to from another module, so the dispatcher goes through this rather than writing the variable.
 */
export function setProgressReporter(reporter: EffectProgressReporter | undefined) {
  activeProgressReporter = reporter;
  progressRangeStart = 0;
  progressRangeEnd = 1;
  lastReportedProgress = -1;
}
