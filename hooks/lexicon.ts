// Weighted swear patterns for EN, RU, UK, DE and PL. JS \b does not see Cyrillic,
// so each pattern needs a non-letter before it (L) and, where a stem could
// run on into an innocent word, a non-letter after it (E).
const L = '(?<![\\p{L}\\p{N}*])'
const E = '(?![\\p{L}])'

const LEX: readonly [number, string][] = [
  [3, L + '\\p{L}*fuck\\p{L}*'],
  [3, L + '\\p{L}*shit\\p{L}*'],
  [3, L + 'cunt\\p{L}*'],
  [2, L + '(?:wtf|stfu|fml)' + E],
  [2, L + '(?:ass(?:hole|hat)s?|bitch\\p{L}*|bastard\\p{L}*)' + E],
  [1, L + '(?:(?:god)?damn\\p{L}*|crap\\p{L}*|hell|ffs|omfg)' + E],
  // censored by dictation: f***, sh*t, п***ц
  [3, L + '(?:f\\*+(?:c?k\\p{L}*|\\**)|sh\\*+t\\p{L}*|[пхбе]\\*+\\p{L}*)'],
  [3, L + '(?:на|по|ни|от|за|о|до|при|рас|с)?ху[йяеёиюї]\\p{L}*'],
  [3, '\\p{L}*пизд\\p{L}*'],
  [3, L + 'бля(?:д\\p{L}*|ть|ха)?' + E],
  [3, L + '(?:за|у|вы|на|под|до|от|про|раз|съ|при|по|из)?[еёї]б(?:а|у|ну|ё|е[тш]|л|ис)\\p{L}*'],
  [2, L + '(?:сук(?:а|и|у|ой|ин\\p{L}*)|муд(?:ак|ач|ил)\\p{L}*|(?:на|по|ни)?хер(?!сон)\\p{L}*|г[оі]вн\\p{L}*|курв\\p{L}*)' + E],
  // DE
  [3, L + '(?:(?:ver|ge|abge)?fick(?:en|t|te|er|st|e)?|schei(?:ß|ss|s)\\p{L}*|arschloch\\p{L}*)' + E],
  [2, L + '(?:verdammt\\p{L}*|mist(?:stück)?|kacke)' + E],
  // PL
  [3, L + '(?:kurw\\p{L}*|\\p{L}*pierdol\\p{L}*|(?:wy|za|od|roz|s)?jeb(?:a|i|ie|n|ło|ać)\\p{L}*|chuj\\p{L}*)'],
  [1, L + '(?:kurde|kurczę|cholera(?:\\s+jasna)?)' + E],
  [1, L + '(?:блин|хр[еі]н\\p{L}*|ч[её]рт(?:и|ов|овски)?|дідьк\\p{L}*|трясця|холера|срак\\p{L}*|лайн[оа])' + E],
]
const RX = LEX.map(([w, re]) => ({ w, rx: new RegExp(re, 'giu') }))

export type Hit = { i: number; end: number; word: string; w: number }

export function score(text: string): { total: number; hits: Hit[] } {
  const all: Hit[] = []
  for (const { w, rx } of RX) {
    for (const m of text.matchAll(rx)) {
      all.push({ i: m.index, end: m.index + m[0].length, word: m[0], w })
    }
  }
  all.sort((a, b) => a.i - b.i || b.w - a.w)
  const hits: Hit[] = []
  for (const h of all) {
    const last = hits[hits.length - 1]
    if (!last || h.i >= last.end) hits.push(h)
  }
  return { total: hits.reduce((s, h) => s + h.w, 0), hits }
}

export const LEVELS = [
  { name: 'Calm', dot: '🔵', min: 0, color: '#5b8db0', toast: 'Cooled off. Carry on.' },
  { name: 'Grumbling', dot: '🟡', min: 0.6, color: '#d4a72c', toast: 'Some grumbling in here.' },
  { name: 'Heated', dot: '🟠', min: 1.5, color: '#e8743b', toast: 'Breathe.' },
  { name: 'Meltdown', dot: '🔴', min: 2.5, color: '#e5484d', toast: 'Maybe git stash and get a coffee.' },
] as const
export type Level = (typeof LEVELS)[number]

/** Level from the average score of the last 4 messages. */
export function levelOf(scores: readonly number[]): { level: Level; avg: number } {
  const win = scores.slice(-4)
  const avg = win.length ? win.reduce((a, b) => a + b, 0) / win.length : 0
  let level: Level = LEVELS[0]
  for (const l of LEVELS) if (avg >= l.min) level = l
  return { level, avg }
}

/** Color for one message's stamp, by how bad that message alone was. */
export const stampColor = (total: number) =>
  total >= 6 ? LEVELS[3].color : total >= 3 ? LEVELS[2].color : LEVELS[1].color
