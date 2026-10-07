export type Msg = { score: number; hits: number; worst: string | null }

declare module 'claude-code' {
  interface PluginState {
    'wtf-meter': { msgs: Msg[]; isHidden: boolean }
  }
}
