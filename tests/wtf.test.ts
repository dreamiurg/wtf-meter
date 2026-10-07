import { expect, test } from 'claude-code/testing'

import { levelOf, score } from '../hooks/lexicon'

test('scores swears in EN, RU, UK, DE and PL', async () => {
  expect(score('wtf, why did you delete it').total).toBe(2)
  expect(score('верни как было, бля').total).toBe(3)
  expect(score('що за хрінь').total).toBe(1)
  expect(score('ну ёбаный стыд').total).toBe(3)
  expect(score('f*** this, п***ц').hits.length).toBe(2)
  expect(score('kurwa mać').total).toBe(3)
  expect(score('so eine Scheiße, verdammt').total).toBe(5)
  expect(score('ja pierdolę, kurde').total).toBe(4)
  expect(score('verfickte Pipeline').total).toBe(3)
})

test('ignores the classic false positives', async () => {
  const clean = 'корабля рубля употреблять блины чертёж Херсон hello shell class психует похудел небо хлеба сукно mister Mistral misty Fickle'
  expect(score(clean).hits.map(h => h.word)).toEqual([])
})

test('level follows the last four messages', async () => {
  expect(levelOf([]).level.name).toBe('Calm')
  expect(levelOf([0, 0, 1, 2]).level.name).toBe('Grumbling')
  expect(levelOf([2, 3, 1, 4]).level.name).toBe('Meltdown')
  expect(levelOf([3, 0, 0, 0]).level.name).toBe('Grumbling')
})

test('a sweary prompt sets status, stamps its row and draws the strip', async ($, on) => {
  const statuses: (string | undefined)[] = []
  const toasts: string[] = []
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('ui.status', (_$, e) => { statuses.push(e.text); return { value: undefined } as never })
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } as never })
  on('ui.render', (_$, e) => ({ type: 'Text', props: {}, children: [String((e.props as { text?: string }).text ?? 'engine')] }) as never)

  await $.prompt.submit({ text: 'fucking hell, бля', wait: false, origin: { kind: 'composer' } })
  expect(statuses.at(-1)).toBe('🔴 Meltdown · 3 WTFs ▲')
  expect(toasts).toEqual(['Calm → Meltdown. Maybe git stash and get a coffee.'])

  for (const surface of ['terminal', 'desktop'] as const) {
    const row = await $.ui.mount({
      plugin: 'wtf-meter', surface, component: 'UserMessage',
      props: { text: 'верни, бля', origin: { kind: 'composer' }, isExpanded: false } as never,
    })
    expect(await row.find({ type: 'Text', text: surface === 'desktop' ? /\+3 · бля/ : /\[WTF \+3 · бля\]/ })).toBeDefined()
    await row.unmount()

    const band = await $.ui.mount({
      plugin: 'wtf-meter', surface, component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } as never,
    })
    expect(await band.find({ type: 'Text', text: 'Meltdown' })).toBeDefined()
    // the terminal draws block bars; the desktop draws them as one Svg
    expect(await band.find(surface === 'terminal' ? { type: 'Text', text: /[▁▂▃▄▅▆▇█]/ } : { type: 'Svg' })).toBeDefined()
    await band.press({ key: 'hide' })
    expect(await band.find({ key: 'show' })).toBeDefined()
    await band.press({ key: 'show' })
    expect(await band.find({ key: 'hide' })).toBeDefined()
    await band.unmount()
  }
})
