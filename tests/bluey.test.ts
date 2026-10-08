import { expect, test } from 'claude-code/testing'

import { blueyVersion, streak } from '../hooks/bluey'

const BLUEY = { mode: 'bluey' }

test('swaps by weight in the message language, leaving mild words alone', async () => {
  expect(blueyVersion('wtf, fix it')).toEqual({ markdown: '**biscuits**, fix it', said: ['wtf'], swap: 'biscuits!' })
  expect(blueyVersion('kurwa. why')?.markdown).toBe('**o kurka wodna**. why')
  // capitalized stays capitalized; 3 + 2 = 5 is not yet the big one
  expect(blueyVersion('Scheiße, verdammt')).toEqual({ markdown: '**Ach du dickes Ei**, **Potzblitz**', said: ['Scheiße', 'verdammt'], swap: 'ach du dickes Ei!' })
  // the shared mat roots read as Russian only when Russian-only letters show up
  expect(blueyVersion('що це, бля')?.swap).toBe('ой лишенько!')
  expect(blueyVersion('что это, бля')?.swap).toBe('ёшкин кот!')
  // weight 1 is what parents already say instead
  expect(blueyVersion('damn, hell, блин, kurde')).toBeNull()
  expect(blueyVersion('fucking hell, wtf')?.said).toEqual(['fucking', 'wtf'])
  // every lexicon row carries the right language
  const swaps: [string, string][] = [
    ['cunt', 'boogerbeans!'], ['asshole', 'biscuits!'], ['f***', 'boogerbeans!'], ['п***ц', 'ой лишенько!'],
    ['хуйня', 'ой лишенько!'], ['сука', 'отакої!'], ['сука, это', 'ёлки-палки!'], ['пиздец, это', 'ёшкин кот!'],
    ['Scheiße, Scheiße', 'ach du grüne Neune!'], ['бля, бля', 'матінко рідна!'], ['chuj', 'o kurka wodna!'],
  ]
  for (const [text, swap] of swaps) expect(blueyVersion(text)?.swap).toBe(swap)
})

test('a message scoring 6 or more gets the full phrase', async () => {
  expect(blueyVersion('fucking shit')?.swap).toBe('boogerbeans on toast!')
  // mild words count toward it, like the meter's red stamp
  expect(blueyVersion('fucking hell, wtf')?.swap).toBe('boogerbeans on toast!')
  expect(blueyVersion('kurwa, ja pierdolę')?.swap).toBe('o matko i córko!')
})

test('streak counts clean messages since the last swap', async () => {
  expect(streak([])).toEqual({ now: 0, best: 0, total: 0 })
  expect(streak([0, 1, 0, 0, 2, 0])).toEqual({ now: 1, best: 2, total: 3 })
  expect(streak([1, 0, 0, 0])).toEqual({ now: 3, best: 3, total: 1 })
})

test('Bluey mode redraws the message, draws the streak and toasts a broken streak', { options: BLUEY }, async ($, on) => {
  const statuses: (string | undefined)[] = []
  const toasts: string[] = []
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('ui.status', (_$, e) => { statuses.push(e.text); return { value: undefined } as never })
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } as never })
  on('ui.render', (_$, e) => ({ type: 'Text', props: {}, children: [String((e.props as { text?: string }).text ?? 'engine')] }) as never)
  const say = (text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

  for (const t of ['damn, fine', 'v', 'w', 'x', 'y']) await say(t)
  expect(statuses.at(-1)).toBeUndefined() // nothing swapped yet
  await say('wtf')
  expect(toasts).toEqual([]) // no streak was on screen, so none broke
  const strip = { plugin: 'wtf-meter', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } as never } as const
  const pre = await $.ui.mount({ ...strip, surface: 'terminal' })
  await pre.press({ key: 'hide' })
  for (const t of ['a', 'b', 'c', 'd', 'e']) await say(t)
  expect(statuses.at(-1)).toBe('🍪 Clean for 5 · 1 swap')
  expect(toasts).toEqual([])
  await say('kurwa')
  expect(toasts).toEqual(['Streak over at 5 clean messages. O kurka wodna!'])
  expect(await pre.find({ key: 'hide' })).toBeDefined() // a broken streak brings the strip back
  await pre.unmount()
  expect(statuses.at(-1)).toBe('🍪 Clean for 0 · 2 swaps')

  const props = { text: 'wtf, run it', origin: { kind: 'composer' }, isExpanded: false } as never
  const term = await $.ui.mount({ plugin: 'wtf-meter', surface: 'terminal', component: 'UserMessage', props })
  expect(await term.find({ type: 'Text', text: 'wtf, run it\n[bluey · wtf → biscuits!]' })).toBeDefined()
  await term.unmount()
  const desk = await $.ui.mount({ plugin: 'wtf-meter', surface: 'desktop', component: 'UserMessage', props })
  expect(await desk.find({ type: 'Markdown', text: '**biscuits**, run it' })).toBeDefined()
  expect(await desk.find({ type: 'Text', text: /you typed: wtf/ })).toBeDefined()
  await desk.unmount()

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ ...strip, surface })
    expect(await band.find({ type: 'Text', text: /Clean for 0 messages/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /best 5 · 2 swaps this session/ })).toBeDefined()
    await band.press({ key: 'hide' })
    expect(await band.find({ key: 'show' })).toBeDefined()
    await band.press({ key: 'show' })
    await band.unmount()
  }

  const r = await $.command.run({ command: 'wtf', args: '' } as never)
  expect(JSON.stringify(r)).toContain('Bluey mode: 🍪 Clean for 0 · 2 swaps. Best streak 5.')
})
