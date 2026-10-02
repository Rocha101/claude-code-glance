/** One picture drawn in the chat: the source file and the PNG/image shown. */
export type Shot = { file: string; img: string; w: number; h: number; generation: number; error?: string }

declare module 'claude-code' {
  interface PluginState {
    'glance': { shots: Record<string, Shot>; generation: number }
  }
}
