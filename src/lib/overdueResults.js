export const OVERDUE_HOURS = 48
export const OVERDUE_MS = OVERDUE_HOURS * 60 * 60 * 1000

// Only records still classified as pending qualify. Scored or excluded records
// have their own statuses in the archive, even if an old score was disputed.
// The timestamp is the last known *approximate* kick-off, not proof of play.
export function findOverdueResults(records, now = Date.now()) {
  if (!Array.isArray(records) || !Number.isFinite(now)) throw new Error('Cannot assess overdue results without a ledger and clock')
  return records.filter((record) => record?.result === null && record.excludedReason === null &&
      Number.isFinite(record.latestKickoff?.timestamp) && now - record.latestKickoff.timestamp >= OVERDUE_MS)
    .sort((a, b) => a.latestKickoff.timestamp - b.latestKickoff.timestamp || a.id.localeCompare(b.id))
}
