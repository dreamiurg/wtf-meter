// Kid mode: every swear gets a child-friendly swap, in the language it was said in.
// Display only: Claude still reads what was typed.

import { score } from './lexicon'
import type { Hit } from './lexicon'

// Per language: [weight 2, weight 3, a whole message scoring BIG or more]
const SWAPS = {
  en: ['biscuits', 'boogerbeans', 'boogerbeans on toast'],
  de: ['Potzblitz', 'ach du dickes Ei', 'ach du grüne Neune'],
  pl: ['o rany', 'o kurka wodna', 'o matko i córko'],
  uk: ['отакої', 'ой лишенько', 'матінко рідна'],
  ru: ['ёлки-палки', 'ёшкин кот', 'батюшки мои'],
} as const
const BIG = 6

// The shared mat roots read as Russian only when Russian-only letters show up.
const langOf = (h: Hit, text: string) => (h.lang !== 'cyr' ? h.lang : /[ыэъё]/i.test(text) ? 'ru' : 'uk')
const swapOf = (h: Hit, text: string) => SWAPS[langOf(h, text)][h.w >= 3 ? 1 : 0]
const capped = (s: string, like: string) =>
  like[0] !== like[0]!.toLowerCase() ? s[0]!.toUpperCase() + s.slice(1) : s

/**
 * The child-friendly version of a message, or null when it has nothing to swap.
 * Weight 1 (damn, kurde, блин) is what parents already say instead, so it stays.
 */
export function kidVersion(text: string): { markdown: string; said: string[]; swap: string } | null {
  const hits = score(text).hits.filter(h => h.w >= 2)
  if (!hits.length) return null
  // ponytail: a swear inside a code span shows its ** literally; fine for chat prose
  let markdown = ''
  let at = 0
  for (const h of hits) {
    markdown += `${text.slice(at, h.i)}**${capped(swapOf(h, text), h.word)}**`
    at = h.end
  }
  markdown += text.slice(at)
  const worst = [...hits].sort((a, b) => b.w - a.w)[0]!
  const total = hits.reduce((s, h) => s + h.w, 0)
  const swap = total >= BIG ? SWAPS[langOf(worst, text)][2] : swapOf(worst, text)
  return { markdown, said: hits.map(h => h.word), swap: `${swap}!` }
}

/** Clean messages since the last swap, the best run, and swaps in all. */
export function streak(swaps: readonly number[]) {
  let best = 0
  let run = 0
  for (const s of swaps) {
    run = s ? 0 : run + 1
    best = Math.max(best, run)
  }
  return { now: run, best, total: swaps.reduce((a, b) => a + b, 0) }
}

export const kidStatus = (swaps: readonly number[]) => {
  const k = streak(swaps)
  return `🍪 Clean for ${k.now} · ${k.total} swap${k.total === 1 ? '' : 's'}`
}
