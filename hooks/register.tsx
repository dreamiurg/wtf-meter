import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Msg, Pending } from '../types'
import { channelIdIn, channelLabel, channelLink, cleanTopic, parseChannel, CENTS_PER_POINT, JAR_CENTS, money, postText, topicPrompt } from './jar'
import { blueyStatus, blueyVersion, streak } from './bluey'
import { LEVELS, levelOf, score, stampColor } from './lexicon'

const msgs = atom({ plugin: 'wtf-meter', key: 'msgs' } as const, [])
const isHidden = atom({ plugin: 'wtf-meter', key: 'isHidden' } as const, false)
const jarCents = atom({ plugin: 'wtf-meter', key: 'jarCents' } as const, 0)
const pending = atom({ plugin: 'wtf-meter', key: 'pending' } as const, null)
const cooling = atom({ plugin: 'wtf-meter', key: 'cooling' } as const, false)
const isPreviewOpen = atom({ plugin: 'wtf-meter', key: 'isPreviewOpen' } as const, false)
const tick = atom({ plugin: 'wtf-meter', key: 'tick' } as const, 0)

const JAR_KEY = 'jarCents' // $.store: the jar outlives the session, like a real one
const POST_DELAY_MS = 2 * 60 * 1000
const JAR_COLOR = '#c39a1c'
const BLUEY_COLOR = '#3f7fc4'
const SWAP_COLOR = '#d9963f'
const STREAK_TOAST = 5 // a clean run this long gets a toast when it breaks

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
const cfg = { mode: 'meter', jarOnlyFor: '', jar: undefined as boolean | undefined, channel: '', onlyFor: '', name: '', id: '' }
let timer: { cancel: () => void } | undefined
let ticker: { cancel: () => void } | undefined // redraws the countdown while a post waits

async function showStatus($: EngineInterface) {
  if (await jarMode($)) return $.ui.status(jarStatus(await read($, jarCents)))
  const list = await read($, msgs)
  if (cfg.mode === 'bluey') return $.ui.status(blueyStatus(streak(list.map(m => m.swaps))))
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

  let channel = cfg.id || String((await $.store.get(`channel:${cfg.name}`)) ?? '')
  if (!channel) {
    const found = await $.mcp
      .call(server, 'slack_search_channels', { query: cfg.name })
      .catch(() => undefined)
    channel = (found && !found.isError && channelIdIn(textOf(found))) || ''
    if (!channel) return `couldn't find ${channelLabel(cfg)}. Add its ID (C…) after the name in the channel setting.`
    await $.store.set(`channel:${cfg.name}`, channel)
  }

  let last = ''
  for (const args of [{ channel_id: channel, message: text }, { channel_id: channel, text }]) {
    const r = await $.mcp.call(server, 'slack_send_message', args).catch((err: unknown) => ({ isError: true, content: [{ type: 'text', text: String(err) }] }))
    if (!r.isError) return null
    last = textOf(r)
  }
  return last.slice(0, 160) || 'Slack refused the message.'
}

// The signed-in account: the desktop app sets CLAUDE_CODE_USER_EMAIL; elsewhere set
// WTF_METER_ACCOUNT_EMAIL. An account the mod can't see never matches.
async function accountIs($: EngineInterface, suffix: string) {
  const email = ((await $.env.get('WTF_METER_ACCOUNT_EMAIL')) ?? (await $.env.get('CLAUDE_CODE_USER_EMAIL')) ?? '').toLowerCase()
  return email !== '' && email.endsWith(suffix)
}

// Jar mode, unless jarOnlyFor names another account; that account gets the meter.
async function jarMode($: EngineInterface) {
  cfg.jar ??= cfg.mode === 'jar' && (!cfg.jarOnlyFor || (await accountIs($, cfg.jarOnlyFor)))
  return cfg.jar
}

// Posts only from the account slackOnlyFor names, and only in jar mode.
async function canPost($: EngineInterface) {
  if (!cfg.channel || !(await jarMode($))) return false
  return !cfg.onlyFor || accountIs($, cfg.onlyFor)
}

const HEATED = LEVELS[2].min

async function topicFor($: EngineInterface, texts: readonly string[]) {
  const r = await $.model
    .complete({ model: 'haiku', prompt: topicPrompt(texts), maxTokens: 16, timeoutMs: 20000 })
    .catch(() => undefined)
  return cleanTopic(r?.isAnswered ? r.text : undefined) // no answer: "something", still posts
}

// Drafts the exact line that will post; redrafted when a new swear changes the amount.
async function draft($: EngineInterface) {
  const b = await read($, pending)
  if (!b?.queued) return
  const text = postText(b.cents, await topicFor($, b.texts), await read($, jarCents), b.pick)
  const isFirst = !b.preview
  await update($, pending, p => (p && p.cents === b.cents ? { ...p, preview: text } : p))
  if (isFirst) $.ui.toast(`Queued for ${channelLabel(cfg)}: ${text} Posts in 2 min; /wtf skip cancels.`)
}

function arm($: EngineInterface, ms: number) {
  timer?.cancel()
  ticker?.cancel()
  timer = $.clock.after(Math.max(0, ms), () => void flush($))
  ticker = $.clock.every(15000, () => void update($, tick, n => n + 1))
}

function disarm() {
  timer?.cancel()
  ticker?.cancel()
  timer = undefined
  ticker = undefined
}

// Adds a message to the current blow-up and queues the post once the session is Heated.
async function track($: EngineInterface, text: string | null, cents: number, avg: number) {
  const heated = avg >= HEATED
  if (!heated) await update($, cooling, () => false)
  let p: Pending | null = await read($, pending)
  if (text) {
    p = p
      ? { ...p, cents: p.cents + cents, texts: [...p.texts, text] }
      : { cents, texts: [text], queued: false, preview: null, pick: Math.random(), dueAt: 0 }
  }
  if (p && !p.queued && avg < LEVELS[1].min) p = null // calmed down without a blow-up
  if (p && !p.queued && heated && !(await read($, cooling))) {
    p = { ...p, queued: true, dueAt: (await $.clock.now()) + POST_DELAY_MS }
    arm($, POST_DELAY_MS)
  }
  await update($, pending, () => p)
  if (p?.queued && text) $.clock.after(0, () => void draft($))
}

// Posts the previewed line, once the delay is up or on Post now.
async function flush($: EngineInterface) {
  disarm()
  const b = await read($, pending)
  if (!b?.queued) return
  await update($, pending, () => null)
  await update($, cooling, () => true)
  await update($, isPreviewOpen, () => false)
  if (!(await canPost($))) return
  const text = b.preview ?? postText(b.cents, await topicFor($, b.texts), await read($, jarCents), b.pick)
  const failed = await sendToSlack($, text)
  $.ui.toast(failed ? `Swear jar: Slack post failed: ${failed}` : `Posted to ${channelLabel(cfg)}: ${text}`)
}

async function skip($: EngineInterface) {
  disarm()
  const had = await read($, pending)
  await update($, pending, () => null)
  await update($, isPreviewOpen, () => false)
  if (had?.queued) await update($, cooling, () => true)
  return had?.queued ? had : null
}

export const register: Register = (on, options) => {
  cfg.mode = String(options.mode ?? 'meter')
  cfg.jarOnlyFor = String(options.jarOnlyFor ?? '').trim().toLowerCase()
  cfg.jar = undefined
  cfg.channel = String(options.slackChannel ?? '').trim()
  Object.assign(cfg, parseChannel(cfg.channel))
  cfg.onlyFor = String(options.slackOnlyFor ?? '').trim().toLowerCase()

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'wtf', description: 'WTF meter: show the strip again and print the tally', argumentHint: '[skip]' })
    if (await jarMode($)) {
      const kept = Number((await $.store.get(JAR_KEY)) ?? 0)
      await update($, jarCents, () => kept)
      // A reload drops timers; a queued post gets its timer back.
      const waiting = await read($, pending)
      if (waiting?.queued && (await canPost($))) arm($, waiting.dueAt - (await $.clock.now()))
    }
    await showStatus($)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (!isTyped(e.origin)) return next(e)
    const s = score(e.text)

    const msg: Msg = { score: s.total, hits: s.hits.length, worst: worstOf(s.hits), swaps: s.hits.filter(h => h.w >= 2).length }
    const list = await update($, msgs, l => [...l, msg].slice(-500))

    if (await jarMode($)) {
      const cents = s.total * CENTS_PER_POINT
      if (cents) {
        const total = await update($, jarCents, c => c + cents)
        await $.store.set(JAR_KEY, total)
        const full = Math.floor(total / JAR_CENTS) > Math.floor((total - cents) / JAR_CENTS)
        $.ui.toast(`🪙 +${money(cents)} in the jar (${money(total)}).${full ? ' 🍺 Jar full: beer run!' : ''}`)
      }
      if (await canPost($)) await track($, cents ? e.text : null, cents, levelOf(list.map(m => m.score)).avg)
      await showStatus($)
      return next(e)
    }

    if (cfg.mode === 'bluey') {
      const run = streak(list.slice(0, -1).map(m => m.swaps)).now
      const clean = msg.swaps ? blueyVersion(e.text) : null
      if (clean && run >= STREAK_TOAST) {
        $.ui.toast(`Streak over at ${run} clean messages. ${clean.swap[0]!.toUpperCase()}${clean.swap.slice(1)}`)
        await update($, isHidden, () => false) // a broken streak brings a hidden strip back
      }
      await showStatus($)
      return next(e)
    }

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
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (!isTyped(e.props.origin)) return next(e)
    // Bluey mode draws the child-friendly version; Claude still got what was typed.
    if (cfg.mode === 'bluey') {
      const clean = blueyVersion(e.props.text)
      if (!clean) return next(e)
      if (e.surface !== 'desktop') {
        return next({ ...e, props: { ...e.props, text: `${e.props.text}\n[bluey · ${clean.said.join(', ')} → ${clean.swap}]` } })
      }
      const { Box, Markdown, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column" gap={1}>
          <Markdown text={clean.markdown} />
          <Text dimColor>you typed: {clean.said.join(', ')}</Text>
        </Box>
      )
    }
    const s = score(e.props.text)
    if (!s.total) return next(e)
    const isJar = await jarMode($)
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
    const { Box, Text, Button, Link } = t
    const hide = <Button key="hide" label="Hide" onPress={() => update($, isHidden, () => true)} />

    if (await jarMode($)) {
      const cents = await read($, jarCents)
      const waiting = await read($, pending)
      if (!cents && !waiting) return next(e)
      if (await read($, isHidden)) {
        return <Button key="show" plain label={`🫙 ${money(cents)} ▸`} onPress={() => update($, isHidden, () => false)} />
      }
      const fill = (cents % JAR_CENTS) / JAR_CENTS
      const amount = <Text bold color={JAR_COLOR}>🫙 {money(cents)}</Text>
      const left = <Text dimColor> {money(JAR_CENTS - (cents % JAR_CENTS))} to a beer run </Text>
      // A queued post shows as a small chip; pressing it opens the draft with its controls.
      const queued = waiting?.queued ? waiting : null
      await read($, tick) // redraw the countdown
      const mins = queued ? Math.max(0, Math.ceil((queued.dueAt - (await $.clock.now())) / 60000)) : 0
      const chip = queued
        ? <Button key="preview" plain label={`↗ queued · ${mins ? `${mins} min` : '<1 min'}`} onPress={() => update($, isPreviewOpen, o => !o)} />
        : null
      const card = queued && (await read($, isPreviewOpen))
        ? (
          <Box flexDirection="column" borderStyle="round" borderColor={JAR_COLOR} paddingX={1}>
            <Box flexDirection="row" gap={1}>
              <Text dimColor>Posts to</Text>
              {cfg.id ? <Link href={channelLink(cfg.id)} label={channelLabel(cfg)} /> : <Text>{channelLabel(cfg)}</Text>}
              <Text dimColor>as you, in {mins ? `${mins} min` : 'under a minute'}</Text>
            </Box>
            <Text>{queued.preview ?? 'Drafting…'}</Text>
            <Box flexDirection="row" gap={1}>
              <Button key="post-now" label="Post now" onPress={() => void flush($)} />
              <Button key="skip" label="Skip" onPress={() => void skip($)} />
            </Box>
          </Box>
        )
        : null

      if (e.surface === 'terminal' || !('Svg' in t)) {
        const cells = 12
        const full = Math.round(fill * cells)
        return (
          <Box flexDirection="column">
            <Box flexDirection="row">
              {amount}
              <Text> </Text>
              <Text color={JAR_COLOR}>{'█'.repeat(full)}</Text>
              <Text dimColor>{'░'.repeat(cells - full)}</Text>
              {left}
              {chip}
              {hide}
            </Box>
            {card}
          </Box>
        )
      }
      const { Svg } = t
      const W = 200, H = 10
      const bar = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" rx="5" fill="#8a8f94" fill-opacity="0.25"/><rect width="${fill ? Math.max(6, W * fill) : 0}" height="${H}" rx="5" fill="${JAR_COLOR}"/></svg>`
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" alignItems="center" gap={1}>
            {amount}
            <Svg source={bar} alt={`Swear jar ${Math.round(fill * 100)}% full`} width={W} height={H} />
            {left}
            {chip}
            {hide}
          </Box>
          {card}
        </Box>
      )
    }

    const list = await read($, msgs)
    if (cfg.mode === 'bluey') {
      const k = streak(list.map(m => m.swaps))
      if (!k.total) return next(e)
      const head = `🍪 Clean for ${k.now}`
      if (await read($, isHidden)) {
        return <Button key="show" plain label={`${head} ▸`} onPress={() => update($, isHidden, () => false)} />
      }
      return (
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Text bold color={BLUEY_COLOR}>{head} message{k.now === 1 ? '' : 's'}</Text>
          <Box flexDirection="row">
            {list.slice(-12).map(m => <Text color={m.swaps ? SWAP_COLOR : BLUEY_COLOR}>●</Text>)}
          </Box>
          <Text dimColor>best {k.best} · {k.total} swap{k.total === 1 ? '' : 's'} this session</Text>
          {hide}
        </Box>
      )
    }
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
    if (await jarMode($)) return { text: `Swear jar: ${jarStatus(await read($, jarCents))}${(await canPost($)) ? `. Posting to ${channelLabel(cfg)}.` : cfg.channel ? `. Not posting to ${channelLabel(cfg)} from this account.` : '. Slack posting is off: no channel set.'}` }
    const list = await read($, msgs)
    if (cfg.mode === 'bluey') {
      const k = streak(list.map(m => m.swaps))
      return { text: k.total ? `Bluey mode: ${blueyStatus(k)}. Best streak ${k.best}.` : 'Bluey mode: nothing swapped yet.' }
    }
    if (!list.length) return { text: 'WTF meter: nothing counted yet.' }
    const words = list.map(m => m.worst).filter(Boolean).join(', ')
    return { text: `WTF meter: ${meterStatus(list)}${words ? `. Worst words: ${words}` : ''}` }
  })
}
