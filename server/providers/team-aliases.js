// Maps a provider's team spelling onto the canonical name already used by the
// public forecast ledger. This is deliberately an explicit, reviewed table: a
// fuzzy "looks similar" match could silently attach a forecast to the wrong
// club, which is worse than showing no prediction.
//
// Keys are provider names normalised with `teamKey` (lowercase, accents
// stripped, punctuation collapsed). Values name the roster club; the resolver
// takes the exact spelling from `community-teams.json`, so only the identity
// matters here, not the accents.
//
// A provider name that is not listed and not already a roster name is treated
// as unknown: the match is dropped and reported by the audit, never guessed.
// `npm run audit:teams` (label-triggered CI) lists what is still unmapped.
export const TEAM_ALIASES = Object.freeze({
  // England
  'manchester city': 'Man City',
  'manchester united': 'Man Utd',
  'man united': 'Man Utd',
  'man utd': 'Man Utd',
  'tottenham': 'Spurs',
  'tottenham hotspur': 'Spurs',
  'nottingham forest': 'Nottm Forest',
  'nottingham forrest': 'Nottm Forest',
  'newcastle united': 'Newcastle',
  'brighton and hove albion': 'Brighton',
  'afc bournemouth': 'Bournemouth',
  'coventry city': 'Coventry',
  'hull city': 'Hull',
  'ipswich town': 'Ipswich',
  'leeds united': 'Leeds',
  'sunderland afc': 'Sunderland',

  // Spain
  'fc barcelona': 'FC Barcelona',
  'atletico madrid': 'Atlético de Madrid',
  'athletic bilbao': 'Athletic Club',
  'celta vigo': 'Celta',
  'deportivo alaves': 'Deportivo Alavés',
  'osasuna': 'CA Osasuna',
  'espanyol': 'RCD Espanyol de Barcelona',
  'racing santander': 'R. Racing Club',
  'deportivo la coruna': 'RC Deportivo',
  'levante': 'Levante UD',
  'malaga': 'Málaga CF',
  'getafe': 'Getafe CF',
  'elche': 'Elche CF',
  'valencia': 'Valencia CF',
  'sevilla': 'Sevilla FC',
  'villarreal': 'Villarreal CF',

  // Germany
  'bayern munich': 'FC Bayern München',
  'monchengladbach': 'Borussia Mönchengladbach',
  'bayer leverkusen': 'Bayer 04 Leverkusen',
  'leverkusen': 'Bayer 04 Leverkusen',
  'mainz': '1. FSV Mainz 05',
  'mainz 05': '1. FSV Mainz 05',
  'union berlin': '1. FC Union Berlin',
  'koln': '1. FC Köln',
  'fc koln': '1. FC Köln',
  'hoffenheim': 'TSG Hoffenheim',
  'werder bremen': 'SV Werder Bremen',
  'freiburg': 'SC Freiburg',
  'augsburg': 'FC Augsburg',
  'stuttgart': 'VfB Stuttgart',
  'frankfurt': 'Eintracht Frankfurt',
  'dortmund': 'Borussia Dortmund',
  'leipzig': 'RB Leipzig',
  'hamburg': 'Hamburger SV',
  'elversberg': 'SV 07 Elversberg',
  'schalke': 'FC Schalke 04',
  'paderborn': 'SC Paderborn 07',

  // Italy
  'ac milan': 'Milan',
  'inter': 'Internazionale',
  'inter milan': 'Internazionale',
  'as roma': 'Roma',
})
