import { sendSuccessPing } from '../../watchdog/healthchecks.js'

// A push, manual refresh or rerun may make the site fresh, but must not hide
// a missed scheduled event. Only the first attempt can signal success.
export async function reportScheduledHeartbeat({ event, attempt, build, deploy, backup, notify, pingUrl, fetchImpl = globalThis.fetch }) {
  if (event !== 'schedule' || String(attempt) !== '1' || [build, deploy, backup, notify].some((result) => result !== 'success')) {
    return { ok: false, reason: 'not-a-successful-scheduled-run' }
  }
  if (!pingUrl) return { ok: true, reason: 'not-configured' }
  return sendSuccessPing(pingUrl, { fetchImpl })
}
