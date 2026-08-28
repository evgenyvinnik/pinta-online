import { memo, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { ToolDefinition, ToolId } from '../editor/types';
import { translateUi } from '../i18n';
import { PintaIcon } from './primitives';

const ToolButton = memo(function ToolButton({ item, active, onSelect }: {
  item: ToolDefinition;
  active: boolean;
  onSelect: (tool: ToolId) => void;
}) {
  useTranslation();
  const toolName = translateUi(item.name);
  return (
    <button
      className={`tool-button ${active ? 'active' : ''}`}
      type="button"
      title={`${toolName}${item.shortcut ? `\n${translateUi('Shortcut key')}: ${item.shortcut}` : ''}\n${translateUi(item.status)}`}
      aria-label={toolName}
      onClick={() => onSelect(item.id)}
    >
      <PintaIcon file={item.icon} size={22} />
    </button>
  );
});

export function Toolbox({
  items,
  rows,
  activeTool,
  onSelect,
}: {
  items: ToolDefinition[];
  rows: number;
  activeTool: ToolId;
  onSelect: (tool: ToolId) => void;
}) {
  return (
    <aside className="toolbox" style={{ '--toolbox-rows': rows } as CSSProperties} aria-label={translateUi('Tools')}>
      {items.map((item) => (
        <ToolButton key={item.id} item={item} active={activeTool === item.id} onSelect={onSelect} />
      ))}
    </aside>
  );
}
