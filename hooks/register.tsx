import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Msg } from '../types'
import { levelOf, score, stampColor } from './lexicon'

const msgs = atom({ plugin: 'wtf-meter', key: 'msgs' } as const, [])
const isHidden = atom({ plugin: 'wtf-meter', key: 'isHidden' } as const, false)

// Only what the person typed counts: not task notifications, peers, plugins.
const NOT_TYPED = new Set([
  'task-notification', 'scheduled-trigger', 'peer', 'peer-send-message', 'projects-relay',
  'channel', 'coordinator', 'observer', 'observer-activity', 'auto-continuation', 'plugin',
  'unclassified',
])
const isTyped = (origin: { kind: string } | undefined) => !NOT_TYPED.has(origin?.kind ?? '')

const worstOf = (hits: { word: string; w: number }[]) =>
  hits.length ? [...hits].sort((a, b) => b.w - a.w)[0]!.word.toLowerCase() : null

function statusLine(list: readonly Msg[]) {
  const scores = list.map(m => m.score)
  const now = levelOf(scores)
  const before = levelOf(scores.slice(0, -1))
  const wtf = list.reduce((a, m) => a + m.hits, 0)
  const arrow = now.avg > before.avg ? ' ▲' : now.avg < before.avg ? ' ▼' : ''
  return `${now.level.dot} ${now.level.name} · ${wtf} WTF${wtf === 1 ? '' : 's'}${arrow}`
}

const showStatus = async ($: EngineInterface) => {
  const list = await read($, msgs)
  $.ui.status(list.length ? statusLine(list) : undefined)
}

export const register: Register = on => {
  // A reload keeps $.state; put the status line back.
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'wtf', description: 'Show the WTF meter strip again and print the session tally' })
    await showStatus($)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (!isTyped(e.origin)) return next(e)

    const s = score(e.text)
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
    const label = `+${s.total} · ${worstOf(s.hits)}`

    if (e.surface !== 'desktop') {
      return next({ ...e, props: { ...e.props, text: `${e.props.text}\n[WTF ${label}]` } })
    }
    const { Box, Markdown, Text } = $.ui.resolve(e)
    const color = stampColor(s.total)
    return (
      <Box flexDirection="column" gap={1}>
        <Markdown text={e.props.text} />
        <Box flexDirection="row">
          <Box borderStyle="round" borderColor={color} paddingX={1}>
            <Text color={color} bold>● {label}</Text>
          </Box>
        </Box>
      </Box>
    )
  })

  // Heat strip above the prompt: one bar per message.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, msgs)
    if (e.props.hasSurvey || !list.length) return next(e)

    const scores = list.map(m => m.score)
    const { level, avg } = levelOf(scores)
    const t = $.ui.resolve(e)
    const { Box, Text, Button } = t

    // Hidden collapses to one chip that opens the strip again.
    if (await read($, isHidden)) {
      return <Button key="show" plain label={`${level.dot} ${level.name} ▸`} onPress={() => update($, isHidden, () => false)} />
    }
    const before = levelOf(scores.slice(0, -1)).avg
    const trend = avg > before ? 'rising' : avg < before ? 'cooling' : 'steady'
    // Color each bar by the level the session was at when that message landed.
    const bars = scores.map((sc, i) => ({ sc, color: sc ? levelOf(scores.slice(0, i + 1)).level.color : null }))

    const hide = <Button key="hide" label="Hide" onPress={() => update($, isHidden, () => true)} />
    const label = <Text bold color={level.color}>{level.name}</Text>
    const tail = <Text dimColor> avg {avg.toFixed(2)} · {trend} </Text>

    if (e.surface === 'terminal') {
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

    if (!('Svg' in t)) return next(e)
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

  // Brings the strip back after Hide.
  on('command.run', { command: 'wtf' }, async $ => {
    await update($, isHidden, () => false)
    const list = await read($, msgs)
    if (!list.length) return { text: 'WTF meter: nothing counted yet.' }
    const words = list.map(m => m.worst).filter(Boolean).join(', ')
    return { text: `WTF meter: ${statusLine(list)}${words ? `. Worst words: ${words}` : ''}` }
  })
}

