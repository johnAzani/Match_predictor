// All fixtures and statistics are illustrative. They are not a live feed or
// a representation of the teams' real schedules or current-season records.
export const leagues = [
  { id: 'premier-league', name: 'Premier League', country: 'england' },
  { id: 'la-liga', name: 'La Liga', country: 'spain' },
  { id: 'bundesliga', name: 'Bundesliga', country: 'germany' },
  { id: 'serie-a', name: 'Serie A', country: 'italy' },
]

const teams = {
  arsenal: {
    name: 'Arsenal', shortName: 'Arsenal', crest: 'arsenal.svg',
    goalsFor: 2.1, goalsAgainst: 0.8, form: ['W', 'W', 'D', 'W', 'W'],
  },
  chelsea: {
    name: 'Chelsea', shortName: 'Chelsea', crest: 'chelsea.svg',
    goalsFor: 1.8, goalsAgainst: 1.3, form: ['W', 'L', 'W', 'D', 'W'],
  },
  city: {
    name: 'Manchester City', shortName: 'Man City', crest: 'manchester-city.svg',
    goalsFor: 2.3, goalsAgainst: 1.2, form: ['W', 'D', 'W', 'W', 'W'],
  },
  liverpool: {
    name: 'Liverpool', shortName: 'Liverpool', crest: 'liverpool-fc.svg',
    goalsFor: 2.2, goalsAgainst: 1.0, form: ['W', 'W', 'D', 'W', 'L'],
  },
  madrid: {
    name: 'Real Madrid', shortName: 'Real Madrid', crest: 'real-madrid.svg',
    goalsFor: 2.1, goalsAgainst: 0.9, form: ['W', 'W', 'D', 'W', 'W'],
  },
  barcelona: {
    name: 'Barcelona', shortName: 'Barcelona', crest: 'barcelona.svg',
    goalsFor: 2.3, goalsAgainst: 1.1, form: ['W', 'W', 'W', 'D', 'W'],
  },
  bayern: {
    name: 'Bayern Munich', shortName: 'Bayern', crest: 'bayern-munich.svg',
    goalsFor: 2.6, goalsAgainst: 1.0, form: ['W', 'W', 'W', 'D', 'W'],
  },
  dortmund: {
    name: 'Borussia Dortmund', shortName: 'Dortmund', crest: 'borussia-dortmund.svg',
    goalsFor: 1.8, goalsAgainst: 1.5, form: ['L', 'W', 'D', 'W', 'L'],
  },
  atletico: {
    name: 'Atlético Madrid', shortName: 'Atlético', crest: 'atletico-madrid.svg',
    goalsFor: 1.8, goalsAgainst: 0.9, form: ['W', 'D', 'W', 'W', 'D'],
  },
  sociedad: {
    name: 'Real Sociedad', shortName: 'Sociedad', crest: 'real-sociedad.svg',
    goalsFor: 1.3, goalsAgainst: 1.2, form: ['D', 'W', 'L', 'W', 'D'],
  },
  leverkusen: {
    name: 'Bayer Leverkusen', shortName: 'Leverkusen', crest: 'bayer-leverkusen.svg',
    goalsFor: 2.1, goalsAgainst: 1.0, form: ['W', 'D', 'W', 'W', 'D'],
  },
  leipzig: {
    name: 'RB Leipzig', shortName: 'Leipzig', crest: 'rb-leipzig.svg',
    goalsFor: 1.8, goalsAgainst: 1.2, form: ['W', 'L', 'W', 'D', 'W'],
  },
  inter: {
    name: 'Inter Milan', shortName: 'Inter', crest: 'inter.svg',
    goalsFor: 2.2, goalsAgainst: 0.8, form: ['W', 'W', 'D', 'W', 'W'],
  },
  juventus: {
    name: 'Juventus', shortName: 'Juventus', crest: 'juventus.svg',
    goalsFor: 1.5, goalsAgainst: 1.0, form: ['D', 'W', 'D', 'W', 'L'],
  },
  milan: {
    name: 'AC Milan', shortName: 'AC Milan', crest: 'milan.svg',
    goalsFor: 1.7, goalsAgainst: 1.1, form: ['W', 'D', 'L', 'W', 'W'],
  },
  napoli: {
    name: 'Napoli', shortName: 'Napoli', crest: 'napoli.svg',
    goalsFor: 2.0, goalsAgainst: 1.0, form: ['W', 'W', 'D', 'W', 'D'],
  },
}

const league = (id) => leagues.find((item) => item.id === id)

export const fixtures = [
  { id: 'arsenal-chelsea', league: league('premier-league'), day: 'SAT', time: '12:30', home: teams.arsenal, away: teams.chelsea },
  { id: 'city-liverpool', league: league('premier-league'), day: 'SAT', time: '15:00', home: teams.city, away: teams.liverpool },
  { id: 'madrid-barcelona', league: league('la-liga'), day: 'SAT', time: '17:30', home: teams.madrid, away: teams.barcelona },
  { id: 'bayern-dortmund', league: league('bundesliga'), day: 'SAT', time: '20:00', home: teams.bayern, away: teams.dortmund },
  { id: 'atletico-sociedad', league: league('la-liga'), day: 'SUN', time: '14:00', home: teams.atletico, away: teams.sociedad },
  { id: 'leverkusen-leipzig', league: league('bundesliga'), day: 'SUN', time: '16:30', home: teams.leverkusen, away: teams.leipzig },
  { id: 'inter-juventus', league: league('serie-a'), day: 'SUN', time: '17:30', home: teams.inter, away: teams.juventus },
  { id: 'milan-napoli', league: league('serie-a'), day: 'SUN', time: '19:45', home: teams.milan, away: teams.napoli },
]
