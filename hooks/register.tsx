import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Msg } from '../types'
import { channelIdIn, cleanTopic, CENTS_PER_POINT, JAR_CENTS, money, postText, topicPrompt } from './jar'
import { levelOf, score, stampColor } from './lexicon'

const msgs = atom({ plugin: 'wtf-meter', key: 'msgs' } as const, [])
const isHidden = atom({ plugin: 'wtf-meter', key: 'isHidden' } as const, false)
const jarCents = atom({ plugin: 'wtf-meter', key: 'jarCents' } as const, 0)
const pending = atom({ plugin: 'wtf-meter', key: 'pending' } as const, null)

const JAR_KEY = 'jarCents' // $.store: the jar outlives the session, like a real one
const POST_DELAY_MS = 2 * 60 * 1000
const JAR_COLOR = '#c39a1c'

// Only what the person typed counts: not task notifications, peers, plugins.
const NOT_TYPED = new Set([
  'task-notification', 'scheduled-trigger', 'peer', 'peer-send-message', 'projects-relay',
  'channel', 'coordinator', 'observer', 'observer-activity', 'auto-continuation', 'plugin',
  'unclassified',
])
const isTyped = (origin: { kind: string } | undefined) => !NOT_TYPED.has(origin?.kind ?? '')

const worstOf = (hits: { word: string; w: number }[]) =>
  hits.length ? [...hits].sort((a, b) => b.w - a.w)[0]!.word.toLowerCase() : null

function meterStatus(list: readonly Msg[]) {
  const scores = list.map(m => m.score)
  const now = levelOf(scores)
  const before = levelOf(scores.slice(0, -1))
  const wtf = list.reduce((a, m) => a + m.hits, 0)
  const arrow = now.avg > before.avg ? ' ▲' : now.avg < before.avg ? ' ▼' : ''
  return `${now.level.dot} ${now.level.name} · ${wtf} WTF${wtf === 1 ? '' : 's'}${arrow}`
}

const jarStatus = (cents: number) => `🫙 ${money(cents)} · ${money(JAR_CENTS - (cents % JAR_CENTS))} to a beer run`

// Set from the plugin's options when the module registers; a reload resets them.
const cfg = { isJar: false, channel: '', onlyFor: '' }
let timer: { cancel: () => void } | undefined

async function showStatus($: EngineInterface) {
  if (cfg.isJar) return $.ui.status(jarStatus(await read($, jarCents)))
  const list = await read($, msgs)
  $.ui.status(list.length ? meterStatus(list) : undefined)
}

const textOf = (r: { content: { type: string; text?: string }[] }) => r.content.map(c => c.text ?? '').join('\n')

// Posts through whatever Slack connector the session has: the first MCP tool
// named slack_send_message. Its argument names aren't documented, so the two
// common shapes are tried; a rejected shape posts nothing.
async function sendToSlack($: EngineInterface, text: string): Promise<string | null> {
  const tools = await $.tool.list()
  const send = tools.find(t => t.mcp && /__slack_send_message$/.test(t.name))
  if (!send) return 'no Slack connector in this session. Connect Slack in Claude, or clear the channel setting.'
  const server = send.name.slice('mcp__'.length, -'__slack_send_message'.length)

  let channel = /^[CG][A-Z0-9]{8,}$/.test(cfg.channel) ? cfg.channel : String((await $.store.get(`channel:${cfg.channel}`)) ?? '')
  if (!channel) {
    const found = await $.mcp
      .call(server, 'slack_search_channels', { query: cfg.channel.replace(/^#/, '') })
      .catch(() => undefined)
    channel = (found && !found.isError && channelIdIn(textOf(found))) || ''
    if (!channel) return `couldn't find channel ${cfg.channel}. Put its ID (C…) in the channel setting.`
    await $.store.set(`channel:${cfg.channel}`, channel)
  }

  let last = ''
  for (const args of [{ channel_id: channel, message: text }, { channel_id: channel, text }]) {
    const r = await $.mcp.call(server, 'slack_send_message', args).catch((err: unknown) => ({ isError: true, content: [{ type: 'text', text: String(err) }] }))
    if (!r.isError) return null
    last = textOf(r)
  }
  return last.slice(0, 160) || 'Slack refused the message.'
}

// Posts what the batch put in, once the delay is up, unless skipped.
async function flush($: EngineInterface) {
  timer = undefined
  const batch = await read($, pending)
  await update($, pending, () => null)
  if (!batch || !(await canPost($))) return

  const r = await $.model
    .complete({ model: 'haiku', prompt: topicPrompt(batch.texts), maxTokens: 12, timeoutMs: 20000 })
    .catch(() => undefined)
  const topic = cleanTopic(r?.isAnswered ? r.text : undefined) // no answer: "something", still posts
  const text = postText(batch.cents, topic, await read($, jarCents))
  const failed = await sendToSlack($, text)
  $.ui.toast(failed ? `Swear jar: Slack post failed: ${failed}` : `Posted to ${cfg.channel}: ${text}`)
}

// Posts only from the account slackOnlyFor names; an account it can't see never posts.
// The desktop app sets CLAUDE_CODE_USER_EMAIL; elsewhere set WTF_METER_ACCOUNT_EMAIL.
async function canPost($: EngineInterface) {
  if (!cfg.channel) return false
  if (!cfg.onlyFor) return true
  const email = ((await $.env.get('WTF_METER_ACCOUNT_EMAIL')) ?? (await $.env.get('CLAUDE_CODE_USER_EMAIL')) ?? '').toLowerCase()
  return email !== '' && email.endsWith(cfg.onlyFor)
}

async function skip($: EngineInterface) {
  timer?.cancel()
  timer = undefined
  const had = await read($, pending)
  await update($, pending, () => null)
  return had
}

export const register: Register = (on, options) => {
  cfg.isJar = options.mode === 'jar'
  cfg.channel = String(options.slackChannel ?? '').trim()
  cfg.onlyFor = String(options.slackOnlyFor ?? '').trim().toLowerCase()
  const { isJar } = cfg

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'wtf', description: 'WTF meter: show the strip again and print the tally', argumentHint: '[skip]' })
    if (isJar) {
      const kept = Number((await $.store.get(JAR_KEY)) ?? 0)
      await update($, jarCents, () => kept)
      // A reload drops timers; a batch still waiting gets a fresh one.
      if ((await read($, pending)) && (await canPost($))) timer = $.clock.after(POST_DELAY_MS, () => void flush($))
    }
    await showStatus($)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (!isTyped(e.origin)) return next(e)
    const s = score(e.text)

    if (isJar) {
      if (s.total) {
        const cents = s.total * CENTS_PER_POINT
        const total = await update($, jarCents, c => c + cents)
        await $.store.set(JAR_KEY, total)
        const posts = await canPost($)
        if (posts) {
          await update($, pending, p => ({ cents: (p?.cents ?? 0) + cents, texts: [...(p?.texts ?? []), e.text] }))
          if (!timer) timer = $.clock.after(POST_DELAY_MS, () => void flush($))
        }
        const full = Math.floor(total / JAR_CENTS) > Math.floor((total - cents) / JAR_CENTS)
        $.ui.toast(
          `🪙 +${money(cents)} in the jar (${money(total)}).${full ? ' 🍺 Jar full: beer run!' : ''}` +
            (posts ? ` Posting to ${cfg.channel} in 2 min; /wtf skip cancels.` : ''),
        )
      }
      await showStatus($)
      return next(e)
    }

    const msg: Msg = { score: s.total, hits: s.hits.length, worst: worstOf(s.hits) }
    const list = await update($, msgs, l => [...l, msg].slice(-500))
    const scores = list.map(m => m.score)
    const was = levelOf(scores.slice(0, -1)).level
    const now = levelOf(scores).level
    if (now !== was) {
      $.ui.toast(`${was.name} → ${now.name}. ${now.toast}`)
      await update($, isHidden, () => false) // a level change brings a hidden strip back
    }
    await showStatus($)
    return next(e)
  }).catch(($, e, next) => next(e)) // a counter must never block a prompt

  // Stamp each of your messages that scored: a colored pill under the bubble
  // on the desktop, a text line where only text draws.
  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    if (!isTyped(e.props.origin)) return next(e)
    const s = score(e.props.text)
    if (!s.total) return next(e)
    const label = isJar ? `🪙 +${money(s.total * CENTS_PER_POINT)} · ${worstOf(s.hits)}` : `+${s.total} · ${worstOf(s.hits)}`

    if (e.surface !== 'desktop') {
      return next({ ...e, props: { ...e.props, text: `${e.props.text}\n[${isJar ? 'jar' : 'WTF'} ${label}]` } })
    }
    const { Box, Markdown, Text } = $.ui.resolve(e)
    const color = isJar ? JAR_COLOR : stampColor(s.total)
    return (
      <Box flexDirection="column" gap={1}>
        <Markdown text={e.props.text} />
        <Box flexDirection="row">
          <Box borderStyle="round" borderColor={color} paddingX={1}>
            <Text color={color} bold>{isJar ? label : `● ${label}`}</Text>
          </Box>
        </Box>
      </Box>
    )
  })

  // The strip above the prompt: heat bars (meter) or the jar (jar).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const t = $.ui.resolve(e)
    const { Box, Text, Button } = t
    const hide = <Button key="hide" label="Hide" onPress={() => update($, isHidden, () => true)} />

    if (isJar) {
      const cents = await read($, jarCents)
      const waiting = await read($, pending)
      if (!cents && !waiting) return next(e)
      if (await read($, isHidden)) {
        return <Button key="show" plain label={`🫙 ${money(cents)} ▸`} onPress={() => update($, isHidden, () => false)} />
      }
      const fill = (cents % JAR_CENTS) / JAR_CENTS
      const amount = <Text bold color={JAR_COLOR}>🫙 {money(cents)}</Text>
      const left = <Text dimColor> {money(JAR_CENTS - (cents % JAR_CENTS))} to a beer run </Text>
      const skipBtn = waiting
        ? <Button key="skip" label={`Skip Slack post (${money(waiting.cents)})`} onPress={() => void skip($)} />
        : null

      if (e.surface === 'terminal' || !('Svg' in t)) {
        const cells = 12
        const full = Math.round(fill * cells)
        return (
          <Box flexDirection="row">
            {amount}
            <Text> </Text>
            <Text color={JAR_COLOR}>{'█'.repeat(full)}</Text>
            <Text dimColor>{'░'.repeat(cells - full)}</Text>
            {left}
            {skipBtn}
            {hide}
          </Box>
        )
      }
      const { Svg } = t
      const W = 200, H = 10
      const bar = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" rx="5" fill="#8a8f94" fill-opacity="0.25"/><rect width="${fill ? Math.max(6, W * fill) : 0}" height="${H}" rx="5" fill="${JAR_COLOR}"/></svg>`
      return (
        <Box flexDirection="row" alignItems="center" gap={1}>
          {amount}
          <Svg source={bar} alt={`Swear jar ${Math.round(fill * 100)}% full`} width={W} height={H} />
          {left}
          {skipBtn}
          {hide}
        </Box>
      )
    }

    const list = await read($, msgs)
    if (!list.length) return next(e)
    const scores = list.map(m => m.score)
    const { level, avg } = levelOf(scores)

    // Hidden collapses to one chip that opens the strip again.
    if (await read($, isHidden)) {
      return <Button key="show" plain label={`${level.dot} ${level.name} ▸`} onPress={() => update($, isHidden, () => false)} />
    }
    const before = levelOf(scores.slice(0, -1)).avg
    const trend = avg > before ? 'rising' : avg < before ? 'cooling' : 'steady'
    // Color each bar by the level the session was at when that message landed.
    const bars = scores.map((sc, i) => ({ sc, color: sc ? levelOf(scores.slice(0, i + 1)).level.color : null }))
    const label = <Text bold color={level.color}>{level.name}</Text>
    const tail = <Text dimColor> avg {avg.toFixed(2)} · {trend} </Text>

    if (e.surface === 'terminal' || !('Svg' in t)) {
      const room = Math.max(4, (e.props.bodyColumns ?? 80) - 40)
      const BLOCKS = '▁▂▃▄▅▆▇█'
      return (
        <Box flexDirection="row">
          {label}
          <Text> </Text>
          {bars.slice(-room).map(b => (
            <Text color={b.color ?? undefined} dimColor={!b.color}>
              {BLOCKS[Math.min(7, b.sc)]}
            </Text>
          ))}
          {tail}
          {hide}
        </Box>
      )
    }

    const { Svg } = t
    const shown = bars.slice(-60)
    const W = 360, H = 28, gap = 2
    const bw = Math.max(3, Math.min(14, (W - gap * shown.length) / shown.length))
    const max = Math.max(6, ...scores)
    const rects = shown
      .map((b, i) => {
        const h = b.sc ? Math.max(4, (b.sc / max) * H) : 2
        return `<rect x="${i * (bw + gap)}" y="${H - h}" width="${bw}" height="${h}" rx="1.5" fill="${b.color ?? '#8a8f94'}" fill-opacity="${b.color ? 1 : 0.4}"/>`
      })
      .join('')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${rects}</svg>`

    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        {label}
        <Svg source={svg} alt={`Swear score per message, now ${level.name}`} width={W} height={H} />
        {tail}
        {hide}
      </Box>
    )
  })

  // `/wtf` brings the strip back and prints the tally; `/wtf skip` cancels a waiting Slack post.
  on('command.run', { command: 'wtf' }, async ($, e) => {
    if (e.args.trim() === 'skip') {
      const had = await skip($)
      return { text: had ? `Swear jar: skipped the Slack post for ${money(had.cents)}. The coins stay in your jar.` : 'Swear jar: nothing waiting to post.' }
    }
    await update($, isHidden, () => false)
    if (isJar) return { text: `Swear jar: ${jarStatus(await read($, jarCents))}${(await canPost($)) ? `. Posting to ${cfg.channel}.` : cfg.channel ? `. Not posting to ${cfg.channel} from this account.` : '. Slack posting is off: no channel set.'}` }
    const list = await read($, msgs)
    if (!list.length) return { text: 'WTF meter: nothing counted yet.' }
    const words = list.map(m => m.worst).filter(Boolean).join(', ')
    return { text: `WTF meter: ${meterStatus(list)}${words ? `. Worst words: ${words}` : ''}` }
  })
}
