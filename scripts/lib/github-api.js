const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

export function validRepository(value) {
  return typeof value === 'string' && REPOSITORY_PATTERN.test(value) && value.split('/').every((part) => part !== '.' && part !== '..')
}

// Only the official API/upload origins receive the short-lived Actions token.
// fetchImpl is injectable for offline tests, not configurable from the workflow.
export function githubApi({ repository, token, fetchImpl = globalThis.fetch }) {
  if (!validRepository(repository)) throw new Error('Invalid GitHub repository')
  if (typeof token !== 'string' || !token) throw new Error('GitHub Actions token is required')
  const [owner, name] = repository.split('/').map(encodeURIComponent)
  const prefix = `/repos/${owner}/${name}`

  async function request(path, { method = 'GET', body, accept = 'application/vnd.github+json', upload = false, allow404 = false } = {}) {
    const url = new URL(`${prefix}${path}`, upload ? 'https://uploads.github.com' : 'https://api.github.com')
    const headers = { Accept: accept, Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' }
    if (body !== undefined) headers['Content-Type'] = upload ? 'application/json' : 'application/json; charset=utf-8'
    const response = await fetchImpl(url, { method, headers, body, signal: AbortSignal.timeout(30_000) })
    if (allow404 && response.status === 404) return null
    if (!response.ok) throw new Error(`GitHub ${method} ${path.split('?')[0]} failed with HTTP ${response.status}`)
    if (response.status === 204) return null
    if (accept === 'application/octet-stream') return Buffer.from(await response.arrayBuffer())
    return response.json()
  }

  async function list(path, maxPages = 100) {
    const all = []
    for (let page = 1; page <= maxPages; page += 1) {
      const separator = path.includes('?') ? '&' : '?'
      const batch = await request(`${path}${separator}per_page=100&page=${page}`)
      if (!Array.isArray(batch)) throw new Error('Unexpected paginated GitHub response')
      all.push(...batch)
      if (batch.length < 100) return all
    }
    throw new Error('GitHub pagination limit reached; refusing to assume the list is complete')
  }

  return { request, list }
}
