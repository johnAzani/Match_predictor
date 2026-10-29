import { useEffect, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'

export function Brand({ footer = false }) {
  return (
    <a className={`brand${footer ? ' brand--footer' : ''}`} href="#top" aria-label="Pitchside home">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 36 36" fill="none">
          <rect x="1" y="1" width="34" height="34" rx="9" fill="currentColor" />
          <path d="M10 10.5h7.5c4.3 0 6.5 2.2 6.5 5.7s-2.2 5.8-6.5 5.8h-3v4.2H10V10.5Zm4.5 4v3.7h2.9c1.3 0 2-.7 2-1.9s-.7-1.8-2-1.8h-2.9Z" fill="#111914" />
          <path d="M25.5 9.5v5M23 12h5" stroke="#111914" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </span>
      <span className="brand-name">pitchside<span>.</span></span>
    </a>
  )
}

export function CountryFlag({ country }) {
  return <span className={`country-flag country-flag--${country}`} aria-hidden="true" />
}

export function Crest({ team, className = '' }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [team.crest])
  if (!team.crest || failed) {
    const words = team.shortName.replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean)
    const initials = (words.length > 1 ? words.slice(0, 2).map((word) => word[0]).join('') : (words[0] || '?').slice(0, 2)).toUpperCase()
    return <span className={`crest crest--fallback ${className}`} aria-hidden="true">{initials}</span>
  }
  return <img className={`crest ${className}`} src={`${import.meta.env.BASE_URL}crests/${team.crest}`} alt="" onError={() => setFailed(true)} />
}

export function FormGuide({ form, teamName }) {
  const words = { W: 'win', D: 'draw', L: 'loss' }
  if (!form.length) return <span className="no-form">NO RESULTS YET</span>
  return (
    <div className="form-guide" role="img" aria-label={`${teamName} form, oldest to newest: ${form.map((result) => words[result]).join(', ')}`}>
      {form.map((result, index) => <span className={`form-result form-result--${result.toLowerCase()}`} aria-hidden="true" key={`${result}-${index}`}>{result}</span>)}
    </div>
  )
}

export function ProbabilityBar({ probabilities, className = '' }) {
  return (
    <div
      className={`probability-bar ${className}`}
      role="img"
      aria-label={`Home win ${probabilities.home}%, draw ${probabilities.draw}%, away win ${probabilities.away}%`}
    >
      <span className="probability-bar__home" style={{ width: `${probabilities.home}%` }} />
      <span className="probability-bar__draw" style={{ width: `${probabilities.draw}%` }} />
      <span className="probability-bar__away" style={{ width: `${probabilities.away}%` }} />
    </div>
  )
}

export function ProbabilityLabels({ probabilities }) {
  return (
    <div className="probability-labels">
      <div><span>HOME WIN</span><strong>{probabilities.home}%</strong></div>
      <div><span>DRAW</span><strong>{probabilities.draw}%</strong></div>
      <div><span>AWAY WIN</span><strong>{probabilities.away}%</strong></div>
    </div>
  )
}

export function TextLink({ children, onClick, className = '' }) {
  return <button type="button" className={`text-link ${className}`} onClick={onClick}>{children}<ArrowUpRight size={15} strokeWidth={1.8} aria-hidden="true" /></button>
}
