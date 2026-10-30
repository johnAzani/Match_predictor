import { createHash } from 'node:crypto'
import { isValidTracker } from '../../src/lib/tracker.js'
import { findOverdueResults, OVERDUE_HOURS } from '../../src/lib/overdueResults.js'
import { validRepository } from './github-api.js'

export const OVERDUE_ALERT_MARKER = '<!-- pitchside-overdue-monitor:v1 -->'
export const OVERDUE_ALERT_TITLE = 'Overdue forecast results need attention'
const CLOCK_SKEW = 5 * 60 * 1000
const MAX_LEDGER_AGE = 36 * 60 * 60 * 1000

// The digest tracks identity and the last known kick-off only. Team names from
// the public feed never enter issue Markdown, and unchanged sets don't notify.
export function overdueFingerprint(records) {
  const entries = records.map((record) => [record.id, record.latestKickoff.timestamp])
    .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1])
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex')
}

function links(repository, runId, attempt) {
  const [owner, name] = repository.split('/')
  const path = name.toLowerCase() === `${owner.toLowerCase()}.github.io` ? '' : `${encodeURIComponent(name)}/`
  return {
    site: `https://${owner}.github.io/${path}#track-record`,
    run: `https://github.com/${repository}/actions/runs/${runId}/attempts/${attempt}`,
  }
}

function issueDetails(records, urls) {
  const oldest = new Date(records[0].latestKickoff.timestamp).toISOString()
  return `**${records.length} pending ${records.length === 1 ? 'forecast is' : 'forecasts are'} at least ${OVERDUE_HOURS} hours past the last known kick-off.**\n\nOldest last known kick-off: ${oldest} (approximate; the source uses fixed UTC+1).\n\n[Review the flagged fixtures on the site](${urls.site}) and compare the schedule/results with a reliable source. [View this workflow run](${urls.run}).\n\nA missing score does not establish that a match was played or postponed. The community source or schedule may be delayed. Do not invent results or modify frozen forecasts.`
}

function issueBody(records, urls, fingerprint) {
  return `${OVERDUE_ALERT_MARKER}\n<!-- pitchside-overdue-set:${fingerprint} -->\n${issueDetails(records, urls)}\n\nA later confirmed published ledger with no overdue pending entries will close this issue; that can also happen if a fixture is rescheduled or excluded. Checks only run after a successful deployment and backup, and scheduled runs may be delayed.`
}

// Call only with the same artifact that a successful backup job confirmed was
// served by Pages. Refuse invalid identities, clocks or ledgers before any API
// access, so an uncertain state can never silently resolve an existing alert.
export async function reportOverdueResults({ api, repository, runId, attempt, ledger, confirmedBackup, now = Date.now() }) {
  if (!validRepository(repository) || !/^\d+$/.test(String(runId)) || !/^\d+$/.test(String(attempt))) throw new Error('Invalid workflow identity')
  if (confirmedBackup !== true) throw new Error('The published ledger backup was not confirmed')
  if (!isValidTracker(ledger) || ledger.publication !== 'github-pages') throw new Error('Cannot monitor an invalid published ledger')
  if (!Number.isFinite(now) || Date.parse(ledger.updatedAt) > now + CLOCK_SKEW || Date.parse(ledger.sourceUpdatedAt) > now + CLOCK_SKEW) throw new Error('Cannot monitor with an invalid clock')
  if (now - Date.parse(ledger.updatedAt) > MAX_LEDGER_AGE) throw new Error('Cannot monitor with a stale published ledger')
  const records = findOverdueResults(ledger.records, now)
  const urls = links(repository, runId, attempt)
  const issues = await api.list('/issues?state=open')
  const matching = issues.filter((issue) => !issue.pull_request && issue.title === OVERDUE_ALERT_TITLE && issue.body?.includes(OVERDUE_ALERT_MARKER) && issue.user?.login === 'github-actions[bot]')
  if (matching.length > 1) throw new Error('Multiple automated overdue issues are open; please resolve the duplicates manually')
  const issue = matching[0]
  if (issue && (!Number.isSafeInteger(issue.number) || issue.number <= 0)) throw new Error('Invalid overdue issue number')

  if (!records.length) {
    if (!issue) return { status: 'healthy', issue: null, count: 0 }
    const body = `The latest confirmed published ledger has no pending forecasts past the ${OVERDUE_HOURS}-hour threshold. A result may have arrived, or a fixture may have been rescheduled or excluded. [Review the site](${urls.site}) · [View the workflow run](${urls.run}).`
    await api.request(`/issues/${issue.number}/comments`, { method: 'POST', body: JSON.stringify({ body }) })
    await api.request(`/issues/${issue.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) })
    return { status: 'closed', issue: issue.number, count: 0 }
  }

  const fingerprint = overdueFingerprint(records)
  const body = issueBody(records, urls, fingerprint)
  if (!issue) {
    const created = await api.request('/issues', { method: 'POST', body: JSON.stringify({ title: OVERDUE_ALERT_TITLE, body }) })
    if (!Number.isSafeInteger(created?.number) || created.number <= 0) throw new Error('GitHub did not confirm the overdue issue')
    return { status: 'created', issue: created.number, count: records.length }
  }
  if (issue.body.includes(`<!-- pitchside-overdue-set:${fingerprint} -->`)) return { status: 'unchanged', issue: issue.number, count: records.length }
  // Comment first so a failed notification is retried rather than silently lost.
  await api.request(`/issues/${issue.number}/comments`, { method: 'POST', body: JSON.stringify({ body: `The set of overdue forecasts changed.\n\n${issueDetails(records, urls)}` }) })
  await api.request(`/issues/${issue.number}`, { method: 'PATCH', body: JSON.stringify({ body }) })
  return { status: 'updated', issue: issue.number, count: records.length }
}
