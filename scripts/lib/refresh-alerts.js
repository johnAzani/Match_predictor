import { validRepository } from './github-api.js'

export const ALERT_MARKER = '<!-- pitchside-refresh-monitor:v1 -->'
export const ALERT_TITLE = 'Forecast refresh or backup needs attention'
const SOURCE_MESSAGES = {
  'source-stale': 'The community source is stale or its update time is unknown.',
  'leagues-unavailable': 'One or more leagues are unavailable in the community snapshot.',
  'source-mismatch': 'The tracker and fixture snapshot disagree about the source update time.',
}

export function refreshProblems({ build, deploy, backup, sourceHealth }) {
  const problems = []
  if (build !== 'success') problems.push('The Pages build did not complete successfully.')
  if (deploy !== 'success' && build === 'success') problems.push('The Pages deployment did not complete successfully.')
  if (backup !== 'success' && deploy === 'success') problems.push('The confirmed public-ledger backup did not complete successfully.')
  if (build === 'success' && sourceHealth !== 'ok') {
    const codes = typeof sourceHealth === 'string' ? sourceHealth.split(',') : []
    const messages = [...new Set(codes.map((code) => SOURCE_MESSAGES[code]).filter(Boolean))]
    problems.push(...(messages.length ? messages : ['The community snapshot health could not be confirmed.']))
  }
  return problems
}

export async function reportRefreshHealth({ api, repository, runId, attempt, build, deploy, backup, sourceHealth }) {
  if (!validRepository(repository) || !/^\d+$/.test(String(runId)) || !/^\d+$/.test(String(attempt))) throw new Error('Invalid workflow identity')
  const url = `https://github.com/${repository}/actions/runs/${runId}/attempts/${attempt}`
  const problems = refreshProblems({ build, deploy, backup, sourceHealth })
  const issues = await api.list('/issues?state=open')
  const matching = issues.filter((issue) => !issue.pull_request && issue.title === ALERT_TITLE && issue.body?.includes(ALERT_MARKER) && issue.user?.login === 'github-actions[bot]')
  if (matching.length > 1) throw new Error('Multiple automated refresh issues are open; please resolve the duplicates manually')
  const issue = matching[0]
  if (issue && (!Number.isSafeInteger(issue.number) || issue.number <= 0)) throw new Error('Invalid refresh issue number')

  if (problems.length) {
    const details = `${problems.map((problem) => `- ${problem}`).join('\n')}\n\n[View the workflow run](${url}). The previously deployed site is retained when deployment fails. Do not reset or reconstruct the forecast history.\n\n<!-- pitchside-run:${runId}:${attempt} -->`
    if (issue) {
      await api.request(`/issues/${issue.number}/comments`, { method: 'POST', body: JSON.stringify({ body: `Another refresh needs attention:\n\n${details}` }) })
      return { status: 'updated', issue: issue.number, problems }
    }
    const created = await api.request('/issues', { method: 'POST', body: JSON.stringify({ title: ALERT_TITLE, body: `${ALERT_MARKER}\nThe automated forecast refresh or its backup needs review.\n\n${details}\n\nA later fully healthy run will close this issue automatically.` }) })
    if (!Number.isSafeInteger(created?.number) || created.number <= 0) throw new Error('GitHub did not confirm the refresh issue')
    return { status: 'created', issue: created.number, problems }
  }

  if (issue) {
    await api.request(`/issues/${issue.number}/comments`, { method: 'POST', body: JSON.stringify({ body: `The latest build, deployment, public-ledger backup and source-health check succeeded. [View the recovery run](${url}).` }) })
    await api.request(`/issues/${issue.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) })
    return { status: 'closed', issue: issue.number, problems }
  }
  return { status: 'healthy', issue: null, problems }
}
