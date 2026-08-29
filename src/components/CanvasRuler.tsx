import type { CSSProperties } from 'react';
import type { RulerMetric } from '../state/preferences';

function rulerStep(unitPixels: number, zoom: number) {
  const minimumUnits = 56 / Math.max(0.001, unitPixels * zoom);
  const magnitude = 10 ** Math.floor(Math.log10(minimumUnits));
  for (const factor of [1, 2, 5, 10]) {
    const step = factor * magnitude;
    if (step >= minimumUnits) return step;
  }
  return 10 * magnitude;
}
export function CanvasRuler({ orientation, metric, imageSize, zoom, viewportSize, scroll }: {
  orientation: 'horizontal' | 'vertical';
  metric: RulerMetric;
  imageSize: number;
  zoom: number;
  viewportSize: number;
  scroll: number;
}) {
  const unitPixels = metric === 'pixels' ? 1 : metric === 'inches' ? 96 : 96 / 2.54;
  const step = rulerStep(unitPixels, zoom);
  const majorPixels = step * unitPixels * zoom;
  const minorPixels = Math.max(3, majorPixels / 10);
  const canvasPixels = imageSize * zoom;
  const offset = Math.max(26, (viewportSize - canvasPixels) / 2) - scroll;
  const first = Math.max(0, Math.floor((-offset) / majorPixels) * step);
  const last = Math.min(imageSize / unitPixels, Math.ceil((viewportSize - offset) / majorPixels) * step + step);
  const ticks: Array<{ value: number; position: number }> = [];
  for (let value = first, count = 0; value <= last + step / 100 && count < 160; value += step, count += 1) {
    ticks.push({ value, position: offset + value * unitPixels * zoom });
  }
  const style = {
    '--ruler-offset': `${offset}px`,
    '--ruler-minor': `${minorPixels}px`,
  } as CSSProperties;
  const digits = step < 1 ? Math.min(3, Math.ceil(-Math.log10(step))) : 0;
  return (
    <div className={`canvas-ruler canvas-ruler-${orientation}`} style={style} aria-hidden="true">
      {ticks.map((tick) => (
        <span
          key={`${orientation}-${tick.value}`}
          className="ruler-major-tick"
          style={orientation === 'horizontal' ? { left: tick.position } : { top: tick.position }}
        >
          {metric === 'pixels' ? Math.round(tick.value) : tick.value.toFixed(digits)}
        </span>
      ))}
    </div>
  );
}
