import {
  useRef,
  type CSSProperties,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { usePaintEditor } from '../editor/usePaintEditor';
import type { ToolId } from '../editor/types';
import { translateDocumentName, translateUi } from '../i18n';
import type { CanvasGridSettings, RulerMetric } from '../state/preferences';
import { CanvasRuler } from './CanvasRuler';
import { PintaIcon } from './primitives';

type CanvasEditor = ReturnType<typeof usePaintEditor>;

interface ViewportMetrics {
  width: number;
  height: number;
  scrollLeft: number;
  scrollTop: number;
}

interface ZoomMarquee {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TextDrag {
  x: number;
  y: number;
  originX: number;
  originY: number;
}

const TOOL_CURSORS: Partial<Record<ToolId, string>> = {
  'rectangle-select': "url('/cursors/Cursor.RectangleSelect.png') 9 18, crosshair",
  'ellipse-select': "url('/cursors/Cursor.EllipseSelect.png') 9 18, crosshair",
  'lasso-select': "url('/cursors/Cursor.LassoSelect.png') 9 18, crosshair",
  'magic-wand': "url('/cursors/Cursor.MagicWand.png') 21 10, crosshair",
  paintbrush: "url('/cursors/Cursor.Paintbrush.png') 8 24, crosshair",
  'block-brush': "url('/cursors/Cursor.Paintbrush.png') 8 24, crosshair",
  pencil: "url('/cursors/Cursor.Pencil.png') 7 24, crosshair",
  eraser: "url('/cursors/Cursor.Eraser.png') 8 22, crosshair",
  'paint-bucket': "url('/cursors/Cursor.PaintBucket.png') 21 21, crosshair",
  gradient: "url('/cursors/Cursor.Gradient.png') 9 18, crosshair",
  'color-picker': "url('/cursors/Cursor.ColorPicker.png') 7 27, crosshair",
  line: "url('/cursors/Cursor.Line.png') 9 18, crosshair",
  rectangle: "url('/cursors/Cursor.Rectangle.png') 9 18, crosshair",
  'rounded-rectangle': "url('/cursors/Cursor.RoundedRectangle.png') 9 18, crosshair",
  ellipse: "url('/cursors/Cursor.Ellipse.png') 9 18, crosshair",
  freeform: "url('/cursors/Cursor.FreeformShape.png') 9 18, crosshair",
  'clone-stamp': "url('/cursors/Cursor.CloneStamp.png') 16 26, crosshair",
  recolor: "url('/cursors/Cursor.Recolor.png') 9 18, crosshair",
};

export function CanvasArea({
  editor,
  showDocumentTabs,
  showRulers,
  rulerMetric,
  viewportMetrics,
  viewportRef,
  canvasStyle,
  zoomMarquee,
  canvasGrid,
  textEditorLeft,
  textEditorWidth,
  textDragRef,
  onViewportScroll,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onRequestCloseDocument,
  onOpenSaveAs,
  onSaveCurrentImage,
  onNewImage,
  onOpenImages,
}: {
  editor: CanvasEditor;
  showDocumentTabs: boolean;
  showRulers: boolean;
  rulerMetric: RulerMetric;
  viewportMetrics: ViewportMetrics;
  viewportRef: RefObject<HTMLDivElement | null>;
  canvasStyle: CSSProperties;
  zoomMarquee: ZoomMarquee | null;
  canvasGrid: CanvasGridSettings;
  textEditorLeft: number;
  textEditorWidth: number;
  textDragRef: MutableRefObject<TextDrag | null>;
  onViewportScroll: (scrollLeft: number, scrollTop: number) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onRequestCloseDocument: (documentId: string) => void;
  onOpenSaveAs: () => void;
  onSaveCurrentImage: () => void;
  onNewImage: () => void;
  onOpenImages: () => void;
}) {
  const textEditorRef = useRef<HTMLTextAreaElement>(null);

  const handleCanvasPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    onPointerDown(event);
    if (editor.tool !== 'text' || event.button !== 0) return;
    // React's autoFocus covers a newly mounted editor and restored sessions. A second text
    // placement can reuse the existing textarea in the same render batch, though, so explicitly
    // restore typing focus after the canvas pointer event has finished.
    requestAnimationFrame(() => textEditorRef.current?.focus({ preventScroll: true }));
  };

  return (
    <div className="canvas-area">
      {showDocumentTabs && editor.documents.length > 1 && (
        <nav className="document-tabs" role="tablist" aria-label="Open images">
          <div className="document-tabs-scroll">
            {editor.documents.map((document) => (
              <div
                className={`document-tab ${document.id === editor.activeDocumentId ? 'active' : ''}`}
                key={document.id}
              >
                <button
                  type="button"
                  className="document-tab-activate"
                  role="tab"
                  aria-selected={document.id === editor.activeDocumentId}
                  title={`${translateDocumentName(document.fileName)} · ${document.width} × ${document.height}`}
                  onClick={() => editor.switchDocument(document.id)}
                >
                  <PintaIcon file="image-x-generic-symbolic.svg" size={13} standard />
                  <span>
                    {translateDocumentName(document.fileName)}
                    {document.dirty ? '*' : ''}
                  </span>
                </button>
                <button
                  type="button"
                  className="document-tab-close"
                  aria-label={`Close ${document.fileName}`}
                  title={`Close ${document.fileName}`}
                  onClick={() => onRequestCloseDocument(document.id)}
                >
                  <PintaIcon file="window-close-symbolic.svg" size={12} standard />
                </button>
              </div>
            ))}
          </div>
        </nav>
      )}

      {editor.documents.length > 0 ? (
        <div className={`canvas-viewport-shell ${showRulers ? 'with-rulers' : ''}`}>
          {showRulers && (
            <>
              <span className="ruler-corner" aria-hidden="true" />
              <CanvasRuler
                orientation="horizontal"
                metric={rulerMetric}
                imageSize={editor.width}
                zoom={editor.zoom}
                viewportSize={viewportMetrics.width}
                scroll={viewportMetrics.scrollLeft}
              />
              <CanvasRuler
                orientation="vertical"
                metric={rulerMetric}
                imageSize={editor.height}
                zoom={editor.zoom}
                viewportSize={viewportMetrics.height}
                scroll={viewportMetrics.scrollTop}
              />
            </>
          )}
          <main
            ref={viewportRef}
            className="canvas-viewport"
            onScroll={(event) => {
              const { scrollLeft, scrollTop } = event.currentTarget;
              onViewportScroll(scrollLeft, scrollTop);
            }}
          >
            <div className="canvas-centering-frame">
              <div
                className={`canvas-stack tool-${editor.tool}`}
                style={{ ...canvasStyle, cursor: editor.selectionCursor || TOOL_CURSORS[editor.tool] }}
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onContextMenu={(event) => event.preventDefault()}
              >
                <canvas ref={editor.displayCanvasRef} width={editor.width} height={editor.height} />
                <canvas
                  ref={editor.previewCanvasRef}
                  width={editor.width}
                  height={editor.height}
                  className="preview-canvas"
                />
                <canvas
                  ref={editor.selectionCanvasRef}
                  width={editor.width}
                  height={editor.height}
                  className="selection-canvas"
                />
                {zoomMarquee && (
                  <div
                    className="zoom-marquee"
                    aria-hidden="true"
                    style={{
                      left: zoomMarquee.x * editor.zoom,
                      top: zoomMarquee.y * editor.zoom,
                      width: zoomMarquee.width * editor.zoom,
                      height: zoomMarquee.height * editor.zoom,
                    }}
                  />
                )}
                {canvasGrid.showGrid && <div className="canvas-grid-overlay orthogonal-grid" aria-hidden="true" />}
                {canvasGrid.showAxonometricGrid && (
                  <div className="canvas-grid-overlay axonometric-grid" aria-hidden="true" />
                )}
                {editor.textEditor && (
                  <div
                    className={`text-editor-overlay ${editor.textEditor.y * editor.zoom < 32 ? 'near-top' : ''}`}
                    style={{
                      left: `${textEditorLeft}px`,
                      top: `${Math.max(0, editor.textEditor.y * editor.zoom)}px`,
                      width: `${textEditorWidth}px`,
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <div className="text-editor-actions">
                      <button
                        type="button"
                        className="text-drag-handle"
                        aria-label="Move text"
                        title="Drag to move text"
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          event.currentTarget.setPointerCapture(event.pointerId);
                          textDragRef.current = {
                            x: event.clientX,
                            y: event.clientY,
                            originX: editor.textEditor!.x,
                            originY: editor.textEditor!.y,
                          };
                        }}
                        onPointerMove={(event) => {
                          const drag = textDragRef.current;
                          if (!drag) return;
                          editor.moveText(
                            drag.originX + (event.clientX - drag.x) / editor.zoom,
                            drag.originY + (event.clientY - drag.y) / editor.zoom,
                          );
                        }}
                        onPointerUp={() => {
                          textDragRef.current = null;
                        }}
                        onPointerCancel={() => {
                          textDragRef.current = null;
                        }}
                      >
                        ⠿
                      </button>
                      <span>Editing text</span>
                      <button type="button" aria-label="Commit text" title="Commit text" onClick={editor.commitText}>
                        <span className="native-checkmark" aria-hidden="true" />
                      </button>
                      <button type="button" aria-label="Cancel text" title="Cancel text" onClick={editor.cancelText}>
                        <PintaIcon file="window-close-symbolic.svg" size={13} standard />
                      </button>
                    </div>
                    <textarea
                      ref={textEditorRef}
                      autoFocus
                      dir="auto"
                      wrap="off"
                      className={`canvas-text-editor text-style-${editor.textStyle}`}
                      aria-label="Text editor"
                      value={editor.textEditor.value}
                      spellCheck
                      placeholder="Type text…"
                      onChange={(event) => editor.updateText(event.target.value)}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        if (event.button !== 2) return;
                        event.preventDefault();
                        event.currentTarget.setPointerCapture(event.pointerId);
                        textDragRef.current = {
                          x: event.clientX,
                          y: event.clientY,
                          originX: editor.textEditor!.x,
                          originY: editor.textEditor!.y,
                        };
                      }}
                      onPointerMove={(event) => {
                        const drag = textDragRef.current;
                        if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
                        editor.moveText(
                          drag.originX + (event.clientX - drag.x) / editor.zoom,
                          drag.originY + (event.clientY - drag.y) / editor.zoom,
                        );
                      }}
                      onPointerUp={(event) => {
                        if (event.currentTarget.hasPointerCapture(event.pointerId))
                          event.currentTarget.releasePointerCapture(event.pointerId);
                        textDragRef.current = null;
                      }}
                      onPointerCancel={() => {
                        textDragRef.current = null;
                      }}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.nativeEvent.isComposing) return;
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          editor.commitText();
                        } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.altKey) {
                          event.preventDefault();
                          const input = event.currentTarget;
                          const start = input.selectionStart;
                          const end = input.selectionEnd;
                          editor.updateText(`${input.value.slice(0, start)}\n${input.value.slice(end)}`);
                          requestAnimationFrame(() => input.setSelectionRange(start + 1, start + 1));
                        } else if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
                          event.preventDefault();
                          const input = event.currentTarget;
                          const start = input.selectionStart;
                          const end = input.selectionEnd;
                          editor.updateText(`${input.value.slice(0, start)}\t${input.value.slice(end)}`);
                          requestAnimationFrame(() => input.setSelectionRange(start + 1, start + 1));
                        } else if (event.key.toLowerCase() === 's' && (event.ctrlKey || event.metaKey)) {
                          event.preventDefault();
                          if (event.shiftKey) onOpenSaveAs();
                          else onSaveCurrentImage();
                        } else if (event.key.toLowerCase() === 'b' && (event.ctrlKey || event.metaKey)) {
                          event.preventDefault();
                          editor.setTextFontWeight(editor.textFontWeight >= 700 ? 400 : 700);
                        } else if (event.key.toLowerCase() === 'i' && (event.ctrlKey || event.metaKey)) {
                          event.preventDefault();
                          editor.setTextItalic(!editor.textItalic);
                        } else if (event.key.toLowerCase() === 'u' && (event.ctrlKey || event.metaKey)) {
                          event.preventDefault();
                          editor.setTextUnderline(!editor.textUnderline);
                        }
                      }}
                      style={{
                        minHeight: `${Math.max(82, editor.textFontSize * editor.zoom * 2.7)}px`,
                        fontFamily: editor.textFontFamily,
                        fontSize: `${editor.textFontSize * editor.zoom}px`,
                        fontWeight: editor.textFontWeight,
                        fontStyle: editor.textItalic ? 'italic' : 'normal',
                        fontVariantCaps:
                          editor.textVariant === 'small-caps' || editor.textVariant === 'petite-caps'
                            ? 'small-caps'
                            : 'normal',
                        textTransform:
                          editor.textVariant === 'all-small-caps' || editor.textVariant === 'all-petite-caps'
                            ? 'uppercase'
                            : editor.textVariant === 'unicase'
                              ? 'lowercase'
                              : editor.textVariant === 'title-caps'
                                ? 'capitalize'
                                : 'none',
                        textDecoration: editor.textUnderline ? 'underline' : 'none',
                        textAlign: editor.textAlignment,
                        color: editor.textStyle === 'outline' ? 'transparent' : editor.primary,
                        backgroundColor: editor.textStyle === 'background' ? editor.secondary : undefined,
                        WebkitTextStroke:
                          editor.textStyle === 'fill-outline'
                            ? `${Math.max(1, editor.textOutlineWidth * editor.zoom)}px ${editor.secondary}`
                            : editor.textStyle === 'outline'
                              ? `${Math.max(1, editor.textOutlineWidth * editor.zoom)}px ${editor.primary}`
                              : undefined,
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          </main>
        </div>
      ) : (
        <main className="empty-workspace" aria-label={translateUi('No image open')}>
          <PintaIcon file="image-x-generic-symbolic.svg" size={64} standard />
          <h2>{translateUi('No image open')}</h2>
          <p>{translateUi('Create a new image or open an existing image to start editing.')}</p>
          <div>
            <button type="button" className="native-dialog-button suggested" onClick={onNewImage}>
              <PintaIcon file="document-new-symbolic.svg" size={16} standard />
              {translateUi('New Image')}
            </button>
            <button type="button" className="native-dialog-button" onClick={onOpenImages}>
              <PintaIcon file="document-open-symbolic.svg" size={16} standard />
              {translateUi('Open Image')}
            </button>
          </div>
        </main>
      )}
    </div>
  );
}
