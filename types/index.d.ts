export type Msg = { score: number; hits: number; worst: string | null }
/** Coins waiting to be posted to Slack, and the messages that put them in (local only). */
export type Pending = { cents: number; texts: string[] }

declare module 'claude-code' {
  interface PluginState {
    'wtf-meter': { msgs: Msg[]; isHidden: boolean; jarCents: number; pending: Pending | null }
  }
}
