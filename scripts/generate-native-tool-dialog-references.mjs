import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'tests/visual/native-dialog-references/tools');

const esc = (value) =>
  String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

function popup(title, selected, items, note = '') {
  return `<section class="reference-card popup-card">
    <div class="reference-title"><strong>${esc(title)}</strong>${note ? `<small>${esc(note)}</small>` : ''}</div>
    <button class="closed-control"><span class="icon">◈</span>${esc(selected)}<span class="chevron">⌄</span></button>
    <div class="popup">
      ${items.map((item) => `<div class="popup-row"><span class="icon">${item.icon ?? '◈'}</span><span>${esc(item.label ?? item)}</span><b>${(item.label ?? item) === selected ? '✓' : ''}</b></div>`).join('')}
    </div>
  </section>`;
}

function spin(label, value, range) {
  return `<div class="inline-field"><span>${esc(label)}</span><span class="spin">${esc(value)} <i>−</i><i>+</i></span><small>${esc(range)}</small></div>`;
}

function pointSpin(label, value, range) {
  return `<div class="point-field"><span>${esc(label)}</span><span class="spin compact">${esc(value)}</span><button class="reset" title="Reset">↶</button><small>${esc(range)}</small></div>`;
}

function slider(label, value, range) {
  return `<div class="slider-block"><strong>${esc(label)}</strong><div><span class="track"><i style="left:${Math.max(4, Math.min(96, Number(value) || 50))}%"></i></span><span class="spin compact">${esc(value)}</span><button class="reset">↶</button></div><small>${esc(range)}</small></div>`;
}

function seed(label, value, range) {
  return `<div class="slider-block seed-block"><strong>${esc(label)}</strong><div><button class="reseed">Reseed</button><span class="spin compact">${esc(value)}</span></div><small>${esc(range)}</small></div>`;
}

function checkbox(label, checked = false) {
  return `<label class="check"><span>${checked ? '☑' : '☐'}</span>${esc(label)}</label>`;
}

function toolbar(title, contents, note = '') {
  return `<section class="reference-card toolbar-card">
    <div class="reference-title"><strong>${esc(title)}</strong>${note ? `<small>${esc(note)}</small>` : ''}</div>
    <div class="toolbar"><b>Tool:</b><span class="tool-icon">◈</span><span class="separator"></span>${contents}</div>
  </section>`;
}

function effectDialog(title, controls, note = '', action = 'OK', destructive = false) {
  return `<section class="effect-window">
    <header><strong>${esc(title)}</strong></header>
    <main>${controls}</main>
    ${note ? `<p class="source-note">${esc(note)}</p>` : ''}
    <footer><button>Cancel</button><button class="${destructive ? 'danger' : 'suggested'}">${esc(action)}</button></footer>
  </section>`;
}

const style = `
  * { box-sizing: border-box; }
  body { margin: 0; padding: 28px; color: #292a2f; background: #e9eaed; font: 14px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .page-head { display:flex; align-items:end; justify-content:space-between; gap:24px; margin:0 0 20px; }
  h1 { margin:0; font-size:25px; font-weight:650; }
  .watermark { padding:6px 10px; color:#704d00; background:#fff4cd; border:1px solid #d9b955; border-radius:8px; font-size:11px; font-weight:700; letter-spacing:.06em; }
  .subtitle { margin:5px 0 0; color:#62646b; }
  .grid { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:18px; align-items:start; }
  .grid.two { grid-template-columns:repeat(2, minmax(0, 1fr)); }
  .grid.one { grid-template-columns:1fr; }
  .reference-card, .effect-window { background:#fff; border:1px solid #c8c9cd; border-radius:14px; box-shadow:0 3px 12px #00000018; overflow:hidden; }
  .reference-title { display:flex; align-items:baseline; justify-content:space-between; gap:12px; padding:12px 14px; border-bottom:1px solid #dedfe2; }
  .reference-title strong { font-size:15px; }
  .reference-title small, small { color:#6c6d73; }
  button { min-height:34px; padding:0 12px; color:#26272c; background:#f2f2f4; border:1px solid #c8c9cd; border-radius:8px; font:inherit; }
  .closed-control { width:calc(100% - 28px); margin:14px; display:grid; grid-template-columns:auto 1fr auto; align-items:center; gap:8px; text-align:left; }
  .closed-control .chevron { font-size:18px; }
  .popup { margin:0 14px 14px; padding:6px; background:#fff; border:1px solid #c6c7cb; border-radius:10px; box-shadow:0 5px 18px #0002; }
  .popup-row { min-height:36px; display:grid; grid-template-columns:25px 1fr 22px; align-items:center; gap:7px; padding:4px 8px; border-radius:7px; }
  .popup-row:hover, .popup-row:first-child { background:#e8effb; }
  .popup-row b { color:#1568c5; text-align:right; }
  .icon { width:20px; text-align:center; color:#4c4e55; }
  .toolbar-card { grid-column:1/-1; }
  .toolbar { min-height:48px; padding:7px 12px; display:flex; align-items:center; gap:9px; white-space:nowrap; overflow:hidden; background:#fafafa; }
  .tool-icon { font-size:18px; }
  .separator { width:1px; height:26px; margin:0 4px; background:#d2d3d6; }
  .pill { min-height:34px; display:inline-flex; align-items:center; gap:8px; padding:0 10px; background:#ececef; border:1px solid #d2d3d6; border-radius:8px; }
  .inline-field { display:inline-flex; align-items:center; gap:7px; }
  .inline-field small { margin-left:-3px; font-size:10px; }
  .spin { min-width:105px; height:34px; display:inline-grid; grid-template-columns:1fr 27px 27px; align-items:center; padding-left:10px; background:#f3f3f4; border:1px solid #c8c9cd; border-radius:8px; }
  .spin i { height:32px; display:grid; place-items:center; border-left:1px solid #d1d2d5; font-style:normal; }
  .spin.compact { min-width:65px; grid-template-columns:1fr; padding:0 8px; text-align:center; }
  .check { display:flex; align-items:center; gap:5px; }
  .check span { color:#1671cf; font-size:17px; }
  .shape-stack { padding:14px; display:grid; gap:12px; }
  .shape-stack .row { display:flex; flex-wrap:wrap; align-items:center; gap:9px; }
  .slider-block { padding:12px 14px; display:grid; gap:7px; border-bottom:1px solid #e3e3e5; }
  .slider-block:last-child { border-bottom:0; }
  .slider-block > div { display:grid; grid-template-columns:1fr 70px 34px; gap:8px; align-items:center; }
  .seed-block > div { grid-template-columns:1fr 110px; }
  .reseed { justify-self:start; }
  .track { position:relative; height:5px; background:#d5d6d9; border-radius:99px; }
  .track:before { content:""; position:absolute; left:0; top:0; bottom:0; width:50%; background:#2b78d0; border-radius:inherit; }
  .track i { position:absolute; top:50%; width:17px; height:17px; margin:-8px 0 0 -8px; background:white; border:1px solid #868890; border-radius:50%; box-shadow:0 1px 3px #0003; }
  .reset { min-width:34px; padding:0; }
  .effect-window header { min-height:48px; display:grid; place-items:center; background:#f8f8f9; border-bottom:1px solid #d7d8dc; font-size:16px; }
  .effect-window main { padding:8px 14px 2px; }
  .effect-window footer { padding:10px 12px; display:flex; justify-content:flex-end; gap:8px; border-top:1px solid #dedfe2; }
  .suggested { color:white; background:#2677cd; border-color:#2677cd; }
  .effect-window .danger { color:white; background:#c01c28; border-color:#c01c28; }
  .source-note { margin:0; padding:7px 14px 10px; color:#686a70; font-size:11px; }
  .combo-block, .point-block, .color-block { padding:12px 14px; display:grid; gap:7px; border-bottom:1px solid #e3e3e5; }
  .combo-block select { height:34px; padding:0 10px; background:#f3f3f4; border:1px solid #c8c9cd; border-radius:8px; }
  .point-grid { display:grid; grid-template-columns:125px 1fr; gap:10px; align-items:center; }
  .point-pad { height:92px; position:relative; background:linear-gradient(90deg,transparent 49.5%,#bfc2c7 50%,transparent 50.5%),linear-gradient(transparent 49.5%,#bfc2c7 50%,transparent 50.5%),#eef0f2; border:1px solid #c8c9cd; border-radius:6px; }
  .point-pad:after { content:"●"; position:absolute; left:50%; top:50%; color:#2375cb; transform:translate(-50%,-50%); }
  .point-fields { display:grid; gap:7px; }
  .point-field { display:grid; grid-template-columns:18px 66px 34px 1fr; gap:7px; align-items:center; }
  .color-swatch { width:80px; height:34px; background:#111; border:1px solid #909299; border-radius:8px; }
  .manager { min-height:440px; display:grid; grid-template-rows:52px 1fr; background:white; border:1px solid #c8c9cd; border-radius:14px; overflow:hidden; box-shadow:0 3px 12px #0002; }
  .manager-head { display:grid; grid-template-columns:auto auto 1fr; align-items:center; gap:8px; padding:0 12px; background:#f8f8f9; border-bottom:1px solid #d7d8dc; }
  .manager-head .tabs { justify-self:center; display:flex; gap:4px; }
  .manager-head .tabs b { padding:8px 11px; border-radius:8px; }
  .manager-head .tabs b:first-child { background:#e2e3e6; }
  .manager-body { display:grid; grid-template-columns:300px 1px minmax(300px,1fr); min-height:390px; }
  .manager-list { padding:6px; }
  .manager-list article { padding:11px; border-radius:8px; }
  .manager-list article:first-child { background:#dcecff; }
  .manager-list strong, .manager-list small { display:block; }
  .manager-info { padding:18px; display:flex; flex-direction:column; gap:9px; }
  .manager-info h2, .manager-info p { margin:0; }
  .manager-actions { margin-top:auto; display:flex; align-items:center; gap:8px; }
  .manager-actions .danger { margin-left:auto; color:#a51d2d; }
  .split { background:#d7d8db; }
  .no-popup-table { width:100%; border-collapse:collapse; }
  .no-popup-table th,.no-popup-table td { padding:10px 12px; border-bottom:1px solid #e1e2e4; text-align:left; }
  .no-popup-table th { background:#f3f3f4; }
  .overflow-demo { padding:14px; }
  .overflow-shell { height:48px; display:flex; align-items:center; gap:8px; overflow:hidden; background:#fafafa; border:1px solid #c8c9cd; border-radius:9px; }
  .overflow-content { width:1320px; flex:0 0 1320px; padding:7px 10px; display:flex; gap:8px; align-items:center; }
  .overflow-scroll { height:8px; margin:5px 2px 0; background:#dedfe2; border-radius:5px; }
  .overflow-scroll i { width:38%; height:100%; display:block; background:#a7a9af; border-radius:inherit; }
`;

function page(title, subtitle, body) {
  return `<!doctype html><meta charset="utf-8"><style>${style}</style><body>
    <div class="page-head"><div><h1>${esc(title)}</h1><p class="subtitle">${esc(subtitle)}</p></div><span class="watermark">SOURCE RECONSTRUCTION — NOT A LIVE CAPTURE</span></div>
    ${body}
  </body>`;
}

const refs = [
  {
    name: 'reconstructed-tool-dropdowns-selection-flood.png',
    title: 'Pinta tool flyouts — selection, lasso, flood and eraser',
    subtitle:
      'Rows are icon + label + trailing selected checkmark. The closed control shows only the icon unless noted.',
    html: `<div class="grid">
      ${popup('Selection Mode · Gtk.ComboBoxText · 170 px', 'Replace', ['Replace', 'Union (+) (Command + Left Click)', 'Exclude (-) (Right Click)', 'Xor (Command + Right Click)', 'Intersect (Option + Left Click)'], 'Rectangle, Ellipse, Lasso, Magic Wand')}
      ${popup('Autoscroll · Gtk.DropDown', 'Autoscroll On', ['Autoscroll On', 'Autoscroll Off'], 'Rectangle and Ellipse selection')}
      ${popup('Lasso Mode · Gtk.DropDown', 'Freeform', ['Freeform', 'Polygon'], 'Lasso only')}
      ${popup('Flood Mode · Gtk.DropDown', 'Contiguous', ['Contiguous', 'Global'], 'Paint Bucket and Magic Wand')}
      ${popup('Eraser Type · Gtk.ComboBoxText · 100 px', 'Normal', ['Normal', 'Smooth'])}
      ${popup('Antialiasing · Gtk.DropDown', 'Antialiasing On', ['Antialiasing On', 'Antialiasing Off'], 'Shared by brush/shape/text tools')}
    </div>`,
  },
  {
    name: 'reconstructed-tool-dropdowns-brush-gradient-picker.png',
    title: 'Pinta tool flyouts — paintbrush, gradient and color picker',
    subtitle: 'Paintbrush type is a 100 px combo; picker controls deliberately show text in the closed state.',
    html: `<div class="grid">
      ${popup('Paintbrush Type · Gtk.ComboBoxText · 100 px', 'Normal', ['Normal', 'Circles', 'Grid', 'Slash', 'Splatter', 'Squares'], 'Block appears alphabetically when add-in is installed')}
      ${popup('Gradient · Gtk.DropDown', 'Linear Gradient', ['Linear Gradient', 'Linear Reflected Gradient', 'Linear Diamond Gradient', 'Radial Gradient', 'Conical Gradient'])}
      ${popup('Gradient Mode · Gtk.DropDown', 'Color Mode', ['Color Mode', 'Transparency Mode'])}
      ${popup('Sampling Size · Gtk.DropDown + label', 'Single Pixel', ['Single Pixel', '3 x 3 Region', '5 x 5 Region', '7 x 7 Region', '9 x 9 Region'])}
      ${popup('Sampling Source · Gtk.DropDown + label', 'Layer', ['Layer', 'Image'])}
      ${popup('After select · Gtk.DropDown + label', 'Do not switch tool', ['Do not switch tool', 'Switch to previous tool', 'Switch to Pencil tool'])}
      ${popup('Alpha Blending · Gtk.DropDown', 'Normal Blending', ['Normal Blending', 'Overwrite'], 'Pencil and Gradient')}
    </div>`,
  },
  {
    name: 'reconstructed-shape-flyouts.png',
    width: 2200,
    title: 'Pinta editable-shape controls and conditional arrow options',
    subtitle:
      'Exact toolbar order is significant. Rounded Rectangle places Radius before Fill Style. Arrow numeric controls are inserted only when Arrow 1 or 2 is enabled.',
    html: `<div class="grid one">
      ${toolbar('Rectangle / Ellipse — outline state', `<span>Shape Type:</span><span class="pill">◈ Closed Line/Curve Series ⌄</span><span class="separator"></span><span>Fill Style:</span><span class="pill">◈ Outline Shape ⌄</span><span class="separator"></span>${spin('Outline width:', 2, '1…100000')}<span class="separator"></span><span>Dash:</span><span class="pill">− ⌄</span><span class="separator"></span><span class="pill">◈ Antialiasing On ⌄</span>`)}
      ${toolbar('Rounded Rectangle — exact order', `<span>Shape Type:</span><span class="pill">◈ Rounded Line Series ⌄</span><span class="separator"></span>${spin('Radius:', 20, '0…100000')}<span class="separator"></span><span>Fill Style:</span><span class="pill">◈ Outline Shape ⌄</span><span class="separator"></span>${spin('Outline width:', 2, '1…100000')}<span class="separator"></span><span>Dash:</span><span class="pill">− ⌄</span><span class="separator"></span><span class="pill">◈ Antialiasing On ⌄</span>`)}
      ${toolbar('Line / Curve — arrows disabled', `<span>Shape Type:</span><span class="pill">◈ Open Line/Curve Series ⌄</span><span class="separator"></span><span>Fill Style:</span><span class="pill">◈ Outline Shape ⌄</span><span class="separator"></span>${spin('Outline width:', 2, '1…100000')}<span class="separator"></span><span>Dash:</span><span class="pill">− ⌄</span><span class="separator"></span><span>Arrow:</span>${checkbox('1')}${checkbox('2')}<span class="separator"></span><span class="pill">◈ Antialiasing On ⌄</span>`)}
      ${toolbar('Line / Curve — Arrow 1 enabled', `<span>Shape Type:</span><span class="pill">◈ Open Line/Curve Series ⌄</span><span class="separator"></span><span>Fill Style:</span><span class="pill">◈ Outline Shape ⌄</span><span class="separator"></span>${spin('Outline width:', 2, '1…100000')}<span class="separator"></span><span>Dash:</span><span class="pill">− ⌄</span><span class="separator"></span><span>Arrow:</span>${checkbox('1', true)}${checkbox('2')}${spin('Size:', 10, '1…100')}${spin('Angle:', 15, '−89…89')}${spin('Length:', 10, '−100…100')}<span class="separator"></span><span class="pill">◈ Antialiasing On ⌄</span>`)}
      <section class="reference-card"><div class="reference-title"><strong>Shape Type flyout</strong><small>Gtk.DropDown</small></div><div class="shape-stack"><div class="row"><span class="pill">◈ Open Line/Curve Series</span><span class="pill">◈ Closed Line/Curve Series</span><span class="pill">◈ Ellipse</span><span class="pill">◈ Rounded Line Series</span></div><div class="row"><b>Fill Style:</b><span class="pill">◈ Outline Shape</span><span class="pill">◈ Fill Shape</span><span class="pill">◈ Fill and Outline Shape</span></div><div class="row"><b>Dash editable presets:</b><code>-</code><code> -</code><code> --</code><code> ---</code><code>  -</code><code>   -</code><code> - --</code><code> - - --------</code><code> - - ---- - ----</code></div></div></section>
    </div>`,
  },
  {
    name: 'reconstructed-text-choosers.png',
    width: 2200,
    title: 'Pinta Text tool — family chooser and dropdown flyouts',
    subtitle:
      'The live native Font chooser is Gtk.FontDialogButton (Family level, modal). The tool toolbar is horizontally scrollable.',
    html: `<div class="grid two">
      ${popup('Font Variant', 'Normal', ['Normal', 'Small Caps', 'All Small Caps', 'Petite Caps', 'All Petite Caps', 'Unicase', 'Title Caps'])}
      ${popup('Font Weight', 'Normal 400', ['Thin 100', 'Ultralight 200', 'Light 300', 'Semilight 350', 'Book 380', 'Normal 400', 'Medium 500', 'Semibold 600', 'Bold 700', 'Ultrabold 800', 'Heavy 900', 'Ultraheavy 1000'])}
      ${popup('Text Style', 'Normal', ['Normal', 'Normal and Outline', 'Outline', 'Fill Background'])}
      ${popup('Line Join', 'Miter Join', ['Miter Join', 'Round Join', 'Bevel Join'], 'Visible only for Normal + Outline or Outline')}
      <section class="reference-card"><div class="reference-title"><strong>Gtk.FontDialogButton popup</strong><small>Modal · Gtk.FontLevel.Family · UseSize=false</small></div><div class="shape-stack"><div class="row"><span class="pill" style="width:100%;justify-content:space-between">Adwaita Sans <b>⌄</b></span></div><div style="border:1px solid #c8c9cd;border-radius:9px;overflow:hidden"><div style="padding:10px;background:#f4f4f5"><input style="width:100%;height:34px;border:1px solid #c8c9cd;border-radius:8px;padding:0 10px" placeholder="Search fonts"></div>${['Adwaita Sans', 'Arial', 'Courier New', 'Georgia', 'Times New Roman', 'Verdana'].map((f, i) => `<div style="padding:9px 12px;${i === 0 ? 'background:#dcecff;' : ''}">${f}${i === 0 ? '<b style="float:right">✓</b>' : ''}</div>`).join('')}</div></div></section>
      ${toolbar('Text toolbar order', `<span>Font:</span><span class="pill">Adwaita Sans ⌄</span><span class="separator"></span><span class="pill">◈ Variant ⌄</span><span class="separator"></span>${spin('', 16, '1…2000')}<span class="separator"></span><span class="pill">◈ Weight ⌄</span><button><i>I</i></button><button><u>U</u></button><span class="separator"></span><button>≡</button><button>≡</button><button>≡</button><span class="separator"></span><span>Text Style:</span><span class="pill">◈ Normal ⌄</span><span class="separator"></span>${spin('Outline width:', 2, '1…100000')}<span class="separator"></span><span class="pill">◈ Join ⌄</span><span class="separator"></span><span class="pill">◈ Antialiasing On ⌄</span>`)}
    </div>`,
  },
  {
    name: 'reconstructed-addin-manager.png',
    title: 'Pinta Add-in Manager — native information architecture',
    subtitle: 'Adw.Window with a strict-centered ViewSwitcherTitle and non-folding split list/detail view.',
    html: `<div class="manager"><div class="manager-head"><button title="Install from file">↥</button><button title="Refresh">↻</button><div class="tabs"><b>▣ Gallery</b><b>▤ Installed</b><b>↻ Updates</b></div></div><div class="manager-body"><div class="manager-list"><article><strong>Block Brush</strong><small>A rectangular block-shaped brush.</small></article><article><strong>Night Vision Effect</strong><small>Recolors the image for night vision.</small></article><article><strong>More Pixelates</strong><small>Configurable hexagonal pixelation.</small></article></div><div class="split"></div><div class="manager-info"><h2>Block Brush</h2><b>Version: 0.2.4</b><b>Download size: 0.01 MB</b><b>Available in repository: Pinta Community Addins</b><p>A rectangular block-shaped brush.</p><div class="manager-actions"><label class="check"><span>☑</span> Enabled</label><button>Install…</button><button>Update…</button><button>More Information…</button><button class="danger">Uninstall…</button></div></div></div></div>`,
  },
  {
    name: 'reconstructed-addin-install-dialogs.png',
    title: 'Pinta add-in installation, removal and error dialogs',
    subtitle:
      'These are child dialogs of the native Add-in Manager. Web add-ins are bundled, so the web manager intentionally has no file/network installation workflow.',
    html: `<div class="grid two">
      ${effectDialog('Install', `<div class="slider-block"><strong>The following packages will be installed:</strong><p>Block Brush</p></div><div class="slider-block"><strong>The following packages need to be uninstalled:</strong><p class="source-note">Shown only when required; warning style</p></div><div class="slider-block"><strong>The following dependencies could not be resolved:</strong><p class="source-note">Shown only on conflict; error style</p></div>`, 'Adw.Window · requested 500 × 250 · scrolled label area · Cancel then Install buttons', 'Install')}
      ${effectDialog('Uninstall', `<div class="slider-block"><strong>The following packages will be uninstalled:</strong><p>Block Brush</p></div><div class="slider-block"><strong>Dependent packages</strong><p class="source-note">Visible only when other extensions depend on the selected package.</p></div>`, 'Same 500 × 250 window; Uninstall button receives destructive-action styling.', 'Uninstall', true)}
      <section class="reference-card"><div class="reference-title"><strong>Install Extension Package</strong><small>Gtk.FileDialog · modal · multiple selection</small></div><div class="shape-stack"><div class="row"><span class="pill" style="width:100%;justify-content:space-between">Extension packages (*.mpack) <b>⌄</b></span></div><div style="height:170px;padding:14px;background:#f5f5f6;border:1px solid #d1d2d5;border-radius:9px">Native filesystem chooser<br><small>Filters in order: Extension packages; All files</small></div><div class="row" style="justify-content:flex-end"><button>Cancel</button><button class="suggested">Open</button></div></div></section>
      <section class="reference-card"><div class="reference-title"><strong>Failed to load extension package</strong><small>Adw.MessageDialog</small></div><div class="shape-stack"><h3 style="margin:0">Failed to load extension package</h3><p style="margin:0">The file may be an invalid or corrupt extension package</p><div class="row" style="justify-content:flex-end"><button class="suggested">OK</button></div></div></section>
    </div>`,
  },
  {
    name: 'reconstructed-addin-effect-dialogs-1.png',
    title: 'Add-in effect dialogs — Ars Kali Glitches',
    subtitle:
      'All configurable Ars Kali effects use Pinta SimpleEffectDialog: modal, fixed 400 px request, non-resizable, 12 px vertical spacing, 6 px margins, Cancel/OK.',
    html: `<div class="grid two">
      ${effectDialog('Chromatic Aberration', `<div class="point-block"><strong>Red shift</strong><div class="point-grid"><div class="point-pad"></div><div class="point-fields">${pointSpin('X:', 0, '0…image width')}${pointSpin('Y:', 0, '0…image height')}</div></div></div><div class="point-block"><strong>Green shift</strong><div class="point-grid"><div class="point-pad"></div><div class="point-fields">${pointSpin('X:', 0, '0…image width')}${pointSpin('Y:', 0, '0…image height')}</div></div></div><div class="point-block"><strong>Blue shift</strong><div class="point-grid"><div class="point-pad"></div><div class="point-fields">${pointSpin('X:', 0, '0…image width')}${pointSpin('Y:', 0, '0…image height')}</div></div></div>${checkbox('Tile result')}`, 'PointI defaults to (0,0); the PointPicker is a graphic plus X/Y spinners and individual reset buttons.')}
      ${effectDialog('Scanlines', `${checkbox('Scanlines', true)}${checkbox('Red interlace lines', true)}${checkbox('Green interlace lines', true)}${checkbox('Blue interlace lines', true)}`)}
      ${effectDialog('Colored Artifacts', `${slider('Number of artifacts', 128, '1…2048 · step 1')}${slider('Minimum artifact alpha', 64, '0…255 · step 1')}${slider('Maximum artifact alpha', 255, '0…255 · step 1')}${slider('Maximum artifact height (% of image height)', 50, '0…1 · step .01 · 2 digits')}${slider('Minimum artifact height (% of image height)', 20, '0…1 · step .01 · 2 digits')}${slider('Maximum artifact width (% of image width)', 50, '0…1 · step .01 · 2 digits')}${slider('Minimum artifact width (% of image width)', 20, '0…1 · step .01 · 2 digits')}${seed('Seed', 0, '0…2147483646')}`)}
      ${effectDialog('Pixel Drag', `<div class="combo-block"><strong>Drag direction</strong><select><option>X</option><option>Y</option></select></div>${slider('Min length to drag pixels (% of axis length)', 1, '0…1 · step .001 · 3 digits')}${slider('Max length to drag pixels (% of axis length)', 1, '0…1 · step .001 · 3 digits')}${slider('# of pixels to drag', 512, '0…4096 · step 1')}${seed('Seed', 0, '0…2147483646')}`)}
      ${effectDialog('Row Slice', `${slider('Number of slices', 32, '1…128 · step 1')}${slider('Leftmost shift (% of half image width)', 50, '0…1 · step .01 · 2 digits')}${slider('Rightmost shift (% of half image width)', 50, '0…1 · step .01 · 2 digits')}${seed('Seed', 0, '0…2147483646')}`)}
      ${effectDialog('Adjustment Noise', `${seed('Seed', 0, '0…2147483646')}`, 'Upstream exposes RandomSeed only. The web-only Intensity control is not native parity.')}
    </div>`,
  },
  {
    name: 'reconstructed-addin-effect-dialogs-2.png',
    title: 'Add-in effect dialogs — More Pixelates and Night Vision',
    subtitle:
      'Colored Grayscale and Block Brush have no configuration dialog; their no-popup status is explicitly recorded in the audit.',
    html: `<div class="grid two">
      ${effectDialog('Hexagon Pixelate', `${slider('Radius', 20, '5…200 · step 1')}<div class="combo-block"><strong>Sample mode</strong><select><option>Average</option><option>Center</option></select></div><div class="point-block"><strong>Offset</strong><div class="point-grid"><div class="point-pad"></div><div class="point-fields">${pointSpin('X:', 0, 'derived from image width')}${pointSpin('Y:', 0, 'derived from image height')}</div></div></div>${slider('Border Width', 0, '0…50 · step 1')}<div class="color-block"><strong>Border Color</strong><button class="color-swatch" title="Opens the full single-color Pinta ColorPickerDialog"></button></div>`, 'Border Color opens a nested full Pinta color picker.')}
      ${effectDialog('Night Vision', `${slider('Brightness', 0.6, '0…1 · step .01 · 2 digits')}${checkbox('Noise')}`)}
      <section class="reference-card"><div class="reference-title"><strong>No configuration popup</strong><small>Still must be tested as immediate commands/brush choices</small></div><table class="no-popup-table"><thead><tr><th>Add-in surface</th><th>Native behavior</th><th>Web mapping</th></tr></thead><tbody><tr><td>Colored Grayscale</td><td>Immediate effect; uses current primary color</td><td>Immediate adjustment</td></tr><tr><td>Block Brush</td><td>Paintbrush Type list item; only shared Brush width + Antialiasing</td><td>Separate optional toolbox tool</td></tr></tbody></table></section>
    </div>`,
  },
  {
    name: 'reconstructed-toolbar-overflow-no-popup-tools.png',
    title: 'Toolbar overflow and tools with no tool-specific popup',
    subtitle:
      'Native tool options live in a horizontally scrolling Gtk.ScrolledWindow: automatic horizontal policy, no vertical scrollbar, overlay scrolling, bottom-right placement.',
    html: `<div class="grid one"><section class="reference-card"><div class="reference-title"><strong>Native overflow behavior</strong><small>ToolManager.ToolWidgetsScroll</small></div><div class="overflow-demo"><div class="overflow-shell"><div class="overflow-content"><b>Tool:</b><span>◈</span><span class="separator"></span><span>Shape Type:</span><span class="pill">◈ Open Line/Curve Series ⌄</span><span class="separator"></span><span>Fill Style:</span><span class="pill">◈ Outline Shape ⌄</span>${spin('Outline width:', 2, '1…100000')}<span>Dash:</span><span class="pill">− ⌄</span><span>Arrow:</span>${checkbox('1', true)}${checkbox('2')}${spin('Size:', 10, '1…100')}${spin('Angle:', 15, '−89…89')}${spin('Length:', 10, '−100…100')}<span class="pill">◈ Antialiasing On ⌄</span></div></div><div class="overflow-scroll"><i></i></div></div></section><section class="reference-card"><div class="reference-title"><strong>Core tools with no unique tool-specific popup/flyout</strong><small>Four empty toolbars plus three using only shared or inline controls</small></div><table class="no-popup-table"><thead><tr><th>Tool</th><th>Native toolbar after Tool icon</th><th>Web status</th></tr></thead><tbody><tr><td>Move Selected Pixels</td><td>Empty</td><td>Empty</td></tr><tr><td>Move Selection</td><td>Empty</td><td>Empty</td></tr><tr><td>Zoom</td><td>Empty</td><td>Empty</td></tr><tr><td>Pan</td><td>Empty</td><td>Empty</td></tr><tr><td>Pencil</td><td>Shared Alpha Blending dropdown only</td><td>Mapped</td></tr><tr><td>Clone Stamp</td><td>Brush width + shared Antialiasing only</td><td>Mapped</td></tr><tr><td>Recolor</td><td>Brush width + Tolerance 0…100 + shared Antialiasing</td><td>Mapped</td></tr></tbody></table></section></div>`,
  },
];

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const pageHandle = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  for (const ref of refs) {
    await pageHandle.setViewportSize({ width: ref.width ?? 1600, height: 1000 });
    await pageHandle.setContent(page(ref.title, ref.subtitle, ref.html), { waitUntil: 'load' });
    await pageHandle.screenshot({ path: path.join(output, ref.name), fullPage: true });
  }
} finally {
  await browser.close();
}

console.log(`Generated ${refs.length} source-reconstruction references in ${path.relative(root, output)}`);
