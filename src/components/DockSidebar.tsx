import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { context2d } from '../editor/canvasContext';
import { usePaintEditor } from '../editor/usePaintEditor';
import { BLEND_MODES, type BlendMode, type PaintLayer } from '../editor/types';
import { translateUi } from '../i18n';
import { MAX_DOCK_WIDTH, MIN_DOCK_WIDTH, usePreferences } from '../state/preferences';
import { MenuItem, Popover } from './menus';
import { IconButton, PintaIcon } from './primitives';

type PaintEditorController = ReturnType<typeof usePaintEditor>;
export type LayerPropertiesPreview = {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
};
const LayerThumbnail = memo(
  function LayerThumbnail({ layer }: { layer: PaintLayer }) {
    const thumbnailRef = useRef<HTMLCanvasElement>(null);
    const pixelRatio = Math.max(1, Math.min(2, globalThis.devicePixelRatio ?? 1));
    useLayoutEffect(() => {
      const thumbnail = thumbnailRef.current;
      if (!thumbnail) return;
      const context = context2d(thumbnail);
      context.clearRect(0, 0, thumbnail.width, thumbnail.height);
      const scale = Math.min(thumbnail.width / layer.canvas.width, thumbnail.height / layer.canvas.height);
      const width = Math.max(1, Math.round(layer.canvas.width * scale));
      const height = Math.max(1, Math.round(layer.canvas.height * scale));
      context.drawImage(
        layer.canvas,
        Math.floor((thumbnail.width - width) / 2),
        Math.floor((thumbnail.height - height) / 2),
        width,
        height,
      );
    }, [layer.canvas, layer.revision, pixelRatio]);
    return (
      <canvas
        ref={thumbnailRef}
        width={Math.round(53 * pixelRatio)}
        height={Math.round(42 * pixelRatio)}
        aria-hidden="true"
      />
    );
  },
  (previous, next) => previous.layer.canvas === next.layer.canvas && previous.layer.revision === next.layer.revision,
);
interface LayerRowPreview {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
}
const LayerRow = memo(function LayerRow({
  layer,
  active,
  preview,
  onSelect,
  onToggle,
  onEdit,
}: {
  layer: PaintLayer;
  active: boolean;
  preview: LayerRowPreview | null;
  onSelect: (id: string) => boolean;
  onToggle: (id: string) => void;
  onEdit: (id: string) => void;
}) {
  useTranslation();
  const displayName = preview?.name ?? layer.name;
  const displayVisible = preview?.visible ?? layer.visible;
  const displayOpacity = preview?.opacity ?? layer.opacity;
  const displayBlendMode = preview?.blendMode ?? layer.blendMode;
  return (
    <div
      className={`layer-row ${active ? 'active' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(layer.id)}
      onDoubleClick={() => onEdit(layer.id)}
      title={`${displayName === 'Background' ? translateUi(displayName) : displayName} · ${translateUi(BLEND_MODES.find((mode) => mode.id === displayBlendMode)?.label ?? 'Normal')} · ${Math.round(displayOpacity * 100)}%`}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onSelect(layer.id);
      }}
    >
      <button
        type="button"
        className="layer-eye"
        aria-label={displayVisible ? 'Hide layer' : 'Show layer'}
        onClick={(event) => {
          event.stopPropagation();
          onToggle(layer.id);
        }}
      >
        <PintaIcon
          file={displayVisible ? 'view-reveal-symbolic.svg' : 'view-conceal-symbolic.svg'}
          size={14}
          standard
        />
      </button>
      <span className="layer-thumbnail checkerboard">
        <LayerThumbnail layer={layer} />
      </span>
      <span className="layer-name">{displayName === 'Background' ? translateUi(displayName) : displayName}</span>
      {active && <span className="layer-check native-checkmark" aria-hidden="true" />}
    </div>
  );
});
const HistoryRow = memo(function HistoryRow({
  index,
  label,
  active,
  future,
  toolIcon,
  onSelect,
}: {
  index: number;
  label: string;
  active: boolean;
  future: boolean;
  toolIcon: string;
  onSelect: (index: number) => void;
}) {
  useTranslation();
  return (
    <button
      type="button"
      className={`history-row ${active ? 'active' : ''} ${future ? 'future' : ''}`}
      data-history-index={index}
      onClick={() => onSelect(index)}
    >
      {index === 0 ? (
        <PintaIcon file="document-new-symbolic.svg" size={14} standard />
      ) : (
        <PintaIcon file={index === 1 ? toolIcon : 'ui-historylist-symbolic.svg'} size={14} />
      )}
      <span>{translateUi(label)}</span>
    </button>
  );
});
export const DockSidebar = memo(function DockSidebar({
  documentState,
  commands,
  toolIcon,
  layerPropertiesPreview,
  onImportLayer,
  onOpenRotateZoomLayer,
  onEditLayer,
}: {
  documentState: PaintEditorController['slices']['document'];
  commands: PaintEditorController['slices']['commands'];
  toolIcon: string;
  layerPropertiesPreview: LayerPropertiesPreview | null;
  onImportLayer: () => void;
  onOpenRotateZoomLayer: () => void;
  onEditLayer: (id: string) => void;
}) {
  useTranslation();
  const dockLayout = usePreferences((state) => state.dockLayout);
  const setDockLayout = usePreferences((state) => state.setDockLayout);
  const [layerMenuOpen, setLayerMenuOpen] = useState(false);
  const activeLayerIndex = documentState.layers.findIndex((layer) => layer.id === documentState.activeLayerId);
  const canUndo = documentState.historyIndex > 0;
  const canRedo = documentState.historyIndex < documentState.history.length - 1;

  useEffect(() => {
    const close = (event: Event) => {
      if (event.type === 'pointerdown' && (event.target as Element | null)?.closest('.layer-menu-anchor')) return;
      setLayerMenuOpen(false);
    };
    window.addEventListener('blur', close);
    window.addEventListener('pointerdown', close);
    return () => {
      window.removeEventListener('blur', close);
      window.removeEventListener('pointerdown', close);
    };
  }, []);

  const startDockResize = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      const startX = event.clientX;
      const startWidth = dockLayout.width;
      const rtl = getComputedStyle(handle).direction === 'rtl';
      const move = (moveEvent: PointerEvent) => {
        const delta = (startX - moveEvent.clientX) * (rtl ? -1 : 1);
        setDockLayout((current) => ({
          ...current,
          width: Math.round(Math.max(MIN_DOCK_WIDTH, Math.min(MAX_DOCK_WIDTH, startWidth + delta))),
        }));
      };
      const stop = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', stop);
        handle.removeEventListener('pointercancel', stop);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', stop);
      handle.addEventListener('pointercancel', stop);
    },
    [dockLayout.width, setDockLayout],
  );

  const startPadResize = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      event.preventDefault();
      const handle = event.currentTarget;
      const sidebar = handle.parentElement;
      if (!sidebar) return;
      handle.setPointerCapture(event.pointerId);
      const bounds = sidebar.getBoundingClientRect();
      const move = (moveEvent: PointerEvent) => {
        const share = (moveEvent.clientY - bounds.top) / Math.max(1, bounds.height);
        setDockLayout((current) => ({ ...current, layersShare: Math.max(0.15, Math.min(0.85, share)) }));
      };
      const stop = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', stop);
        handle.removeEventListener('pointercancel', stop);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', stop);
      handle.addEventListener('pointercancel', stop);
    },
    [setDockLayout],
  );

  return (
    <aside
      className="dock-sidebar"
      style={
        {
          '--dock-width': `${dockLayout.width}px`,
          '--layers-share': dockLayout.layersShare,
        } as CSSProperties
      }
      data-layers-minimized={dockLayout.layersMinimized}
      data-history-minimized={dockLayout.historyMinimized}
    >
      <div
        className="dock-resize-handle dock-resize-width"
        role="separator"
        aria-label={translateUi('Resize tool windows')}
        aria-orientation="vertical"
        tabIndex={0}
        onPointerDown={startDockResize}
        onKeyDown={(event) => {
          const step = event.key === 'ArrowLeft' ? 16 : event.key === 'ArrowRight' ? -16 : 0;
          if (!step) return;
          event.preventDefault();
          setDockLayout((current) => ({
            ...current,
            width: Math.round(Math.max(MIN_DOCK_WIDTH, Math.min(MAX_DOCK_WIDTH, current.width + step))),
          }));
        }}
      />
      <section className="dock-panel layers-panel">
        <header className="dock-header">
          <span>{translateUi('Layers')}</span>
          <button
            className="dock-menu-button dock-minimize-button"
            type="button"
            aria-label={translateUi(dockLayout.layersMinimized ? 'Restore Layers' : 'Minimize Layers')}
            aria-expanded={!dockLayout.layersMinimized}
            onClick={() => setDockLayout((current) => ({ ...current, layersMinimized: !current.layersMinimized }))}
          >
            <span aria-hidden="true">{dockLayout.layersMinimized ? '+' : '−'}</span>
          </button>
          <div className="menu-anchor layer-menu-anchor" onClick={(event) => event.stopPropagation()}>
            <button
              className="dock-menu-button"
              type="button"
              aria-label="Layer menu"
              aria-expanded={layerMenuOpen}
              disabled={!documentState.documents.length}
              onClick={() => setLayerMenuOpen((value) => !value)}
            >
              <PintaIcon file="open-menu-symbolic.svg" size={15} standard />
            </button>
            {layerMenuOpen && (
              <Popover align="right" className="layer-menu-popover">
                <MenuItem
                  icon={<PintaIcon file="layer-import-symbolic.svg" size={16} />}
                  label="Import from File…"
                  onClick={() => {
                    setLayerMenuOpen(false);
                    onImportLayer();
                  }}
                />
                <div className="menu-divider" />
                <MenuItem
                  icon={<PintaIcon file="image-flip-horizontal-symbolic.svg" size={15} />}
                  label="Flip Horizontal"
                  shortcut="Ctrl+F"
                  onClick={() => {
                    setLayerMenuOpen(false);
                    commands.flipLayer('horizontal');
                  }}
                />
                <MenuItem
                  icon={<PintaIcon file="image-flip-vertical-symbolic.svg" size={15} />}
                  label="Flip Vertical"
                  shortcut="Shift+F"
                  onClick={() => {
                    setLayerMenuOpen(false);
                    commands.flipLayer('vertical');
                  }}
                />
                <MenuItem
                  icon={<PintaIcon file="layers-rotate-zoom-symbolic.svg" size={16} />}
                  label="Rotate / Zoom Layer…"
                  onClick={() => {
                    setLayerMenuOpen(false);
                    onOpenRotateZoomLayer();
                  }}
                />
                <div className="menu-divider" />
                <MenuItem
                  icon={<PintaIcon file="document-properties-symbolic.svg" size={15} standard />}
                  label="Layer Properties…"
                  shortcut="F4"
                  onClick={() => {
                    setLayerMenuOpen(false);
                    onEditLayer(documentState.activeLayerId);
                  }}
                />
              </Popover>
            )}
          </div>
        </header>
        <div className="layer-list">
          {[...documentState.layers].reverse().map((layer) => (
            <LayerRow
              key={layer.id}
              layer={layer}
              active={documentState.activeLayerId === layer.id}
              preview={layerPropertiesPreview?.id === layer.id ? layerPropertiesPreview : null}
              onSelect={commands.setActiveLayerId}
              onToggle={commands.toggleLayer}
              onEdit={onEditLayer}
            />
          ))}
        </div>
        <footer className="dock-toolbar">
          <IconButton label="Add New Layer" disabled={!documentState.documents.length} onClick={commands.addLayer}>
            <PintaIcon file="layers-add-layer-symbolic.svg" size={15} />
          </IconButton>
          <IconButton label="Delete Layer" disabled={documentState.layers.length <= 1} onClick={commands.deleteLayer}>
            <PintaIcon file="layers-remove-layer-symbolic.svg" size={15} />
          </IconButton>
          <IconButton
            label="Duplicate Layer"
            disabled={!documentState.documents.length}
            onClick={commands.duplicateLayer}
          >
            <PintaIcon file="layers-duplicate-layer-symbolic.svg" size={15} />
          </IconButton>
          <IconButton label="Merge Layer Down" disabled={activeLayerIndex <= 0} onClick={commands.mergeLayerDown}>
            <PintaIcon file="layers-merge-down-symbolic.svg" size={15} />
          </IconButton>
          <IconButton
            label="Move Layer Up"
            disabled={activeLayerIndex >= documentState.layers.length - 1}
            onClick={() => commands.moveLayer(1)}
          >
            <PintaIcon file="pan-up-symbolic.svg" size={15} standard />
          </IconButton>
          <IconButton label="Move Layer Down" disabled={activeLayerIndex <= 0} onClick={() => commands.moveLayer(-1)}>
            <PintaIcon file="pan-down-symbolic.svg" size={15} standard />
          </IconButton>
          <IconButton
            label="Layer Properties (F4)"
            disabled={!documentState.documents.length}
            onClick={() => onEditLayer(documentState.activeLayerId)}
          >
            <PintaIcon file="document-properties-symbolic.svg" size={15} standard />
          </IconButton>
        </footer>
      </section>

      <div
        className="dock-resize-handle dock-resize-pads"
        role="separator"
        aria-label={translateUi('Resize Layers and History')}
        aria-orientation="horizontal"
        tabIndex={0}
        onPointerDown={startPadResize}
        onKeyDown={(event) => {
          const step = event.key === 'ArrowUp' ? -0.04 : event.key === 'ArrowDown' ? 0.04 : 0;
          if (!step) return;
          event.preventDefault();
          setDockLayout((current) => ({
            ...current,
            layersShare: Math.max(0.15, Math.min(0.85, current.layersShare + step)),
          }));
        }}
      />
      <section className="dock-panel history-panel">
        <header className="dock-header">
          <span>{translateUi('History')}</span>
          <button
            className="dock-menu-button dock-minimize-button"
            type="button"
            aria-label={translateUi(dockLayout.historyMinimized ? 'Restore History' : 'Minimize History')}
            aria-expanded={!dockLayout.historyMinimized}
            onClick={() => setDockLayout((current) => ({ ...current, historyMinimized: !current.historyMinimized }))}
          >
            <span aria-hidden="true">{dockLayout.historyMinimized ? '+' : '−'}</span>
          </button>
        </header>
        <div className="history-list">
          {documentState.history[0]?.evicted && (
            <p className="history-evicted" role="status">
              {translateUi('Older steps were discarded to free memory.')}
            </p>
          )}
          {documentState.history.map((entry, index) => (
            <HistoryRow
              key={`${index}-${entry.label}`}
              index={index}
              label={entry.label}
              active={index === documentState.historyIndex}
              future={index > documentState.historyIndex}
              toolIcon={toolIcon}
              onSelect={commands.goToHistory}
            />
          ))}
        </div>
        <footer className="dock-toolbar history-toolbar">
          <IconButton label="Undo" onClick={commands.undo} disabled={!canUndo}>
            <PintaIcon file="edit-undo-symbolic.svg" size={15} standard />
          </IconButton>
          <IconButton label="Redo" onClick={commands.redo} disabled={!canRedo}>
            <PintaIcon file="edit-redo-symbolic.svg" size={15} standard />
          </IconButton>
        </footer>
      </section>
    </aside>
  );
});
