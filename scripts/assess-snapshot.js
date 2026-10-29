import { appendFile, readFile } from 'node:fs/promises'
import { assessSnapshot } from './lib/snapshot-health.js'

try {
  const [ledger, feed] = await Promise.all([
    readFile('public/data/track-record.json', 'utf8').then(JSON.parse),
    readFile('public/data/matchday.json', 'utf8').then(JSON.parse),
  ])
  const health = assessSnapshot(ledger, feed)
  if (!process.env.GITHUB_OUTPUT) throw new Error('GitHub Actions output is required')
  await appendFile(process.env.GITHUB_OUTPUT, `source_health=${health.healthy ? 'ok' : health.codes.join(',')}\n`)
  console.log(health.healthy ? 'Community snapshot health: OK.' : `Community snapshot needs attention: ${health.codes.join(', ')}.`)
} catch (error) {
  console.error(`Snapshot health check failed: ${error.message}`)
  process.exitCode = 1
}
