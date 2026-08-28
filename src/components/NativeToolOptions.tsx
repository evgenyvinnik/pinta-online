import { translateUi } from '../i18n';
import { TOOLS } from '../editor/tools';
import type { SelectionMode, ShapeDashStyle, ShapeFillStyle, TextAlignment, TextStyle, TextVariant, usePaintEditor } from '../editor/usePaintEditor';
import { AngleDial, IconButton, PintaIcon, ToolbarIconSelect, ToolbarStepper } from './primitives';

export const ANTIALIAS_OPTIONS = [
  { value: 'on', label: 'Antialiasing On', icon: 'tool-antialiasing-enabled-symbolic.svg' },
  { value: 'off', label: 'Antialiasing Off', icon: 'tool-antialiasing-disabled-symbolic.svg' },
] as const;

export const BLENDING_OPTIONS = [
  { value: 'normal', label: 'Normal Blending', icon: 'tool-blending-normal-symbolic.svg' },
  { value: 'overwrite', label: 'Overwrite', icon: 'tool-blending-overwrite-symbolic.svg' },
] as const;

export const FILL_STYLE_OPTIONS = [
  { value: 'outline', label: 'Outline Shape', icon: 'tool-fillstyle-outline-symbolic.svg' },
  { value: 'fill', label: 'Fill Shape', icon: 'tool-fillstyle-fill-symbolic.svg' },
  { value: 'fill-outline', label: 'Fill and Outline Shape', icon: 'tool-fillstyle-outlinefill-symbolic.svg' },
] as const;

export function NativeToolOptions({ editor, currentTool, blockBrushEnabled, onChooseFont }: { editor: ReturnType<typeof usePaintEditor>; currentTool: (typeof TOOLS)[number]; blockBrushEnabled: boolean; onChooseFont: () => void }) {
  const antialias = <ToolbarIconSelect label="Antialiasing" value={editor.shapeAntialiasing ? 'on' : 'off'} options={ANTIALIAS_OPTIONS} onChange={(value) => editor.setShapeAntialiasing(value === 'on')} />;
  const primaryModifier = /Mac|iPhone|iPad/.test(navigator.platform) ? 'Command' : 'Ctrl';
  const alternateModifier = primaryModifier === 'Command' ? 'Option' : 'Alt';
  const selectionMode = <ToolbarIconSelect className="selection-mode-select" label="Selection mode" showLabel value={editor.selectionMode} options={SELECTION_MODE_OPTIONS.map((mode) => ({ value: mode.value, label: translateUi(mode.label).replace('{0}', mode.value === 'intersect' ? alternateModifier : primaryModifier) }))} onChange={(value) => editor.setSelectionMode(value as SelectionMode)} />;
  const fillStyle = <ToolbarIconSelect label="Fill style" value={editor.shapeFillStyle} options={FILL_STYLE_OPTIONS} onChange={(value) => editor.setShapeFillStyle(value as ShapeFillStyle)} />;
  const dash = (
    <><input className="native-toolbar-select dash-option-select" list="pinta-dash-patterns" value={editor.shapeDashStyle} onChange={(event) => editor.setShapeDashStyle(event.target.value as ShapeDashStyle)} aria-label={translateUi('Dash pattern')} /><datalist id="pinta-dash-patterns">{['-', ' -', ' --', ' ---', '  -', '   -', ' - --', ' - - --------', ' - - ---- - ----'].map((pattern) => <option key={pattern} value={pattern} />)}</datalist></>
  );
  const blend = <ToolbarIconSelect label="Blending" value={editor.alphaBlendingMode} options={BLENDING_OPTIONS} onChange={(value) => editor.setAlphaBlendingMode(value as typeof editor.alphaBlendingMode)} />;
  const shapeTool = ['line', 'rectangle', 'rounded-rectangle', 'ellipse'].includes(editor.tool);

  return (
    <div className="tool-options-bar">
      <span className="tool-label">{translateUi('Tool:')}</span>
      <PintaIcon file={currentTool.icon} size={19} />

      {['paintbrush', 'block-brush', 'eraser', 'recolor', 'clone-stamp'].includes(editor.tool) && <>
        <span className="option-label">{translateUi('Brush width:')}</span>
        <ToolbarStepper label="Brush width" value={editor.brushSize} min={1} max={100000} onChange={editor.setBrushSize} />
        {editor.tool === 'paintbrush' && <>
          <span className="option-label">{translateUi('Type:')}</span>
          <ToolbarIconSelect className="brush-type-select" label="Paintbrush type" showLabel value={editor.paintBrushType} options={[
            { value: 'normal', label: 'Normal' },
            ...(blockBrushEnabled ? [{ value: 'block', label: 'Block' }] : []),
            { value: 'circles', label: 'Circles' },
            { value: 'grid', label: 'Grid' },
            { value: 'slash', label: 'Slash' },
            { value: 'splatter', label: 'Splatter' },
            { value: 'squares', label: 'Squares' },
          ]} onChange={(value) => editor.setPaintBrushType(value as typeof editor.paintBrushType)} />
          {editor.paintBrushType === 'slash' && <><span className="option-label">{translateUi('Angle:')}</span><ToolbarStepper label="Slash angle" value={editor.slashBrushAngle} min={0} max={180} onChange={editor.setSlashBrushAngle} /></>}
          {editor.paintBrushType === 'splatter' && <><span className="option-label">{translateUi('Minimum Size:')}</span><ToolbarStepper label="Splatter minimum size" value={editor.splatterMinimumSize} min={1} max={10000} onChange={editor.setSplatterMinimumSize} /><span className="option-label">{translateUi('Maximum Size:')}</span><ToolbarStepper label="Splatter maximum size" value={editor.splatterMaximumSize} min={1} max={10000} onChange={editor.setSplatterMaximumSize} /></>}
        </>}
        {editor.tool === 'eraser' && <>
          <span className="option-label">{translateUi('Type:')}</span>
          <ToolbarIconSelect className="brush-type-select" label="Eraser type" showLabel value={editor.eraserType} options={[{ value: 'normal', label: 'Normal' }, { value: 'smooth', label: 'Smooth' }]} onChange={(value) => editor.setEraserType(value as typeof editor.eraserType)} />
        </>}
        {editor.tool === 'recolor' && <>
          <span className="option-label">{translateUi('Tolerance:')}</span><output className="native-toolbar-value">{editor.recolorTolerance}</output>
          <input className="tool-option-slider compact" type="range" min="0" max="100" value={editor.recolorTolerance} onChange={(event) => editor.setRecolorTolerance(Number(event.target.value))} aria-label={translateUi('Recolor tolerance')} />
        </>}
        {antialias}
      </>}

      {editor.tool === 'pencil' && blend}

      {['paint-bucket', 'magic-wand'].includes(editor.tool) && <>
        <span className="option-label">{translateUi('Flood Mode:')}</span>
        <ToolbarIconSelect label="Flood Mode" value={editor.floodMode} options={[
          { value: 'contiguous', label: 'Contiguous', icon: 'tool-freeformshape-symbolic.svg' },
          { value: 'global', label: 'Global', icon: 'help-website-symbolic.svg' },
        ]} onChange={(value) => editor.setFloodMode(value as typeof editor.floodMode)} />
        <span className="option-label">{translateUi('Tolerance:')}</span>
        <input className="tool-option-slider compact" type="range" min="0" max="100" value={editor.tool === 'magic-wand' ? editor.magicWandTolerance : editor.paintBucketTolerance} onChange={(event) => editor.tool === 'magic-wand' ? editor.setMagicWandTolerance(Number(event.target.value)) : editor.setPaintBucketTolerance(Number(event.target.value))} aria-label={translateUi('Tolerance')} />
        {editor.tool === 'magic-wand' && <><span className="option-label">{translateUi('Selection Mode:')}</span>{selectionMode}</>}
      </>}

      {['rectangle-select', 'ellipse-select', 'lasso-select'].includes(editor.tool) && <>
        <span className="option-label">{translateUi('Selection Mode:')}</span>{selectionMode}
        {editor.tool === 'lasso-select' ? <>
          <span className="option-label">{translateUi('Lasso Mode:')}</span>
          <ToolbarIconSelect label="Lasso Mode" value={editor.lassoMode} options={[
            { value: 'freeform', label: 'Freeform', icon: 'tool-select-lasso-freeform-symbolic.svg' },
            { value: 'polygon', label: 'Polygon', icon: 'tool-select-lasso-polygon-symbolic.svg' },
          ]} onChange={(value) => editor.setLassoMode(value as typeof editor.lassoMode)} />
        </> : <ToolbarIconSelect label="Auto-scroll" value={editor.selectionAutoScroll ? 'on' : 'off'} options={[
          { value: 'on', label: 'Autoscroll On', icon: 'effects-blurs-zoomblur-symbolic.svg' },
          { value: 'off', label: 'Autoscroll Off', icon: 'effects-blurs-unfocus-symbolic.svg' },
        ]} onChange={(value) => editor.setSelectionAutoScroll(value === 'on')} />}
      </>}

      {shapeTool && <>
        <span className="option-label">{translateUi('Shape Type:')}</span>
        <ToolbarIconSelect label="Shape type" value={editor.tool} options={[
          { value: 'line', label: 'Line / Curve', icon: 'tool-line-symbolic.svg' },
          { value: 'rectangle', label: 'Rectangle', icon: 'tool-rectangle-symbolic.svg' },
          { value: 'rounded-rectangle', label: 'Rounded Rectangle', icon: 'tool-rectangle-rounded-symbolic.svg' },
          { value: 'ellipse', label: 'Ellipse', icon: 'tool-ellipse-symbolic.svg' },
        ]} onChange={(value) => editor.setTool(value as typeof editor.tool)} />
        {editor.tool === 'rounded-rectangle' && <><span className="option-label">{translateUi('Radius:')}</span><ToolbarStepper label="Radius" value={editor.roundedRectangleRadius} min={0} max={100000} onChange={editor.setRoundedRectangleRadius} /></>}
        <span className="option-label">{translateUi('Fill Style:')}</span>{fillStyle}
        {editor.shapeFillStyle !== 'fill' && <><span className="option-label">{translateUi('Outline width:')}</span><ToolbarStepper label="Outline width" value={editor.brushSize} min={1} max={100000} onChange={editor.setBrushSize} /><span className="option-label">{translateUi('Dash:')}</span>{dash}</>}
        {editor.tool === 'line' && <><span className="option-label">{translateUi('Arrow:')}</span><label className="native-toolbar-check"><input aria-label={translateUi('Start arrow')} type="checkbox" checked={editor.lineArrowStart} onChange={(event) => editor.setLineArrowStart(event.target.checked)} />1</label><label className="native-toolbar-check"><input aria-label={translateUi('End arrow')} type="checkbox" checked={editor.lineArrowEnd} onChange={(event) => editor.setLineArrowEnd(event.target.checked)} />2</label>{(editor.lineArrowStart || editor.lineArrowEnd) && <><span className="option-label">{translateUi('Size:')}</span><ToolbarStepper label="Arrow size" value={editor.lineArrowSize} min={1} max={100} onChange={editor.setLineArrowSize} /><span className="option-label">{translateUi('Angle:')}</span><ToolbarStepper label="Arrow angle" value={editor.lineArrowAngle} min={-89} max={89} onChange={editor.setLineArrowAngle} /><span className="option-label">{translateUi('Length:')}</span><ToolbarStepper label="Arrow length" value={editor.lineArrowLength} min={-100} max={100} onChange={editor.setLineArrowLength} /></>}</>}
        {antialias}
      </>}

      {editor.tool === 'freeform' && <>
        <span className="option-label">{translateUi('Fill Style:')}</span>{fillStyle}
        {editor.shapeFillStyle !== 'fill' && <><span className="option-label">{translateUi('Brush width:')}</span><ToolbarStepper label="Brush width" value={editor.brushSize} min={1} max={100000} onChange={editor.setBrushSize} /><span className="option-label">{translateUi('Dash:')}</span>{dash}</>}
        {antialias}
      </>}

      {editor.tool === 'gradient' && <>
        <span className="option-label">{translateUi('Gradient:')}</span>
        <ToolbarIconSelect label="Gradient" value={editor.gradientType} options={[
          { value: 'linear', label: 'Linear Gradient', icon: 'tool-gradient-linear-symbolic.svg' },
          { value: 'reflected', label: 'Linear Reflected Gradient', icon: 'tool-gradient-linear-reflected-symbolic.svg' },
          { value: 'diamond', label: 'Linear Diamond Gradient', icon: 'tool-gradient-diamond-symbolic.svg' },
          { value: 'radial', label: 'Radial Gradient', icon: 'tool-gradient-radial-symbolic.svg' },
          { value: 'conical', label: 'Conical Gradient', icon: 'tool-gradient-conical-symbolic.svg' },
        ]} onChange={(value) => editor.setGradientType(value as typeof editor.gradientType)} />
        <span className="option-label">{translateUi('Mode:')}</span>
        <ToolbarIconSelect label="Gradient mode" value={editor.gradientColorMode} options={[
          { value: 'color', label: 'Color Mode', icon: 'tool-gradient-colormode-color-symbolic.svg' },
          { value: 'transparency', label: 'Transparency Mode', icon: 'tool-gradient-colormode-transparency-symbolic.svg' },
        ]} onChange={(value) => editor.setGradientColorMode(value as typeof editor.gradientColorMode)} />
        {blend}
      </>}

      {editor.tool === 'color-picker' && <>
        <span className="option-label">{translateUi('Sampling:')}</span>
        <ToolbarIconSelect label="Sampling size" showLabel value={String(editor.colorPickerSampleSize)} options={[
          { value: '1', label: 'Single Pixel', icon: 'tool-colorpicker-sampling-1x1-symbolic.svg' },
          { value: '3', label: '3 x 3 Region', icon: 'tool-colorpicker-sampling-3x3-symbolic.svg' },
          { value: '5', label: '5 x 5 Region', icon: 'tool-colorpicker-sampling-5x5-symbolic.svg' },
          { value: '7', label: '7 x 7 Region', icon: 'tool-colorpicker-sampling-7x7-symbolic.svg' },
          { value: '9', label: '9 x 9 Region', icon: 'tool-colorpicker-sampling-9x9-symbolic.svg' },
        ]} onChange={(value) => editor.setColorPickerSampleSize(Number(value))} />
        <ToolbarIconSelect label="Sample source" showLabel value={editor.colorPickerSampleType} options={[
          { value: 'layer', label: 'Layer', icon: 'layers-merge-down-symbolic.svg' },
          { value: 'image', label: 'Image', icon: 'image-resize-canvas-base-symbolic.svg' },
        ]} onChange={(value) => editor.setColorPickerSampleType(value as typeof editor.colorPickerSampleType)} />
        <span className="option-label">{translateUi('After select:')}</span>
        <ToolbarIconSelect label="After select" showLabel value={editor.colorPickerAfterSelect} options={[
          { value: 'none', label: 'Do not switch tool', icon: 'tool-colorpicker-symbolic.svg' },
          { value: 'previous', label: 'Switch to previous tool', icon: 'go-previous-symbolic.svg', standard: true },
          { value: 'pencil', label: 'Switch to Pencil tool', icon: 'tool-pencil-symbolic.svg' },
        ]} onChange={(value) => editor.setColorPickerAfterSelect(value as typeof editor.colorPickerAfterSelect)} />
      </>}

      {editor.tool === 'text' && <>
        <span className="option-label">{translateUi('Font:')}</span>
        <button type="button" className="native-toolbar-select font-family-select" onClick={onChooseFont} aria-label={translateUi('Font family')} title={translateUi('Choose an installed font family')}>{editor.textFontFamily}</button>
        <ToolbarIconSelect label="Font variant" value={editor.textVariant} options={[
          { value: 'normal', label: 'Normal', icon: 'text-variant-normal-symbolic.svg' },
          { value: 'small-caps', label: 'Small Caps', icon: 'text-variant-small-caps-symbolic.svg' },
          { value: 'all-small-caps', label: 'All Small Caps', icon: 'text-variant-all-small-caps-symbolic.svg' },
          { value: 'petite-caps', label: 'Petite Caps', icon: 'text-variant-petite-caps-symbolic.svg' },
          { value: 'all-petite-caps', label: 'All Petite Caps', icon: 'text-variant-all-petite-caps-symbolic.svg' },
          { value: 'unicase', label: 'Unicase', icon: 'text-variant-unicase-symbolic.svg' },
          { value: 'title-caps', label: 'Title Caps', icon: 'text-variant-title-caps-symbolic.svg' },
        ]} onChange={(value) => editor.setTextVariant(value as TextVariant)} />
        <ToolbarStepper className="font-size-stepper" label="Font size" value={editor.textFontSize} min={1} max={2000} onChange={editor.setTextFontSize} />
        <ToolbarIconSelect label="Font weight" value={String(editor.textFontWeight)} options={[
          { value: '100', label: 'Thin 100', icon: 'text-extra-light-symbolic.svg' },
          { value: '200', label: 'Ultralight 200', icon: 'text-extra-light-symbolic.svg' },
          { value: '300', label: 'Light 300', icon: 'text-light-symbolic.svg' },
          { value: '350', label: 'Semilight 350', icon: 'text-light-symbolic.svg' },
          { value: '380', label: 'Book 380', icon: 'text-normal-symbolic.svg' },
          { value: '400', label: 'Normal 400', icon: 'text-normal-symbolic.svg' },
          { value: '500', label: 'Medium 500', icon: 'text-normal-symbolic.svg' },
          { value: '600', label: 'Semibold 600', icon: 'text-bold-symbolic.svg' },
          { value: '700', label: 'Bold 700', icon: 'text-bold-symbolic.svg' },
          { value: '800', label: 'Ultrabold 800', icon: 'text-extra-bold-symbolic.svg' },
          { value: '900', label: 'Heavy 900', icon: 'text-extra-bold-symbolic.svg' },
          { value: '1000', label: 'Ultraheavy 1000', icon: 'text-extra-bold-symbolic.svg' },
        ]} onChange={(value) => editor.setTextFontWeight(Number(value))} />
        <button className={`text-format-button ${editor.textItalic ? 'active' : ''}`} type="button" aria-label={translateUi('Italic')} onClick={() => editor.setTextItalic(!editor.textItalic)}><PintaIcon file="format-text-italic-symbolic.svg" size={15} standard /></button>
        <button className={`text-format-button ${editor.textUnderline ? 'active' : ''}`} type="button" aria-label={translateUi('Underline')} onClick={() => editor.setTextUnderline(!editor.textUnderline)}><PintaIcon file="format-text-underline-symbolic.svg" size={15} standard /></button>
        {([['left', 'format-justify-left-symbolic.svg', 'Left align'], ['center', 'format-justify-center-symbolic.svg', 'Center align'], ['right', 'format-justify-right-symbolic.svg', 'Right align']] as const).map(([alignment, icon, label]) => <button key={alignment} className={`text-format-button ${editor.textAlignment === alignment ? 'active' : ''}`} type="button" aria-label={translateUi(label)} onClick={() => editor.setTextAlignment(alignment as TextAlignment)}><PintaIcon file={icon} size={15} standard /></button>)}
        <span className="option-label">{translateUi('Text Style:')}</span>
        <ToolbarIconSelect label="Text style" value={editor.textStyle} options={[
          { value: 'fill', label: 'Normal', icon: 'tool-fillstyle-fill-symbolic.svg' },
          { value: 'fill-outline', label: 'Normal and Outline', icon: 'tool-fillstyle-outlinefill-symbolic.svg' },
          { value: 'outline', label: 'Outline', icon: 'tool-fillstyle-outline-symbolic.svg' },
          { value: 'background', label: 'Fill Background', icon: 'tool-fillstyle-background-symbolic.svg' },
        ]} onChange={(value) => editor.setTextStyle(value as TextStyle)} />
        {(editor.textStyle === 'fill-outline' || editor.textStyle === 'outline') && <><span className="option-label">{translateUi('Outline width:')}</span><ToolbarStepper label="Text outline width" value={editor.textOutlineWidth} min={1} max={100000} onChange={editor.setTextOutlineWidth} /><span className="option-label">{translateUi('Join:')}</span><ToolbarIconSelect className="text-join-select" label="Text outline join" showLabel value={editor.textLineJoin} options={[{ value: 'miter', label: 'Miter Join' }, { value: 'round', label: 'Round Join' }, { value: 'bevel', label: 'Bevel Join' }]} onChange={(value) => editor.setTextLineJoin(value as CanvasLineJoin)} /></>}
        {antialias}
      </>}
    </div>
  );
}

export const SELECTION_MODE_OPTIONS: Array<{ value: SelectionMode; label: string }> = [
  { value: 'replace', label: 'Replace' },
  { value: 'union', label: 'Union (+) ({0} + Left Click)' },
  { value: 'exclude', label: 'Exclude (-) (Right Click)' },
  { value: 'xor', label: 'Xor ({0} + Right Click)' },
  { value: 'intersect', label: 'Intersect ({0} + Left Click)' },
];
