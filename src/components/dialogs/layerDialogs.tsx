import { useEffect, useRef, useState } from 'react';
import { translateUi } from '../../i18n';
import { BLEND_MODES, type BlendMode, type PaintLayer } from '../../editor/types';
import { AngleDial, PointPad } from '../primitives';
import { DialogActions, DialogResetButton, DialogStepper } from '../dialogControls';

export interface LayerPropertiesDialogProps {
  layer: PaintLayer;
  onCancel: () => void;
  onPreview: (properties: { name: string; visible: boolean; opacity: number; blendMode: BlendMode }) => void;
  onSubmit: (properties: { name: string; visible: boolean; opacity: number; blendMode: BlendMode }) => void;
}

export function LayerPropertiesDialog({ layer, onCancel, onPreview, onSubmit }: LayerPropertiesDialogProps) {
  const [name, setName] = useState(layer.name);
  const [visible, setVisible] = useState(layer.visible);
  const [opacity, setOpacity] = useState(Math.round(layer.opacity * 100));
  const [blendMode, setBlendMode] = useState<BlendMode>(layer.blendMode);
  const onPreviewRef = useRef(onPreview);
  onPreviewRef.current = onPreview;
  const valid = name.trim().length > 0;
  useEffect(() => {
    onPreviewRef.current({ name, visible, opacity: opacity / 100, blendMode });
  }, [blendMode, name, opacity, visible]);

  return (
    <div className="dialog-backdrop native-dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <form className="pinta-dialog layer-properties-dialog" role="dialog" aria-modal="true" aria-labelledby="layer-properties-title" onSubmit={(event) => {
        event.preventDefault();
        if (valid) onSubmit({ name, visible, opacity: opacity / 100, blendMode });
      }}>
        <h2 className="visually-hidden" id="layer-properties-title">{translateUi('Layer Properties')}</h2>
        <div className="dialog-content layer-properties-content">
          <label className="layer-property-field">
            <span>{translateUi('Name')}</span>
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} aria-label={translateUi('Layer name')} />
          </label>
          <label className="dialog-checkbox layer-visible-field">
            <input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} />
            <span>{translateUi('Visible')}</span>
          </label>
          <label className="layer-property-field">
            <span>{translateUi('Blend Mode')}</span>
            <select value={blendMode} onChange={(event) => setBlendMode(event.target.value as BlendMode)} aria-label={translateUi('Blend mode')}>
              {BLEND_MODES.map((mode) => <option key={mode.id} value={mode.id}>{translateUi(mode.label)}</option>)}
            </select>
          </label>
          <label className="layer-opacity-field">
            <span>{translateUi('Opacity')}</span>
            <span className="layer-opacity-value">
              <input type="number" min="0" max="100" value={opacity} onChange={(event) => setOpacity(Math.max(0, Math.min(100, Number(event.target.value))))} aria-label="Opacity value" />
              <i>%</i>
            </span>
            <input type="range" min="0" max="100" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} aria-label={`Opacity ${opacity}%`} />
          </label>
        </div>
        <DialogActions onCancel={onCancel} disabled={!valid} />
      </form>
    </div>
  );
}

export function RotateZoomLayerDialog({ layer, imageWidth, imageHeight, thumbnailUrl, onCancel, onPreview, onSubmit }: { layer: PaintLayer; imageWidth: number; imageHeight: number; thumbnailUrl: string; onCancel: () => void; onPreview: (layerId: string, angle: number, panHorizontal: number, panVertical: number, zoom: number) => void; onSubmit: (angle: number, panHorizontal: number, panVertical: number, zoom: number) => void }) {
  const [angle, setAngle] = useState(0);
  const [panX, setPanX] = useState(() => Math.floor(imageWidth / 2));
  const [panY, setPanY] = useState(() => Math.floor(imageHeight / 2));
  const [panHorizontal, setPanHorizontal] = useState(0);
  const [panVertical, setPanVertical] = useState(0);
  const [zoom, setZoom] = useState(1);
  const updatePanX = (x: number) => { setPanX(x); setPanHorizontal(x * 2 / imageWidth - 1); };
  const updatePanY = (y: number) => { setPanY(y); setPanVertical(y * 2 / imageHeight - 1); };
  useEffect(() => {
    onPreview(layer.id, angle, panHorizontal, panVertical, zoom);
  }, [angle, layer.id, onPreview, panHorizontal, panVertical, zoom]);
  return (
    <div className="dialog-backdrop native-dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <form className="pinta-dialog rotate-zoom-dialog" role="dialog" aria-modal="true" aria-labelledby="rotate-zoom-title" onSubmit={(event) => {
        event.preventDefault();
        onSubmit(angle, panHorizontal, panVertical, zoom);
      }}>
        <h2 className="visually-hidden" id="rotate-zoom-title">{translateUi('Rotate / Zoom Layer')}</h2>
        <div className="dialog-content rotate-zoom-content">
          <div className="native-transform-control">
            <strong>{translateUi('Angle')}</strong>
            <div><AngleDial value={angle} min={-360} max={360} onChange={setAngle} /><DialogStepper label="Layer rotation angle" min={-360} max={360} value={angle} onChange={setAngle} /><DialogResetButton label="Reset angle" onClick={() => setAngle(0)} /></div>
          </div>
          <div className="native-transform-control native-transform-pan">
            <strong>{translateUi('Pan')}</strong>
            <div><PointPad x={panX} y={panY} minX={0} maxX={imageWidth} minY={0} maxY={imageHeight} stepX={1} stepY={1} thumbnailUrl={thumbnailUrl} onChange={(x, y) => { updatePanX(x); updatePanY(y); }} /><span className="native-effect-point-fields"><label><span>X:</span><DialogStepper label="Layer horizontal pan" min={0} max={imageWidth} value={panX} onChange={updatePanX} /><DialogResetButton label="Reset horizontal pan" onClick={() => updatePanX(Math.floor(imageWidth / 2))} /></label><label><span>Y:</span><DialogStepper label="Layer vertical pan" min={0} max={imageHeight} value={panY} onChange={updatePanY} /><DialogResetButton label="Reset vertical pan" onClick={() => updatePanY(Math.floor(imageHeight / 2))} /></label></span></div>
          </div>
          <label className="native-effect-range native-transform-zoom"><strong>{translateUi('Zoom')}</strong><span><input type="range" min="0" max="16" step="0.01" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /><DialogStepper label="Layer zoom value" min={0} max={16} step={0.01} value={zoom} onChange={setZoom} /><DialogResetButton label="Reset zoom" onClick={() => setZoom(1)} /></span></label>
        </div>
        <DialogActions onCancel={onCancel} />
      </form>
    </div>
  );
}
