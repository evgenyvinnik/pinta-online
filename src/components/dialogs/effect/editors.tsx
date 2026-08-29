import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { RgbHistogram } from '../../../editor/usePaintEditor';
import type { EffectParameters } from '../../../effects/types';
import {
  curvePointsFromParameters,
  curveSvgPath,
  setCurvePoints,
  type CurveChannel,
  type CurvePoint,
} from '../../../effects/curves';
import { PintaIcon } from '../../primitives';
import { DialogStepper } from '../../dialogControls';
import {
  LEVEL_CONTROLS,
  levelColor,
  leveledHistogram,
  levelParameterKey,
  mapLevelValue,
  type LevelChannel,
  type LevelControlKey,
} from './levels';

const CURVE_CHANNEL_COLORS: Record<CurveChannel, string> = {
  luminosity: '#e8edf4',
  red: '#ef5350',
  green: '#4fd46b',
  blue: '#4d86ff',
};

export interface CurvesEditorProps {
  parameters: EffectParameters;
  disabled: boolean;
  onChange: (parameters: EffectParameters) => void;
}

export interface LevelsEditorProps extends CurvesEditorProps {
  activeChannels: Record<LevelChannel, boolean>;
  histogram: RgbHistogram;
  onChooseColor: (control: Exclude<LevelControlKey, 'gamma'>) => void;
}

export function HistogramChart({
  histogram,
  activeChannels,
  output = false,
}: {
  histogram: RgbHistogram;
  activeChannels: Record<LevelChannel, boolean>;
  output?: boolean;
}) {
  const selected = (['red', 'green', 'blue'] as LevelChannel[]).filter((channel) => activeChannels[channel]);
  const maximum = Math.max(1, ...selected.flatMap((channel) => histogram[channel]));
  const total = selected.reduce(
    (sum, channel) => sum + histogram[channel].reduce((channelSum, value) => channelSum + value, 0),
    0,
  );
  return (
    <svg
      className="levels-histogram"
      viewBox="0 0 255 100"
      preserveAspectRatio="none"
      role="img"
      aria-label={output ? 'Output histogram' : 'Input histogram'}
      data-total={total}
      data-output={output ? 'true' : 'false'}
    >
      {selected.map((channel) => {
        const points = histogram[channel]
          .map((occurrences, index) => `${index},${100 - (occurrences / maximum) * 100}`)
          .join(' ');
        return <polyline key={channel} className={`levels-histogram-channel channel-${channel}`} points={points} />;
      })}
    </svg>
  );
}

export function LevelGradient({
  kind,
  low,
  high,
  gamma,
  disabled,
  onChange,
}: {
  kind: 'input' | 'output';
  low: number;
  high: number;
  gamma: number;
  disabled: boolean;
  onChange: (control: LevelControlKey, value: number) => void;
}) {
  const dragRef = useRef<'low' | 'gamma' | 'high' | null>(null);
  const mid = low + (high - low) * Math.pow(0.5, gamma);
  const position = (value: number) => value / 2.55;
  const updateFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const handle = dragRef.current;
    if (!handle) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const value = Math.max(0, Math.min(255, Math.round(((bounds.bottom - event.clientY) / bounds.height) * 255)));
    if (handle === 'gamma') {
      const ratio = Math.max(0.000001, Math.min(0.999999, (value - low) / Math.max(1, high - low)));
      onChange('gamma', Math.max(0.1, Math.min(10, Math.log(ratio) / Math.log(0.5))));
    } else {
      onChange(
        kind === 'input'
          ? handle === 'low'
            ? 'inputLow'
            : 'inputHigh'
          : handle === 'low'
            ? 'outputLow'
            : 'outputHigh',
        value,
      );
    }
  };
  const handles =
    kind === 'input'
      ? [
          { key: 'low' as const, value: low },
          { key: 'high' as const, value: high },
        ]
      : [
          { key: 'low' as const, value: low },
          { key: 'gamma' as const, value: mid },
          { key: 'high' as const, value: high },
        ];
  return (
    <div
      className={`levels-gradient vertical ${kind}`}
      role="application"
      aria-label={`${kind === 'input' ? 'Input' : 'Output'} levels gradient`}
      aria-disabled={disabled}
      onPointerDown={(event) => {
        if (disabled) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const pointerValue = ((bounds.bottom - event.clientY) / bounds.height) * 255;
        dragRef.current = handles.reduce((nearest, candidate) =>
          Math.abs(candidate.value - pointerValue) < Math.abs(nearest.value - pointerValue) ? candidate : nearest,
        ).key;
        event.currentTarget.setPointerCapture(event.pointerId);
        updateFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(event);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        dragRef.current = null;
      }}
      onPointerCancel={() => {
        dragRef.current = null;
      }}
    >
      {handles.map((handle) => (
        <i
          key={handle.key}
          className={`levels-marker ${handle.key}`}
          style={{ bottom: `${position(handle.value)}%` }}
        />
      ))}
    </div>
  );
}

export function LevelsEditor({
  parameters,
  disabled,
  onChange,
  activeChannels,
  histogram,
  onChooseColor,
}: LevelsEditorProps) {
  const selectedChannels = (['red', 'green', 'blue'] as LevelChannel[]).filter((channel) => activeChannels[channel]);
  const displayedValue = (control: LevelControlKey) => {
    if (!selectedChannels.length) return control === 'gamma' ? 1 : control.endsWith('High') ? 255 : 0;
    const average =
      selectedChannels.reduce((total, channel) => total + parameters[levelParameterKey(channel, control)], 0) /
      selectedChannels.length;
    return control === 'gamma' ? Number(average.toFixed(1)) : Math.round(average);
  };
  const updateControl = (control: LevelControlKey, rawValue: number) => {
    const definition = LEVEL_CONTROLS.find((candidate) => candidate.key === control)!;
    const nextValue = Math.max(definition.min, Math.min(definition.max, rawValue));
    const next = { ...parameters };
    for (const channel of selectedChannels) {
      next[levelParameterKey(channel, control)] = nextValue;
      if (control === 'inputLow')
        next[levelParameterKey(channel, 'inputHigh')] = Math.max(
          nextValue + 1,
          next[levelParameterKey(channel, 'inputHigh')],
        );
      if (control === 'inputHigh')
        next[levelParameterKey(channel, 'inputLow')] = Math.min(
          nextValue - 1,
          next[levelParameterKey(channel, 'inputLow')],
        );
      if (control === 'outputLow')
        next[levelParameterKey(channel, 'outputHigh')] = Math.max(
          nextValue + 1,
          next[levelParameterKey(channel, 'outputHigh')],
        );
      if (control === 'outputHigh')
        next[levelParameterKey(channel, 'outputLow')] = Math.min(
          nextValue - 1,
          next[levelParameterKey(channel, 'outputLow')],
        );
    }
    onChange(next);
  };
  const inputLow = displayedValue('inputLow');
  const inputHigh = displayedValue('inputHigh');
  const outputLow = displayedValue('outputLow');
  const outputHigh = displayedValue('outputHigh');
  const gamma = displayedValue('gamma');
  const outputHistogram = leveledHistogram(histogram, parameters);
  const meanInput = (channel: LevelChannel) => {
    const total = histogram[channel].reduce((sum, count) => sum + count, 0);
    if (!total) return 0;
    return histogram[channel].reduce((sum, count, value) => sum + count * value, 0) / total;
  };
  const outputMidColor = `#${(['red', 'green', 'blue'] as LevelChannel[])
    .map((channel) => mapLevelValue(meanInput(channel), parameters, channel).toString(16).padStart(2, '0'))
    .join('')}`;

  return (
    <div className="levels-editor">
      <div className="levels-native-grid">
        <section className="levels-histogram-block">
          <strong>Input Histogram</strong>
          <HistogramChart histogram={histogram} activeChannels={activeChannels} />
        </section>
        <section className="levels-control-column levels-input-controls">
          <strong>Input</strong>
          <DialogStepper
            label="Input high value"
            min={1}
            max={255}
            value={inputHigh}
            disabled={disabled || !selectedChannels.length}
            onChange={(value) => updateControl('inputHigh', value)}
          />
          <button
            type="button"
            className="levels-color-panel"
            style={{ backgroundColor: levelColor(parameters, 'inputHigh') }}
            disabled={disabled}
            aria-label="Choose input high color"
            title="Choose input high color"
            onClick={() => onChooseColor('inputHigh')}
          />
          <span className="levels-control-spacer" />
          <button
            type="button"
            className="levels-color-panel"
            style={{ backgroundColor: levelColor(parameters, 'inputLow') }}
            disabled={disabled}
            aria-label="Choose input low color"
            title="Choose input low color"
            onClick={() => onChooseColor('inputLow')}
          />
          <DialogStepper
            label="Input low value"
            min={0}
            max={254}
            value={inputLow}
            disabled={disabled || !selectedChannels.length}
            onChange={(value) => updateControl('inputLow', value)}
          />
        </section>
        <section className="levels-gradient-column input" aria-label="Input range">
          <strong aria-hidden="true">&nbsp;</strong>
          <LevelGradient
            kind="input"
            low={inputLow}
            high={inputHigh}
            gamma={gamma}
            disabled={disabled || !selectedChannels.length}
            onChange={updateControl}
          />
        </section>
        <section className="levels-gradient-column output" aria-label="Output range">
          <strong>Output</strong>
          <LevelGradient
            kind="output"
            low={outputLow}
            high={outputHigh}
            gamma={gamma}
            disabled={disabled || !selectedChannels.length}
            onChange={updateControl}
          />
        </section>
        <section className="levels-control-column levels-output-controls">
          <strong aria-hidden="true">&nbsp;</strong>
          <DialogStepper
            label="Output high value"
            min={2}
            max={255}
            value={outputHigh}
            disabled={disabled || !selectedChannels.length}
            onChange={(value) => updateControl('outputHigh', value)}
          />
          <button
            type="button"
            className="levels-color-panel"
            style={{ backgroundColor: levelColor(parameters, 'outputHigh') }}
            disabled={disabled}
            aria-label="Choose output high color"
            title="Choose output high color"
            onClick={() => onChooseColor('outputHigh')}
          />
          <DialogStepper
            label="Gamma value"
            min={0.1}
            max={10}
            step={0.1}
            value={gamma}
            disabled={disabled || !selectedChannels.length}
            onChange={(value) => updateControl('gamma', value)}
          />
          <span
            className="levels-color-panel levels-output-mid"
            style={{ backgroundColor: outputMidColor }}
            aria-label="Leveled mean color"
            title="Leveled mean color"
          />
          <button
            type="button"
            className="levels-color-panel"
            style={{ backgroundColor: levelColor(parameters, 'outputLow') }}
            disabled={disabled}
            aria-label="Choose output low color"
            title="Choose output low color"
            onClick={() => onChooseColor('outputLow')}
          />
          <DialogStepper
            label="Output low value"
            min={0}
            max={252}
            value={outputLow}
            disabled={disabled || !selectedChannels.length}
            onChange={(value) => updateControl('outputLow', value)}
          />
        </section>
        <section className="levels-histogram-block">
          <strong>Output Histogram</strong>
          <HistogramChart histogram={outputHistogram} activeChannels={activeChannels} output />
        </section>
      </div>
    </div>
  );
}

export function CurvesEditor({ parameters, disabled, onChange }: CurvesEditorProps) {
  const parametersRef = useRef(parameters);
  parametersRef.current = parameters;
  const [activeRgbChannels, setActiveRgbChannels] = useState<Record<'red' | 'green' | 'blue', boolean>>({
    red: true,
    green: true,
    blue: true,
  });
  const [pointerPosition, setPointerPosition] = useState<CurvePoint>({ x: 255, y: 255 });
  const [selectedPoint, setSelectedPoint] = useState<{ channels: CurveChannel[]; x: number } | null>(null);
  const dragRef = useRef<{ channels: CurveChannel[]; x: number } | null>(null);
  const luminosityMode = parameters.curveMode === 0;
  const visibleChannels: CurveChannel[] = luminosityMode ? ['luminosity'] : ['red', 'green', 'blue'];
  const editableChannels = luminosityMode
    ? (['luminosity'] as CurveChannel[])
    : (['red', 'green', 'blue'] as CurveChannel[]).filter(
        (channel) => activeRgbChannels[channel as 'red' | 'green' | 'blue'],
      );

  const publish = (next: EffectParameters) => {
    parametersRef.current = next;
    onChange(next);
  };

  const coordinates = (event: ReactPointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(255, Math.round(((event.clientX - bounds.left) * 255) / bounds.width))),
      y: Math.max(0, Math.min(255, Math.round(255 - ((event.clientY - bounds.top) * 255) / bounds.height))),
    };
  };

  const updateDraggedPoint = (position: CurvePoint) => {
    const drag = dragRef.current;
    if (!drag) return;
    let next = parametersRef.current;
    let nextX = position.x;
    if (drag.x === 0 || drag.x === 255) nextX = drag.x;
    for (const channel of drag.channels) {
      const points = curvePointsFromParameters(next, channel).filter(
        (point) => point.x !== drag.x && point.x !== nextX,
      );
      points.push({ x: nextX, y: position.y });
      next = setCurvePoints(next, channel, points);
    }
    dragRef.current = { ...drag, x: nextX };
    setSelectedPoint({ channels: drag.channels, x: nextX });
    publish(next);
  };

  const removeSelectedPoint = () => {
    if (!selectedPoint || selectedPoint.x === 0 || selectedPoint.x === 255) return false;
    let next = parametersRef.current;
    for (const channel of selectedPoint.channels) {
      next = setCurvePoints(
        next,
        channel,
        curvePointsFromParameters(next, channel).filter((point) => point.x !== selectedPoint.x),
      );
    }
    setSelectedPoint(null);
    publish(next);
    return true;
  };

  const resetVisibleCurves = () => {
    let next = parametersRef.current;
    for (const channel of editableChannels.length ? editableChannels : visibleChannels) {
      next = setCurvePoints(next, channel, [
        { x: 0, y: 0 },
        { x: 255, y: 255 },
      ]);
    }
    publish(next);
  };

  return (
    <div className="curves-editor">
      <div className="curves-toolbar">
        <label>
          <span>Transfer Map</span>
          <select
            value={luminosityMode ? 'luminosity' : 'rgb'}
            disabled={disabled}
            onChange={(event) =>
              publish({ ...parametersRef.current, curveMode: event.target.value === 'luminosity' ? 0 : 1 })
            }
            aria-label="Transfer map"
          >
            <option value="rgb">RGB</option>
            <option value="luminosity">Luminosity</option>
          </select>
        </label>
        <output aria-label="Curve pointer position">
          ({pointerPosition.x}, {pointerPosition.y})
        </output>
      </div>
      <svg
        className="curves-graph"
        viewBox="0 0 256 256"
        role="application"
        aria-label="Curve transfer graph"
        tabIndex={0}
        onContextMenu={(event) => event.preventDefault()}
        onPointerMove={(event) => {
          const position = coordinates(event);
          setPointerPosition(position);
          if (dragRef.current) updateDraggedPoint(position);
        }}
        onPointerDown={(event) => {
          if (disabled || !editableChannels.length) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          const position = coordinates(event);
          setPointerPosition(position);
          const hitRadius = 8;
          const referencePoints = curvePointsFromParameters(parametersRef.current, editableChannels[0]);
          const nearest = referencePoints.reduce<CurvePoint | null>((match, point) => {
            const distance = Math.hypot(point.x - position.x, point.y - position.y);
            if (distance > hitRadius) return match;
            return !match || distance < Math.hypot(match.x - position.x, match.y - position.y) ? point : match;
          }, null);
          if (event.button === 2) {
            if (!nearest || nearest.x === 0 || nearest.x === 255) return;
            let next = parametersRef.current;
            for (const channel of editableChannels) {
              next = setCurvePoints(
                next,
                channel,
                curvePointsFromParameters(next, channel).filter((point) => point.x !== nearest.x),
              );
            }
            setSelectedPoint(null);
            publish(next);
            return;
          }
          const point = nearest ?? position;
          let next = parametersRef.current;
          for (const channel of editableChannels) {
            const points = curvePointsFromParameters(next, channel).filter((candidate) => candidate.x !== point.x);
            points.push(point);
            next = setCurvePoints(next, channel, points);
          }
          publish(next);
          dragRef.current = { channels: editableChannels, x: point.x };
          setSelectedPoint({ channels: editableChannels, x: point.x });
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
        onKeyDown={(event) => {
          if (disabled || !selectedPoint) return;
          if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            removeSelectedPoint();
            return;
          }
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault();
          const reference = curvePointsFromParameters(parametersRef.current, selectedPoint.channels[0]).find(
            (point) => point.x === selectedPoint.x,
          );
          if (!reference) return;
          const amount = event.shiftKey ? 10 : 1;
          dragRef.current = selectedPoint;
          updateDraggedPoint({
            x: reference.x + (event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0),
            y: reference.y + (event.key === 'ArrowDown' ? -amount : event.key === 'ArrowUp' ? amount : 0),
          });
          dragRef.current = null;
        }}
      >
        <rect width="255" height="255" className="curves-graph-background" />
        {[64, 128, 192].map((coordinate) => (
          <path
            key={`grid-${coordinate}`}
            className="curves-grid-line"
            d={`M${coordinate} 0V255M0 ${coordinate}H255`}
          />
        ))}
        <path className="curves-reference-line" d="M0 255L255 0" />
        {visibleChannels.map((channel) => {
          const active = channel === 'luminosity' || activeRgbChannels[channel as 'red' | 'green' | 'blue'];
          const points = curvePointsFromParameters(parameters, channel);
          return (
            <g key={channel} opacity={active ? 1 : 0.28}>
              <path className="curves-channel-line" stroke={CURVE_CHANNEL_COLORS[channel]} d={curveSvgPath(points)} />
              {active &&
                points.map((point) => (
                  <circle
                    key={`${channel}-${point.x}`}
                    className={`curves-control-point ${selectedPoint?.x === point.x && selectedPoint.channels.includes(channel) ? 'selected' : ''}`}
                    fill={CURVE_CHANNEL_COLORS[channel]}
                    cx={point.x}
                    cy={255 - point.y}
                    r="4"
                  />
                ))}
            </g>
          );
        })}
      </svg>
      <div className="curves-footer">
        {!luminosityMode &&
          (['red', 'green', 'blue'] as const).map((channel) => (
            <label key={channel} className={`curve-channel-toggle channel-${channel}`}>
              <input
                type="checkbox"
                checked={activeRgbChannels[channel]}
                disabled={disabled}
                onChange={(event) =>
                  setActiveRgbChannels((current) => ({ ...current, [channel]: event.target.checked }))
                }
              />
              {channel[0].toUpperCase() + channel.slice(1)}
            </label>
          ))}
        <button type="button" className="dialog-text-button" disabled={disabled} onClick={resetVisibleCurves}>
          Reset
        </button>
      </div>
      <p className="dialog-hint">Drag to add or move control points. Right-click an interior point to remove it.</p>
    </div>
  );
}

export function AlignmentEditor({ parameters, disabled, onChange }: CurvesEditorProps) {
  const positions = [
    { label: 'Top Left', icon: 'image-resize-canvas-nw-symbolic.svg' },
    { label: 'Top Center', icon: 'image-resize-canvas-up-symbolic.svg' },
    { label: 'Top Right', icon: 'image-resize-canvas-ne-symbolic.svg' },
    { label: 'Center Left', icon: 'image-resize-canvas-left-symbolic.svg' },
    { label: 'Center', icon: 'image-resize-canvas-base-symbolic.svg' },
    { label: 'Center Right', icon: 'image-resize-canvas-right-symbolic.svg' },
    { label: 'Bottom Left', icon: 'image-resize-canvas-sw-symbolic.svg' },
    { label: 'Bottom Center', icon: 'image-resize-canvas-down-symbolic.svg' },
    { label: 'Bottom Right', icon: 'image-resize-canvas-se-symbolic.svg' },
  ];
  const selected = parameters.position ?? 4;
  return (
    <div className="alignment-editor" role="group" aria-label="Object alignment">
      {positions.map((position, index) => (
        <button
          key={position.label}
          type="button"
          title={position.label}
          aria-label={position.label}
          aria-pressed={selected === index}
          disabled={disabled}
          onClick={() => onChange({ ...parameters, position: index })}
        >
          <PintaIcon file={position.icon} size={22} />
        </button>
      ))}
    </div>
  );
}
