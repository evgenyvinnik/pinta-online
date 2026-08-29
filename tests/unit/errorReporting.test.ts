import { afterEach, describe, expect, it, vi } from 'vitest';
import { countRepeat, errorMessageOf, isForeignError, noteRepeat, reportError } from '../../src/errorReporting';

afterEach(() => {
  Reflect.deleteProperty(window, 'gtag');
});

function errorEvent(overrides: Partial<ErrorEvent>) {
  return { message: 'boom', filename: `${location.origin}/assets/app.js`, ...overrides } as ErrorEvent;
}

describe('errorMessageOf', () => {
  it('reads a message from anything a handler might receive', () => {
    expect(errorMessageOf(new Error('exploded'))).toBe('exploded');
    expect(errorMessageOf('string rejection')).toBe('string rejection');
    expect(errorMessageOf({ nope: true })).toBe('Unknown error');
    // An Error with no message still identifies itself by name.
    expect(errorMessageOf(new TypeError())).toBe('TypeError');
  });
});

describe('isForeignError', () => {
  it('keeps errors that came from the application', () => {
    expect(isForeignError(errorEvent({}))).toBe(false);
  });

  it('ignores extensions and other origins the user cannot act on', () => {
    expect(isForeignError(errorEvent({ filename: 'chrome-extension://abc/inject.js' }))).toBe(true);
    expect(isForeignError(errorEvent({ filename: 'https://tracker.example/pixel.js' }))).toBe(true);
  });

  it('treats an opaque cross-origin script error as foreign', () => {
    expect(isForeignError(errorEvent({ filename: '', message: 'Script error.' }))).toBe(true);
  });

  it('does not discard a real error that merely lacks a filename', () => {
    expect(isForeignError(errorEvent({ filename: '', message: 'Cannot read properties of null' }))).toBe(false);
  });
});

describe('countRepeat', () => {
  it('reports the first sighting as new and later ones as repeats', () => {
    const message = `repeat-${Math.random()}`;
    expect(countRepeat(message)).toBe(0);
    expect(countRepeat(message)).toBeGreaterThan(0);
    expect(countRepeat(message)).toBeGreaterThan(0);
  });

  it('treats different messages independently', () => {
    const first = `a-${Math.random()}`;
    const second = `b-${Math.random()}`;
    expect(countRepeat(first)).toBe(0);
    expect(countRepeat(second)).toBe(0);
  });

  it('lets a boundary pre-record a message so the window handler stays quiet', () => {
    const message = `boundary-${Math.random()}`;
    noteRepeat(message);
    expect(countRepeat(message)).toBeGreaterThan(0);
  });
});

describe('reportError', () => {
  it('does nothing when analytics is absent', () => {
    expect(() => reportError(new Error('no analytics'), 'worker')).not.toThrow();
  });

  it('sends the area and message but never a stack trace', () => {
    const gtag = vi.fn();
    Object.defineProperty(window, 'gtag', { configurable: true, writable: true, value: gtag });
    const error = new Error('persistence failed');
    error.stack = 'Error: persistence failed\n    at /Users/someone/secret/path.ts:1:1';

    reportError(error, 'persistence');

    const [, , parameters] = gtag.mock.calls[0];
    expect(parameters.description).toBe('persistence: persistence failed');
    expect(JSON.stringify(parameters)).not.toContain('secret/path');
    expect(parameters.fatal).toBe(false);
  });

  it('survives analytics throwing', () => {
    Object.defineProperty(window, 'gtag', {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error('analytics blew up');
      },
    });
    expect(() => reportError(new Error('inner'), 'codec')).not.toThrow();
  });
});
