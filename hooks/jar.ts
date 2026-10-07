// Swear jar: coins per swear, and the one line it may post to Slack.
//
// Privacy by construction: a post is built only from an amount and one topic
// from TOPICS. The model only picks a topic; any reply
// that is not exactly one of them becomes "something". Nothing the person
// typed can reach Slack, whatever the model answers.

export const CENTS_PER_POINT = 25
export const JAR_CENTS = 2000

export const TOPICS = [
  'a flaky test', 'a failing build', 'CI', 'a deploy', 'a release', 'a merge conflict',
  'a bug', 'a database', 'a migration', 'dependencies', 'the type checker', 'performance',
  'a config file', 'an API', 'the AI itself', 'a code review', 'infrastructure', 'docs',
] as const
export type Topic = (typeof TOPICS)[number] | 'something'

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`

export function topicPrompt(texts: readonly string[]): string {
  return [
    'A developer swore at their AI coding assistant. Pick the ONE topic below that best names what they are frustrated with.',
    'Answer with the topic exactly as written and nothing else. If none fits, answer: something',
    '',
    'Topics:',
    ...TOPICS.map(t => `- ${t}`),
    '',
    'Their messages:',
    ...texts.map(t => `<message>${t.slice(0, 600)}</message>`),
  ].join('\n')
}

export function cleanTopic(reply: string | undefined): Topic {
  const t = (reply ?? '').trim().replace(/^[-*"'\s]+|["'.\s]+$/g, '').toLowerCase()
  return TOPICS.find(x => x.toLowerCase() === t) ?? 'something'
}

const VERBS = ['fighting', 'wrestling with', 'having words with', 'losing it at', 'yelling at']

/** The post, in the first person: the Slack connector posts as you. */
export function postText(cents: number, topic: Topic, totalCents: number, pick = Math.random()): string {
  const verb = VERBS[Math.floor(pick * VERBS.length) % VERBS.length]
  let text = `🫙 +${money(cents)} in the swear jar, ${verb} ${topic}.`
  if (Math.floor(totalCents / JAR_CENTS) > Math.floor((totalCents - cents) / JAR_CENTS)) {
    text += ` 🍺 That fills my jar: ${money(totalCents)} in all. Beer run!`
  }
  return text
}

/** A Slack channel id (C…, G…) in a tool result's text, if any. */
export const channelIdIn = (text: string) => /\b[CG][A-Z0-9]{8,}\b/.exec(text)?.[0]

/** `slackChannel` as written: a name, an ID, or both ("swear-jar C0C7JH2AC6N"). */
export function parseChannel(raw: string): { name: string; id: string } {
  const parts = raw.split(/[\s,|]+/).filter(Boolean)
  const id = parts.find(p => /^[CG][A-Z0-9]{8,}$/.test(p)) ?? ''
  const name = (parts.find(p => p !== id) ?? '').replace(/^#/, '')
  return { name, id }
}

/** How a channel reads to people: its name, never the raw ID. */
export const channelLabel = (c: { name: string }) => (c.name ? `#${c.name}` : 'the Slack channel')

/** Opens the channel in Slack, in any workspace the viewer belongs to. */
export const channelLink = (id: string) => `https://slack.com/app_redirect?channel=${id}`
