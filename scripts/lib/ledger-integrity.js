import { isDeepStrictEqual } from 'node:util'
import { isValidTracker } from '../../src/lib/tracker.js'

export function parsePublishedLedger(bytes) {
  let ledger
  try { ledger = JSON.parse(Buffer.from(bytes).toString('utf8')) } catch { throw new Error('The forecast ledger is not valid JSON') }
  if (!isValidTracker(ledger) || ledger.publication !== 'github-pages') throw new Error('The forecast ledger is not a valid published ledger')
  return ledger
}

// Results and the latest kick-off may legitimately change. The original
// forecast, input data, publication verification and history must not.
export function assertLedgerContinuity(previous, next) {
  if (!previous) return
  if (!isValidTracker(previous) || !isValidTracker(next)) throw new Error('Cannot compare invalid forecast ledgers')
  if (previous.startedAt !== next.startedAt || Date.parse(next.updatedAt) < Date.parse(previous.updatedAt)) {
    throw new Error('Forecast ledger start or update time regressed')
  }
  const current = new Map(next.records.map((record) => [record.id, record]))
  const immutable = ['season', 'league', 'home', 'away', 'originalKickoff', 'recordedAt', 'modelVersion', 'prediction']
  for (const before of previous.records) {
    const after = current.get(before.id)
    if (!after) throw new Error(`Forecast disappeared from the ledger: ${before.id}`)
    for (const key of immutable) {
      if (!isDeepStrictEqual(before[key], after[key])) throw new Error(`Frozen ${key} changed for forecast ${before.id}`)
    }
    if (before.verifiedAt && before.verifiedAt !== after.verifiedAt) throw new Error(`Publication verification changed for forecast ${before.id}`)
  }
}
