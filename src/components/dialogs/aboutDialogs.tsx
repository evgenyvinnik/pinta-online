import { useMemo, useState } from 'react';
import { aboutPathForLocale, changeLocale, currentLocale, SUPPORTED_LOCALES, translateUi, type LocaleCode } from '../../i18n';
import { ADDIN_DEFINITIONS, type AddinId } from '../../addins/registry';
import { REGISTERED_SHORTCUT_SECTIONS } from '../../editor/shortcuts';
import { TOOLS } from '../../editor/tools';
import { USER_GUIDE_URL, WEB_BUG_REPORT_URL, WEB_REPOSITORY_URL } from '../../projectLinks';
import { PintaIcon } from '../primitives';
import { DialogActions } from '../dialogControls';

const PINTA_DEVELOPERS = [
  '@badcel',
  '@bplaat',
  'Cameron White (@cameronwhite)',
  'Elvis Alistar (@ericksson)',
  'James Carroll (@JGCarroll)',
  'Lehonti Ramos (@Lehonti)',
  '@Matthieu-LAURENT39',
  '@PabloRufianJiminez',
  '@pedropaulosuzuki',
  '@spaghetti22',
  '@stefan-dangl',
  '@UrtsiSantsi',
] as const;

export function KeyboardShortcutsDialog({ onClose }: { onClose: () => void }) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const sections = useMemo(() => [{
    title: 'Tools',
    entries: TOOLS.filter((tool) => tool.shortcut)
      .map((tool) => [tool.name, tool.shortcut!.toUpperCase()] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  }, ...REGISTERED_SHORTCUT_SECTIONS], []);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleSections = sections.flatMap((section) => {
    const entries = normalizedQuery
      ? section.entries.filter(([label, shortcut]) => `${translateUi(label)} ${shortcut}`.toLocaleLowerCase().includes(normalizedQuery))
      : section.entries;
    return entries.length ? [{ ...section, entries }] : [];
  });
  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="pinta-dialog shortcuts-dialog" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
        <header className="dialog-header shortcuts-header">
          <button type="button" className={`about-header-button ${searching ? 'active' : ''}`} aria-label={translateUi('Search shortcuts')} aria-pressed={searching} onClick={() => {
            setSearching((current) => !current);
            if (searching) setQuery('');
          }}><PintaIcon file="system-search-symbolic.svg" size={15} standard /></button>
          <strong id="shortcuts-title">{translateUi('Keyboard Shortcuts')}</strong>
          <button type="button" className="about-header-button" aria-label={translateUi('Close')} onClick={onClose}>×</button>
        </header>
        {searching && <div className="shortcuts-search"><input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={translateUi('Search shortcuts')} aria-label={translateUi('Search shortcuts')} /></div>}
        <div className="shortcuts-layout">
          <nav className="shortcuts-navigation" aria-label={translateUi('Shortcut sections')}>
            {sections.map((section) => <button key={section.title} type="button" onClick={() => document.getElementById(`shortcut-section-${section.title.toLowerCase()}`)?.scrollIntoView({ block: 'start' })}>{translateUi(section.title)}</button>)}
          </nav>
          <div className="dialog-content shortcuts-content">
            {visibleSections.map((section) => (
              <section className="shortcut-section" id={`shortcut-section-${section.title.toLowerCase()}`} key={section.title}>
                <h3>{translateUi(section.title)}</h3>
                <div className="shortcut-list">
                  {section.entries.map(([label, shortcut]) => <div className="shortcut-row" key={label}><span>{translateUi(label)}</span><kbd>{shortcut}</kbd></div>)}
                </div>
              </section>
            ))}
            {!visibleSections.length && <div className="shortcuts-empty"><PintaIcon file="system-search-symbolic.svg" size={34} standard /><strong>{translateUi('No shortcuts found')}</strong></div>}
          </div>
        </div>
      </div>
    </div>
  );
}

export function LanguageDialog({ onClose }: { onClose: () => void }) {
  const [selectedLocale, setSelectedLocale] = useState<LocaleCode>(currentLocale());

  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <form className="pinta-dialog language-dialog" role="dialog" aria-modal="true" aria-labelledby="language-title" onSubmit={(event) => {
        event.preventDefault();
        void changeLocale(selectedLocale).then(onClose);
      }}>
        <header className="dialog-header">
          <button type="button" className="dialog-text-button" onClick={onClose}>{translateUi('Cancel')}</button>
          <strong id="language-title">{translateUi('Choose language')}</strong>
          <button type="submit" className="dialog-text-button suggested">{translateUi('Apply')}</button>
        </header>
        <div className="dialog-content language-content">
          <fieldset>
            <legend>{translateUi('Interface language')}</legend>
            {SUPPORTED_LOCALES.map((locale) => (
              <label key={locale.code} dir={locale.direction}>
                <input
                  type="radio"
                  name="locale"
                  value={locale.code}
                  checked={selectedLocale === locale.code}
                  onChange={() => setSelectedLocale(locale.code)}
                />
                <span lang={locale.code}>{locale.name}</span>
                <small>{locale.code.toUpperCase()} · {locale.direction.toUpperCase()}</small>
              </label>
            ))}
          </fieldset>
          <p className="dialog-hint">{translateUi('Language changes apply immediately.')}</p>
        </div>
      </form>
    </div>
  );
}

export interface AddinManagerDialogProps {
  enabledAddins: readonly AddinId[];
  onToggle: (addin: AddinId, enabled: boolean) => void;
  onSetAll: (enabled: boolean) => void;
  onClose: () => void;
}

export function AddinManagerDialog({ enabledAddins, onToggle, onSetAll, onClose }: AddinManagerDialogProps) {
  const enabledCount = ADDIN_DEFINITIONS.filter((addin) => enabledAddins.includes(addin.id)).length;
  const [tab, setTab] = useState<'gallery' | 'installed' | 'updates'>('gallery');
  const [selectedId, setSelectedId] = useState<AddinId>(ADDIN_DEFINITIONS[0].id);
  const listedAddins = tab === 'updates' ? [] : tab === 'installed'
    ? ADDIN_DEFINITIONS.filter((addin) => enabledAddins.includes(addin.id))
    : ADDIN_DEFINITIONS;
  const selected = ADDIN_DEFINITIONS.find((addin) => addin.id === selectedId) ?? listedAddins[0];
  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="pinta-dialog addin-manager-dialog" role="dialog" aria-modal="true" aria-labelledby="addin-manager-title">
        <header className="addin-manager-header">
          <button type="button" className="icon-button" disabled aria-label="Install Extension Package"><PintaIcon file="document-open-symbolic.svg" size={17} standard /></button>
          <button type="button" className="icon-button" aria-label="Refresh add-ins"><PintaIcon file="view-refresh-symbolic.svg" size={17} standard /></button>
          <strong id="addin-manager-title">{translateUi('Add-in Manager')}</strong>
          <button type="button" className="dialog-text-button" onClick={onClose}>{translateUi('Done')}</button>
        </header>
        <nav className="addin-manager-tabs" aria-label="Add-in sections">
          {([['gallery', 'Gallery'], ['installed', 'Installed'], ['updates', 'Updates']] as const).map(([id, label]) => <button key={id} type="button" className={tab === id ? 'active' : ''} aria-pressed={tab === id} onClick={() => setTab(id)}>{translateUi(label)}{id === 'installed' && <small>{enabledCount}</small>}</button>)}
        </nav>
        <div className="addin-manager-content">
          <div className="addin-manager-list-pane">
            <div className="addin-manager-actions"><button type="button" onClick={() => onSetAll(true)}>{translateUi('Enable all')}</button><button type="button" onClick={() => onSetAll(false)}>{translateUi('Disable all')}</button></div>
            <div className="addin-list" role="listbox" aria-label={translateUi('Add-ins')}>
              {listedAddins.map((addin) => <button key={addin.id} type="button" role="option" aria-selected={selected?.id === addin.id} onClick={() => setSelectedId(addin.id)}><strong>{translateUi(addin.name)}</strong><span>{translateUi(addin.description)}</span></button>)}
              {!listedAddins.length && <div className="addin-empty"><PintaIcon file="system-search-symbolic.svg" size={34} standard /><strong>{translateUi('No Items Found')}</strong></div>}
            </div>
          </div>
          {selected && <article className="addin-detail-pane"><span className="addin-manager-icon"><PintaIcon file="addins-manage.png" size={30} /></span><h2>{translateUi(selected.name)}</h2><span>v{selected.version} · {selected.author}</span><p>{translateUi(selected.description)}</p><div className="addin-capabilities">{selected.capabilities.map((capability) => <span key={capability}>{translateUi(capability)}</span>)}</div><footer><label><span>{enabledAddins.includes(selected.id) ? translateUi('Enabled') : translateUi('Disabled')}</span><span className="addin-switch"><input type="checkbox" checked={enabledAddins.includes(selected.id)} onChange={(event) => onToggle(selected.id, event.target.checked)} /><span aria-hidden="true" /></span></label><a href={selected.sourceUrl} target="_blank" rel="noreferrer">{translateUi('More Information')} ↗</a></footer><small>{translateUi(selected.license)} · {translateUi('Bundled with Pinta Online; no code is downloaded at runtime.')}</small></article>}
        </div>
      </div>
    </div>
  );
}

export type AboutPage = 'overview' | 'details' | 'credits' | 'legal';

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const [page, setPage] = useState<AboutPage>('overview');
  const translatorCredits = translateUi('translator-credits');
  const title = page === 'overview' ? 'About Pinta' : page === 'details' ? 'Details' : page === 'credits' ? 'Credits' : 'Legal';
  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="pinta-dialog about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title">
        <header className="dialog-header about-dialog-header">
          {page === 'overview'
            ? <span />
            : <button type="button" className="about-header-button" data-about-back aria-label={translateUi('Back')} onClick={() => setPage('overview')}>‹</button>}
          <strong id="about-title">{translateUi(title)}</strong>
          <button type="button" className="about-header-button" aria-label={translateUi('Close')} onClick={onClose}>×</button>
        </header>
        {page === 'overview' && (
          <div className="dialog-content about-content">
            <img src="/apps/com.github.PintaProject.Pinta.svg" alt="Pinta" />
            <h2>Pinta</h2>
            <p className="about-version" data-visual-version>Pinta Online {__PINTA_ONLINE_VERSION__} · based on Pinta 3.2</p>
            <p>{translateUi('Easily create and edit images, now in the browser.')}</p>
            <p className="about-port-credit">{translateUi('Ported to the web by')} <a href={WEB_REPOSITORY_URL} target="_blank" rel="noreferrer">Evgeny Vinnik</a>.</p>
            <div className="about-links">
              <button type="button" onClick={() => setPage('details')}><span>{translateUi('Details')}</span><b>›</b></button>
              <a href={USER_GUIDE_URL}><span>{translateUi('Support Questions')}</span><b>›</b></a>
              <a href={WEB_BUG_REPORT_URL} target="_blank" rel="noreferrer"><span>{translateUi('Report an Issue')}</span><b>›</b></a>
              <button type="button" onClick={() => setPage('credits')}><span>{translateUi('Credits')}</span><b>›</b></button>
              <button type="button" onClick={() => setPage('legal')}><span>{translateUi('Legal')}</span><b>›</b></button>
            </div>
            <p className="dialog-hint">Copyright © 2010–2026 {translateUi('by Pinta contributors')}</p>
          </div>
        )}
        {page === 'details' && (
          <article className="dialog-content about-subpage">
            <img src="/apps/com.github.PintaProject.Pinta.svg" alt="" />
            <h2>{translateUi('Easily create and edit images')}</h2>
            <p>{translateUi('Pinta Online brings the familiar Pinta painting and image-editing experience to modern web browsers.')}</p>
            <dl>
              <div><dt>{translateUi('Version')}</dt><dd>Pinta Online {__PINTA_ONLINE_VERSION__}</dd></div>
              <div><dt>{translateUi('Based on')}</dt><dd>Pinta 3.2</dd></div>
              <div><dt>{translateUi('Website')}</dt><dd><a href={aboutPathForLocale(currentLocale())} aria-label={translateUi('Website')}>{translateUi('Pinta Online website')}</a></dd></div>
              <div><dt>{translateUi('Source Code')}</dt><dd><a href={WEB_REPOSITORY_URL} target="_blank" rel="noreferrer" aria-label={translateUi('Source Code')}>github.com/evgenyvinnik/pinta-online</a></dd></div>
            </dl>
            <p>{translateUi('Ported to the web by')} <a href={WEB_REPOSITORY_URL} target="_blank" rel="noreferrer">Evgeny Vinnik</a>.</p>
          </article>
        )}
        {page === 'credits' && (
          <article className="dialog-content about-subpage about-credits">
            <section>
              <h2>{translateUi('Web port')}</h2>
              <p><a href={WEB_REPOSITORY_URL} target="_blank" rel="noreferrer">Evgeny Vinnik</a></p>
            </section>
            <section>
              <h2>{translateUi('Developers')}</h2>
              <ul>{PINTA_DEVELOPERS.map((developer) => <li key={developer}>{developer}</li>)}</ul>
              <a href="https://github.com/PintaProject/Pinta/graphs/contributors" target="_blank" rel="noreferrer">{translateUi('View all Pinta contributors')} ↗</a>
            </section>
            {translatorCredits !== 'translator-credits' && (
              <section>
                <h2>{translateUi('Translators')}</h2>
                <pre>{translatorCredits}</pre>
              </section>
            )}
          </article>
        )}
        {page === 'legal' && (
          <article className="dialog-content about-subpage about-legal">
            <h2>{translateUi('Copyright')}</h2>
            <p>Copyright © 2010–2026 {translateUi('by Pinta contributors')}</p>
            <h2>{translateUi('License')}</h2>
            <p>{translateUi('Released under the MIT X11 License.')}</p>
            <p><a href={`${WEB_REPOSITORY_URL}/blob/master/LICENSE`} target="_blank" rel="noreferrer">{translateUi('Read the complete license')} ↗</a></p>
            <h2>{translateUi('Based on the work of Paint.NET:')}</h2>
            <p><a href="https://www.getpaint.net/" target="_blank" rel="noreferrer">getpaint.net ↗</a></p>
            <h2>{translateUi('Using some icons from:')}</h2>
            <ul>
              <li>Silk — famfamfam.com</li>
              <li>Fugue — pinvoke.com</li>
              <li>Google Material Icons</li>
              <li>Microsoft Fluent UI System Icons</li>
              <li>{translateUi('Pinta contributors')}</li>
            </ul>
          </article>
        )}
      </div>
    </div>
  );
}

export function FontFamilyDialog({ families, current, onCancel, onSubmit }: {
  families: string[];
  current: string;
  onCancel: () => void;
  onSubmit: (family: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(current);
  const visibleFamilies = families.filter((family) => family.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return (
    <div className="dialog-backdrop native-dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <form className="pinta-dialog font-family-dialog" role="dialog" aria-modal="true" aria-labelledby="font-family-dialog-title" onSubmit={(event) => {
        event.preventDefault();
        onSubmit(selected);
      }}>
        <h2 className="visually-hidden" id="font-family-dialog-title">Choose Font Family</h2>
        <div className="font-family-dialog-content">
          <input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search fonts" placeholder="Search fonts" />
          <div className="font-family-list" role="listbox" aria-label="Font families">
            {visibleFamilies.map((family) => (
              <button
                key={family}
                type="button"
                role="option"
                aria-selected={family === selected}
                className={family === selected ? 'selected' : ''}
                style={{ fontFamily: `"${family}"` }}
                onClick={() => setSelected(family)}
                onDoubleClick={() => onSubmit(family)}
              >{family}</button>
            ))}
            {!visibleFamilies.length && <p>No matching fonts</p>}
          </div>
          <div className="font-family-preview" style={{ fontFamily: `"${selected}"` }}>The quick brown fox jumps over the lazy dog.</div>
        </div>
        <DialogActions onCancel={onCancel} submitLabel="Select" />
      </form>
    </div>
  );
}
