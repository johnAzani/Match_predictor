import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, CalendarDays, Download, ShieldCheck, Wallet } from 'lucide-react'
import {
  assessDailyData, assessSavedPick, calculateWager, canRecordBet, captureDailyPick, chooseDailyPick,
  DAILY_PICKS_STORAGE_KEY, estimatedBetResult, isValidDailyPick, loadDailyStore, mergeDailyStores,
  nigeriaDay, pickName, saveDailyStore, summarizeDailyPicks,
} from '../lib/dailyPicks.js'

function browserStorage() {
  try { return window.localStorage } catch { return null }
}

function money(kobo, signed = false) {
  const amount = (Math.abs(kobo) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${kobo < 0 ? '−' : signed && kobo > 0 ? '+' : ''}₦${amount}`
}

function dayLabel(day) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`))
}

function kickoffLabel(value) {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Lagos' }).format(new Date(value))
}

function statusLabel(assessment, pick, now) {
  if (assessment.state === 'correct') return 'Model pick correct'
  if (assessment.state === 'incorrect') return 'Model pick incorrect'
  if (assessment.state === 'review') return 'Needs result review'
  if (assessment.state === 'loading') return 'Checking result'
  if (assessment.state === 'unavailable') return 'Result status unavailable'
  if (assessment.scheduleChanged) return 'Schedule changed · needs review'
  return now < pick.selectedKickoff ? 'Awaiting kick-off' : 'Awaiting reported result'
}

function DailyPickCard({ pick, assessment, isSaved, now, selection }) {
  if (!pick) return <div className="daily-card daily-card--empty" role="status">
    <div className="daily-card__top"><span>TODAY’S SELECTION</span><CalendarDays size={17} aria-hidden="true" /></div>
    <h3>{selection.state === 'loading' ? 'CHECKING THE MATCHDAY.' : selection.state === 'empty' ? 'NO PICK FOR NOW.' : 'A PICK ISN’T AVAILABLE.'}</h3>
    <p>{selection.reason}</p>
    <a href="#predictions">Browse upcoming fixtures <ArrowUpRight size={14} aria-hidden="true" /></a>
  </div>

  return <div className="daily-card">
    <div className="daily-card__top"><span>{isSaved ? 'SAVED MODEL SELECTION' : 'MODEL SELECTION · NOT SAVED'}</span><span>{dayLabel(pick.day).toUpperCase()} / WAT</span></div>
    <div className="daily-card__match"><span>{pick.leagueName.toUpperCase()}</span><h3>{pick.homeShortName} <i>vs</i> {pick.awayShortName}</h3><p>Approx. {kickoffLabel(pick.selectedKickoff)} WAT · check the official fixture</p></div>
    <div className="daily-card__lean"><div><span>MODEL LEANS</span><strong>{pickName(pick)}</strong></div><b>{pick.probability}<small>%</small><em>MODEL PROBABILITY</em></b></div>
    <p className="daily-card__status"><ShieldCheck size={15} aria-hidden="true" /> {isSaved ? statusLabel(assessment, pick, now) : 'This device could not save the selection for tracking.'}</p>
    {assessment.scheduleChanged && <p className="daily-card__warning">The recorded schedule changed. Check the fixture and any bookmaker settlement; no replacement is selected automatically.</p>}
  </div>
}

function BetCalculator({ active, canRecord, storageReady, onRecord, message }) {
  const [stake, setStake] = useState('')
  const [odds, setOdds] = useState('')
  const calculation = calculateWager(stake, odds)

  useEffect(() => {
    setStake(active?.bet ? (active.bet.stakeKobo / 100).toFixed(2) : '')
    setOdds(active?.bet ? (active.bet.oddsHundredths / 100).toFixed(2) : '')
  }, [active?.day, active?.forecastId, active?.bet?.stakeKobo, active?.bet?.oddsHundredths])

  return <div className="daily-calculator">
    <div className="daily-calculator__heading"><div><span>OPTIONAL / SINGLE BET</span><h3>ESTIMATE A RETURN.</h3></div><Wallet size={20} aria-hidden="true" /></div>
    <p>Enter a stake and the actual decimal odds offered to you. No odds are supplied or checked by this site.</p>
    <form onSubmit={(event) => { event.preventDefault(); onRecord(calculation) }} noValidate>
      <div className="daily-calculator__fields">
        <label>Stake (₦)<input inputMode="decimal" value={stake} onChange={(event) => setStake(event.target.value)} placeholder="Up to 100" aria-describedby="daily-cap-note" /></label>
        <label>Decimal odds<input inputMode="decimal" value={odds} onChange={(event) => setOdds(event.target.value)} placeholder="e.g. 1.50" /></label>
      </div>
      <p className="daily-calculator__cap" id="daily-cap-note">₦100 total per WAT day in this record. Other bets and devices aren’t included.</p>
      <div className="daily-calculator__result" aria-live="polite">
        {calculation.state === 'ready' ? <>
          <div><span>RETURN IF IT WINS</span><strong>{money(calculation.returnKobo)}</strong></div>
          <div><span>PROFIT IF IT WINS</span><strong>{money(calculation.profitKobo, true)}</strong></div>
          <p>Includes your stake. If it loses, the whole {money(calculation.stakeKobo)} stake may be lost. Before fees or taxes.</p>
        </> : <p>{calculation.state === 'invalid' ? calculation.reason : 'Enter both amounts for a hypothetical estimate. This does not place or record a bet.'}</p>}
      </div>
      {active && <button type="submit" className="daily-calculator__button" disabled={!storageReady || !canRecord || Boolean(active.bet?.voidedAt) || calculation.state !== 'ready'}>{active.bet ? 'Correct this recorded bet' : 'I placed this single · record it'}</button>}
      {active && <p className="daily-calculator__disclaimer">Only record a bet after you actually place it. This site cannot place or verify a bet. {active.bet ? 'Edits correct this same single, not additional wagers. ' : ''}Recording closes two hours before the earliest known kick-off.</p>}
      {active && !canRecord && <p className="daily-calculator__disclaimer">Recording is closed, or the fixture or data needs checking.</p>}
      {active?.bet?.voidedAt && <p className="daily-calculator__disclaimer">You marked this bet void. Undo that in your record before editing it.</p>}
      {message && <p className="daily-calculator__message" role="status">{message}</p>}
    </form>
  </div>
}

function HistoryRow({ pick, context, now, onVoid, storageReady }) {
  const assessment = assessSavedPick(pick, context)
  const betResult = estimatedBetResult(pick, assessment)
  const result = assessment.record?.result
  let betText = 'No actual bet recorded.'
  if (pick.bet) {
    const base = `You recorded ${money(pick.bet.stakeKobo)} at ${(pick.bet.oddsHundredths / 100).toFixed(2)}.`
    if (betResult.state === 'won') betText = `${base} Estimated return ${money(betResult.returnKobo)} · profit ${money(betResult.netKobo, true)}.`
    else if (betResult.state === 'lost') betText = `${base} Estimated return ${money(0)} · loss ${money(betResult.netKobo)}.`
    else if (betResult.state === 'void') betText = `${base} Marked void by you; check any refund with your bookmaker.`
    else if (betResult.state === 'review') betText = `${base} Schedule changed; check bookmaker settlement.`
    else betText = `${base} Awaiting a usable result.`
  }
  return <li className="daily-history__row">
    <div><span>{dayLabel(pick.day)} WAT · {pick.leagueName}</span><strong>{pick.homeShortName} <i>vs</i> {pick.awayShortName}</strong><small>{pickName(pick)} · {pick.probability}% model probability</small></div>
    <div className="daily-history__outcome"><b className={`daily-history__badge daily-history__badge--${assessment.state}`}>{statusLabel(assessment, pick, now)}</b>{result && (assessment.state === 'correct' || assessment.state === 'incorrect') && <small>Reported score {result.homeGoals}–{result.awayGoals}</small>}</div>
    <div className="daily-history__bet"><span>{betText}</span>{pick.bet && <button type="button" disabled={!storageReady} onClick={() => onVoid(pick.day, !pick.bet.voidedAt)}>{pick.bet.voidedAt ? 'Undo void' : 'Mark bet void'}<span className="sr-only"> for {pick.homeShortName} versus {pick.awayShortName}, {dayLabel(pick.day)}</span></button>}</div>
  </li>
}

function DailyHistory({ picks, context, now, storageReady, onVoid, onExport, onImport, importMessage }) {
  const [showAll, setShowAll] = useState(false)
  const sorted = [...picks].sort((a, b) => b.day.localeCompare(a.day))
  const summary = summarizeDailyPicks(picks, context)
  return <div className="daily-history">
    <div className="daily-history__heading"><div><span>YOUR RECORD / THIS BROWSER</span><h3>HOW DID THE PICKS GO?</h3><p>Selections are saved only when you visit before the cut-off. Results refresh when you return; they aren’t live or bookmaker settlement.</p></div><a href="#forecast-history">Full public forecast history <ArrowUpRight size={14} aria-hidden="true" /></a></div>
    <div className="daily-history__stats">
      <div><strong>{context.state === 'ready' ? <>{summary.correct} <i>/</i> {summary.scored}</> : '— / —'}</strong><span>MODEL PICKS CORRECT / SCORED</span></div>
      <div><strong>{summary.estimatedBets ? money(summary.estimatedNetKobo, true) : '—'}</strong><span>EST. NET / {summary.estimatedBets} SCORED {summary.estimatedBets === 1 ? 'BET' : 'BETS'}</span></div>
      <p>{context.state !== 'ready' ? 'Results cannot currently be checked. ' : summary.awaitingPicks ? `${summary.awaitingPicks} ${summary.awaitingPicks === 1 ? 'pick is' : 'picks are'} pending or need review. ` : ''}Estimates assume standard full-time single settlement, before fees or taxes. {summary.awaitingBets ? `${summary.awaitingBets} recorded ${summary.awaitingBets === 1 ? 'bet is' : 'bets are'} awaiting a usable result or review. ` : ''}{summary.voidBets ? `${summary.voidBets} marked void, excluded from net. ` : ''}Bookmakers may void or settle differently.</p>
    </div>
    {sorted.length ? <>
      <ul className="daily-history__list">{(showAll ? sorted : sorted.slice(0, 3)).map((pick) => <HistoryRow key={pick.day} pick={pick} context={context} now={now} onVoid={onVoid} storageReady={storageReady} />)}</ul>
      {sorted.length > 3 && <button className="daily-history__more" type="button" onClick={() => setShowAll((value) => !value)}>{showAll ? 'Show recent picks' : `Show all ${sorted.length} saved picks`}</button>}
    </> : <p className="daily-history__empty">No daily picks saved on this browser yet. Past recommendations are not invented.</p>}
    <div className="daily-history__backup"><p>Saved only on this browser—not in the public GitHub backup, synced to other devices, or proof that a bet was placed. Clearing browser data can erase it. Keep exported backups private.</p><div><button type="button" onClick={onExport} disabled={!storageReady || !picks.length}><Download size={14} aria-hidden="true" /> Export my backup</button><label>Import backup<input className="sr-only" type="file" accept="application/json,.json" aria-label="Import daily picks backup" onChange={onImport} disabled={!storageReady} /></label></div></div>
    {importMessage && <p className="daily-history__message" role="status">{importMessage}</p>}
  </div>
}

export default function DailyPicks({ feed, tracker }) {
  const [now, setNow] = useState(() => Date.now())
  const [store, setStore] = useState(() => loadDailyStore(browserStorage()))
  const [betMessage, setBetMessage] = useState('')
  const [importMessage, setImportMessage] = useState('')
  const context = useMemo(() => assessDailyData(feed, tracker, now), [feed, tracker, now])
  const selection = useMemo(() => chooseDailyPick(context, now), [context, now])
  const today = nigeriaDay(now)
  const picks = store.data?.picks || []
  const active = picks.find((pick) => pick.day === today) || null
  const displayPick = active || (selection.state === 'ready' ? captureDailyPick(selection.record, now) : null)
  const assessment = displayPick ? assessSavedPick(displayPick, context) : null
  const storageReady = store.state === 'ready'

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(interval)
  }, [])
  useEffect(() => {
    const changed = (event) => { if (event.key === DAILY_PICKS_STORAGE_KEY || event.key === null) setStore(loadDailyStore(browserStorage())) }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [])

  useEffect(() => {
    if (!storageReady || active || selection.state !== 'ready') return
    const clock = Date.now()
    if (nigeriaDay(clock) !== today) { setNow(clock); return }
    const latestContext = assessDailyData(feed, tracker, clock)
    const latest = chooseDailyPick(latestContext, clock)
    if (latest.state !== 'ready' || latest.record.id !== selection.record.id) { setNow(clock); return }
    const storage = browserStorage()
    const current = loadDailyStore(storage)
    if (current.state !== 'ready') { setStore(current); return }
    if (current.data.picks.some((pick) => pick.day === today)) { setStore(current); return }
    const pick = captureDailyPick(latest.record, clock)
    if (!isValidDailyPick(pick)) return
    const next = { version: 1, picks: [...current.data.picks, pick] }
    if (saveDailyStore(storage, next)) setStore({ state: 'ready', data: next })
    else setStore({ state: 'write-failed', data: current.data })
  }, [active, feed, selection, storageReady, today, tracker])

  function changeStore(transform) {
    const storage = browserStorage()
    const current = loadDailyStore(storage)
    if (current.state !== 'ready') { setStore(current); return false }
    const next = transform(current.data)
    if (!next) return false
    if (!saveDailyStore(storage, next)) { setStore({ state: 'write-failed', data: current.data }); return false }
    setStore({ state: 'ready', data: next })
    return true
  }

  function recordBet(calculation) {
    setBetMessage('')
    if (!active || calculation.state !== 'ready') return
    let rejected = false
    const saved = changeStore((current) => {
      const currentPick = current.picks.find((pick) => pick.day === active.day)
      const clock = Date.now()
      if (!currentPick || currentPick.forecastId !== active.forecastId || currentPick.selectedAt !== active.selectedAt || currentPick.bet?.voidedAt ||
        !canRecordBet(currentPick, assessDailyData(feed, tracker, clock), clock)) { rejected = true; return null }
      const bet = { stakeKobo: calculation.stakeKobo, oddsHundredths: calculation.oddsHundredths, loggedAt: new Date(clock).toISOString(), voidedAt: null }
      return { version: 1, picks: current.picks.map((pick) => pick.day === currentPick.day ? { ...pick, bet } : pick) }
    })
    setBetMessage(saved ? 'Bet details saved on this browser. No bet was placed by this site.' : rejected ? 'The selection or its schedule changed, or recording has closed. Nothing was saved.' : 'Could not save bet details on this browser.')
  }

  function markVoid(day, isVoid) {
    const saved = changeStore((current) => {
      const existing = current.picks.find((pick) => pick.day === day)
      if (!existing?.bet || (isVoid && Date.now() < Date.parse(existing.bet.loggedAt))) return null
      const voidedAt = isVoid ? new Date(Date.now()).toISOString() : null
      return { version: 1, picks: current.picks.map((pick) => pick.day === day ? { ...pick, bet: { ...pick.bet, voidedAt } } : pick) }
    })
    setImportMessage(saved ? (isVoid ? 'Bet marked void on this browser. Confirm the refund with your bookmaker.' : 'Void mark removed on this browser.') : 'Could not update this record.')
  }

  function exportBackup() {
    if (!storageReady || !store.data || !picks.length) return
    const blob = new Blob([JSON.stringify(store.data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `pitchside-daily-picks-${today}.json`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setImportMessage('Backup downloaded. It contains your private recorded bet details.')
  }

  function importBackup(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > 5_000_000) { setImportMessage('Backup is too large; nothing was imported.'); return }
    const reader = new FileReader()
    reader.onerror = () => setImportMessage('The backup could not be read; nothing was imported.')
    reader.onload = () => {
      let data
      try { data = JSON.parse(String(reader.result)) } catch { setImportMessage('This is not a valid JSON backup; nothing was imported.'); return }
      let merged
      const saved = changeStore((current) => {
        merged = mergeDailyStores(current, data)
        return merged.ok ? merged.data : null
      })
      setImportMessage(saved ? `Imported ${merged.added} new ${merged.added === 1 ? 'pick' : 'picks'} and updated ${merged.updated} matching ${merged.updated === 1 ? 'day' : 'days'}.` : merged?.reason || 'Could not save the backup on this browser; nothing was imported.')
    }
    reader.readAsText(file)
  }

  return <section className="daily-section" id="daily-pick" aria-labelledby="daily-title">
    <div className="daily-heading"><div><div className="section-kicker"><span /> THE DAILY EDIT <i>/</i> NIGERIA TIME</div><h2 id="daily-title">ONE PICK. <em>YOUR CALL.</em></h2><p>One model selection at most, not an accumulator. It is okay to skip a day; no outcome or profit is guaranteed.</p></div><div className="daily-budget"><span>MAXIMUM PER DAY</span><strong>₦100</strong><small>TOTAL · WAT</small></div></div>
    <div className="daily-grid"><DailyPickCard pick={displayPick} assessment={assessment} isSaved={Boolean(active)} now={now} selection={selection} /><BetCalculator active={active} canRecord={active ? canRecordBet(active, context, now) : false} storageReady={storageReady} onRecord={recordBet} message={betMessage} /></div>
    <p className="daily-section__note">The selection is the highest model probability among today’s eligible publication-verified forecasts in the Premier League, La Liga, Bundesliga and Serie A. It does not compare odds or prove value. Kick-offs are approximate, the source is not live, and results may change. Europa League is not covered. Informational only—not betting advice. <a href="https://github.com/oladeeayo/open-matchday/blob/master/DISCLAIMER.md" target="_blank" rel="noreferrer">Source rights and limitations</a>.</p>
    {!storageReady && <div className="daily-storage-warning" role="status">{store.state === 'corrupt' ? 'Your local daily record could not be read. It will not be overwritten; check your backup.' : 'Browser storage is unavailable or full. New picks and bet details cannot be saved here.'}</div>}
    <DailyHistory picks={picks} context={context} now={now} storageReady={storageReady} onVoid={markVoid} onExport={exportBackup} onImport={importBackup} importMessage={importMessage} />
  </section>
}
