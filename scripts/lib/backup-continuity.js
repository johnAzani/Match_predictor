import { assertLedgerContinuity } from './ledger-integrity.js'
import { BACKUP_TAG, latestManagedBackup } from './ledger-backups.js'

// Before publishing again, compare the restored public ledger with the most
// recent verified release backup. An older or damaged public copy must never
// silently erase forecasts that a confirmed backup still contains.
export async function checkBackupContinuity({ ledger, backupVersion, api }) {
  if (backupVersion !== undefined && backupVersion !== 1) throw new Error('Unknown backup marker on the published site')
  const release = await api.request(`/releases/tags/${BACKUP_TAG}`, { allow404: true })
  if (!release) {
    if (backupVersion === 1) throw new Error('The published site expects a managed backup, but the release is missing')
    return { status: 'bootstrap' }
  }
  if (!ledger) throw new Error('A confirmed backup exists but the published ledger is missing; refusing to start over')
  const backup = await latestManagedBackup(api, release)
  assertLedgerContinuity(backup.ledger, ledger)
  return { status: 'verified', name: backup.asset.name, count: backup.ledger.records.length }
}
