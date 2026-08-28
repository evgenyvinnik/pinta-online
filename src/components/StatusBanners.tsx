import { useTranslation } from 'react-i18next';
import { formatStorageAmount } from '../editor/workspacePersistence';
import { translateUi } from '../i18n';

interface StoragePressure {
  usage: number;
  quota: number;
  ratio: number;
}

export function StatusBanners({
  persistenceSuspended,
  persistenceSuspendedReason,
  storagePressure,
  persistHistory,
  onReload,
  onStopSavingHistory,
}: {
  persistenceSuspended: boolean;
  persistenceSuspendedReason: 'skipped-restore' | 'newer-workspace' | null;
  storagePressure: StoragePressure | null;
  persistHistory: boolean;
  onReload: () => void;
  onStopSavingHistory: () => void;
}) {
  useTranslation();
  return (
    <>
      {persistenceSuspended && (
        <div className="persistence-suspended-banner" role="status">
          {persistenceSuspendedReason === 'newer-workspace' ? (
            <>
              <strong>{translateUi('A newer version of Pinta Online saved this work.')}</strong>
              <span>{translateUi('Saving is paused so nothing is overwritten. Reload the page to pick up the update and get your images back.')}</span>
              <button type="button" className="native-dialog-button" onClick={onReload}>
                {translateUi('Reload')}
              </button>
            </>
          ) : (
            <>
              <strong>{translateUi('Started without your saved workspace.')}</strong>
              <span>{translateUi('Saving is paused so the stored work is not overwritten. Open or export what you need, then reload normally.')}</span>
            </>
          )}
        </div>
      )}
      {storagePressure && (
        <div className="persistence-suspended-banner storage-pressure-banner" role="status">
          <strong>{translateUi('Browser storage is nearly full.')}</strong>
          <span>
            {formatStorageAmount(storagePressure.usage)}
            {' '}{translateUi('of about')}{' '}
            {formatStorageAmount(storagePressure.quota)}{' '}
            {persistHistory
              ? translateUi('is in use. Saving undo history for every open image is what fills it fastest.')
              : translateUi('is in use. Close images you have already exported to free more space.')}
          </span>
          {persistHistory && (
            <button type="button" className="native-dialog-button" onClick={onStopSavingHistory}>
              {translateUi('Stop saving undo history')}
            </button>
          )}
        </div>
      )}
    </>
  );
}
