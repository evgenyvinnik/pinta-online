import type { ReactNode } from 'react';
import { translateDocumentName, translateUi } from '../i18n';
import { TopLevelMenu, type MenuName } from './menus';

export function MenuBar({
  openMenu,
  menuSurface,
  fileName,
  dirty,
  renderMenuContent,
  onSetOpenMenu,
  onSetMenuSurface,
}: {
  openMenu: MenuName;
  menuSurface: 'top' | 'header' | null;
  fileName: string;
  dirty: boolean;
  renderMenuContent: (menu: Exclude<MenuName, null | 'main'>) => ReactNode;
  onSetOpenMenu: (menu: MenuName) => void;
  onSetMenuSurface: (surface: 'top' | 'header' | null) => void;
}) {
  const toggleTopLevelMenu = (name: Exclude<MenuName, null | 'main'>) => {
    if (menuSurface === 'top' && openMenu === name) {
      onSetOpenMenu(null);
      onSetMenuSurface(null);
      return;
    }
    onSetMenuSurface('top');
    onSetOpenMenu(name);
  };
  const enterTopLevelMenu = (name: Exclude<MenuName, null | 'main'>) => {
    if (menuSurface === 'top' && openMenu) onSetOpenMenu(name);
  };

  return (
    <nav
      className="macos-menu-bar"
      aria-label={translateUi('Application menu')}
      role="menubar"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onSetOpenMenu(null);
          return;
        }
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.macos-menu-button')];
        const current = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement));
        const offset = event.key === 'ArrowRight' ? 1 : -1;
        const next = buttons[(current + offset + buttons.length) % buttons.length];
        next.focus();
        onSetMenuSurface('top');
        onSetOpenMenu(next.dataset.menuName as Exclude<MenuName, null | 'main'>);
      }}
    >
      <TopLevelMenu
        name="pinta"
        label="Pinta"
        appMenu
        active={menuSurface === 'top' && openMenu === 'pinta'}
        onToggle={toggleTopLevelMenu}
        onEnter={enterTopLevelMenu}
      >
        {renderMenuContent('pinta')}
      </TopLevelMenu>
      <TopLevelMenu
        name="file"
        label="File"
        active={menuSurface === 'top' && openMenu === 'file'}
        onToggle={toggleTopLevelMenu}
        onEnter={enterTopLevelMenu}
      >
        {renderMenuContent('file')}
      </TopLevelMenu>
      <TopLevelMenu
        name="edit"
        label="Edit"
        active={menuSurface === 'top' && openMenu === 'edit'}
        onToggle={toggleTopLevelMenu}
        onEnter={enterTopLevelMenu}
      >
        {renderMenuContent('edit')}
      </TopLevelMenu>
      <TopLevelMenu
        name="view"
        label="View"
        active={menuSurface === 'top' && openMenu === 'view'}
        onToggle={toggleTopLevelMenu}
        onEnter={enterTopLevelMenu}
      >
        {renderMenuContent('view')}
      </TopLevelMenu>
      <TopLevelMenu
        name="image"
        label="Image"
        active={menuSurface === 'top' && openMenu === 'image'}
        onToggle={toggleTopLevelMenu}
        onEnter={enterTopLevelMenu}
      >
        {renderMenuContent('image')}
      </TopLevelMenu>
      <TopLevelMenu
        name="adjustments"
        label="Adjustments"
        active={menuSurface === 'top' && openMenu === 'adjustments'}
        onToggle={toggleTopLevelMenu}
        onEnter={enterTopLevelMenu}
      >
        {renderMenuContent('adjustments')}
      </TopLevelMenu>
      <TopLevelMenu
        name="effects"
        label="Effects"
        active={menuSurface === 'top' && openMenu === 'effects'}
        onToggle={toggleTopLevelMenu}
        onEnter={enterTopLevelMenu}
      >
        {renderMenuContent('effects')}
      </TopLevelMenu>
      <TopLevelMenu
        name="addins"
        label="Add-ins"
        active={menuSurface === 'top' && openMenu === 'addins'}
        onToggle={toggleTopLevelMenu}
        onEnter={enterTopLevelMenu}
      >
        {renderMenuContent('addins')}
      </TopLevelMenu>
      <TopLevelMenu
        name="window"
        label="Window"
        active={menuSurface === 'top' && openMenu === 'window'}
        onToggle={toggleTopLevelMenu}
        onEnter={enterTopLevelMenu}
      >
        {renderMenuContent('window')}
      </TopLevelMenu>
      <TopLevelMenu
        name="help"
        label="Help"
        active={menuSurface === 'top' && openMenu === 'help'}
        onToggle={toggleTopLevelMenu}
        onEnter={enterTopLevelMenu}
      >
        {renderMenuContent('help')}
      </TopLevelMenu>
      <span className="macos-menu-document" title={translateDocumentName(fileName)}>
        {translateDocumentName(fileName)}
        {dirty ? '*' : ''}
      </span>
    </nav>
  );
}
