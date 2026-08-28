import {
  memo,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { translateUi } from '../i18n';

export interface IconButtonProps {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  className?: string;
}
export function IconButton({ label, children, onClick, disabled, active, className = '' }: IconButtonProps) {
  const translatedLabel = translateUi(label);
  return (
    <button
      className={`icon-button ${active ? 'active' : ''} ${className}`}
      aria-label={translatedLabel}
      title={translatedLabel}
      onClick={onClick}
      disabled={disabled}
      type="button"
    >
      {children}
    </button>
  );
}
export function PintaIcon({ file, size = 22, standard = false, className = '' }: { file: string; size?: number; standard?: boolean; className?: string }) {
  return <img className={`pinta-icon ${className}`} src={`/${standard ? 'standard-icons' : 'actions'}/${file}`} width={size} height={size} alt="" draggable={false} />;
}
export function BusySpinner({ size = 15 }: { size?: number }) {
  return <span className="busy-spinner" style={{ width: size, height: size }} aria-hidden="true" />;
}
export function SwapColorsIcon() {
  return (
    <svg viewBox="-0.75 -0.75 16.5 16.5" aria-hidden="true">
      <path d="M11 14C11 1 11 4 1 4" />
      <path d="M7 10 11 14 15 10" />
      <path d="M5 0 1 4 5 8" />
    </svg>
  );
}
export function ResetColorsIcon() {
  return (
    <svg viewBox="-0.5 -0.5 16 16" aria-hidden="true">
      <rect x="0.5" y="0.5" width="8" height="8" />
      <rect className="filled" x="6" y="6" width="9" height="9" />
    </svg>
  );
}
export const LONG_PRESS_MS = 500;
export function useSecondaryLongPress(onSecondary: () => void) {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  return {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
      fired.current = false;
      cancel();
      timer.current = window.setTimeout(() => {
        fired.current = true;
        onSecondary();
      }, LONG_PRESS_MS);
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    /** True when the long press already handled this interaction. */
    consumedClick: () => {
      const consumed = fired.current;
      fired.current = false;
      return consumed;
    },
  };
}
export const ColorSwatch = memo(function ColorSwatch({ className, color, title, label, onPrimary, onSecondary, onAuxClick, onDoubleClick }: {
  className: string;
  color: string;
  title: string;
  label: string;
  onPrimary: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onSecondary: () => void;
  onAuxClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onDoubleClick?: () => void;
}) {
  const longPress = useSecondaryLongPress(onSecondary);
  return (
    <button
      className={className}
      style={{ background: color }}
      type="button"
      title={title}
      aria-label={label}
      onPointerDown={longPress.onPointerDown}
      onPointerUp={longPress.onPointerUp}
      onPointerCancel={longPress.onPointerCancel}
      onPointerLeave={longPress.onPointerLeave}
      onClick={(event) => {
        if (longPress.consumedClick()) return;
        onPrimary(event);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onSecondary();
      }}
      onAuxClick={onAuxClick}
      onDoubleClick={onDoubleClick}
    />
  );
}, (previous, next) => previous.className === next.className
  && previous.color === next.color
  && previous.title === next.title
  && previous.label === next.label);
export function PlusGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="7" y="3" width="2" height="10" rx="0.5" />
      <rect x="3" y="7" width="10" height="2" rx="0.5" />
    </svg>
  );
}
export function ToolbarStepper({ label, value, min, max, onChange, className = '' }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void; className?: string }) {
  const update = (next: number) => onChange(Math.max(min, Math.min(max, Math.round(next))));
  const translatedLabel = translateUi(label);
  return (
    <span className={`native-toolbar-stepper ${className}`}>
      <input aria-label={translatedLabel} type="number" min={min} max={max} value={value} onChange={(event) => update(Number(event.target.value))} />
      <button type="button" aria-label={`${translateUi('Decrease')} ${translatedLabel}`} onClick={() => update(value - 1)}><PintaIcon file="value-decrease-symbolic.svg" size={13} standard /></button>
      <button type="button" aria-label={`${translateUi('Increase')} ${translatedLabel}`} onClick={() => update(value + 1)}><PintaIcon file="value-increase-symbolic.svg" size={13} standard /></button>
    </span>
  );
}
export function AngleDial({ value, min = -180, max = 180, disabled = false, onChange }: { value: number; min?: number; max?: number; disabled?: boolean; onChange?: (value: number) => void }) {
  const updateFromPointer = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!onChange || disabled) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    let next = Math.atan2(-(event.clientY - bounds.top - bounds.height / 2), event.clientX - bounds.left - bounds.width / 2) * 180 / Math.PI;
    if (min >= 0 && next < 0) next += 360;
    if (event.shiftKey) next = Math.round(next / 15) * 15;
    onChange(Math.max(min, Math.min(max, Math.round(next))));
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (!onChange || disabled || !['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    onChange(Math.max(min, Math.min(max, value + (event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : -1))));
  };
  return <span className="native-angle-dial" style={{ '--dial-angle': `${-value}deg` } as CSSProperties} role="slider" aria-label="Angle dial" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-disabled={disabled} tabIndex={onChange && !disabled ? 0 : -1} onKeyDown={onKeyDown} onPointerDown={(event) => { if (onChange && !disabled) event.currentTarget.setPointerCapture(event.pointerId); updateFromPointer(event); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(event); }}><i /></span>;
}
export function PointPad({ x, y, minX, maxX, minY, maxY, stepX = (maxX - minX) / 100, stepY = (maxY - minY) / 100, thumbnailUrl = '', disabled = false, onChange }: { x: number; y: number; minX: number; maxX: number; minY: number; maxY: number; stepX?: number; stepY?: number; thumbnailUrl?: string; disabled?: boolean; onChange?: (x: number, y: number) => void }) {
  const left = (x - minX) / Math.max(1e-9, maxX - minX) * 100;
  const top = (y - minY) / Math.max(1e-9, maxY - minY) * 100;
  const quantize = (value: number, min: number, max: number, step: number) => {
    const stepped = min + Math.round((value - min) / step) * step;
    return Math.max(min, Math.min(max, Number(stepped.toFixed(6))));
  };
  const updateFromPointer = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!onChange || disabled) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const nextX = minX + Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * (maxX - minX);
    const nextY = minY + Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) * (maxY - minY);
    onChange(quantize(nextX, minX, maxX, stepX), quantize(nextY, minY, maxY, stepY));
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (!onChange || disabled || !['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    onChange(
      quantize(x + (event.key === 'ArrowRight' ? stepX : event.key === 'ArrowLeft' ? -stepX : 0), minX, maxX, stepX),
      quantize(y + (event.key === 'ArrowDown' ? stepY : event.key === 'ArrowUp' ? -stepY : 0), minY, maxY, stepY),
    );
  };
  return <span className="native-point-pad" style={{ '--point-left': `${left}%`, '--point-top': `${top}%`, '--point-thumbnail': thumbnailUrl ? `url(${JSON.stringify(thumbnailUrl)})` : 'none' } as CSSProperties} role="application" aria-label={`Point picker, X ${x}, Y ${y}`} aria-disabled={disabled} tabIndex={onChange && !disabled ? 0 : -1} onKeyDown={onKeyDown} onPointerDown={(event) => { if (onChange && !disabled) event.currentTarget.setPointerCapture(event.pointerId); updateFromPointer(event); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(event); }}><i /></span>;
}
export interface ToolbarIconOption {
  value: string;
  label: string;
  icon?: string;
  standard?: boolean;
}
export function ToolbarIconSelect({ label, value, options, showLabel = false, className = '', onChange }: { label: string; value: string; options: readonly ToolbarIconOption[]; showLabel?: boolean; className?: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 0, maxHeight: 320 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = options.find((option) => option.value === value) ?? options[0];
  const textOnly = options.every((option) => !option.icon);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === selected.value));
  const translatedLabel = translateUi(label);

  const closeMenu = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const openMenu = (initialIndex = selectedIndex) => {
    const bounds = triggerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const maxHeight = Math.max(92, window.innerHeight - 16);
    const estimatedHeight = Math.min(options.length * 34 + 12, maxHeight);
    const fitsBelow = bounds.bottom + 6 + estimatedHeight <= window.innerHeight - 8;
    setActiveIndex(Math.max(0, Math.min(options.length - 1, initialIndex)));
    setPopoverPosition({
      top: fitsBelow ? bounds.bottom + 6 : Math.max(8, bounds.top - estimatedHeight - 6),
      left: Math.max(8, Math.min(bounds.left, window.innerWidth - 288)),
      maxHeight,
    });
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open) return;
    optionRefs.current[activeIndex]?.focus();
    const triggerBounds = triggerRef.current?.getBoundingClientRect();
    const popoverBounds = popoverRef.current?.getBoundingClientRect();
    if (!triggerBounds || !popoverBounds) return;
    const left = Math.max(8, Math.min(triggerBounds.left, window.innerWidth - popoverBounds.width - 8));
    const top = triggerBounds.bottom + 6 + popoverBounds.height <= window.innerHeight - 8
      ? triggerBounds.bottom + 6
      : Math.max(8, triggerBounds.top - popoverBounds.height - 6);
    setPopoverPosition((current) => current.left === left && current.top === top ? current : { ...current, left, top });
  }, [activeIndex, open]);

  const moveActiveOption = (nextIndex: number) => {
    const wrappedIndex = (nextIndex + options.length) % options.length;
    setActiveIndex(wrappedIndex);
    optionRefs.current[wrappedIndex]?.focus();
  };

  return (
    <div className={`native-toolbar-icon-select ${showLabel ? 'with-label' : ''} ${textOnly ? 'text-only' : ''} ${open ? 'open' : ''} ${className}`} title={`${translatedLabel}: ${translateUi(selected.label)}`} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <button ref={triggerRef} type="button" aria-label={`${translateUi('Choose')} ${translateUi(selected.label)}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => {
        if (open) closeMenu();
        else openMenu();
      }} onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          openMenu(event.key === 'End' ? options.length - 1 : event.key === 'Home' ? 0 : selectedIndex);
        } else if (event.key === 'Escape' && open) {
          event.preventDefault();
          closeMenu(true);
        }
      }}>
        {selected.icon && <PintaIcon file={selected.icon} size={18} standard={selected.standard} />}
        {showLabel && <span className="native-toolbar-selected-label">{translateUi(selected.label)}</span>}
        <span className="native-select-chevron" aria-hidden="true">⌄</span>
      </button>
      <select tabIndex={-1} aria-label={translatedLabel} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{translateUi(option.label)}</option>)}
      </select>
      {open && (
        <div ref={popoverRef} className="native-toolbar-option-popover" role="listbox" aria-label={`${translatedLabel} choices`} style={popoverPosition} onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            moveActiveOption(activeIndex + (event.key === 'ArrowDown' ? 1 : -1));
          } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            moveActiveOption(event.key === 'Home' ? 0 : options.length - 1);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            closeMenu(true);
          }
        }}>
          {options.map((option, index) => (
            <button ref={(element) => { optionRefs.current[index] = element; }} tabIndex={index === activeIndex ? 0 : -1} key={option.value} type="button" role="option" aria-selected={option.value === value} onMouseEnter={() => setActiveIndex(index)} onClick={() => { onChange(option.value); closeMenu(true); }}>
              {option.icon && <PintaIcon file={option.icon} size={18} standard={option.standard} />}
              <span>{translateUi(option.label)}</span>
              <span className="native-toolbar-option-check">{option.value === value && <span className="native-checkmark" />}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
