// Swear jar: coins per swear, and the one line it may post to Slack.
//
// Privacy by construction: a post is built only from the configured name, an
// amount and one topic from TOPICS. The model only picks a topic; any reply
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

export function postText(name: string, cents: number, topic: Topic, totalCents: number, pick = Math.random()): string {
  const who = name.trim() || 'Someone'
  const verb = VERBS[Math.floor(pick * VERBS.length) % VERBS.length]
  let text = `🫙 ${who} put ${money(cents)} in the swear jar, ${verb} ${topic}.`
  if (Math.floor(totalCents / JAR_CENTS) > Math.floor((totalCents - cents) / JAR_CENTS)) {
    text += ` 🍺 That fills ${who}'s jar: ${money(totalCents)} in all. Beer run!`
  }
  return text
}
