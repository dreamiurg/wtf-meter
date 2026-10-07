import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { channelIdIn, channelLabel, cleanTopic, parseChannel, postText, TOPICS } from '../hooks/jar'

const JAR = { mode: 'jar', slackChannel: 'swear-jar' }
const SEND = 'mcp__claude_ai_Slack__slack_send_message'

test('a Slack post can only say a topic from the list', async () => {
  expect(cleanTopic('a flaky test')).toBe('a flaky test')
  expect(cleanTopic(' "CI". ')).toBe('CI')
  // anything else, including the model echoing the user's words, becomes "something"
  expect(cleanTopic('the payments-service deploy for ACME')).toBe('something')
  expect(cleanTopic(undefined)).toBe('something')
  expect(cleanTopic('a flaky test and CI')).toBe('a flaky test and CI')
  expect(cleanTopic('CI and the payments service')).toBe('CI')
  expect(cleanTopic('a deploy, a deploy, a bug, CI')).toBe('a deploy and a bug')
  for (const t of TOPICS) expect(/[0-9/@`_]/.test(t)).toBe(false)
})

test('post text is amount and topic; a full jar adds the beer run', async () => {
  expect(postText(250, 'a release', 1000, 0)).toBe('🫙 +$2.50 in the swear jar, fighting a release.')
  expect(postText(75, 'CI', 2050, 0)).toContain('That fills my jar: $20.50 in all. Beer run!')
  expect(channelIdIn('#swear-jar (C0FAKE0JAR1) 3 members')).toBe('C0FAKE0JAR1')
})

test('the channel setting takes a name, an ID or both, and always reads as a name', async () => {
  expect(parseChannel('#swear-jar C0FAKE0CHAN')).toEqual({ name: 'swear-jar', id: 'C0FAKE0CHAN' })
  expect(parseChannel('swear-jar')).toEqual({ name: 'swear-jar', id: '' })
  expect(parseChannel('C0FAKE0CHAN')).toEqual({ name: '', id: 'C0FAKE0CHAN' })
  expect(channelLabel(parseChannel('C0FAKE0CHAN'))).toBe('the Slack channel')
  expect(channelLabel(parseChannel('swear-jar C0FAKE0CHAN'))).toBe('#swear-jar')
})

/** Stands in for the session: a Slack connector whose send takes `text`, not `message`. */
function world(on: On, opts: { slack: boolean }) {
  const clock = mock.clock(on)
  mock.store(on)
  const sent: Record<string, unknown>[] = []
  const toasts: string[] = []
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } as never })
  on('model.complete', () => ({ value: { isAnswered: true, text: 'a deploy', usage: {} } }) as never)
  on('tool.list', () => ({ value: opts.slack ? [{ name: 'Read', description: '', mcp: false }, { name: SEND, description: '', mcp: true }] : [] }) as never)
  on('mcp.call', (_$, e) => {
    if (e.tool === 'slack_search_channels') return { value: { isError: false, content: [{ type: 'text', text: '#swear-jar C0FAKE0JAR1' }] } } as never
    if ('message' in e.args) return { value: { isError: true, content: [{ type: 'text', text: 'unknown argument: message' }] } } as never
    sent.push({ server: e.server, ...e.args })
    return { value: { isError: false, content: [{ type: 'text', text: 'ok' }] } } as never
  })
  return { clock, sent, toasts }
}

test('jar mode posts a sanitized line through the Slack connector, never the prompt', { options: JAR }, async ($, on) => {
  const { clock, sent, toasts } = world(on, { slack: true })
  await $.prompt.submit({ text: 'ACME-4471 prod-db password leak, fucking hell', wait: false, origin: { kind: 'composer' } })
  expect(toasts[0]).toContain('+$1.00 in the jar')
  expect(sent).toEqual([])

  await clock.advance(2 * 60 * 1000)
  expect(sent.length).toBe(1)
  expect(sent[0]!.server).toBe('claude_ai_Slack')
  expect(sent[0]!.channel_id).toBe('C0FAKE0JAR1')
  expect(String(sent[0]!.text)).toMatch(/^🫙 \+\$1\.00 in the swear jar, [a-z ]+ a deploy\.$/)
  expect(JSON.stringify(sent)).not.toContain('ACME')
})

test('without a Slack connector the jar stays local and says why', { options: JAR }, async ($, on) => {
  const { clock, sent, toasts } = world(on, { slack: false })
  await $.prompt.submit({ text: 'kurwa', wait: false, origin: { kind: 'composer' } })
  await clock.advance(2 * 60 * 1000)
  expect(sent).toEqual([])
  expect(toasts.at(-1)).toContain('no Slack connector')
})

test('posts only from the account slackOnlyFor names', { options: { ...JAR, slackOnlyFor: '@work.example' } }, async ($, on) => {
  const { clock, sent, toasts } = world(on, { slack: true })
  mock.env(on, { CLAUDE_CODE_USER_EMAIL: 'me@home.example' })
  await $.prompt.submit({ text: 'kurwa', wait: false, origin: { kind: 'composer' } })
  await clock.advance(5 * 60 * 1000)
  expect(sent).toEqual([])
  expect(toasts.join(' ')).not.toContain('Posting to')
})

test('/wtf skip cancels the waiting post', { options: JAR }, async ($, on) => {
  const { clock, sent } = world(on, { slack: true })
  await $.prompt.submit({ text: 'kurwa', wait: false, origin: { kind: 'composer' } })
  const r = await $.command.run({ command: 'wtf', args: 'skip' } as never)
  expect(JSON.stringify(r)).toContain('skipped the Slack post for $0.75')
  await clock.advance(5 * 60 * 1000)
  expect(sent).toEqual([])
})

type Submits = { prompt: { submit: (input: { text: string; wait: boolean; origin: { kind: 'composer' } }) => Promise<unknown> } }
const say = ($: Submits, text: string) =>
  $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

test('a mild swear fills the jar but posts nothing', { options: JAR }, async ($, on) => {
  const { clock, sent, toasts } = world(on, { slack: true })
  await say($, 'damn')
  await clock.advance(5 * 60 * 1000)
  expect(toasts[0]).toContain('+$0.25 in the jar')
  expect(sent).toEqual([])
})

test('the posted line is exactly the previewed one, once per blow-up', { options: JAR }, async ($, on) => {
  const { clock, sent, toasts } = world(on, { slack: true })
  await say($, 'kurwa, CI again')
  await clock.advance(0)
  const queued = toasts.find(t => t.startsWith('Queued for #swear-jar: '))!
  expect(queued).toBeDefined()
  await clock.advance(2 * 60 * 1000)
  expect(sent.length).toBe(1)
  expect(queued).toContain(String(sent[0]!.text))

  // still heated: the same blow-up does not post again
  await say($, 'kurwa')
  await clock.advance(5 * 60 * 1000)
  expect(sent.length).toBe(1)

  // calm down, then blow up again: a second post
  for (const t of ['ok', 'fine', 'thanks', 'next']) await say($, t)
  await say($, 'fucking hell, kurwa')
  await clock.advance(2 * 60 * 1000)
  expect(sent.length).toBe(2)
})

test('the strip shows a queued chip that opens the draft with Post now', { options: JAR }, async ($, on) => {
  const { clock, sent } = world(on, { slack: true })
  await say($, 'kurwa')
  await clock.advance(0)
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({
      plugin: 'wtf-meter', surface, component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } as never,
    })
    expect(await band.find({ key: 'preview' })).toBeDefined()
    expect(await band.find({ key: 'post-now' })).toBeUndefined()
    await band.press({ key: 'preview' })
    expect(await band.find({ type: 'Text', text: /in the swear jar, [a-z ]+ a deploy\./ })).toBeDefined()
    if (surface === 'desktop') await band.press({ key: 'post-now' })
    else await band.press({ key: 'preview' })
    await band.unmount()
  }
  expect(sent.length).toBe(1)
})
