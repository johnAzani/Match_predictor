import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowDownWideNarrow, ArrowRight, ArrowUpRight, Bookmark, ChevronDown,
  Clock3, Crosshair, Menu, Search, Sparkles, X,
} from 'lucide-react'
import { leagues } from './data/fixtures.js'
import { hasPredictionData, predictMatch } from './lib/predictions.js'
import { useMatchdayFeed } from './lib/useMatchdayFeed.js'
import { Brand, Crest, TextLink } from './components/Shared.jsx'
import MatchCard from './components/MatchCard.jsx'
import { AnalysisDialog, MethodDialog } from './components/Dialogs.jsx'

const SAVED_KEY = 'pitchside-saved-fixtures-v1'
const PAGE_SIZE = 8

function readSavedMatches() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(SAVED_KEY) || '[]')
    return Array.isArray(stored) ? [...new Set(stored.filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 250))] : []
  } catch {
    return []
  }
}

function scrollTo(id) {
  document.getElementById(id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
}

function normalizeSearch(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
}

function formatUpdate(iso) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return null
  return `${new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }).format(new Date(iso))} UTC`
}

function Header({ savedCount, savedOnly, onToggleSavedView, onOpenMethod, feed }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = () => setMenuOpen(false)
  const feedLabel = feed.status === 'loading' ? 'LOADING DATA' : feed.status === 'demo' ? 'DEMO MODE' : feed.source.stale ? 'DATA DELAYED' : 'COMMUNITY DATA'
  return (
    <header className="site-header" id="top">
      <div className="header-inner page-shell">
        <Brand />
        <nav id="main-navigation" className={`main-nav${menuOpen ? ' is-open' : ''}`} aria-label="Main navigation">
          <a className="main-nav__active" href="#predictions" onClick={closeMenu}>Predictions</a>
          <a href="#leagues" onClick={closeMenu}>Leagues</a>
          <button type="button" onClick={() => { closeMenu(); onOpenMethod() }}>How it works</button>
        </nav>
        <div className="header-actions">
          <button type="button" className="demo-pill" onClick={onOpenMethod} title="Learn about the data and model"><span /> {feedLabel}</button>
          <button type="button" className={`saved-nav${savedOnly ? ' is-active' : ''}`} onClick={() => { closeMenu(); onToggleSavedView() }} aria-label={`Saved ${savedCount} ${savedCount === 1 ? 'match' : 'matches'}`} aria-pressed={savedOnly}>
            <Bookmark size={16} fill={savedOnly ? 'currentColor' : 'none'} aria-hidden="true" />
            <span>Saved{' '}</span><b>{savedCount}</b>
          </button>
          <button className="mobile-menu-button" type="button" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-controls="main-navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>
            {menuOpen ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
      </div>
    </header>
  )
}

function SourceNotice({ feed, onOpenMethod }) {
  if (feed.status === 'loading') return <div className="demo-notice" role="status"><div><span className="demo-notice__icon">i</span><strong>LOADING COMMUNITY DATA</strong><span className="demo-notice__divider" /><span>Getting the latest available fixtures and results.</span></div></div>
  if (feed.status === 'demo') return <div className="demo-notice" role="status"><div><span className="demo-notice__icon">i</span><strong>DEMO MODE</strong><span className="demo-notice__divider" /><span>Community data is unavailable. Showing illustrative sample matches.</span></div><button type="button" className="text-link notice-retry" onClick={feed.retry} disabled={feed.refreshing}>{feed.refreshing ? 'Retrying…' : 'Try again'} <ArrowUpRight size={15} /></button></div>
  const update = formatUpdate(feed.source.sourceUpdatedAt)
  const unavailable = feed.source.unavailableLeagues?.length ? ` · Unavailable: ${feed.source.unavailableLeagues.join(', ')}` : ''
  return (
    <div className="demo-notice" role="status">
      <div><span className="demo-notice__icon">i</span><strong>{feed.source.stale ? 'DATA MAY BE STALE · NON-COMMERCIAL' : 'COMMUNITY DATA · NON-COMMERCIAL'}</strong><span className="demo-notice__divider" /><span>{update ? `Source updated ${update}` : 'Update time unavailable'} · Daily, not live · Times approx. UTC+1{unavailable}</span></div>
      {feed.source.refreshFailed ? <button type="button" className="text-link notice-retry" onClick={feed.retry} disabled={feed.refreshing}>{feed.refreshing ? 'Retrying…' : 'Retry feed'} <ArrowUpRight size={15} /></button> : <button type="button" className="text-link" onClick={onOpenMethod}>About the data <ArrowUpRight size={15} /></button>}
    </div>
  )
}

function Hero({ onOpenMethod, feed }) {
  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__content">
          <div className="hero__eyebrow"><span>✳</span> YOUR MATCHDAY, MADE SMARTER</div>
          <h1 id="hero-title">FOOTBALL, WITH<br />A LITTLE MORE <em>INSIGHT.</em></h1>
          <p>For the love of the game and the numbers behind it.<br className="desktop-break" /> Your matchday predictions start right here.</p>
          <div className="hero__actions">
            <button type="button" className="button button--lime" onClick={() => scrollTo('predictions')}>Explore predictions <ArrowUpRight size={17} strokeWidth={2} /></button>
            <button type="button" className="hero__secondary" onClick={onOpenMethod}><span><ArrowRight size={14} /></span> How it works</button>
          </div>
        </div>
        <div className="hero__edition" aria-hidden="true"><span>THE MATCHDAY EDIT</span><strong>90<span> / </span>MIN</strong><i>FOR THE FANS, ALWAYS.</i></div>
        <div className="hero__bottom-note" aria-hidden="true"><span>✳</span> THE BEAUTIFUL GAME, IN NUMBERS</div>
      </section>
      <SourceNotice feed={feed} onOpenMethod={onOpenMethod} />
    </>
  )
}

function Spotlight({ item, onOpen, usesSelection, isCommunity }) {
  const { fixture, prediction } = item
  const pick = prediction.lean.key === 'tie' ? 'No clear lean' : prediction.lean.team ? `${prediction.lean.team.shortName} win` : 'Draw'
  return (
    <div className="spotlight">
      <div className="spotlight__top"><span><Sparkles size={14} /> PITCHSIDE SPOTLIGHT</span><span>{isCommunity ? 'MODEL' : 'DEMO'} / 01</span></div>
      <div className="spotlight__copy">
        <span className="spotlight__kicker">{prediction.lean.key === 'tie' ? 'A CLOSE CALL' : 'THE STRONGEST MODEL LEAN'}</span>
        <h3>ONE TO<br /><em>WATCH.</em></h3>
        <p>{prediction.lean.key === 'tie' ? 'The top outcomes are level after rounding.' : `The biggest signal ${usesSelection ? 'in this selection' : isCommunity ? 'in the next 14 days' : 'in our sample matchday'}.`}</p>
      </div>
      <div className="spotlight__match">
        <div className="spotlight__crests"><Crest team={fixture.home} /><Crest team={fixture.away} /></div>
        <div><strong>{fixture.home.shortName} <span>vs</span> {fixture.away.shortName}</strong><small>{fixture.league.name} · {fixture.day} {fixture.time}</small></div>
      </div>
      <div className="spotlight__prediction">
        <div><span>{prediction.lean.key === 'tie' ? 'TOP OUTCOMES' : 'MODEL LEANS'}</span><strong>{pick}</strong></div>
        <b>{prediction.lean.percent}<small>%</small></b>
      </div>
      <button type="button" className="spotlight__link" onClick={() => onOpen(fixture)}>See the breakdown <ArrowUpRight size={16} /></button>
    </div>
  )
}

function Sidebar({ spotlight, onOpen, onOpenMethod, usesSelection, feed }) {
  const report = feed.backtest
  return (
    <aside className="sidebar" aria-label="Matchday insights">
      {spotlight && <Spotlight item={spotlight} onOpen={onOpen} usesSelection={usesSelection} isCommunity={feed.status === 'community'} />}
      {feed.status === 'community' && report?.evaluated > 0 ? (
        <div className="explainer-card report-card">
          <div className="explainer-card__heading"><span className="mini-icon"><Crosshair size={16} /></span><span>MODEL CHECK / WALK-FORWARD</span></div>
          <div className="report-card__metric"><strong>{(report.accuracy * 100).toFixed(1)}<small>%</small></strong><span>OUTCOMES<br />CORRECT</span></div>
          <p>Across {report.evaluated.toLocaleString()} past matches. Always picking the home team: <strong>{(report.baselineAccuracy * 100).toFixed(1)}%</strong>.</p>
          <p className="report-card__caveat">Historical results, not a guarantee of future performance.</p>
          <TextLink onClick={onOpenMethod}>See the backtest</TextLink>
        </div>
      ) : (
        <div className="explainer-card">
          <div className="explainer-card__heading"><span className="mini-icon"><Crosshair size={16} /></span><span>THE PITCHSIDE APPROACH</span></div>
          <h3>THE DETAILS<br />MAKE THE GAME<span>.</span></h3>
          <p>Form, goals and home advantage. A simple model, with nothing hidden.</p>
          <TextLink onClick={onOpenMethod}>How predictions work</TextLink>
        </div>
      )}
    </aside>
  )
}

function FixtureFilters({ league, setLeague, query, setQuery, fixtureCount, onAllMatches }) {
  return (
    <div className="filter-bar" id="leagues">
      <div className="league-filters" role="group" aria-label="Filter by league">
        <button type="button" className={league === 'all' ? 'is-selected' : ''} aria-pressed={league === 'all'} onClick={onAllMatches}>All matches <span>{fixtureCount}</span></button>
        {leagues.map((item) => <button type="button" className={league === item.id ? 'is-selected' : ''} aria-pressed={league === item.id} key={item.id} onClick={() => setLeague(item.id)}>{item.name}</button>)}
      </div>
      <label className="search-field">
        <Search size={17} aria-hidden="true" />
        <span className="sr-only">Search teams or leagues</span>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search a team..." />
        <span className="search-shortcut" aria-hidden="true">⌕</span>
      </label>
    </div>
  )
}

function EmptyState({ savedOnly, query, league, isCommunity, onReset }) {
  const noScheduled = isCommunity && !savedOnly && !query && league === 'all'
  return (
    <div className="empty-state">
      <span className="empty-state__icon">{savedOnly ? <Bookmark size={23} /> : <Search size={23} />}</span>
      <h3>{savedOnly && !query ? 'NO SAVED MATCHES HERE YET.' : noScheduled ? 'NO UPCOMING MATCHES.' : 'NO MATCHES FOUND.'}</h3>
      <p>{savedOnly && !query ? 'Save a match with the bookmark icon. Saved matches appear here while they are in the current fixture window.' : noScheduled ? 'The community feed has no matches in the next 14 days. Check back after the next update.' : 'Try another team or reset your filters to see the full matchday.'}</p>
      {!noScheduled && <button type="button" className="button button--outline" onClick={onReset}>View all matches <ArrowRight size={16} /></button>}
    </div>
  )
}

function HowItWorks({ onOpenMethod }) {
  return (
    <section className="how-section" aria-labelledby="how-title">
      <div className="how-section__intro"><div className="section-kicker"><span /> THE PITCHSIDE PLAYBOOK <i>/</i> 02</div><h2 id="how-title">A LITTLE CONTEXT.<br /><em>A LOT MORE FOOTBALL.</em></h2><p>Because the best conversations start with a little perspective.</p><TextLink onClick={onOpenMethod}>Get to know the model</TextLink></div>
      <div className="how-step"><span>01 <i>↗</i></span><div className="how-step__icon"><Sparkles size={20} /></div><h3>FORM MATTERS</h3><p>Recent results give the model a little context about each side.</p></div>
      <div className="how-step"><span>02 <i>↗</i></span><div className="how-step__icon"><Crosshair size={20} /></div><h3>GOALS TELL A STORY</h3><p>Scoring and conceding rates help shape the possible outcomes.</p></div>
      <div className="how-step"><span>03 <i>↗</i></span><div className="how-step__icon"><Clock3 size={20} /></div><h3>EVERY ANGLE</h3><p>See the home, draw and away picture in one easy view.</p></div>
    </section>
  )
}

function Footer({ onOpenMethod, isCommunity }) {
  return (
    <footer className="site-footer">
      <div className="footer-inner page-shell">
        <div><Brand footer /><p>For the love of football and a little more insight.</p></div>
        <div className="footer-note"><span>MADE FOR THE FANS. BUILT FOR THE GAME.</span><p>{isCommunity ? <>Data: <a href="https://github.com/oladeeayo/open-matchday" target="_blank" rel="noreferrer">open-matchday</a> and <a href="https://github.com/openfootball/football.json" target="_blank" rel="noreferrer">openfootball</a>. Community data is for non-commercial use; provider terms apply. Predictions are not betting advice.</> : 'Demo fixtures and statistics are illustrative. Predictions are not guarantees or betting advice.'}</p></div>
        <div className="footer-links"><a href="#predictions">Predictions</a><button type="button" onClick={onOpenMethod}>How it works</button><a href="#top">Back to top ↑</a></div>
      </div>
      <div className="footer-bottom page-shell"><span>© PITCHSIDE — THE MATCHDAY EDIT</span><span>THE BEAUTIFUL GAME, IN NUMBERS <span>✳</span></span></div>
    </footer>
  )
}

export default function App() {
  const feed = useMatchdayFeed()
  const [saved, setSaved] = useState(readSavedMatches)
  const [savedOnly, setSavedOnly] = useState(false)
  const [league, setLeague] = useState('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('kickoff')
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE)
  const [modal, setModal] = useState(null)

  const allMatches = useMemo(() => feed.fixtures.map((fixture) => ({ fixture, prediction: hasPredictionData(fixture) ? predictMatch(fixture) : null })), [feed.fixtures])
  const savedCount = useMemo(() => allMatches.filter(({ fixture }) => saved.includes(fixture.id)).length, [allMatches, saved])
  const visibleMatches = useMemo(() => {
    const search = normalizeSearch(query.trim())
    const filtered = allMatches.filter(({ fixture }) => {
      const matchesLeague = league === 'all' || fixture.league.id === league
      const matchesSaved = !savedOnly || saved.includes(fixture.id)
      const matchesQuery = !search || normalizeSearch(`${fixture.home.name} ${fixture.home.shortName} ${fixture.away.name} ${fixture.away.shortName} ${fixture.league.name}`).includes(search)
      return matchesLeague && matchesSaved && matchesQuery
    })
    if (sort === 'confidence') filtered.sort((a, b) => (b.prediction?.lean.percent ?? -1) - (a.prediction?.lean.percent ?? -1))
    return filtered
  }, [allMatches, league, query, saved, savedOnly, sort])
  const spotlight = useMemo(() => {
    const candidates = (visibleMatches.length ? visibleMatches : allMatches).filter((match) => match.prediction)
    return candidates.length ? candidates.reduce((best, match) => match.prediction.lean.percent > best.prediction.lean.percent ? match : best) : null
  }, [allMatches, visibleMatches])
  const shownMatches = visibleMatches.slice(0, visibleLimit)
  const isCommunity = feed.status === 'community'

  useEffect(() => { setVisibleLimit(PAGE_SIZE) }, [league, query, savedOnly, sort, feed.status])
  useEffect(() => {
    try { window.localStorage.setItem(SAVED_KEY, JSON.stringify(saved)) } catch { /* Storage may be unavailable in private browsing. */ }
  }, [saved])

  const openMethod = useCallback(() => setModal({ type: 'method' }), [])
  const openAnalysis = useCallback((fixture) => setModal({ type: 'analysis', fixture }), [])
  const closeModal = useCallback(() => setModal(null), [])

  function toggleSaved(id) {
    setSaved((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  function toggleSavedView() {
    if (!savedOnly) { setLeague('all'); setQuery('') }
    setSavedOnly((value) => !value)
    window.requestAnimationFrame(() => scrollTo('predictions'))
  }

  function resetFilters() {
    setLeague('all'); setQuery(''); setSavedOnly(false); setSort('kickoff')
  }

  return (
    <>
      <Header savedCount={savedCount} savedOnly={savedOnly} onToggleSavedView={toggleSavedView} onOpenMethod={openMethod} feed={feed} />
      <main className="page-shell">
        <Hero onOpenMethod={openMethod} feed={feed} />
        <section className="predictions-section" id="predictions" aria-labelledby="predictions-title">
          <div className="section-heading">
            <div><div className="section-kicker"><span /> THE MATCH CENTRE <i>/</i> 01</div><h2 id="predictions-title">THE MATCHDAY LINEUP<span aria-hidden="true">.</span></h2><p>{isCommunity ? 'Upcoming community fixtures and the numbers behind each match.' : 'Good games. Better insight. Here’s what the numbers say.'}</p></div>
            <div className="matchday-counts"><div><strong>{feed.status === 'loading' ? '—' : String(feed.fixtures.length).padStart(2, '0')}</strong><span>{isCommunity ? <>NEXT 14<br />DAYS</> : <>DEMO<br />MATCHES</>}</span></div><i /><div><strong>{isCommunity ? String(feed.source.availableLeagueCount).padStart(2, '0') : '04'}</strong><span>TOP<br />LEAGUES</span></div></div>
          </div>
          <FixtureFilters league={league} setLeague={setLeague} query={query} setQuery={setQuery} fixtureCount={feed.fixtures.length} onAllMatches={() => { setLeague('all'); setSavedOnly(false) }} />
          <div className="results-bar">
            <div><span className="results-indicator" /> {savedOnly ? 'SAVED MATCHES' : 'ALL PREDICTIONS'} <i>/</i> <span aria-live="polite" aria-atomic="true">{visibleMatches.length > PAGE_SIZE ? `${shownMatches.length} OF ` : ''}{String(visibleMatches.length).padStart(2, '0')} {visibleMatches.length === 1 ? 'MATCH' : 'MATCHES'}</span>{savedOnly && <button type="button" className="clear-saved" onClick={() => setSavedOnly(false)}>Clear saved filter <X size={12} /></button>}</div>
            <label className="sort-control"><ArrowDownWideNarrow size={15} aria-hidden="true" /><span>Sort by:</span><select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort matches"><option value="kickoff">Kick-off</option><option value="confidence">Highest probability</option></select><ChevronDown size={13} aria-hidden="true" /></label>
          </div>
          <div className="content-layout">
            {feed.status === 'loading' ? <div className="empty-state" role="status"><span className="empty-state__icon"><Clock3 size={23} /></span><h3>GETTING THE MATCHDAY READY.</h3><p>Loading the latest available fixtures and historical results.</p></div> : visibleMatches.length ? <div className="match-list"><div className="match-grid">{shownMatches.map(({ fixture, prediction }) => <MatchCard key={fixture.id} fixture={fixture} prediction={prediction} saved={saved.includes(fixture.id)} onToggleSaved={toggleSaved} onOpen={openAnalysis} />)}</div>{shownMatches.length < visibleMatches.length && <button type="button" className="button button--outline show-more" onClick={() => setVisibleLimit((current) => current + PAGE_SIZE)}>Show more matches <ArrowRight size={16} /></button>}</div> : <EmptyState savedOnly={savedOnly} query={query} league={league} isCommunity={isCommunity} onReset={resetFilters} />}
            <Sidebar spotlight={spotlight} onOpen={openAnalysis} onOpenMethod={openMethod} usesSelection={visibleMatches.length > 0 && (league !== 'all' || query.trim() !== '' || savedOnly)} feed={feed} />
          </div>
          <div className="end-of-line"><span>✳</span> THAT'S THE MATCHDAY LINEUP <i /> <button type="button" onClick={() => scrollTo('top')}>BACK TO TOP ↑</button></div>
        </section>
        <HowItWorks onOpenMethod={openMethod} />
      </main>
      <Footer onOpenMethod={openMethod} isCommunity={isCommunity} />
      {modal?.type === 'analysis' && <AnalysisDialog fixture={modal.fixture} prediction={hasPredictionData(modal.fixture) ? predictMatch(modal.fixture) : null} onClose={closeModal} isCommunity={isCommunity} />}
      {modal?.type === 'method' && <MethodDialog onClose={closeModal} isCommunity={isCommunity} report={feed.backtest} source={feed.source} />}
    </>
  )
}
