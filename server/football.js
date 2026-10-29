import { leagues } from '../src/data/fixtures.js'
import { predictMatch } from '../src/lib/predictions.js'

export const MIN_GAMES = 3
export const FORM_GAMES = 5
export const LOOKBACK_GAMES = 10
export const WINDOW_DAYS = 14

export const competitions = [
  { ...leagues[0], directory: 'ENG_1_premier-league', historicalFile: 'en.1.json' },
  { ...leagues[1], directory: 'ESP_1_la-liga', historicalFile: 'es.1.json' },
  { ...leagues[2], directory: 'GER_1_bundesliga', historicalFile: 'de.1.json' },
  { ...leagues[3], directory: 'ITA_1_serie-a', historicalFile: 'it.1.json' },
]

const knownTeams = {
  'arsenal': ['Arsenal', 'arsenal.svg'],
  'chelsea': ['Chelsea', 'chelsea.svg'],
  'man city': ['Man City', 'manchester-city.svg'],
  'man utd': ['Man United', 'manchester-united.svg'],
  'liverpool': ['Liverpool', 'liverpool-fc.svg'],
  'spurs': ['Tottenham', 'tottenham.svg'],
  'nottm forest': ["Nott'm Forest", 'nottingham-forest.svg'],
  'real madrid': ['Real Madrid', 'real-madrid.svg'],
  'fc barcelona': ['Barcelona', 'barcelona.svg'],
  'atletico de madrid': ['Atlético', 'atletico-madrid.svg'],
  'real sociedad': ['Sociedad', 'real-sociedad.svg'],
  'rcd espanyol de barcelona': ['Espanyol', 'espanyol.svg'],
  'deportivo alaves': ['Alavés', 'alaves.svg'],
  'r racing club': ['Racing', null],
  'rc deportivo': ['Deportivo', null],
  'villarreal cf': ['Villarreal', 'villarreal.svg'],
  'ca osasuna': ['Osasuna', 'osasuna.svg'],
  'fc bayern munchen': ['Bayern', 'bayern-munich.svg'],
  'borussia dortmund': ['Dortmund', 'borussia-dortmund.svg'],
  'bayer 04 leverkusen': ['Leverkusen', 'bayer-leverkusen.svg'],
  'rb leipzig': ['Leipzig', 'rb-leipzig.svg'],
  '1 fsv mainz 05': ['Mainz', 'mainz.svg'],
  '1 fc union berlin': ['Union Berlin', null],
  '1 fc koln': ['Köln', null],
  'sv 07 elversberg': ['Elversberg', 'elversberg.svg'],
  'sv werder bremen': ['Werder Bremen', 'werder-bremen.svg'],
  'tsg hoffenheim': ['Hoffenheim', 'hoffenheim.svg'],
  'borussia monchengladbach': ["M'gladbach", 'monchengladbach.svg'],
  'eintracht frankfurt': ['Frankfurt', null],
  'fc schalke 04': ['Schalke', 'schalke.svg'],
  'sc paderborn 07': ['Paderborn', 'paderborn.svg'],
  'internazionale': ['Inter', 'inter.svg'],
  'juventus': ['Juventus', 'juventus.svg'],
  'milan': ['AC Milan', 'milan.svg'],
  'napoli': ['Napoli', 'napoli.svg'],
  'frosinone': ['Frosinone', 'frosinone.svg'],
  'lecce': ['Lecce', 'lecce.svg'],
  'fiorentina': ['Fiorentina', 'fiorentina.svg'],
  'atalanta': ['Atalanta', 'atalanta.svg'],
  'bologna': ['Bologna', 'bologna.svg'],
  'monza': ['Monza', 'monza.svg'],
  'udinese': ['Udinese', 'udinese.svg'],
  'roma': ['Roma', 'roma.svg'],
  'lazio': ['Lazio', 'lazio.svg'],
  'como': ['Como', 'como.svg'],
  'venezia': ['Venezia', 'venezia.svg'],
  'vfb stuttgart': ['Stuttgart', 'stuttgart.svg'],
  'fc augsburg': ['Augsburg', 'augsburg.svg'],
  'sc freiburg': ['Freiburg', 'freiburg.svg'],
  'levante ud': ['Levante', 'levante.svg'],
  'celta': ['Celta', 'celta.svg'],
  'real betis': ['Real Betis', 'real-betis.svg'],
  'bournemouth': ['Bournemouth', 'bournemouth.svg'],
  'leeds': ['Leeds', 'leeds.svg'],
  'brighton': ['Brighton', 'brighton.svg'],
  'brentford': ['Brentford', 'brentford.svg'],
  'coventry': ['Coventry', 'coventry.svg'],
  'sunderland': ['Sunderland', 'sunderland.svg'],
  'hull': ['Hull', 'hull.svg'],
  'ipswich': ['Ipswich', 'ipswich.svg'],
  'crystal palace': ['Crystal Palace', 'crystal-palace.svg'],
  'newcastle': ['Newcastle', 'newcastle.svg'],
  'everton': ['Everton', 'everton.svg'],
  'aston villa': ['Aston Villa', 'aston-villa.svg'],
  'fulham': ['Fulham', 'fulham.svg'],
}

// Conservative normalization only. If a source changes a club's spelling, we
// prefer an unavailable prediction to guessing that two different clubs match.
export function teamKey(name) {
  return String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}

function teamIdentity(name) {
  const key = teamKey(name)
  const [shortName, crest] = knownTeams[key] || [name, null]
  return { name, shortName, crest }
}

function validDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return false
  const parsed = new Date(`${date}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
}

function score(value) {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 && number <= 50 ? number : null
}

export function normalizeCommunityResults(rows) {
  return uniqueResults(rows.map((row) => ({
    date: row.date, home: row.home?.trim(), away: row.away?.trim(),
    homeGoals: score(row.ft_home), awayGoals: score(row.ft_away),
  })).filter(validResult))
}

export function normalizeHistoricalResults(document) {
  if (!Array.isArray(document?.matches)) throw new Error('Unexpected historical data format')
  return uniqueResults(document.matches.map((match) => {
    const result = Array.isArray(match.score) ? match.score : match.score?.ft
    return { date: match.date, home: match.team1?.trim(), away: match.team2?.trim(), homeGoals: score(result?.[0]), awayGoals: score(result?.[1]) }
  }).filter(validResult))
}

// Conflicting duplicate rows are excluded rather than choosing an arbitrary score.
function uniqueResults(results) {
  const unique = new Map()
  for (const result of results) {
    const key = `${result.date}|${teamKey(result.home)}|${teamKey(result.away)}`
    if (!unique.has(key)) unique.set(key, result)
    else {
      const previous = unique.get(key)
      if (!previous || previous.homeGoals !== result.homeGoals || previous.awayGoals !== result.awayGoals) unique.set(key, null)
    }
  }
  return [...unique.values()].filter(Boolean)
}

function validResult(result) {
  return validDate(result.date) && Boolean(result.home && result.away) && teamKey(result.home) !== teamKey(result.away)
    && result.homeGoals !== null && result.awayGoals !== null
}

function addResult(history, result) {
  const homeKey = teamKey(result.home)
  const awayKey = teamKey(result.away)
  if (!history.has(homeKey)) history.set(homeKey, [])
  if (!history.has(awayKey)) history.set(awayKey, [])
  history.get(homeKey).push({ scored: result.homeGoals, conceded: result.awayGoals })
  history.get(awayKey).push({ scored: result.awayGoals, conceded: result.homeGoals })
}

function teamFromHistory(name, history) {
  const records = history.get(teamKey(name)) || []
  const recent = records.slice(-LOOKBACK_GAMES)
  const form = records.slice(-FORM_GAMES).map(({ scored, conceded }) => scored > conceded ? 'W' : scored === conceded ? 'D' : 'L')
  return {
    ...teamIdentity(name),
    sampleSize: recent.length,
    goalsFor: recent.length ? recent.reduce((sum, item) => sum + item.scored, 0) / recent.length : null,
    goalsAgainst: recent.length ? recent.reduce((sum, item) => sum + item.conceded, 0) / recent.length : null,
    form,
  }
}

function groupByDate(results, beforeDate) {
  const grouped = new Map()
  for (const result of results) {
    if (result.date >= beforeDate) continue
    if (!grouped.has(result.date)) grouped.set(result.date, [])
    grouped.get(result.date).push(result)
  }
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))
}

function historyBefore(results, beforeDate) {
  const history = new Map()
  for (const [, matches] of groupByDate(results, beforeDate)) {
    matches.forEach((result) => addResult(history, result))
  }
  return history
}

// Each season and competition is evaluated independently. All games on a date
// are scored before ANY results from that date enter the history, preventing
// same-day look-ahead even when the source does not provide reliable kickoffs.
export function backtest(datasets, today) {
  let evaluated = 0
  let correct = 0
  let baselineCorrect = 0
  let logLoss = 0
  let brier = 0
  let completed = 0
  let firstDate = null
  let lastDate = null
  const evaluatedSeasons = new Set()
  const byLeague = new Map()

  for (const dataset of datasets) {
    const history = new Map()
    for (const [date, matches] of groupByDate(dataset.results, today)) {
      for (const result of matches) {
        completed += 1
        const home = teamFromHistory(result.home, history)
        const away = teamFromHistory(result.away, history)
        if (home.sampleSize < MIN_GAMES || away.sampleSize < MIN_GAMES) continue
        const prediction = predictMatch({ home, away })
        const probabilities = [prediction.probabilitiesExact.home, prediction.probabilitiesExact.draw, prediction.probabilitiesExact.away]
        const actual = result.homeGoals > result.awayGoals ? 0 : result.homeGoals === result.awayGoals ? 1 : 2
        const predicted = probabilities.indexOf(Math.max(...probabilities))
        evaluated += 1
        correct += Number(predicted === actual)
        baselineCorrect += Number(actual === 0)
        logLoss -= Math.log(Math.max(probabilities[actual], 1e-15))
        brier += probabilities.reduce((sum, probability, index) => sum + (probability - Number(index === actual)) ** 2, 0)
        firstDate = !firstDate || date < firstDate ? date : firstDate
        lastDate = !lastDate || date > lastDate ? date : lastDate
        evaluatedSeasons.add(dataset.season)
        const league = byLeague.get(dataset.league.id) || { id: dataset.league.id, name: dataset.league.name, evaluated: 0, correct: 0 }
        league.evaluated += 1
        league.correct += Number(predicted === actual)
        byLeague.set(dataset.league.id, league)
      }
      matches.forEach((result) => addResult(history, result))
    }
  }

  return {
    evaluated, completed, skipped: completed - evaluated, correct, baselineCorrect,
    accuracy: evaluated ? correct / evaluated : null,
    baselineAccuracy: evaluated ? baselineCorrect / evaluated : null,
    logLoss: evaluated ? logLoss / evaluated : null,
    brier: evaluated ? brier / evaluated : null,
    firstDate, lastDate, seasons: [...evaluatedSeasons].sort(),
    byLeague: [...byLeague.values()],
  }
}

function dateLabel(date) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${date}T12:00:00Z`)).replace(',', '').toUpperCase()
}

function kickoff(date, time) {
  if (!validDate(date)) return null
  const safeTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(time || '') ? time : '23:59'
  return Date.parse(`${date}T${safeTime}:00+01:00`)
}

export function buildUpcomingFixtures(datasets, now = new Date(), days = WINDOW_DAYS) {
  const today = now.toISOString().slice(0, 10)
  const end = now.getTime() + days * 24 * 60 * 60 * 1000
  const matches = []
  for (const dataset of datasets) {
    const history = historyBefore(dataset.results, today)
    const league = { id: dataset.league.id, name: dataset.league.name, country: dataset.league.country }
    for (const row of dataset.fixtures) {
      const homeName = row.home?.trim()
      const awayName = row.away?.trim()
      const timestamp = kickoff(row.date, row.time)
      if (!homeName || !awayName || teamKey(homeName) === teamKey(awayName) || timestamp === null || !Number.isFinite(timestamp)) continue
      if (timestamp < now.getTime() || timestamp > end) continue
      const home = teamFromHistory(homeName, history)
      const away = teamFromHistory(awayName, history)
      const hasEnoughData = home.sampleSize >= MIN_GAMES && away.sampleSize >= MIN_GAMES
      matches.push({
        // Stable across reschedules within the same league season.
        id: `community-${dataset.season}-${league.id}-${teamKey(homeName).replace(/ /g, '-')}-${teamKey(awayName).replace(/ /g, '-')}`,
        league, day: dateLabel(row.date), time: /^([01]\d|2[0-3]):[0-5]\d$/.test(row.time || '') ? row.time : 'TBC',
        date: row.date, kickoffTimestamp: timestamp, home, away, hasEnoughData,
      })
    }
  }
  const unique = new Map()
  for (const match of matches) {
    if (!unique.has(match.id)) unique.set(match.id, match)
    else {
      const previous = unique.get(match.id)
      if (!previous || previous.kickoffTimestamp !== match.kickoffTimestamp) unique.set(match.id, null)
    }
  }
  return [...unique.values()].filter(Boolean).sort((a, b) => a.kickoffTimestamp - b.kickoffTimestamp || a.id.localeCompare(b.id))
}
