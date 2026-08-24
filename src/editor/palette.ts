export type PaletteFormat = 'paint-dot-net' | 'gimp' | 'paint-shop-pro';

export const PALETTE_EXTENSION: Record<PaletteFormat, string> = {
  'paint-dot-net': 'txt',
  gimp: 'gpl',
  'paint-shop-pro': 'pal',
};

function byteToHex(value: number) {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
}

function rgbToHex(red: number, green: number, blue: number) {
  return `#${byteToHex(red)}${byteToHex(green)}${byteToHex(blue)}`;
}

function colorBytes(color: string) {
  const value = color.replace('#', '');
  if (!/^(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) throw new Error(`Invalid palette color: ${color}`);
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
    value.length === 8 ? Number.parseInt(value.slice(6, 8), 16) : 255,
  ] as const;
}

function parsePaintDotNetPalette(text: string) {
  const colors: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;
    const match = /^(?:([0-9a-f]{2}))?([0-9a-f]{6})$/i.exec(line);
    if (!match) throw new Error('Invalid Paint.NET palette color.');
    const alpha = match[1]?.toLowerCase() ?? 'ff';
    colors.push(`#${match[2].toLowerCase()}${alpha === 'ff' ? '' : alpha}`);
  }
  if (!colors.length) throw new Error('The Paint.NET palette contains no colors.');
  return colors;
}

function parseGimpPalette(text: string) {
  const lines = text.split(/\r?\n/);
  if (!lines[0]?.trim().startsWith('GIMP')) throw new Error('Not a valid GIMP palette file.');
  const colors: string[] = [];
  for (const rawLine of lines.slice(1)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || /^(Name|Columns):/i.test(line)) continue;
    const match = /^(\d+)\s+(\d+)\s+(\d+)(?:\s+.*)?$/.exec(line);
    if (!match) continue;
    const values = match.slice(1, 4).map(Number);
    if (values.some((value) => value < 0 || value > 255)) throw new Error('Invalid GIMP palette color.');
    colors.push(rgbToHex(values[0], values[1], values[2]));
  }
  if (!colors.length) throw new Error('The GIMP palette contains no colors.');
  return colors;
}

function parsePaintShopProPalette(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines[0] !== 'JASC-PAL') throw new Error('Not a valid PaintShop Pro palette file.');
  const count = Number.parseInt(lines[2] ?? '', 10);
  if (!Number.isFinite(count) || count < 1) throw new Error('Invalid PaintShop Pro palette size.');
  const colors = lines.slice(3, 3 + count).map((line) => {
    const match = /^(\d+)\s+(\d+)\s+(\d+)$/.exec(line);
    if (!match) throw new Error('Invalid PaintShop Pro palette color.');
    const values = match.slice(1, 4).map(Number);
    if (values.some((value) => value < 0 || value > 255)) throw new Error('Invalid PaintShop Pro palette color.');
    return rgbToHex(values[0], values[1], values[2]);
  });
  if (colors.length !== count) throw new Error('The PaintShop Pro palette is truncated.');
  return colors;
}

function formatFromFileName(fileName: string): PaletteFormat | null {
  const extension = fileName.split('.').at(-1)?.toLowerCase();
  if (extension === 'txt') return 'paint-dot-net';
  if (extension === 'gpl') return 'gimp';
  if (extension === 'pal') return 'paint-shop-pro';
  return null;
}

export function parsePalette(text: string, fileName = '') {
  const preferred = formatFromFileName(fileName);
  const parsers: Record<PaletteFormat, (source: string) => string[]> = {
    'paint-dot-net': parsePaintDotNetPalette,
    gimp: parseGimpPalette,
    'paint-shop-pro': parsePaintShopProPalette,
  };
  const order = preferred
    ? [preferred, ...Object.keys(parsers).filter((format) => format !== preferred) as PaletteFormat[]]
    : Object.keys(parsers) as PaletteFormat[];
  const errors: string[] = [];
  for (const format of order) {
    try {
      return { colors: parsers[format](text), format };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`Unsupported palette format. ${errors.join(' ')}`);
}

export function serializePalette(colors: string[], format: PaletteFormat, name = 'Pinta Online Palette') {
  if (!colors.length) throw new Error('A palette must contain at least one color.');
  if (format === 'paint-dot-net') {
    return `; Hexadecimal format: aarrggbb\n${colors.map((color) => {
      const [red, green, blue, alpha] = colorBytes(color);
      return [alpha, red, green, blue].map(byteToHex).join('').toUpperCase();
    }).join('\n')}\n`;
  }
  if (format === 'gimp') {
    const rows = colors.map((color, index) => {
      const [red, green, blue] = colorBytes(color);
      return `${String(red).padStart(3)} ${String(green).padStart(3)} ${String(blue).padStart(3)} Untitled_${index}`;
    });
    return `GIMP Palette\nName: ${name}\n#\n${rows.join('\n')}\n`;
  }
  return `JASC-PAL\n0100\n${colors.length}\n${colors.map((color) => colorBytes(color).slice(0, 3).join(' ')).join('\n')}\n`;
}

export function paletteFileName(fileName: string, format: PaletteFormat) {
  const extension = PALETTE_EXTENSION[format];
  const base = fileName.trim().replace(/\.(txt|gpl|pal)$/i, '') || 'pinta-palette';
  return `${base}.${extension}`;
}
