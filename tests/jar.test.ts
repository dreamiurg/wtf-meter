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
  for (const t of TOPICS) expect(/[0-9/@`_]/.test(t)).toBe(false)
})

test('post text is amount and topic; a full jar adds the beer run', async () => {
  expect(postText(250, 'a release', 1000, 0)).toBe('🫙 +$2.50 in the swear jar, fighting a release.')
  expect(postText(75, 'CI', 2050, 0)).toContain('That fills my jar: $20.50 in all. Beer run!')
  expect(channelIdIn('#swear-jar (C07ABCDEF12) 3 members')).toBe('C07ABCDEF12')
})

test('the channel setting takes a name, an ID or both, and always reads as a name', async () => {
  expect(parseChannel('#swear-jar C0C7JH2AC6N')).toEqual({ name: 'swear-jar', id: 'C0C7JH2AC6N' })
  expect(parseChannel('swear-jar')).toEqual({ name: 'swear-jar', id: '' })
  expect(parseChannel('C0C7JH2AC6N')).toEqual({ name: '', id: 'C0C7JH2AC6N' })
  expect(channelLabel(parseChannel('C0C7JH2AC6N'))).toBe('the Slack channel')
  expect(channelLabel(parseChannel('swear-jar C0C7JH2AC6N'))).toBe('#swear-jar')
})

/** Stands in for the session: a Slack connector whose send takes `text`, not `message`. */
function world(on: On, opts: { slack: boolean }) {
  const clock = mock.clock(on)
  mock.store(on)
  const sent: Record<string, unknown>[] = []
  const toasts: string[] = []
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } as never })
  on('model.complete', () => ({ value: { isAnswered: true, text: 'a deploy', usage: {} } }) as never)
  on('tool.list', () => ({ value: opts.slack ? [{ name: 'Read', description: '', mcp: false }, { name: SEND, description: '', mcp: true }] : [] }) as never)
  on('mcp.call', (_$, e) => {
    if (e.tool === 'slack_search_channels') return { value: { isError: false, content: [{ type: 'text', text: '#swear-jar C07ABCDEF12' }] } } as never
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
  expect(sent[0]!.channel_id).toBe('C07ABCDEF12')
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
