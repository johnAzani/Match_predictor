import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDataService } from '../server/data-service.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const destination = resolve(root, 'public/data/matchday.json')
const token = process.env.GITHUB_TOKEN

// Actions can use its short-lived, read-only token to avoid shared IP rate
// limits. It is sent only to GitHub's API and is never included in the output.
const fetchImpl = (url, options = {}) => {
  const headers = new Headers(options.headers)
  if (token && new URL(url).origin === 'https://api.github.com') headers.set('Authorization', `Bearer ${token}`)
  return fetch(url, { ...options, headers })
}

try {
  const data = await createDataService({ fetchImpl }).getMatchday()
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, JSON.stringify(data))
  console.log(`Static snapshot: ${data.fixtures.length} fixtures, ${data.source.availableLeagueCount} leagues, fetched ${data.source.fetchedAt}`)
} catch (error) {
  // A failed build leaves the previously deployed Pages site intact.
  console.error(`Could not generate the community snapshot: ${error.message}`)
  process.exitCode = 1
}
