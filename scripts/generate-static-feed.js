import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDataService } from '../server/data-service.js'
import { updateTracker } from '../server/tracker.js'
import { TRACKER_VERSION } from '../src/lib/tracker.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const destination = resolve(root, 'public/data/matchday.json')
const trackerPath = resolve(root, 'public/data/track-record.json')
const token = process.env.GITHUB_TOKEN

// Actions can use its short-lived, read-only token to avoid shared IP rate
// limits. It is sent only to GitHub's API and is never included in the output.
const fetchImpl = (url, options = {}) => {
  const headers = new Headers(options.headers)
  if (token && new URL(url).origin === 'https://api.github.com') headers.set('Authorization', `Bearer ${token}`)
  return fetch(url, { ...options, headers })
}

async function writeAtomically(path, data) {
  const temporary = `${path}.tmp`
  await writeFile(temporary, JSON.stringify(data))
  await rename(temporary, path)
}

try {
  const publication = process.env.TRACKER_PUBLICATION === 'github-pages' ? 'github-pages' : 'local-preview'
  if (publication === 'github-pages' && process.env.TRACKER_RESTORED !== '1') throw new Error('Published tracking history must be restored before building')
  let previous = null
  try { previous = JSON.parse(await readFile(trackerPath, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
  const input = await createDataService({ fetchImpl }).getTrackingInput()
  const tracker = updateTracker(previous, input, new Date(), publication)
  const data = { ...input.feed, trackerVersion: TRACKER_VERSION }
  await mkdir(dirname(destination), { recursive: true })
  await writeAtomically(trackerPath, tracker)
  await writeAtomically(destination, data)
  console.log(`Static snapshot: ${data.fixtures.length} fixtures, ${data.source.availableLeagueCount} leagues, fetched ${data.source.fetchedAt}`)
  console.log(`Forecast ledger: ${tracker.records.length} recorded, ${tracker.records.filter((record) => record.result && !record.excludedReason).length} settled (${publication}).`)
} catch (error) {
  // A failed build leaves the previously deployed Pages site intact.
  console.error(`Could not generate the community snapshot: ${error.message}`)
  process.exitCode = 1
}
