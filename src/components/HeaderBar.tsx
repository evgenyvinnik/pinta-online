import type { ReactNode } from 'react';
import { usePaintEditor } from '../editor/usePaintEditor';
import { translateDocumentName, translateUi } from '../i18n';
import { USER_GUIDE_URL, WEB_BUG_REPORT_URL } from '../projectLinks';
import type { DialogName } from './dialogs/ImageSizeDialog';
import { MenuItem, Popover, type MenuName } from './menus';
import { IconButton, PintaIcon } from './primitives';

type HeaderEditor = ReturnType<typeof usePaintEditor>;
type PasteTarget = 'current' | 'new-layer' | 'new-image';
type AuxiliaryDialogName = 'shortcuts' | 'language' | 'about';

interface HeaderCommands {
  openDialog: (dialog: Exclude<DialogName, null>) => void;
  openImages: () => void;
  saveCurrentImage: () => void;
  copyImage: (mode: 'cut' | 'copy' | 'copy-merged') => void;
  requestPaste: (target: PasteTarget) => void;
  closeAnd: (action: () => void) => void;
  openScreenshot: () => void;
  openSaveAs: () => void;
  openPrintDialog: () => void;
  requestCloseDocument: (documentId: string) => void;
  requestSaveAll: () => void;
  requestCloseAll: () => void;
  openOffsetSelection: () => void;
  notify: (message: string) => void;
  openPalette: () => void;
  savePalette: () => void;
  resizePalette: () => void;
  openAuxiliary: (dialog: AuxiliaryDialogName) => void;
  toggleSidebar: () => void;
  toggleFullscreen: () => void;
}

export function HeaderBar({
  editor,
  iconSize,
  canUndo,
  canRedo,
  showSidebar,
  openMenu,
  menuSurface,
  renderMenuContent,
  commands,
  onSetOpenMenu,
  onSetMenuSurface,
}: {
  editor: HeaderEditor;
  iconSize: number;
  canUndo: boolean;
  canRedo: boolean;
  showSidebar: boolean;
  openMenu: MenuName;
  menuSurface: 'top' | 'header' | null;
  renderMenuContent: (menu: Exclude<MenuName, null | 'main'>) => ReactNode;
  commands: HeaderCommands;
  onSetOpenMenu: (menu: MenuName) => void;
  onSetMenuSurface: (surface: 'top' | 'header' | null) => void;
}) {
  const hasDocument = editor.documents.length > 0;
  const toggleHeaderMenu = (name: Exclude<MenuName, null | 'main'> | 'main') => {
    if (menuSurface === 'header' && openMenu === name) {
      onSetOpenMenu(null);
      onSetMenuSurface(null);
      return;
    }
    onSetMenuSurface('header');
    onSetOpenMenu(name);
  };

  return (
    <header
      className="header-bar"
      onClick={() => {
        onSetOpenMenu(null);
        onSetMenuSurface(null);
      }}
    >
      <div className="header-cluster">
        <IconButton label="New Image (Ctrl+N)" onClick={() => commands.openDialog('new')}>
          <PintaIcon file="document-new-symbolic.svg" size={iconSize} standard />
        </IconButton>
        <IconButton label="Open Image (Ctrl+O)" onClick={commands.openImages}>
          <PintaIcon file="document-open-symbolic.svg" size={iconSize} standard />
        </IconButton>
        <IconButton label="Save Image (Ctrl+S)" disabled={!hasDocument} onClick={commands.saveCurrentImage}>
          <PintaIcon file="document-save-symbolic.svg" size={iconSize} standard />
        </IconButton>
        <span className="toolbar-separator" />
        <IconButton label="Undo (Ctrl+Z)" onClick={editor.undo} disabled={!canUndo}>
          <PintaIcon file="edit-undo-symbolic.svg" size={iconSize} standard />
        </IconButton>
        <IconButton label="Redo (Ctrl+Y)" onClick={editor.redo} disabled={!canRedo}>
          <PintaIcon file="edit-redo-symbolic.svg" size={iconSize} standard />
        </IconButton>
        <span className="toolbar-separator" />
        <IconButton label="Cut (Ctrl+X)" onClick={() => commands.copyImage('cut')}>
          <PintaIcon file="edit-cut-symbolic.svg" size={iconSize} standard />
        </IconButton>
        <IconButton label="Copy (Ctrl+C)" onClick={() => commands.copyImage('copy')}>
          <PintaIcon file="edit-copy-symbolic.svg" size={iconSize} standard />
        </IconButton>
        <IconButton
          label="Paste (Ctrl+V)"
          disabled={!editor.hasClipboard}
          onClick={() => commands.requestPaste('current')}
        >
          <PintaIcon file="edit-paste-symbolic.svg" size={iconSize} standard />
        </IconButton>
        <IconButton label="Crop to Selection" disabled={!editor.hasSelection} onClick={() => editor.cropToSelection()}>
          <PintaIcon file="ui-crop-to-selection-symbolic.svg" size={iconSize} />
        </IconButton>
        <IconButton label="Deselect (Esc)" disabled={!editor.hasSelection} onClick={editor.deselect}>
          <PintaIcon file="ui-deselect-symbolic.svg" size={iconSize} />
        </IconButton>
      </div>

      <div className="window-title">
        <span>
          {translateDocumentName(editor.fileName)}
          {editor.dirty ? '*' : ''}
        </span>
        <span className="window-app-name">Pinta</span>
      </div>

      <div className="header-cluster header-cluster-end" onClick={(event) => event.stopPropagation()}>
        <div className="menu-anchor">
          <IconButton
            label="View"
            active={menuSurface === 'header' && openMenu === 'view'}
            onClick={() => toggleHeaderMenu('view')}
          >
            <PintaIcon file="view-reveal-symbolic.svg" size={iconSize} standard />
          </IconButton>
          {menuSurface === 'header' && openMenu === 'view' && (
            <Popover align="right" className="view-menu-popover">
              {renderMenuContent('view')}
            </Popover>
          )}
        </div>
        <div className="menu-anchor">
          <IconButton
            label="Image"
            disabled={!hasDocument}
            active={menuSurface === 'header' && openMenu === 'image'}
            onClick={() => toggleHeaderMenu('image')}
          >
            <PintaIcon file="image-x-generic-symbolic.svg" size={iconSize} standard />
          </IconButton>
          {menuSurface === 'header' && openMenu === 'image' && (
            <Popover align="right">{renderMenuContent('image')}</Popover>
          )}
        </div>
        <div className="menu-anchor">
          <IconButton
            label="Adjustments"
            disabled={!hasDocument}
            active={menuSurface === 'header' && openMenu === 'adjustments'}
            onClick={() => toggleHeaderMenu('adjustments')}
          >
            <PintaIcon file="adjustments-default-symbolic.svg" size={iconSize} />
          </IconButton>
          {menuSurface === 'header' && openMenu === 'adjustments' && (
            <Popover align="right" className="effect-menu-popover">
              {renderMenuContent('adjustments')}
            </Popover>
          )}
        </div>
        <div className="menu-anchor">
          <IconButton
            label="Effects"
            disabled={!hasDocument}
            active={menuSurface === 'header' && openMenu === 'effects'}
            onClick={() => toggleHeaderMenu('effects')}
          >
            <PintaIcon file="effects-default-symbolic.svg" size={iconSize} />
          </IconButton>
          {menuSurface === 'header' && openMenu === 'effects' && (
            <Popover align="right" className="effect-menu-popover">
              {renderMenuContent('effects')}
            </Popover>
          )}
        </div>
        <div className="menu-anchor">
          <IconButton
            label="Main Menu"
            active={menuSurface === 'header' && openMenu === 'main'}
            onClick={() => toggleHeaderMenu('main')}
          >
            <PintaIcon file="open-menu-symbolic.svg" size={iconSize} standard />
          </IconButton>
          {menuSurface === 'header' && openMenu === 'main' && (
            <Popover align="right" className="main-menu-popover">
              <MenuItem
                icon={<PintaIcon file="document-new-symbolic.svg" size={15} standard />}
                label="New"
                shortcut="Ctrl+N"
                onClick={() => commands.openDialog('new')}
              />
              <MenuItem
                icon={<PintaIcon file="view-fullscreen-symbolic.svg" size={15} standard />}
                label="New Screenshot…"
                onClick={() => commands.closeAnd(commands.openScreenshot)}
              />
              <MenuItem
                icon={<PintaIcon file="document-open-symbolic.svg" size={15} standard />}
                label="Open…"
                shortcut="Ctrl+O"
                onClick={() => commands.closeAnd(commands.openImages)}
              />
              <MenuItem
                icon={<PintaIcon file="document-save-symbolic.svg" size={15} standard />}
                label="Save"
                shortcut="Ctrl+S"
                disabled={!hasDocument}
                onClick={() => commands.closeAnd(commands.saveCurrentImage)}
              />
              <MenuItem
                icon={<PintaIcon file="document-save-as-symbolic.svg" size={15} standard />}
                label="Save As…"
                shortcut="Ctrl+Shift+S"
                disabled={!hasDocument}
                onClick={() => commands.closeAnd(commands.openSaveAs)}
              />
              <MenuItem
                icon={<PintaIcon file="document-print-symbolic.svg" size={15} standard />}
                label="Print…"
                shortcut="Ctrl+P"
                disabled={!hasDocument}
                onClick={commands.openPrintDialog}
              />
              <MenuItem
                icon={<PintaIcon file="window-close-symbolic.svg" size={15} standard />}
                label="Close"
                shortcut="Ctrl+W"
                disabled={!hasDocument}
                onClick={() => commands.requestCloseDocument(editor.activeDocumentId)}
              />
              <MenuItem
                icon={<PintaIcon file="document-save-symbolic.svg" size={15} standard />}
                label="Save All"
                shortcut="Ctrl+Alt+A"
                disabled={!editor.dirty && !editor.documents.some((document) => document.dirty)}
                onClick={() => commands.closeAnd(commands.requestSaveAll)}
              />
              <MenuItem
                icon={<PintaIcon file="window-close-symbolic.svg" size={15} standard />}
                label="Close All"
                shortcut="Ctrl+Shift+W"
                onClick={commands.requestCloseAll}
              />
              <div className="menu-divider" />
              <MenuItem
                icon={<PintaIcon file="edit-undo-symbolic.svg" size={15} standard />}
                label="Undo"
                shortcut="Ctrl+Z"
                disabled={!canUndo}
                onClick={() => commands.closeAnd(editor.undo)}
              />
              <MenuItem
                icon={<PintaIcon file="edit-redo-symbolic.svg" size={15} standard />}
                label="Redo"
                shortcut="Ctrl+Shift+Z"
                disabled={!canRedo}
                onClick={() => commands.closeAnd(editor.redo)}
              />
              <div className="menu-divider" />
              <MenuItem
                icon={<PintaIcon file="edit-cut-symbolic.svg" size={15} standard />}
                label="Cut"
                shortcut="Ctrl+X"
                disabled={!hasDocument}
                onClick={() => commands.closeAnd(() => commands.copyImage('cut'))}
              />
              <MenuItem
                icon={<PintaIcon file="edit-copy-symbolic.svg" size={15} standard />}
                label="Copy"
                shortcut="Ctrl+C"
                disabled={!hasDocument}
                onClick={() => commands.closeAnd(() => commands.copyImage('copy'))}
              />
              <MenuItem
                icon={<PintaIcon file="edit-copy-symbolic.svg" size={15} standard />}
                label="Copy Merged"
                shortcut="Ctrl+Shift+C"
                disabled={!hasDocument}
                onClick={() => commands.closeAnd(() => commands.copyImage('copy-merged'))}
              />
              <MenuItem
                icon={<PintaIcon file="edit-paste-symbolic.svg" size={15} standard />}
                label="Paste"
                shortcut="Ctrl+V"
                onClick={() => commands.closeAnd(() => commands.requestPaste('current'))}
              />
              <MenuItem
                icon={<PintaIcon file="edit-paste-symbolic.svg" size={15} standard />}
                label="Paste Into New Layer"
                shortcut="Ctrl+Shift+V"
                onClick={() => commands.closeAnd(() => commands.requestPaste('new-layer'))}
              />
              <MenuItem
                icon={<PintaIcon file="edit-paste-symbolic.svg" size={15} standard />}
                label="Paste Into New Image"
                shortcut="Shift+V"
                onClick={() => commands.closeAnd(() => commands.requestPaste('new-image'))}
              />
              <div className="menu-divider" />
              <MenuItem
                icon={<PintaIcon file="edit-select-all-symbolic.svg" size={15} standard />}
                label="Select All"
                shortcut="Ctrl+A"
                disabled={!hasDocument}
                onClick={() => commands.closeAnd(editor.selectAll)}
              />
              <MenuItem
                icon={<PintaIcon file="ui-deselect-symbolic.svg" size={15} />}
                label="Deselect All"
                shortcut="Ctrl+Shift+A"
                disabled={!editor.hasSelection}
                onClick={() => commands.closeAnd(editor.deselect)}
              />
              <div className="menu-divider" />
              <MenuItem
                icon={<PintaIcon file="edit-selection-erase-symbolic.svg" size={16} />}
                label="Erase Selection"
                shortcut="Delete"
                disabled={!editor.hasSelection}
                onClick={() => commands.closeAnd(editor.clearActiveLayer)}
              />
              <MenuItem
                icon={<PintaIcon file="edit-selection-fill-symbolic.svg" size={16} />}
                label="Fill Selection"
                shortcut="Backspace"
                disabled={!editor.hasSelection}
                onClick={() => commands.closeAnd(editor.fillSelection)}
              />
              <MenuItem
                icon={<PintaIcon file="edit-selection-invert-symbolic.svg" size={16} />}
                label="Invert Selection"
                shortcut="Ctrl+I"
                disabled={!editor.hasSelection}
                onClick={() => commands.closeAnd(editor.invertSelection)}
              />
              <MenuItem
                icon={<PintaIcon file="edit-selection-offset-symbolic.svg" size={16} />}
                label="Offset Selection…"
                shortcut="Ctrl+Shift+O"
                disabled={!editor.hasSelection}
                onClick={() => commands.closeAnd(commands.openOffsetSelection)}
              />
              <div className="menu-divider" />
              <div className="menu-caption">{translateUi('Palette')}</div>
              <MenuItem
                icon={<PintaIcon file="tool-palette-symbolic.svg" size={15} />}
                label="Add Primary Color"
                disabled={editor.palette.length >= 96}
                onClick={() =>
                  commands.closeAnd(() => {
                    if (editor.addPaletteColor(editor.primary))
                      commands.notify(`Added ${editor.primary} to the palette`);
                  })
                }
              />
              <MenuItem
                icon={<PintaIcon file="document-open-symbolic.svg" size={15} standard />}
                label="Open Palette…"
                onClick={() => commands.closeAnd(commands.openPalette)}
              />
              <MenuItem
                icon={<PintaIcon file="document-save-as-symbolic.svg" size={15} standard />}
                label="Save Palette As…"
                onClick={() => commands.closeAnd(commands.savePalette)}
              />
              <MenuItem
                icon={<PintaIcon file="document-revert-symbolic.svg" size={15} standard />}
                label="Reset Palette to Default"
                onClick={() =>
                  commands.closeAnd(() => {
                    editor.resetPalette();
                    commands.notify('Palette reset to Pinta defaults');
                  })
                }
              />
              <MenuItem label="Set Number of Colors…" onClick={() => commands.closeAnd(commands.resizePalette)} />
              <div className="menu-divider" />
              <div className="menu-caption">{translateUi('Help')}</div>
              <MenuItem
                icon={<PintaIcon file="help-browser-symbolic.svg" size={15} standard />}
                label="Contents"
                shortcut="F1"
                onClick={() => commands.closeAnd(() => window.open(USER_GUIDE_URL, '_blank', 'noopener,noreferrer'))}
              />
              <MenuItem
                icon={<PintaIcon file="preferences-system-symbolic.svg" size={15} standard />}
                label="Keyboard Shortcuts"
                shortcut="Ctrl+,"
                onClick={() => commands.closeAnd(() => commands.openAuxiliary('shortcuts'))}
              />
              <MenuItem
                icon={<PintaIcon file="preferences-system-symbolic.svg" size={15} standard />}
                label="Language…"
                onClick={() => commands.closeAnd(() => commands.openAuxiliary('language'))}
              />
              <MenuItem
                icon={<PintaIcon file="help-website-symbolic.svg" size={15} />}
                label="Pinta Website"
                onClick={() =>
                  commands.closeAnd(() => window.open('https://www.pinta-project.com', '_blank', 'noopener,noreferrer'))
                }
              />
              <MenuItem
                icon={<PintaIcon file="help-bug.png" size={15} />}
                label="File a Bug"
                onClick={() =>
                  commands.closeAnd(() => window.open(WEB_BUG_REPORT_URL, '_blank', 'noopener,noreferrer'))
                }
              />
              <MenuItem
                icon={<PintaIcon file="help-translate.png" size={15} />}
                label="Translate This Application"
                onClick={() =>
                  commands.closeAnd(() =>
                    window.open('https://hosted.weblate.org/engage/pinta/', '_blank', 'noopener,noreferrer'),
                  )
                }
              />
              <div className="menu-divider" />
              <MenuItem
                icon={<PintaIcon file="help-about-symbolic.svg" size={15} standard />}
                label="About"
                onClick={() => commands.closeAnd(() => commands.openAuxiliary('about'))}
              />
            </Popover>
          )}
        </div>
        <span className="toolbar-separator" />
        <IconButton label={showSidebar ? 'Hide sidebar' : 'Show sidebar'} onClick={commands.toggleSidebar}>
          <PintaIcon
            file={showSidebar ? 'view-conceal-symbolic.svg' : 'view-reveal-symbolic.svg'}
            size={iconSize}
            standard
          />
        </IconButton>
        <IconButton label="Fullscreen" onClick={commands.toggleFullscreen}>
          <PintaIcon file="view-fullscreen-symbolic.svg" size={iconSize} standard />
        </IconButton>
      </div>
    </header>
  );
}
