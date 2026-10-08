import { expect, test } from 'claude-code/testing'

import { kidVersion, streak } from '../hooks/kid'

const KID = { mode: 'kid' }

test('swaps by weight in the message language, leaving mild words alone', async () => {
  expect(kidVersion('wtf, fix it')).toEqual({ markdown: '**biscuits**, fix it', said: ['wtf'], swap: 'biscuits!' })
  expect(kidVersion('kurwa. why')?.markdown).toBe('**o kurka wodna**. why')
  // capitalized stays capitalized; 3 + 2 = 5 is not yet the big one
  expect(kidVersion('Scheiße, verdammt')).toEqual({ markdown: '**Ach du dickes Ei**, **Potzblitz**', said: ['Scheiße', 'verdammt'], swap: 'ach du dickes Ei!' })
  // the shared mat roots read as Russian only when Russian-only letters show up
  expect(kidVersion('що це, бля')?.swap).toBe('ой лишенько!')
  expect(kidVersion('что это, бля')?.swap).toBe('ёшкин кот!')
  // weight 1 is what parents already say instead
  expect(kidVersion('damn, hell, блин, kurde')).toBeNull()
  expect(kidVersion('fucking hell, wtf')?.said).toEqual(['fucking', 'wtf'])
})

test('a message scoring 6 or more gets the full phrase', async () => {
  expect(kidVersion('fucking shit')?.swap).toBe('boogerbeans on toast!')
  // mild words count toward it, like the meter's red stamp
  expect(kidVersion('fucking hell, wtf')?.swap).toBe('boogerbeans on toast!')
  expect(kidVersion('kurwa, ja pierdolę')?.swap).toBe('o matko i córko!')
})

test('streak counts clean messages since the last swap', async () => {
  expect(streak([])).toEqual({ now: 0, best: 0, total: 0 })
  expect(streak([0, 1, 0, 0, 2, 0])).toEqual({ now: 1, best: 2, total: 3 })
  expect(streak([1, 0, 0, 0])).toEqual({ now: 3, best: 3, total: 1 })
})

test('kid mode rewrites the stamp, draws the streak and toasts a broken streak', { options: KID }, async ($, on) => {
  const statuses: (string | undefined)[] = []
  const toasts: string[] = []
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('ui.status', (_$, e) => { statuses.push(e.text); return { value: undefined } as never })
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } as never })
  on('ui.render', (_$, e) => ({ type: 'Text', props: {}, children: [String((e.props as { text?: string }).text ?? 'engine')] }) as never)
  const say = (text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

  await say('damn, fine')
  expect(statuses.at(-1)).toBeUndefined() // nothing swapped yet
  await say('wtf')
  for (const t of ['a', 'b', 'c', 'd', 'e']) await say(t)
  expect(statuses.at(-1)).toBe('🍪 Clean for 5 · 1 swap')
  expect(toasts).toEqual([])
  await say('kurwa')
  expect(toasts).toEqual(['Streak over at 5 clean messages. O kurka wodna!'])
  expect(statuses.at(-1)).toBe('🍪 Clean for 0 · 2 swaps')

  const props = { text: 'wtf, run it', origin: { kind: 'composer' }, isExpanded: false } as never
  const term = await $.ui.mount({ plugin: 'wtf-meter', surface: 'terminal', component: 'UserMessage', props })
  expect(await term.find({ type: 'Text', text: 'wtf, run it\n[kid · wtf → biscuits!]' })).toBeDefined()
  await term.unmount()
  const desk = await $.ui.mount({ plugin: 'wtf-meter', surface: 'desktop', component: 'UserMessage', props })
  expect(await desk.find({ type: 'Markdown', text: '**biscuits**, run it' })).toBeDefined()
  expect(await desk.find({ type: 'Text', text: /you typed: wtf/ })).toBeDefined()
  await desk.unmount()

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({
      plugin: 'wtf-meter', surface, component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } as never,
    })
    expect(await band.find({ type: 'Text', text: /Clean for 0 messages/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /best 5 · 2 swaps this session/ })).toBeDefined()
    await band.press({ key: 'hide' })
    expect(await band.find({ key: 'show' })).toBeDefined()
    await band.press({ key: 'show' })
    await band.unmount()
  }

  const r = await $.command.run({ command: 'wtf', args: '' } as never)
  expect(JSON.stringify(r)).toContain('Kid mode: 🍪 Clean for 0 · 2 swaps. Best streak 5.')
})
