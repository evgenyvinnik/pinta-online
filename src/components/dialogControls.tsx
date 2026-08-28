import type { ReactNode } from 'react';
import { translateUi } from '../i18n';
import { PintaIcon } from './primitives';

export function DialogStepper({
  label,
  value,
  min,
  max,
  step = 1,
  disabled = false,
  autoFocus = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  onChange: (value: number) => void;
}) {
  const update = (next: number) => onChange(Math.max(min, Math.min(max, next)));
  return (
    <span className="native-dialog-stepper" dir="ltr">
      <input
        aria-label={label}
        autoFocus={autoFocus}
        disabled={disabled}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => update(Number(event.target.value))}
      />
      <button type="button" disabled={disabled || value <= min} aria-label={`${translateUi('Decrease')} ${translateUi(label)}`} onClick={() => update(value - step)}><PintaIcon file="value-decrease-symbolic.svg" size={12} standard /></button>
      <button type="button" disabled={disabled || value >= max} aria-label={`${translateUi('Increase')} ${translateUi(label)}`} onClick={() => update(value + step)}><PintaIcon file="value-increase-symbolic.svg" size={12} standard /></button>
    </span>
  );
}
export function DialogResetButton({ label, disabled = false, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button className="native-reset-button" type="button" disabled={disabled} aria-label={label} title={label} onClick={onClick}>
      <PintaIcon file="edit-undo-symbolic.svg" size={16} standard />
    </button>
  );
}
export function DialogActions({
  onCancel,
  submitLabel = 'OK',
  disabled = false,
  cancelDisabled = disabled,
  children,
}: {
  onCancel: () => void;
  submitLabel?: string;
  disabled?: boolean;
  cancelDisabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <footer className="native-dialog-actions compact-dialog-actions">
      {children}
      <span className="native-dialog-actions-spacer" />
      <button type="button" className="native-dialog-button" disabled={cancelDisabled} onClick={onCancel}>{translateUi('Cancel')}</button>
      <button type="submit" className="native-dialog-button suggested" disabled={disabled}>{translateUi(submitLabel)}</button>
    </footer>
  );
}
