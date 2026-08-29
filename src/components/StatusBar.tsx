import { memo, useCallback, useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { EditorLiveMetrics, RafValueStore, SelectionSize } from '../editor/liveMetrics';
import { ZOOM_LEVELS, formatZoomPercent, parseZoomPercent, zoomInLevel, zoomOutLevel } from '../editor/zoom';
import { translateUi } from '../i18n';
import { MenuItem, Popover } from './menus';
import { ColorSwatch, IconButton, PintaIcon, PlusGlyph, ResetColorsIcon, SwapColorsIcon } from './primitives';

function useLiveMetric<T>(store: RafValueStore<T>) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
const PointerReadout = memo(function PointerReadout({ store }: { store: EditorLiveMetrics['pointer'] }) {
  const pointer = useLiveMetric(store);
  return (
    <div className="status-readout" dir="ltr" data-live-readout="pointer">
      <PintaIcon file="ui-cursor-location-symbolic.svg" size={15} />
      {Math.round(pointer.x)}, {Math.round(pointer.y)}
    </div>
  );
});
const SelectionSizeReadout = memo(function SelectionSizeReadout({
  store,
  width,
  height,
}: {
  store: RafValueStore<SelectionSize | null>;
  width: number;
  height: number;
}) {
  const selection = useLiveMetric(store);
  return (
    <div className="status-readout" dir="ltr" aria-label={translateUi('Selection size')} data-live-readout="selection">
      <PintaIcon className="selection-size-glyph" file="tool-select-rectangle-symbolic.svg" size={15} />
      {selection?.width ?? width}, {selection?.height ?? height}
    </div>
  );
});
export const StatusBar = memo(function StatusBar({
  hasDocument,
  primary,
  secondary,
  recentColors,
  palette,
  liveMetrics,
  width,
  height,
  zoom,
  zoomMode,
  onOpenColor,
  onSwapColors,
  onResetColors,
  onSetPrimary,
  onSetSecondary,
  onEditPalette,
  onAddPalette,
  onSetZoom,
  onZoomToWindow,
}: {
  hasDocument: boolean;
  primary: string;
  secondary: string;
  recentColors: string[];
  palette: string[];
  liveMetrics: EditorLiveMetrics;
  width: number;
  height: number;
  zoom: number;
  zoomMode: 'fixed' | 'fit' | 'window';
  onOpenColor: (target: 'primary' | 'secondary') => void;
  onSwapColors: () => void;
  onResetColors: () => void;
  onSetPrimary: (color: string) => void;
  onSetSecondary: (color: string) => void;
  onEditPalette: (index: number) => void;
  onAddPalette: () => void;
  onSetZoom: (zoom: number) => void;
  onZoomToWindow: () => void;
}) {
  useTranslation();
  const [zoomDraft, setZoomDraft] = useState<string | null>(null);
  const [zoomListOpen, setZoomListOpen] = useState(false);
  useEffect(() => {
    const close = (event: Event) => {
      if (event.type === 'pointerdown' && (event.target as Element | null)?.closest('.zoom-combo')) return;
      setZoomListOpen(false);
    };
    window.addEventListener('blur', close);
    window.addEventListener('pointerdown', close);
    return () => {
      window.removeEventListener('blur', close);
      window.removeEventListener('pointerdown', close);
    };
  }, []);
  const commitZoomDraft = useCallback(() => {
    const draft = zoomDraft;
    setZoomDraft(null);
    if (draft === null) return;
    if (draft.trim().toLowerCase() === translateUi('Window').toLowerCase()) {
      onZoomToWindow();
      return;
    }
    const parsed = parseZoomPercent(draft);
    if (parsed !== null) onSetZoom(parsed);
  }, [onSetZoom, onZoomToWindow, zoomDraft]);

  return (
    <footer className="status-bar">
      <div className="color-wells" title="Click either color to open the full color picker. Press X to swap.">
        <button
          className="color-well secondary checkerboard"
          style={{ '--well-color': secondary } as CSSProperties}
          onClick={() => onOpenColor('secondary')}
          aria-label={translateUi('Click to select secondary color.')}
          title={`${secondary} · ${translateUi('Click to select secondary color.')}`}
        />
        <button
          className="color-well primary checkerboard"
          style={{ '--well-color': primary } as CSSProperties}
          onClick={() => onOpenColor('primary')}
          aria-label={translateUi('Click to select primary color.')}
          title={`${primary} · ${translateUi('Click to select primary color.')}`}
        />
        <button
          className="swap-colors"
          type="button"
          onClick={onSwapColors}
          aria-label={translateUi('Click to switch between primary and secondary color.')}
          title={`${translateUi('Click to switch between primary and secondary color.')} ${translateUi('Shortcut key')}: X`}
        >
          <SwapColorsIcon />
        </button>
        <button
          className="reset-colors"
          type="button"
          onClick={onResetColors}
          aria-label={translateUi('Click to reset primary and secondary color.')}
          title={translateUi('Click to reset primary and secondary color.')}
        >
          <ResetColorsIcon />
        </button>
      </div>
      <div className="recent-palette" aria-label={translateUi('Recently Used Colors')}>
        {recentColors.slice(0, 10).map((color, index) => (
          <ColorSwatch
            key={`${color}-${index}`}
            className="recent-swatch"
            color={color}
            title={`${color} · ${translateUi('Click to select primary color.')}`}
            label={`${translateUi('Recently Used Colors')}: ${color}`}
            onPrimary={() => onSetPrimary(color)}
            onSecondary={() => onSetSecondary(color)}
          />
        ))}
      </div>
      <div className="palette" aria-label="Color palette">
        {palette.map((color, index) => (
          <ColorSwatch
            key={`${color}-${index}`}
            className="swatch"
            color={color}
            title={`${color} · click for primary, right-click or long press for secondary, Ctrl/⌘+click or middle-click to edit`}
            label={`Set color ${color}`}
            onPrimary={(event) => {
              if (event.ctrlKey || event.metaKey) onEditPalette(index);
              else onSetPrimary(color);
            }}
            onSecondary={() => onSetSecondary(color)}
            onAuxClick={(event) => {
              if (event.button === 1) onEditPalette(index);
            }}
            onDoubleClick={() => onEditPalette(index)}
          />
        ))}
        <button
          className="palette-add-swatch"
          type="button"
          disabled={palette.length >= 96}
          onClick={onAddPalette}
          aria-label={translateUi('Add Primary Color')}
          title={`${translateUi('Add Primary Color')}: ${primary}`}
        >
          <PlusGlyph />
        </button>
      </div>
      <div className="status-spacer" />
      {hasDocument && <PointerReadout store={liveMetrics.pointer} />}
      {hasDocument && <SelectionSizeReadout store={liveMetrics.selectionSize} width={width} height={height} />}
      <div className="zoom-control">
        <IconButton label="Zoom out" disabled={!hasDocument} onClick={() => onSetZoom(zoomOutLevel(zoom))}>
          <PintaIcon file="value-decrease-symbolic.svg" size={14} standard />
        </IconButton>
        <div className="zoom-combo" onClick={(event) => event.stopPropagation()}>
          <input
            className="zoom-entry"
            type="text"
            inputMode="numeric"
            disabled={!hasDocument}
            aria-label={translateUi('Zoom level')}
            value={zoomDraft ?? (zoomMode === 'window' ? translateUi('Window') : formatZoomPercent(zoom))}
            data-zoom-mode={zoomMode}
            onChange={(event) => setZoomDraft(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={commitZoomDraft}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitZoomDraft();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                setZoomDraft(null);
                event.currentTarget.blur();
              }
            }}
          />
          <button
            className="zoom-combo-arrow"
            type="button"
            disabled={!hasDocument}
            aria-label={translateUi('Choose zoom level')}
            aria-expanded={zoomListOpen}
            onClick={() => setZoomListOpen((open) => !open)}
          >
            <PintaIcon file="pan-down-symbolic.svg" size={12} standard />
          </button>
          {zoomListOpen && (
            <Popover align="right" className="zoom-level-popover">
              {ZOOM_LEVELS.map((level) => (
                <MenuItem
                  key={level}
                  label={`${level}%`}
                  checked={zoomMode === 'fixed' && Math.round(zoom * 100) === level}
                  onClick={() => {
                    setZoomListOpen(false);
                    onSetZoom(level / 100);
                  }}
                />
              ))}
              <MenuItem
                label="Window"
                checked={zoomMode === 'window'}
                onClick={() => {
                  setZoomListOpen(false);
                  onZoomToWindow();
                }}
              />
            </Popover>
          )}
        </div>
        <IconButton label="Zoom in" disabled={!hasDocument} onClick={() => onSetZoom(zoomInLevel(zoom))}>
          <PintaIcon file="value-increase-symbolic.svg" size={14} standard />
        </IconButton>
      </div>
    </footer>
  );
});
