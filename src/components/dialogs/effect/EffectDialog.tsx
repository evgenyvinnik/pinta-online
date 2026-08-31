import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { translateUi } from '../../../i18n';
import type { RgbHistogram } from '../../../editor/usePaintEditor';
import { defaultEffectParameters, type EffectDefinition, type EffectParameters } from '../../../effects/types';
import { AngleDial, PointPad } from '../../primitives';
import { DialogActions, DialogResetButton, DialogStepper } from '../../dialogControls';
import { ColorPickerDialog } from '../../ColorPickerDialog';
import { AlignmentEditor, CurvesEditor, LevelsEditor } from './editors';
import { levelColor, levelParameterKey, type LevelChannel, type LevelControlKey } from './levels';

export interface EffectDialogProps {
  effect: EffectDefinition;
  busy: boolean;
  histogram: RgbHistogram;
  imageWidth: number;
  imageHeight: number;
  thumbnailUrl: string;
  onCancel: () => void;
  onPreview: (parameters: EffectParameters) => Promise<boolean>;
  onPreviewError: (error: unknown) => void;
  onSubmit: (parameters: EffectParameters) => Promise<void>;
}

export function EffectDialog({
  effect,
  busy,
  histogram,
  imageWidth,
  imageHeight,
  thumbnailUrl,
  onCancel,
  onPreview,
  onPreviewError,
  onSubmit,
}: EffectDialogProps) {
  const defaults = useMemo(() => defaultEffectParameters(effect), [effect]);
  const [parameters, setParameters] = useState<EffectParameters>(() => defaults);
  const [pointDisplay, setPointDisplay] = useState<Record<string, { x: number; y: number }>>(() =>
    effect.id === 'chromatic-aberration'
      ? Object.fromEntries(
          ['red', 'green', 'blue'].map((prefix) => [
            prefix,
            { x: Math.floor(imageWidth / 2), y: Math.floor(imageHeight / 2) },
          ]),
        )
      : {},
  );
  const [posterizeLinked, setPosterizeLinked] = useState(true);
  const [colorParameterKey, setColorParameterKey] = useState<string | null>(null);
  const [levelColorTarget, setLevelColorTarget] = useState<Exclude<LevelControlKey, 'gamma'> | null>(null);
  const [levelChannels, setLevelChannels] = useState<Record<LevelChannel, boolean>>({
    red: true,
    green: true,
    blue: true,
  });
  const onPreviewRef = useRef(onPreview);
  const onPreviewErrorRef = useRef(onPreviewError);
  const previewGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const visibleParameters = effect.parameters.filter(
    (parameter) => !parameter.visibleWhen || parameters[parameter.visibleWhen.key] === parameter.visibleWhen.equals,
  );

  const resetLevels = () => {
    setParameters((current) => {
      const next = { ...current };
      const selected = (['red', 'green', 'blue'] as LevelChannel[]).filter((channel) => levelChannels[channel]);
      for (const channel of selected.length ? selected : (['red', 'green', 'blue'] as LevelChannel[])) {
        next[levelParameterKey(channel, 'inputLow')] = 0;
        next[levelParameterKey(channel, 'inputHigh')] = 255;
        next[levelParameterKey(channel, 'gamma')] = 1;
        next[levelParameterKey(channel, 'outputLow')] = 0;
        next[levelParameterKey(channel, 'outputHigh')] = 255;
      }
      return next;
    });
  };

  const autoLevels = () => {
    setParameters((current) => {
      const next = { ...current };
      for (const channel of ['red', 'green', 'blue'] as LevelChannel[]) {
        const values = histogram[channel];
        const total = values.reduce((sum, count) => sum + count, 0);
        let cumulative = 0;
        let low = 0;
        let high = 255;
        const weighted = values.reduce((sum, count, value) => sum + value * count, 0);
        for (let value = 0; value < 256; value += 1) {
          const count = values[value];
          cumulative += count;
          if (cumulative > total * 0.005) {
            low = value;
            break;
          }
        }
        cumulative = 0;
        for (let value = 0; value < 256; value += 1) {
          cumulative += values[value];
          if (cumulative > total * 0.995) {
            high = value;
            break;
          }
        }
        if (high <= low) high = Math.min(255, low + 1);
        const mean = total ? weighted / total : 0;
        const ratio = (mean - low) / (high - low);
        const gamma =
          low < mean && mean < high && ratio > 0 && ratio !== 1
            ? Math.max(0.1, Math.min(10, Math.log(0.5) / Math.log(ratio)))
            : 1;
        next[levelParameterKey(channel, 'inputLow')] = Math.min(254, low);
        next[levelParameterKey(channel, 'inputHigh')] = high;
        next[levelParameterKey(channel, 'gamma')] = gamma;
        next[levelParameterKey(channel, 'outputLow')] = 0;
        next[levelParameterKey(channel, 'outputHigh')] = 255;
      }
      return next;
    });
  };

  const updateLevelColor = (control: Exclude<LevelControlKey, 'gamma'>, color: string) => {
    const bytes = [color.slice(1, 3), color.slice(3, 5), color.slice(5, 7)].map((value) => Number.parseInt(value, 16));
    setParameters((current) => {
      const next = { ...current };
      (['red', 'green', 'blue'] as LevelChannel[]).forEach((channel, index) => {
        const value = bytes[index];
        next[levelParameterKey(channel, control)] = value;
        if (control === 'inputLow')
          next[levelParameterKey(channel, 'inputHigh')] = Math.max(
            value + 1,
            next[levelParameterKey(channel, 'inputHigh')],
          );
        if (control === 'inputHigh')
          next[levelParameterKey(channel, 'inputLow')] = Math.min(
            value - 1,
            next[levelParameterKey(channel, 'inputLow')],
          );
        if (control === 'outputLow')
          next[levelParameterKey(channel, 'outputHigh')] = Math.max(
            value + 1,
            next[levelParameterKey(channel, 'outputHigh')],
          );
        if (control === 'outputHigh')
          next[levelParameterKey(channel, 'outputLow')] = Math.min(
            value - 1,
            next[levelParameterKey(channel, 'outputLow')],
          );
      });
      return next;
    });
  };

  useEffect(() => {
    onPreviewRef.current = onPreview;
    onPreviewErrorRef.current = onPreviewError;
  }, [onPreview, onPreviewError]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      previewGenerationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (busy) return;
    const generation = ++previewGenerationRef.current;
    const timer = window.setTimeout(() => {
      void Promise.resolve()
        .then(() => onPreviewRef.current(parameters))
        .catch((error) => {
          if (mountedRef.current && previewGenerationRef.current === generation) onPreviewErrorRef.current(error);
        });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [busy, parameters]);

  const updateParameter = (key: string, value: number) => {
    setParameters((current) => {
      if (effect.id === 'posterize' && posterizeLinked && ['red', 'green', 'blue'].includes(key)) {
        return { ...current, red: value, green: value, blue: value };
      }
      return { ...current, [key]: value };
    });
  };

  const simpleControls: ReactNode[] = [];
  for (let index = 0; index < visibleParameters.length; index += 1) {
    const parameter = visibleParameters[index];
    const following = visibleParameters[index + 1];
    const pointPrefix = parameter.key.endsWith('X') ? parameter.key.slice(0, -1) : null;
    if (pointPrefix !== null && following?.key === `${pointPrefix}Y`) {
      const isCenterOffset = pointPrefix === 'offset';
      const isAbsolutePoint = effect.id === 'chromatic-aberration' && ['red', 'green', 'blue'].includes(pointPrefix);
      const pointTitle = isCenterOffset
        ? ['dents', 'polar-inversion', 'twist'].includes(effect.id)
          ? 'Center Offset'
          : 'Offset'
        : `${pointPrefix[0].toUpperCase()}${pointPrefix.slice(1)} shift`;
      const displayX = isCenterOffset
        ? Math.floor(((parameters[parameter.key] + 1) * imageWidth) / 2)
        : isAbsolutePoint
          ? pointDisplay[pointPrefix].x
          : parameters[parameter.key];
      const displayY = isCenterOffset
        ? Math.floor(((parameters[following.key] + 1) * imageHeight) / 2)
        : isAbsolutePoint
          ? pointDisplay[pointPrefix].y
          : parameters[following.key];
      const minX = isCenterOffset || isAbsolutePoint ? 0 : parameter.min;
      const maxX = isCenterOffset || isAbsolutePoint ? imageWidth : parameter.max;
      const minY = isCenterOffset || isAbsolutePoint ? 0 : following.min;
      const maxY = isCenterOffset || isAbsolutePoint ? imageHeight : following.max;
      const updatePoint = (x: number, y: number) => {
        if (isAbsolutePoint) setPointDisplay((current) => ({ ...current, [pointPrefix]: { x, y } }));
        setParameters((current) => ({
          ...current,
          [parameter.key]: isCenterOffset ? (x * 2) / imageWidth - 1 : x,
          [following.key]: isCenterOffset ? (y * 2) / imageHeight - 1 : y,
        }));
      };
      simpleControls.push(
        <div className="native-effect-point" key={`${parameter.key}-${following.key}`}>
          <strong>{translateUi(pointTitle)}</strong>
          <div>
            <PointPad
              x={displayX}
              y={displayY}
              minX={minX}
              maxX={maxX}
              minY={minY}
              maxY={maxY}
              stepX={isCenterOffset ? 1 : parameter.step}
              stepY={isCenterOffset ? 1 : following.step}
              thumbnailUrl={thumbnailUrl}
              disabled={busy}
              onChange={updatePoint}
            />
            <span className="native-effect-point-fields">
              <label>
                <span>X:</span>
                <DialogStepper
                  label="Offset X"
                  min={minX}
                  max={maxX}
                  step={isCenterOffset || isAbsolutePoint ? 1 : parameter.step}
                  value={displayX}
                  disabled={busy}
                  onChange={(value) => updatePoint(value, displayY)}
                />
                <DialogResetButton
                  label="Reset Offset X"
                  disabled={busy}
                  onClick={() =>
                    isAbsolutePoint
                      ? updatePoint(Math.floor(imageWidth / 2), displayY)
                      : updateParameter(parameter.key, parameter.defaultValue)
                  }
                />
              </label>
              <label>
                <span>Y:</span>
                <DialogStepper
                  label="Offset Y"
                  min={minY}
                  max={maxY}
                  step={isCenterOffset || isAbsolutePoint ? 1 : following.step}
                  value={displayY}
                  disabled={busy}
                  onChange={(value) => updatePoint(displayX, value)}
                />
                <DialogResetButton
                  label="Reset Offset Y"
                  disabled={busy}
                  onClick={() =>
                    isAbsolutePoint
                      ? updatePoint(displayX, Math.floor(imageHeight / 2))
                      : updateParameter(following.key, following.defaultValue)
                  }
                />
              </label>
            </span>
          </div>
        </div>,
      );
      index += 1;
      continue;
    }
    if (/seed/i.test(parameter.key) || /seed/i.test(parameter.label)) {
      simpleControls.push(
        <div className="native-effect-seed" key={parameter.key}>
          <strong>{translateUi(parameter.label)}</strong>
          <div>
            <button
              type="button"
              className="native-dialog-button"
              disabled={busy}
              onClick={() =>
                updateParameter(
                  parameter.key,
                  Math.floor(Math.random() * Math.max(1, parameter.max - parameter.min + 1)) + parameter.min,
                )
              }
            >
              {translateUi('Reseed')}
            </button>
            <DialogStepper
              label={parameter.label}
              min={parameter.min}
              max={parameter.max}
              step={parameter.step}
              value={parameters[parameter.key]}
              disabled={busy}
              onChange={(value) => updateParameter(parameter.key, value)}
            />
          </div>
        </div>,
      );
      continue;
    }
    if ((parameter.key === 'angle' || parameter.key === 'rotation') && parameter.kind !== 'select') {
      simpleControls.push(
        <div className="native-effect-angle" key={parameter.key}>
          <strong>{translateUi(parameter.label)}</strong>
          <div>
            <AngleDial
              value={parameters[parameter.key]}
              min={parameter.min}
              max={parameter.max}
              disabled={busy}
              onChange={(value) => updateParameter(parameter.key, value)}
            />
            <DialogStepper
              label={parameter.label}
              min={parameter.min}
              max={parameter.max}
              step={parameter.step}
              value={parameters[parameter.key]}
              disabled={busy}
              onChange={(value) => updateParameter(parameter.key, value)}
            />
            <DialogResetButton
              label={`${translateUi('Reset')} ${translateUi(parameter.label)}`}
              disabled={busy}
              onClick={() => updateParameter(parameter.key, parameter.defaultValue)}
            />
          </div>
        </div>,
      );
      continue;
    }
    if (parameter.kind === 'boolean') {
      simpleControls.push(
        <label className="native-effect-boolean" key={parameter.key}>
          <input
            type="checkbox"
            checked={parameters[parameter.key] !== 0}
            disabled={busy}
            onChange={(event) => updateParameter(parameter.key, event.target.checked ? 1 : 0)}
          />
          <span>{translateUi(parameter.label)}</span>
        </label>,
      );
      continue;
    }
    if (parameter.kind === 'select') {
      simpleControls.push(
        <label className="native-effect-select" key={parameter.key}>
          <strong>{translateUi(parameter.label)}</strong>
          <select
            value={parameters[parameter.key]}
            disabled={busy}
            onChange={(event) => updateParameter(parameter.key, Number(event.target.value))}
          >
            {parameter.options?.map((option) => (
              <option key={option.value} value={option.value}>
                {translateUi(option.label)}
              </option>
            ))}
          </select>
        </label>,
      );
      continue;
    }
    if (parameter.kind === 'color') {
      const color = `#${Math.round(parameters[parameter.key]).toString(16).padStart(6, '0')}`;
      simpleControls.push(
        <div className="native-effect-color" key={parameter.key}>
          <strong>{translateUi(parameter.label)}</strong>
          <button
            type="button"
            className="native-effect-color-well"
            style={{ backgroundColor: color }}
            disabled={busy}
            aria-label={`${translateUi('Choose')} ${translateUi(parameter.label)}`}
            onClick={() => setColorParameterKey(parameter.key)}
          >
            <span>{color.toUpperCase()}</span>
          </button>
        </div>,
      );
      continue;
    }
    simpleControls.push(
      <label className="native-effect-range" key={parameter.key}>
        <strong>{translateUi(parameter.label)}</strong>
        <span>
          <input
            type="range"
            min={parameter.min}
            max={parameter.max}
            step={parameter.step}
            value={parameters[parameter.key]}
            disabled={busy}
            onChange={(event) => updateParameter(parameter.key, Number(event.target.value))}
          />
          <DialogStepper
            label={parameter.label}
            min={parameter.min}
            max={parameter.max}
            step={parameter.step}
            value={parameters[parameter.key]}
            disabled={busy}
            onChange={(value) => updateParameter(parameter.key, value)}
          />
          <DialogResetButton
            label={`${translateUi('Reset')} ${translateUi(parameter.label)}`}
            disabled={busy}
            onClick={() => updateParameter(parameter.key, parameter.defaultValue)}
          />
        </span>
      </label>,
    );
  }

  return (
    <div
      className="dialog-backdrop native-dialog-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (!busy && event.target === event.currentTarget) onCancel();
      }}
    >
      <form
        className={`pinta-dialog effect-dialog native-effect-dialog native-effect-dialog-${effect.dialog ?? 'simple'} native-effect-${effect.id}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="effect-dialog-title"
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit(parameters);
        }}
      >
        <h2 className="visually-hidden" id="effect-dialog-title">
          {translateUi(effect.name)}
        </h2>
        <div className="native-effect-content">
          {effect.dialog === 'curves' ? (
            <CurvesEditor parameters={parameters} disabled={busy} onChange={setParameters} />
          ) : effect.dialog === 'levels' ? (
            <LevelsEditor
              parameters={parameters}
              disabled={busy}
              onChange={setParameters}
              activeChannels={levelChannels}
              histogram={histogram}
              onChooseColor={setLevelColorTarget}
            />
          ) : effect.dialog === 'alignment' ? (
            <AlignmentEditor parameters={parameters} disabled={busy} onChange={setParameters} />
          ) : (
            <div className="native-effect-parameter-list">
              {simpleControls}
              {effect.hint && <p className="native-effect-hint">{translateUi(effect.hint)}</p>}
              {effect.id === 'posterize' && (
                <label className="native-effect-boolean posterize-linked">
                  <input
                    type="checkbox"
                    checked={posterizeLinked}
                    disabled={busy}
                    onChange={(event) => setPosterizeLinked(event.target.checked)}
                  />
                  <span>{translateUi('Linked')}</span>
                </label>
              )}
            </div>
          )}
        </div>
        <DialogActions
          onCancel={onCancel}
          disabled={busy}
          cancelDisabled={false}
          submitLabel={busy ? 'Applying…' : 'OK'}
        >
          {effect.dialog === 'levels' && (
            <div className="levels-native-footer-controls">
              <button type="button" className="native-dialog-button" disabled={busy} onClick={autoLevels}>
                Auto
              </button>
              <button type="button" className="native-dialog-button" disabled={busy} onClick={resetLevels}>
                Reset
              </button>
              {(['red', 'green', 'blue'] as const).map((channel) => (
                <label key={channel} className={`curve-channel-toggle channel-${channel}`}>
                  <input
                    type="checkbox"
                    checked={levelChannels[channel]}
                    disabled={busy}
                    onChange={(event) =>
                      setLevelChannels((current) => ({ ...current, [channel]: event.target.checked }))
                    }
                  />
                  {channel[0].toUpperCase() + channel.slice(1)}
                </label>
              ))}
            </div>
          )}
        </DialogActions>
      </form>
      {colorParameterKey && (
        <ColorPickerDialog
          title="Choose Color"
          primary={`#${Math.round(parameters[colorParameterKey]).toString(16).padStart(6, '0')}`}
          onCancel={() => setColorParameterKey(null)}
          onSubmit={(colors) => {
            updateParameter(colorParameterKey, Number.parseInt(colors.primary.slice(1, 7), 16));
            setColorParameterKey(null);
          }}
        />
      )}
      {levelColorTarget && (
        <ColorPickerDialog
          title="Choose Color"
          primary={levelColor(parameters, levelColorTarget)}
          onCancel={() => setLevelColorTarget(null)}
          onSubmit={(colors) => {
            updateLevelColor(levelColorTarget, colors.primary);
            setLevelColorTarget(null);
          }}
        />
      )}
    </div>
  );
}
