// Bluey mode: each swear above mild gets a child-friendly swap, in the language it was said in.
// Display only: Claude still reads what was typed.

import { RED, score, worstHit } from './lexicon'
import type { Hit } from './lexicon'

// Per language: [weight 2, weight 3, a whole message scoring RED or more].
// Polish has no weight-2 words in the lexicon yet, so 'o rany' waits for one.
const SWAPS = {
  en: ['biscuits', 'boogerbeans', 'boogerbeans on toast'],
  de: ['Potzblitz', 'ach du dickes Ei', 'ach du grüne Neune'],
  pl: ['o rany', 'o kurka wodna', 'o matko i córko'],
  uk: ['отакої', 'ой лишенько', 'матінко рідна'],
  ru: ['ёлки-палки', 'ёшкин кот', 'батюшки мои'],
} as const

// The shared mat roots read as Russian only when Russian-only letters show up.
const langOf = (h: Hit, text: string) => (h.lang !== 'cyr' ? h.lang : /[ыэъё]/i.test(text) ? 'ru' : 'uk')
const swapOf = (h: Hit, text: string) => SWAPS[langOf(h, text)][h.w >= 3 ? 1 : 0]
export const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)
const capped = (s: string, like: string) => (like[0] !== like[0]!.toLowerCase() ? cap(s) : s)

/** The hits Bluey mode swaps. Weight 1 (damn, kurde, блин) is what parents already say instead. */
export const swappable = (hits: readonly Hit[]) => hits.filter(h => h.w >= 2)

/**
 * The child-friendly version of a message, or null when it has nothing to swap.
 */
export function blueyVersion(text: string): { markdown: string; said: string[]; swap: string } | null {
  const s = score(text)
  const hits = swappable(s.hits)
  if (!hits.length) return null
  // ponytail: a swear inside a code span shows its ** literally; fine for chat prose
  let markdown = ''
  let at = 0
  for (const h of hits) {
    markdown += `${text.slice(at, h.i)}**${capped(swapOf(h, text), h.word)}**`
    at = h.end
  }
  markdown += text.slice(at)
  const worst = worstHit(hits)!
  // the big one counts mild words too, so it lands where the meter's stamp turns red
  const swap = s.total >= RED ? SWAPS[langOf(worst, text)][2] : swapOf(worst, text)
  return { markdown, said: hits.map(h => h.word), swap: `${swap}!` }
}

/** Clean messages since the last swap, the best run, and swaps in all. */
export function streak(swaps: readonly (number | undefined)[]) {
  let best = 0
  let run = 0
  for (const s of swaps) {
    run = s ? 0 : run + 1
    best = Math.max(best, run)
  }
  return { now: run, best, total: swaps.reduce<number>((a, b) => a + (b ?? 0), 0) }
}

/** Status text, or undefined before the first swap. */
export const blueyStatus = (k: ReturnType<typeof streak>) =>
  k.total ? `🍪 Clean for ${k.now} · ${k.total} swap${k.total === 1 ? '' : 's'}` : undefined
