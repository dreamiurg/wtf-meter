import { expect, mock, test } from 'claude-code/testing'

import { cleanTopic, postText, TOPICS } from '../hooks/jar'

const JAR = { mode: 'jar', name: 'Dima', slackWebhookUrl: 'https://hooks.slack.test/T/B/X' }

test('a Slack post can only say a topic from the list', async () => {
  expect(cleanTopic('a flaky test')).toBe('a flaky test')
  expect(cleanTopic(' "CI". ')).toBe('CI')
  // anything else, including the model echoing the user's words, becomes "something"
  expect(cleanTopic('the payments-service deploy for ACME')).toBe('something')
  expect(cleanTopic(undefined)).toBe('something')
  for (const t of TOPICS) expect(/[0-9/@`_]/.test(t)).toBe(false)
})

test('post text is name, amount, topic; a full jar adds the beer run', async () => {
  expect(postText('Dima', 250, 'a release', 1000, 0)).toBe('🫙 Dima put $2.50 in the swear jar, fighting a release.')
  expect(postText('', 75, 'CI', 2050, 0)).toContain("That fills Someone's jar: $20.50 in all. Beer run!")
})

test('jar mode posts a sanitized line after the delay, never the prompt', { options: JAR }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const posts: string[] = []
  const toasts: string[] = []
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } as never })
  on('model.complete', () => ({ value: { isAnswered: true, text: 'a deploy', usage: {} } }) as never)
  on('http.fetch', (_$, e) => {
    posts.push(JSON.parse(String(e.init?.body)).text)
    return { value: { status: 200, ok: true, headers: {}, text: 'ok' } } as never
  })

  const secret = 'ACME-4471 prod-db password leak, fucking hell'
  await $.prompt.submit({ text: secret, wait: false, origin: { kind: 'composer' } })
  expect(toasts[0]).toContain('+$1.00 in the jar')
  expect(posts).toEqual([])

  await clock.advance(2 * 60 * 1000)
  expect(posts.length).toBe(1)
  expect(posts[0]).toMatch(/^🫙 Dima put \$1\.00 in the swear jar, [a-z ]+ a deploy\.$/)
  expect(posts[0]).not.toContain('ACME')
})

test('/wtf skip cancels the waiting post', { options: JAR }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const posts: unknown[] = []
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('http.fetch', () => { posts.push(1); return { value: { status: 200, ok: true, headers: {}, text: 'ok' } } as never })

  await $.prompt.submit({ text: 'kurwa', wait: false, origin: { kind: 'composer' } })
  const r = await $.command.run({ command: 'wtf', args: 'skip' } as never)
  expect(JSON.stringify(r)).toContain('skipped the Slack post for $0.75')
  await clock.advance(5 * 60 * 1000)
  expect(posts).toEqual([])
})
