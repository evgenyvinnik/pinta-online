import type { ReactNode } from 'react';
import { translateUi } from '../i18n';

export type MenuName =
  | 'pinta'
  | 'file'
  | 'edit'
  | 'view'
  | 'image'
  | 'adjustments'
  | 'effects'
  | 'addins'
  | 'window'
  | 'help'
  | 'main'
  | null;
export interface MenuItemProps {
  icon?: ReactNode;
  label: string;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}
export function MenuItem({ icon, label, shortcut, checked, disabled, onClick }: MenuItemProps) {
  const translatedLabel = translateUi(label);
  return (
    <button
      className="menu-item"
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={checked === undefined ? undefined : checked}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="menu-check">{checked ? <span className="native-checkmark" aria-hidden="true" /> : icon}</span>
      <span>{translatedLabel}</span>
      {shortcut && <kbd>{shortcut}</kbd>}
    </button>
  );
}
export function Popover({
  children,
  align = 'left',
  className = '',
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <div className={`popover popover-${align} ${className}`} role="menu">
      {children}
    </div>
  );
}
export function TopLevelMenu({
  name,
  label,
  active,
  onToggle,
  onEnter,
  children,
  appMenu = false,
}: {
  name: Exclude<MenuName, null | 'main'>;
  label: string;
  active: boolean;
  onToggle: (name: Exclude<MenuName, null | 'main'>) => void;
  onEnter: (name: Exclude<MenuName, null | 'main'>) => void;
  children: ReactNode;
  appMenu?: boolean;
}) {
  const translatedLabel = translateUi(label);
  return (
    <div className={`macos-menu-anchor ${active ? 'active' : ''}`} onPointerEnter={() => onEnter(name)}>
      <button
        className={`macos-menu-button ${appMenu ? 'application-menu-button' : ''}`}
        data-menu-name={name}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={active}
        onClick={() => onToggle(name)}
      >
        {appMenu && <img src="/apps/com.github.PintaProject.Pinta.svg" alt="" />}
        <span>{translatedLabel}</span>
      </button>
      {active && <Popover className="macos-menu-popover">{children}</Popover>}
    </div>
  );
}
