import {
  forwardRef,
  memo,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { AddinId } from '../addins/registry';
import { usePaintEditor } from '../editor/usePaintEditor';
import type { PaletteFormat } from '../editor/palette';
import type { ExportFormat } from '../editor/types';
import { EFFECT_BY_ID, type EffectId, type EffectParameters } from '../effects/types';
import type { CanvasGridSettings } from '../state/preferences';
import { WEB_BUG_REPORT_URL } from '../projectLinks';
import { ColorPickerDialog } from './ColorPickerDialog';
import type { LayerPropertiesPreview } from './DockSidebar';
import { ErrorBoundary } from './ErrorBoundary';
import { AboutDialog, AddinManagerDialog, FontFamilyDialog, KeyboardShortcutsDialog, LanguageDialog } from './dialogs/aboutDialogs';
import { CloseDocumentDialog, FlattenConfirmDialog, initialExportFormat, PasteExpandDialog, SaveAsDialog } from './dialogs/documentDialogs';
import { EffectDialog } from './dialogs/effect/EffectDialog';
import { ImageSizeDialog, type DialogName } from './dialogs/ImageSizeDialog';
import { LayerPropertiesDialog, RotateZoomLayerDialog } from './dialogs/layerDialogs';
import { PaletteResizeDialog, PaletteSaveDialog } from './dialogs/paletteDialogs';
import {
  CanvasGridDialog,
  EffectProgressDialog,
  ErrorReportDialog,
  InformationDialog,
  OffsetSelectionDialog,
  PrintDialog,
  ScreenshotDialog,
  type ApplicationError,
  type PrintPreview,
} from './dialogs/systemDialogs';

interface PrimaryDialogState {
  dialog: DialogName;
  effectDialog: EffectId | null;
  showSaveAs: boolean;
}

export interface PrimaryDialogHandle {
  getState: () => PrimaryDialogState;
  setDialog: (dialog: DialogName) => void;
  setEffectDialog: (effect: EffectId | null) => void;
  setShowSaveAs: (show: boolean) => void;
  closeAll: () => void;
}

export type AuxiliaryDialogName = 'shortcuts' | 'language' | 'about' | 'addins';

export interface AuxiliaryDialogHandle {
  open: (dialog: AuxiliaryDialogName) => void;
  openFonts: () => Promise<void>;
  hasOpenDialog: () => boolean;
  closeTop: () => void;
  closeAll: () => void;
}

interface LocalFontData {
  family: string;
  fullName?: string;
  postscriptName?: string;
  style?: string;
}

type LocalFontWindow = Window & {
  queryLocalFonts?: () => Promise<LocalFontData[]>;
};

const FALLBACK_FONT_FAMILIES = ['Adwaita Sans', 'Arial', 'Arial Black', 'Avenir Next', 'Baskerville', 'Brush Script MT', 'Charter', 'Courier New', 'Futura', 'Georgia', 'Helvetica', 'Helvetica Neue', 'Impact', 'Menlo', 'Monaco', 'Noto Sans', 'Palatino', 'Sans', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];

const AuxiliaryDialogHost = memo(forwardRef<AuxiliaryDialogHandle, {
  currentFont: string;
  setFont: (family: string) => void;
  enabledAddins: readonly AddinId[];
  paintBrushType: string;
  setPaintBrushType: (type: 'normal') => void;
  onToggleAddin: (addin: AddinId, enabled: boolean) => void;
  onSetAllAddins: (enabled: boolean) => void;
  notify: (message: string) => void;
}>(function AuxiliaryDialogHost({
  currentFont,
  setFont,
  enabledAddins,
  paintBrushType,
  setPaintBrushType,
  onToggleAddin,
  onSetAllAddins,
  notify,
}, ref) {
  const [dialog, setDialog] = useState<AuxiliaryDialogName | 'fonts' | null>(null);
  const [fontFamilies, setFontFamilies] = useState<string[]>(FALLBACK_FONT_FAMILIES);

  const closeTop = useCallback(() => {
    if (dialog === 'about') {
      const back = document.querySelector<HTMLButtonElement>('.about-dialog [data-about-back]');
      if (back) {
        back.click();
        return;
      }
    }
    setDialog(null);
  }, [dialog]);

  useImperativeHandle(ref, () => ({
    open: setDialog,
    openFonts: async () => {
      let available = FALLBACK_FONT_FAMILIES;
      const queryLocalFonts = (window as LocalFontWindow).queryLocalFonts;
      if (queryLocalFonts) {
        try {
          const localFonts = await queryLocalFonts.call(window);
          const installed = localFonts.map((font) => font.family.trim()).filter(Boolean);
          if (installed.length) available = [...new Set([...installed, currentFont])].sort((left, right) => left.localeCompare(right));
        } catch {
          notify('Installed font access was not granted; showing common fonts instead.');
        }
      }
      if (!available.includes(currentFont)) available = [currentFont, ...available];
      setFontFamilies(available);
      setDialog('fonts');
    },
    hasOpenDialog: () => dialog !== null,
    closeTop,
    closeAll: () => setDialog(null),
  }), [closeTop, currentFont, dialog, notify]);

  return (
    <>
      {dialog === 'shortcuts' && <KeyboardShortcutsDialog onClose={() => setDialog(null)} />}
      {dialog === 'language' && <LanguageDialog onClose={() => setDialog(null)} />}
      {dialog === 'about' && <AboutDialog onClose={() => setDialog(null)} />}
      {dialog === 'fonts' && (
        <FontFamilyDialog
          families={fontFamilies}
          current={currentFont}
          onCancel={() => setDialog(null)}
          onSubmit={(family) => {
            setFont(family);
            setDialog(null);
          }}
        />
      )}
      {dialog === 'addins' && (
        <AddinManagerDialog
          enabledAddins={enabledAddins}
          onToggle={(addin, enabled) => {
            onToggleAddin(addin, enabled);
            if (!enabled && addin === 'block-brush' && paintBrushType === 'block') setPaintBrushType('normal');
          }}
          onSetAll={(enabled) => {
            onSetAllAddins(enabled);
            if (!enabled && paintBrushType === 'block') setPaintBrushType('normal');
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}));

const PrimaryDialogBoundary = memo(forwardRef<PrimaryDialogHandle, {
  children: (state: PrimaryDialogState) => ReactNode;
}>(function PrimaryDialogBoundary({ children }, ref) {
  const [dialog, setDialog] = useState<DialogName>(null);
  const [effectDialog, setEffectDialog] = useState<EffectId | null>(null);
  const [showSaveAs, setShowSaveAs] = useState(false);
  const stateRef = useRef<PrimaryDialogState>({ dialog: null, effectDialog: null, showSaveAs: false });
  stateRef.current = { dialog, effectDialog, showSaveAs };
  const closeAll = useCallback(() => {
    setDialog(null);
    setEffectDialog(null);
    setShowSaveAs(false);
  }, []);

  useImperativeHandle(ref, () => ({
    getState: () => stateRef.current,
    setDialog,
    setEffectDialog,
    setShowSaveAs,
    closeAll,
  }), [closeAll]);

  return children(stateRef.current);
}));

type Editor = ReturnType<typeof usePaintEditor>;
type PaletteDialog = 'save' | 'resize' | null;
type PendingPaste = 'current' | 'new-layer' | null;
type PendingSaveAction = { kind: 'close' | 'close-all' | 'save-all'; documentId: string } | null;
type PendingFlattenAction = { kind: 'save' | 'close' | 'close-all' | 'save-all'; documentId: string } | null;
type SaveImageAsOptions = { fileName: string; format: ExportFormat; quality: number; flatten: boolean };

interface DialogHostProps {
  editor: Editor;
  primaryDialogRef: RefObject<PrimaryDialogHandle | null>;
  auxiliaryDialogRef: RefObject<AuxiliaryDialogHandle | null>;
  closeAllOverlays: () => void;
  effectThumbnailUrl: string;
  runEffect: (effect: EffectId, parameters?: EffectParameters) => Promise<boolean>;
  closingDocumentId: string | null;
  setClosingDocumentId: Dispatch<SetStateAction<string | null>>;
  showCloseAllConfirm: boolean;
  setShowCloseAllConfirm: Dispatch<SetStateAction<boolean>>;
  closeAllQueue: string[];
  setCloseAllQueue: Dispatch<SetStateAction<string[]>>;
  completeCloseAllStep: (documentId: string) => void;
  pendingPaste: PendingPaste;
  setPendingPaste: Dispatch<SetStateAction<PendingPaste>>;
  performPaste: (target: Exclude<PendingPaste, null>, expandCanvas?: boolean) => void;
  pendingFlattenAction: PendingFlattenAction;
  setPendingFlattenAction: Dispatch<SetStateAction<PendingFlattenAction>>;
  setSaveAllQueue: Dispatch<SetStateAction<string[]>>;
  completeSaveAllStep: (documentId: string, saved: boolean) => void;
  showError: (title: string, message: string, error: unknown) => void;
  clipboardInformation: { title: string; message: string } | null;
  setClipboardInformation: Dispatch<SetStateAction<{ title: string; message: string } | null>>;
  pendingSaveAction: PendingSaveAction;
  setPendingSaveAction: Dispatch<SetStateAction<PendingSaveAction>>;
  saveImageAs: (options: SaveImageAsOptions) => Promise<boolean>;
  printPreview: PrintPreview | null;
  setPrintPreview: Dispatch<SetStateAction<PrintPreview | null>>;
  showOffsetSelection: boolean;
  setShowOffsetSelection: Dispatch<SetStateAction<boolean>>;
  showScreenshot: boolean;
  setShowScreenshot: Dispatch<SetStateAction<boolean>>;
  screenshotBusy: boolean;
  screenshotError: string;
  setScreenshotError: Dispatch<SetStateAction<string>>;
  captureScreenshot: (delay: number) => Promise<void>;
  showCanvasGridDialog: boolean;
  setShowCanvasGridDialog: Dispatch<SetStateAction<boolean>>;
  canvasGrid: CanvasGridSettings;
  setCanvasGrid: (settings: CanvasGridSettings) => void;
  enabledAddins: readonly AddinId[];
  setAddinEnabled: (addin: AddinId, enabled: boolean) => void;
  setAllAddinsEnabled: (enabled: boolean) => void;
  notify: (message: string) => void;
  paletteDialog: PaletteDialog;
  setPaletteDialog: Dispatch<SetStateAction<PaletteDialog>>;
  savePalette: (format: PaletteFormat, requestedName: string) => void;
  colorDialogTarget: 'primary' | 'secondary' | null;
  setColorDialogTarget: Dispatch<SetStateAction<'primary' | 'secondary' | null>>;
  colorDialogOriginalRef: MutableRefObject<{ primary: string; secondary: string } | null>;
  editingPaletteIndex: number | null;
  setEditingPaletteIndex: Dispatch<SetStateAction<number | null>>;
  addingPaletteColor: boolean;
  setAddingPaletteColor: Dispatch<SetStateAction<boolean>>;
  layerPropertiesId: string | null;
  setLayerPropertiesId: Dispatch<SetStateAction<string | null>>;
  setLayerPropertiesPreview: Dispatch<SetStateAction<LayerPropertiesPreview | null>>;
  rotateZoomLayerId: string | null;
  setRotateZoomLayerId: Dispatch<SetStateAction<string | null>>;
  rotateZoomThumbnailUrl: string;
  runningEffect: EffectId | null;
  applicationError: ApplicationError | null;
  setApplicationError: Dispatch<SetStateAction<ApplicationError | null>>;
  toast: string;
  isFullscreen: boolean;
  toggleFullscreen: () => Promise<void>;
}

export function DialogHost({
  editor,
  primaryDialogRef,
  auxiliaryDialogRef,
  closeAllOverlays,
  effectThumbnailUrl,
  runEffect,
  closingDocumentId,
  setClosingDocumentId,
  showCloseAllConfirm,
  setShowCloseAllConfirm,
  closeAllQueue,
  setCloseAllQueue,
  completeCloseAllStep,
  pendingPaste,
  setPendingPaste,
  performPaste,
  pendingFlattenAction,
  setPendingFlattenAction,
  setSaveAllQueue,
  completeSaveAllStep,
  showError,
  clipboardInformation,
  setClipboardInformation,
  pendingSaveAction,
  setPendingSaveAction,
  saveImageAs,
  printPreview,
  setPrintPreview,
  showOffsetSelection,
  setShowOffsetSelection,
  showScreenshot,
  setShowScreenshot,
  screenshotBusy,
  screenshotError,
  setScreenshotError,
  captureScreenshot,
  showCanvasGridDialog,
  setShowCanvasGridDialog,
  canvasGrid,
  setCanvasGrid,
  enabledAddins,
  setAddinEnabled,
  setAllAddinsEnabled,
  notify,
  paletteDialog,
  setPaletteDialog,
  savePalette,
  colorDialogTarget,
  setColorDialogTarget,
  colorDialogOriginalRef,
  editingPaletteIndex,
  setEditingPaletteIndex,
  addingPaletteColor,
  setAddingPaletteColor,
  layerPropertiesId,
  setLayerPropertiesId,
  setLayerPropertiesPreview,
  rotateZoomLayerId,
  setRotateZoomLayerId,
  rotateZoomThumbnailUrl,
  runningEffect,
  applicationError,
  setApplicationError,
  toast,
  isFullscreen,
  toggleFullscreen,
}: DialogHostProps) {
  const closingDocument = editor.documents.find((document) => document.id === closingDocumentId);
  const closeAllDocument = editor.documents.find((document) => document.id === closeAllQueue[0]);

  return (
    <PrimaryDialogBoundary ref={primaryDialogRef}>
      {({ dialog, effectDialog, showSaveAs }) => (
        <ErrorBoundary region="dialog" onDismiss={closeAllOverlays}>
          <>
            {dialog && (
              <ImageSizeDialog
                key={dialog}
                mode={dialog}
                currentWidth={editor.width}
                currentHeight={editor.height}
                secondaryColor={editor.secondary}
                onCancel={() => primaryDialogRef.current?.setDialog(null)}
                onSubmit={(nextWidth, nextHeight, anchor, background, resampling) => {
                  if (dialog === 'new') editor.newDocument(nextWidth, nextHeight, background);
                  else if (dialog === 'resize-image') editor.resizeImage(nextWidth, nextHeight, resampling);
                  else editor.resizeCanvas(nextWidth, nextHeight, anchor);
                  primaryDialogRef.current?.setDialog(null);
                }}
              />
            )}
            {effectDialog && (
              <EffectDialog
                key={effectDialog}
                effect={EFFECT_BY_ID[effectDialog]}
                busy={editor.effectBusy}
                histogram={editor.getActiveHistogram()}
                imageWidth={editor.width}
                imageHeight={editor.height}
                thumbnailUrl={effectThumbnailUrl}
                onCancel={() => {
                  editor.cancelEffect();
                  primaryDialogRef.current?.setEffectDialog(null);
                }}
                onPreview={(parameters) => editor.previewEffect(effectDialog, parameters)}
                onSubmit={async (parameters) => {
                  const effect = effectDialog;
                  primaryDialogRef.current?.setEffectDialog(null);
                  await runEffect(effect, parameters);
                }}
              />
            )}
            {closingDocument && (
              <CloseDocumentDialog
                fileName={closingDocument.fileName}
                onCancel={() => setClosingDocumentId(null)}
                onDiscard={() => {
                  editor.closeDocument(closingDocument.id);
                  setClosingDocumentId(null);
                }}
                onSave={async () => {
                  if (/^Unsaved Image(?:\s+\d+)?$/i.test(closingDocument.fileName)) {
                    setPendingSaveAction({ kind: 'close', documentId: closingDocument.id });
                    setClosingDocumentId(null);
                    primaryDialogRef.current?.setShowSaveAs(true);
                  } else if (editor.layers.length > 1 && initialExportFormat(closingDocument.fileName) !== 'ora') {
                    setPendingFlattenAction({ kind: 'close', documentId: closingDocument.id });
                    setClosingDocumentId(null);
                  } else if (await editor.saveImage()) {
                    editor.closeDocument(closingDocument.id);
                    setClosingDocumentId(null);
                  }
                }}
              />
            )}
            {showCloseAllConfirm && closeAllDocument && (
              <CloseDocumentDialog
                fileName={closeAllDocument.fileName}
                onCancel={() => {
                  setCloseAllQueue([]);
                  setShowCloseAllConfirm(false);
                }}
                onDiscard={() => completeCloseAllStep(closeAllDocument.id)}
                onSave={async () => {
                  if (/^Unsaved Image(?:\s+\d+)?$/i.test(closeAllDocument.fileName)) {
                    setPendingSaveAction({ kind: 'close-all', documentId: closeAllDocument.id });
                    setShowCloseAllConfirm(false);
                    primaryDialogRef.current?.setShowSaveAs(true);
                  } else if (editor.layers.length > 1 && initialExportFormat(closeAllDocument.fileName) !== 'ora') {
                    setPendingFlattenAction({ kind: 'close-all', documentId: closeAllDocument.id });
                    setShowCloseAllConfirm(false);
                  } else if (await editor.saveImage()) completeCloseAllStep(closeAllDocument.id);
                }}
              />
            )}
            {pendingPaste && (
              <PasteExpandDialog
                onCancel={() => setPendingPaste(null)}
                onPreserve={() => {
                  performPaste(pendingPaste, false);
                  setPendingPaste(null);
                }}
                onExpand={() => {
                  performPaste(pendingPaste, true);
                  setPendingPaste(null);
                }}
              />
            )}
            {pendingFlattenAction && (
              <FlattenConfirmDialog
                onCancel={() => {
                  if (pendingFlattenAction.kind === 'close-all') setCloseAllQueue([]);
                  if (pendingFlattenAction.kind === 'save-all') setSaveAllQueue([]);
                  setPendingFlattenAction(null);
                }}
                onFlatten={() => {
                  const action = pendingFlattenAction;
                  setPendingFlattenAction(null);
                  editor.flattenImage();
                  void editor.saveImage().then((saved) => {
                    if (!saved) return;
                    if (action.kind === 'close') editor.closeDocument(action.documentId);
                    else if (action.kind === 'close-all') completeCloseAllStep(action.documentId);
                    else if (action.kind === 'save-all') completeSaveAllStep(action.documentId, true);
                  }).catch((error) => showError('Failed to save image', error instanceof Error ? error.message : 'The image could not be saved.', error));
                }}
              />
            )}
            {clipboardInformation && <InformationDialog title={clipboardInformation.title} message={clipboardInformation.message} onClose={() => setClipboardInformation(null)} />}
            {showSaveAs && (
              <SaveAsDialog
                fileName={editor.fileName}
                layerCount={editor.layers.length}
                onCancel={() => {
                  primaryDialogRef.current?.setShowSaveAs(false);
                  if (pendingSaveAction?.kind === 'close-all') setCloseAllQueue([]);
                  if (pendingSaveAction?.kind === 'save-all') setSaveAllQueue([]);
                  setPendingSaveAction(null);
                }}
                onSaved={() => primaryDialogRef.current?.setShowSaveAs(false)}
                onSubmit={async (options) => {
                  const saved = await saveImageAs(options);
                  if (!saved || !pendingSaveAction) return saved;
                  const action = pendingSaveAction;
                  setPendingSaveAction(null);
                  if (action.kind === 'close') editor.closeDocument(action.documentId);
                  else if (action.kind === 'close-all') completeCloseAllStep(action.documentId);
                  else completeSaveAllStep(action.documentId, true);
                  return true;
                }}
              />
            )}
            {printPreview && (
              <PrintDialog
                preview={printPreview}
                onCancel={() => setPrintPreview(null)}
                onPrint={() => window.print()}
                onSettingsChange={(settings) => setPrintPreview((current) => current ? { ...current, settings } : null)}
              />
            )}
            {showOffsetSelection && (
              <OffsetSelectionDialog
                onCancel={() => setShowOffsetSelection(false)}
                onSubmit={(offset) => {
                  editor.offsetSelection(offset);
                  setShowOffsetSelection(false);
                }}
              />
            )}
            {showScreenshot && (
              <ScreenshotDialog
                busy={screenshotBusy}
                error={screenshotError}
                onCancel={() => {
                  setShowScreenshot(false);
                  setScreenshotError('');
                }}
                onCapture={(delay) => void captureScreenshot(delay)}
              />
            )}
            {showCanvasGridDialog && (
              <CanvasGridDialog
                settings={canvasGrid}
                onCancel={() => setShowCanvasGridDialog(false)}
                onSubmit={(settings) => {
                  setCanvasGrid(settings);
                  setShowCanvasGridDialog(false);
                }}
              />
            )}
            <AuxiliaryDialogHost
              ref={auxiliaryDialogRef}
              currentFont={editor.textFontFamily}
              setFont={editor.slices.commands.setTextFontFamily}
              enabledAddins={enabledAddins}
              paintBrushType={editor.paintBrushType}
              setPaintBrushType={editor.slices.commands.setPaintBrushType}
              onToggleAddin={setAddinEnabled}
              onSetAllAddins={setAllAddinsEnabled}
              notify={notify}
            />
            {paletteDialog === 'resize' && (
              <PaletteResizeDialog
                currentSize={editor.palette.length}
                onCancel={() => setPaletteDialog(null)}
                onSubmit={(size) => {
                  editor.resizePalette(size);
                  setPaletteDialog(null);
                  notify(`Palette resized to ${Math.max(1, Math.min(96, Math.round(size)))} colors`);
                }}
              />
            )}
            {paletteDialog === 'save' && <PaletteSaveDialog onCancel={() => setPaletteDialog(null)} onSubmit={savePalette} />}
            {colorDialogTarget !== null && (
              <ColorPickerDialog
                key={colorDialogTarget}
                title="Choose Colors"
                primary={editor.primary}
                secondary={editor.secondary}
                initialTarget={colorDialogTarget}
                onCancel={() => {
                  const original = colorDialogOriginalRef.current;
                  if (original) {
                    editor.setPrimary(original.primary, false);
                    editor.setSecondary(original.secondary, false);
                  }
                  colorDialogOriginalRef.current = null;
                  setColorDialogTarget(null);
                }}
                onChange={(colors) => {
                  editor.setPrimary(colors.primary, false);
                  if (colors.secondary) editor.setSecondary(colors.secondary, false);
                }}
                onSubmit={(colors) => {
                  editor.setPrimary(colors.primary);
                  if (colors.secondary) editor.setSecondary(colors.secondary);
                  colorDialogOriginalRef.current = null;
                  setColorDialogTarget(null);
                }}
              />
            )}
            {editingPaletteIndex !== null && editor.palette[editingPaletteIndex] && (
              <ColorPickerDialog
                key={editingPaletteIndex}
                title="Choose Palette Color"
                primary={editor.palette[editingPaletteIndex]}
                recentColors={editor.recentColors}
                palette={editor.palette}
                onCancel={() => setEditingPaletteIndex(null)}
                onSubmit={(colors) => {
                  editor.setPaletteColor(editingPaletteIndex, colors.primary);
                  setEditingPaletteIndex(null);
                  notify(`Palette color changed to ${colors.primary}`);
                }}
              />
            )}
            {addingPaletteColor && (
              <ColorPickerDialog
                title="Add Palette Color"
                primary={editor.primary}
                recentColors={editor.recentColors}
                palette={editor.palette}
                onCancel={() => setAddingPaletteColor(false)}
                onSubmit={(colors) => {
                  setAddingPaletteColor(false);
                  if (editor.addPaletteColor(colors.primary)) notify(`Added ${colors.primary} to the palette`);
                }}
              />
            )}
            {layerPropertiesId && (() => {
              const layer = editor.layers.find((candidate) => candidate.id === layerPropertiesId);
              return layer ? (
                <LayerPropertiesDialog
                  key={layer.id}
                  layer={layer}
                  onPreview={(properties) => {
                    setLayerPropertiesPreview({ id: layer.id, ...properties });
                    editor.previewLayerProperties(layer.id, properties);
                  }}
                  onCancel={() => {
                    editor.clearLayerTransformPreview();
                    setLayerPropertiesPreview(null);
                    setLayerPropertiesId(null);
                  }}
                  onSubmit={(properties) => {
                    editor.clearLayerTransformPreview();
                    setLayerPropertiesPreview(null);
                    editor.updateLayerProperties(layer.id, properties);
                    setLayerPropertiesId(null);
                  }}
                />
              ) : null;
            })()}
            {rotateZoomLayerId && (() => {
              const layer = editor.layers.find((candidate) => candidate.id === rotateZoomLayerId);
              return layer ? (
                <RotateZoomLayerDialog
                  key={layer.id}
                  layer={layer}
                  imageWidth={editor.width}
                  imageHeight={editor.height}
                  thumbnailUrl={rotateZoomThumbnailUrl}
                  onPreview={editor.previewRotateZoomLayer}
                  onCancel={() => {
                    editor.clearLayerTransformPreview();
                    setRotateZoomLayerId(null);
                  }}
                  onSubmit={(angle, panHorizontal, panVertical, zoom) => {
                    editor.rotateZoomLayer(angle, panHorizontal, panVertical, zoom);
                    setRotateZoomLayerId(null);
                  }}
                />
              ) : null;
            })()}
            {editor.effectBusy && !effectDialog && runningEffect && (
              <EffectProgressDialog effectName={EFFECT_BY_ID[runningEffect].name} progress={editor.effectProgress} onCancel={editor.cancelEffect} />
            )}
            {applicationError && (
              <ErrorReportDialog
                error={applicationError}
                onClose={() => setApplicationError(null)}
                onReportBug={() => {
                  window.open(WEB_BUG_REPORT_URL, '_blank', 'noopener,noreferrer');
                  setApplicationError(null);
                }}
              />
            )}
            {toast && <div className="toast" role="status">{toast}</div>}
            {isFullscreen && <button className="fullscreen-exit" type="button" onClick={() => void toggleFullscreen()}>Exit fullscreen</button>}
            {printPreview && (
              <>
                <style>{`@media print { @page { size: ${printPreview.settings.orientation}; margin: ${printPreview.settings.margin}mm; } }`}</style>
                <div
                  className={`print-surface print-scale-${printPreview.settings.scaleMode} ${printPreview.settings.center ? 'print-centered' : ''}`}
                  data-print-orientation={printPreview.settings.orientation}
                  data-print-scale={printPreview.settings.scaleMode === 'custom' ? printPreview.settings.scale : printPreview.settings.scaleMode}
                  data-print-margin={printPreview.settings.margin}
                  aria-hidden="true"
                >
                  <img
                    src={printPreview.dataUrl}
                    alt=""
                    style={printPreview.settings.scaleMode === 'fit' ? undefined : {
                      width: `${printPreview.width / 96 * (printPreview.settings.scaleMode === 'custom' ? printPreview.settings.scale / 100 : 1)}in`,
                      maxWidth: 'none',
                      maxHeight: 'none',
                    }}
                  />
                </div>
              </>
            )}
          </>
        </ErrorBoundary>
      )}
    </PrimaryDialogBoundary>
  );
}
