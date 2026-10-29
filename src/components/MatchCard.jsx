import { ArrowRight, Bookmark } from 'lucide-react'
import { CountryFlag, Crest, ProbabilityBar, ProbabilityLabels } from './Shared.jsx'

export default function MatchCard({ fixture, prediction, lockedAt, trackingStatus, saved, onToggleSaved, onOpen }) {
  const lean = prediction?.lean
  const pick = !lean ? 'Waiting for more results' : lean.key === 'tie' ? 'No clear lean' : lean.team ? `Model leans ${lean.team.shortName} win` : 'Model leans a draw'

  return (
    <article className="match-card" aria-labelledby={`match-${fixture.id}`}>
      <div className="match-card__top">
        <div className="league-label"><CountryFlag country={fixture.league.country} /><span>{fixture.league.name}</span></div>
        <div className="match-card__meta">
          <span>{fixture.day} <span className="meta-dot">·</span> {fixture.time}</span>
          <button
            type="button"
            className={`save-button${saved ? ' is-saved' : ''}`}
            onClick={() => onToggleSaved(fixture.id)}
            aria-label={`${saved ? 'Remove' : 'Save'} ${fixture.home.name} vs ${fixture.away.name}${saved ? ' from saved matches' : ''}`}
            aria-pressed={saved}
            title={saved ? 'Remove from saved matches' : 'Save match'}
          >
            <Bookmark size={17} fill={saved ? 'currentColor' : 'none'} strokeWidth={1.6} />
          </button>
        </div>
      </div>

      <div className="matchup" id={`match-${fixture.id}`}>
        <div className="matchup__team">
          <Crest team={fixture.home} />
          <strong title={fixture.home.name}>{fixture.home.shortName}</strong>
          <span>HOME</span>
        </div>
        <div className="matchup__score">
          <span>{prediction ? 'LIKELY SCORE' : 'PREDICTION'}</span>
          {prediction ? <strong>{prediction.likelyScore.home}<i>:</i>{prediction.likelyScore.away}</strong> : <strong>—</strong>}
          <span>{prediction ? 'MODEL ESTIMATE' : 'NOT AVAILABLE'}</span>
        </div>
        <div className="matchup__team">
          <Crest team={fixture.away} />
          <strong title={fixture.away.name}>{fixture.away.shortName}</strong>
          <span>AWAY</span>
        </div>
      </div>

      <div className="match-card__probabilities">
        <div className="eyebrow-row"><span>OUTCOME PROBABILITIES</span><span>1&nbsp; / &nbsp;X&nbsp; / &nbsp;2</span></div>
        {prediction ? <><ProbabilityBar probabilities={prediction.probabilities} /><ProbabilityLabels probabilities={prediction.probabilities} /></> : <p className="missing-prediction">At least three earlier league results are needed for each team.</p>}
      </div>

      {prediction && <p className={`locked-prediction ${lockedAt ? 'is-recorded' : 'locked-prediction--muted'}`}>
        {lockedAt ? <><span aria-hidden="true">✳ </span>{trackingStatus === 'preview' ? 'PREVIEW FORECAST' : 'RECORDED FOR TRACKING'} · {new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(lockedAt)).toUpperCase()} UTC</> :
          trackingStatus === 'demo' ? 'SAMPLE ESTIMATE · NOT TRACKED' : trackingStatus === 'loading' ? 'CHECKING TRACKING STATUS' : trackingStatus === 'unavailable' ? 'TRACKING STATUS UNAVAILABLE' : 'CURRENT ESTIMATE · NOT IN ACTIVE TRACKING'}
      </p>}
      <div className="match-card__bottom">
        <div className="model-lean"><span className="model-lean__dot" /><strong>{pick}</strong></div>
        <button type="button" className="analysis-link" onClick={() => onOpen(fixture)} aria-label={`View analysis for ${fixture.home.name} vs ${fixture.away.name}`}>
          Analysis <ArrowRight size={15} aria-hidden="true" />
        </button>
      </div>
    </article>
  )
}
