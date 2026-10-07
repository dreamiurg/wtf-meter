export type Msg = { score: number; hits: number; worst: string | null }
/**
 * One blow-up: the coins and messages since the person was last calm (local only).
 * `queued` once the session reached Heated; `preview` is the exact line that will post.
 */
export type Pending = { cents: number; texts: string[]; queued: boolean; preview: string | null; pick: number; dueAt: number }

declare module 'claude-code' {
  interface PluginState {
    'wtf-meter': {
      msgs: Msg[]
      isHidden: boolean
      jarCents: number
      pending: Pending | null
      /** After a post or skip, until the level drops below Heated: no new queue. */
      cooling: boolean
      isPreviewOpen: boolean
      tick: number
    }
  }
}
