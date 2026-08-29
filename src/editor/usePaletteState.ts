import { useCallback } from 'react';
import { PALETTE } from './tools';

interface PaletteStateDeps {
  primary: string;
  secondary: string;
  palette: string[];
  setPrimary: (value: string, addToRecent?: boolean) => void;
  setSecondary: (value: string, addToRecent?: boolean) => void;
  setPalette: (update: string[] | ((current: string[]) => string[])) => void;
}

/** The primary/secondary colours and the swatch palette beside them. */

export function usePaletteState({ primary, secondary, palette, setPrimary, setSecondary, setPalette }: PaletteStateDeps) {
  const swapColors = useCallback(() => {
    setPrimary(secondary);
    setSecondary(primary);
  }, [primary, secondary, setPrimary, setSecondary]);

  const replacePalette = useCallback((colors: string[]) => {
    const normalized = colors
      .filter((color) => /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color))
      .map((color) => color.toLowerCase());
    if (!normalized.length) return false;
    setPalette(normalized);
    return true;
  }, [setPalette]);

  const resetPalette = useCallback(() => {
    setPalette([...PALETTE]);
  }, [setPalette]);

  const resizePalette = useCallback((size: number) => {
    const nextSize = Math.max(1, Math.min(96, Math.round(size)));
    setPalette((current) => current.length >= nextSize
      ? current.slice(0, nextSize)
      : [...current, ...Array.from({ length: nextSize - current.length }, () => '#ffffff')]);
  }, [setPalette]);

  const setPaletteColor = useCallback((index: number, color: string) => {
    if (!/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) return false;
    setPalette((current) => current.map((candidate, candidateIndex) => candidateIndex === index ? color.toLowerCase() : candidate));
    return true;
  }, [setPalette]);

  const addPaletteColor = useCallback((color: string) => {
    if (!/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color) || palette.length >= 96) return false;
    setPalette((current) => [...current, color.toLowerCase()]);
    return true;
  }, [palette.length, setPalette]);

  return {
    swapColors,
    replacePalette,
    resetPalette,
    resizePalette,
    setPaletteColor,
    addPaletteColor,
  };
}
