import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Shot } from '../types'

const W = 1280
const H = 900
const PAD = 48 // px kept below the last content
// image px per terminal column; ~8px cells are typical, so 12 draws at ~0.7x. GLANCE_CELL_PX tunes it
const CELL_PX = 12
// terminal cell height / width when the terminal doesn't report its pixels; GLANCE_CELL_RATIO overrides
const CELL_RATIO = 2.25
const HTML = /\.html?$/i
const IMG = /\.(png|jpe?g|gif|webp|bmp|svg)$/i
const BROWSERS = ['chromium', 'google-chrome-stable', 'google-chrome']

const shots = atom({ plugin: 'glance', key: 'shots' } as const, {})
const generation = atom({ plugin: 'glance', key: 'generation' } as const, 0)

// GLANCE_MODE=image|cells overrides; else kitty-protocol terminals get real pixels
async function wantsImage($: EngineInterface) {
  const mode = await $.env.get('GLANCE_MODE')
  if (mode) return mode === 'image'
  if (await $.env.get('CLAUDE_CODE_FORCE_TERMINAL_IMAGES')) return true
  const term = `${(await $.env.get('TERM')) ?? ''} ${(await $.env.get('TERM_PROGRAM')) ?? ''}`
  return /kitty|ghostty|wezterm/i.test(term)
}

// cut the empty band under the page's content: a fixed window is mostly blank on short pages
async function cropToContent($: EngineInterface, img: string) {
  const box = await $.process.run(['magick', img, '-fuzz', '3%', '-format', '%@', 'info:'])
  const m = /^(\d+)x(\d+)\+(\d+)\+(\d+)/.exec(box.stdout)
  if (box.exitCode || !m) return H
  const h = Math.min(H, Number(m[2]) + Number(m[4]) + PAD)
  if (h >= H) return H
  const cut = await $.process.run(['magick', img, '-crop', `${W}x${h}+0+0`, '+repage', img])
  return cut.exitCode ? H : h
}

async function shoot($: EngineInterface, id: string, path: string): Promise<Shot> {
  await update($, generation, n => n + 1)
  const gen = await read($, generation)
  const real = await $.process.run(['realpath', '-e', path])
  const file = real.stdout.trim() || path
  let shot: Shot = { file, img: file, w: W, h: H, generation: gen }
  if (real.exitCode) shot.error = `not found: ${path}`
  else if (HTML.test(file)) {
    // note: one png per shot in /dev/shm, gone on reboot
    shot.img = `/dev/shm/claude-glance-${gen}.png`
    shot.error = 'no chromium/google-chrome found'
    for (const bin of BROWSERS) {
      try {
        const r = await $.process.run(
          [bin, '--headless', '--disable-gpu', '--hide-scrollbars', `--window-size=${W},${H}`,
            `--screenshot=${shot.img}`, `file://${file}`],
          { timeoutMs: 30_000 },
        )
        shot.error = r.exitCode ? r.stderr.slice(-300) : undefined
        if (!shot.error) shot.h = await cropToContent($, shot.img)
        break
      } catch {
        // binary missing, try next
      }
    }
  } else {
    const size = await $.process.run(['magick', 'identify', '-format', '%w %h', `${file}[0]`])
    const [w, h] = size.stdout.split(' ').map(Number)
    if (size.exitCode || !w || !h) shot.error = `cannot read image: ${file}`
    else {
      const img = `/dev/shm/claude-glance-${gen}.png`
      const conv = await $.process.run(['magick', `${file}[0]`, '-resize', '1600x1600>', img])
      shot = conv.exitCode ? { ...shot, error: `cannot convert image: ${file}` } : { ...shot, img, w, h }
    }
  }
  await update($, shots, all => ({ ...all, [id]: shot }))
  return shot
}

// quadrant glyph per fg bitmask (tl=1 tr=2 bl=4 br=8)
const QUAD = [0x20, 0x2598, 0x259d, 0x2580, 0x2596, 0x258c, 0x259e, 0x259b,
  0x2597, 0x259a, 0x2590, 0x259c, 0x2584, 0x2599, 0x259f, 0x2588]

const cellCache = new Map<string, string>()

async function toCells($: EngineInterface, s: Shot, cols: number, rows: number) {
  const key = `${s.generation}:${cols}x${rows}`
  const hit = cellCache.get(key)
  if (hit) return hit
  const raw = `/dev/shm/claude-glance-${s.generation}.rgb`
  const r = await $.process.run(['magick', `${s.img}[0]`, '-resize', `${cols * 2}x${rows * 2}!`, '-depth', '8', `rgb:${raw}`])
  if (r.exitCode) return undefined
  const px = Uint8Array.fromBase64((await $.fs.read(raw, { as: 'bytes' })).base64)
  const pw = cols * 2
  const out = new Uint32Array(cols * rows * 3)
  const p = [0, 0, 0, 0].map(() => [0, 0, 0])
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      for (let k = 0; k < 4; k++) {
        const i = ((y * 2 + (k >> 1)) * pw + x * 2 + (k & 1)) * 3
        p[k] = [px[i] ?? 0, px[i + 1] ?? 0, px[i + 2] ?? 0]
      }
      // try each 2-colour split of the 4 pixels, keep the least error
      let best = { err: Infinity, mask: 0, fg: 0, bg: 0 }
      for (let mask = 0; mask < 8; mask++) {
        const mean = (on: boolean) => {
          const sum = [0, 0, 0]
          let n = 0
          for (let k = 0; k < 4; k++) if (((mask >> k) & 1) === +on) { n++; for (let c = 0; c < 3; c++) sum[c]! += p[k]![c]! }
          return n ? sum.map(v => v / n) : [0, 0, 0]
        }
        const fg = mean(true)
        const bg = mean(false)
        let err = 0
        for (let k = 0; k < 4; k++) {
          const m = (mask >> k) & 1 ? fg : bg
          for (let c = 0; c < 3; c++) err += (p[k]![c]! - m[c]!) ** 2
        }
        if (err < best.err) {
          const rgb = (v: number[]) => (Math.round(v[0]!) << 16) | (Math.round(v[1]!) << 8) | Math.round(v[2]!)
          best = { err, mask, fg: rgb(fg), bg: rgb(bg) }
        }
      }
      const c = (y * cols + x) * 3
      out[c] = QUAD[best.mask]!
      out[c + 1] = best.fg
      out[c + 2] = best.bg
    }
  }
  const cells = new Uint8Array(out.buffer).toBase64()
  cellCache.set(key, cells)
  return cells
}

// the terminal's cell size in pixels, from Claude Code's own pty (TIOCGWINSZ); undefined where
// the terminal doesn't report pixels. Cached briefly: a resize shows up within a few seconds
const PTY_PROBE = `
import fcntl, os, struct, termios
p = os.getppid()
for n in (0, 1, 2):
    try:
        t = os.readlink(f"/proc/{p}/fd/{n}")
        if t.startswith("/dev/pts") or t.startswith("/dev/tty"):
            f = os.open(t, os.O_RDONLY | os.O_NOCTTY)
            r, c, x, y = struct.unpack("HHHH", fcntl.ioctl(f, termios.TIOCGWINSZ, bytes(8)))
            print(c, r, x, y)
            break
    except Exception:
        pass
`
type Cell = { w: number; h: number }
let ptyCell: { at: number; cell: Cell | undefined } | undefined

async function cellSize($: EngineInterface): Promise<Cell | undefined> {
  const now = await $.clock.now()
  if (ptyCell && now - ptyCell.at < 5000) return ptyCell.cell
  let cell: Cell | undefined
  try {
    const r = await $.process.run(['python3', '-c', PTY_PROBE], { timeoutMs: 3000 })
    const [c, rows, x, y] = r.stdout.trim().split(' ').map(Number)
    if (c && rows && x && y) cell = { w: x / c, h: y / rows }
  } catch {
    // no python3: fall back to the estimates
  }
  ptyCell = { at: now, cell }
  return cell
}

// the picture resized to exactly the box's pixels (Lanczos + light sharpening), so the terminal
// draws it 1:1 instead of scaling it with its own softer filter
const fitCache = new Map<string, string>()

async function fitted($: EngineInterface, s: Shot, cols: number, rows: number, cell: Cell | undefined) {
  if (!cell) return s.img
  const w = Math.round(cols * cell.w)
  const h = Math.round(rows * cell.h)
  const key = `${s.generation}:${w}x${h}`
  const hit = fitCache.get(key)
  if (hit) return hit
  const out = `/dev/shm/claude-glance-${s.generation}-${w}x${h}.png`
  const r = await $.process.run(['magick', `${s.img}[0]`, '-filter', 'Lanczos', '-resize', `${w}x${h}`, '-unsharp', '0x0.6+0.6+0', out])
  const img = r.exitCode ? s.img : out
  fitCache.set(key, img)
  return img
}

const GAP = 2 // columns between images in a row
const MIN_TILE = 36 // columns an image gets at least before the row wraps
const WIDE = 160 // chat columns from which pictures stop at half the width

type ResolveArg = Parameters<EngineInterface['ui']['resolve']>[0]

async function tile($: EngineInterface, e: ResolveArg, s: Shot, cols: number, rows: number, caption: boolean, cell: Cell | undefined) {
  if (e.surface !== 'terminal') return null
  const { Box, Text, Image, Raster } = $.ui.resolve(e)
  const name = s.file.split('/').pop() ?? s.file
  if (s.error) return <Text color="red">glance: {s.error}</Text>
  let pic
  if (await wantsImage($)) {
    const { base64 } = await $.fs.read(await fitted($, s, cols, rows, cell), { as: 'bytes' })
    pic = <Image source={{ png: base64 }} columns={cols} rows={rows} alt={s.file} />
  } else {
    const cells = await toCells($, s, cols, rows)
    pic = cells ? <Raster key={`p${s.generation}`} columns={cols} rows={rows} cells={cells} /> : <Text color="red">glance: resize failed (magick)</Text>
  }
  return (
    <Box flexDirection="column" width={cols}>
      {pic}
      {caption && <Text dimColor wrap="truncate-end">{name}</Text>}
    </Box>
  )
}

// justified rows: as many images per row as fit at MIN_TILE columns, all of a row one height,
// that height filling the width but never past any image's natural size (px / cellPx: no upscale)
async function gallery($: EngineInterface, e: ResolveArg, list: Shot[], width: number) {
  const { Box, Text } = $.ui.resolve(e)
  if (e.surface !== 'terminal') return <Text dimColor>Pictures draw in the terminal only.</Text>
  // wide chat (one pane, full screen): at most half of it; split chat: the whole width
  const avail = Math.max(1, Math.min(255, width >= WIDE ? Math.floor(width / 2) : width - 4))
  const cell = await cellSize($)
  const ratio = Number(await $.env.get('GLANCE_CELL_RATIO')) || (cell ? cell.h / cell.w : CELL_RATIO)
  const cellPx = Number(await $.env.get('GLANCE_CELL_PX')) || CELL_PX
  const perRow = Math.max(1, Math.min(list.length, Math.floor((avail + GAP) / (MIN_TILE + GAP))))
  const ok = list.filter(s => !s.error)
  const rows = []
  for (const s of list.filter(s => s.error)) rows.push(await tile($, e, s, 1, 1, false, cell))
  for (let i = 0; i < ok.length; i += perRow) {
    const row = ok.slice(i, i + perRow)
    // an image `a = w/h` wide is ratio * a * rows columns
    const aspect = row.map(s => s.w / s.h)
    const fill = (avail - GAP * (row.length - 1)) / (ratio * aspect.reduce((x, y) => x + y, 0))
    const natural = Math.min(...row.map(s => s.h / cellPx / ratio))
    const height = Math.max(1, Math.min(255, Math.floor(Math.min(fill, natural))))
    const tiles = []
    for (const [k, s] of row.entries()) {
      const cols = Math.max(1, Math.min(avail, Math.round(ratio * aspect[k]! * height)))
      tiles.push(await tile($, e, s, cols, height, list.length > 1, cell))
    }
    rows.push(<Box flexDirection="row" gap={GAP} alignItems="flex-start">{tiles}</Box>)
  }
  return <Box flexDirection="column" rowGap={1}>{rows}</Box>
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'glance', description: 'Show images or HTML pages inline in the chat: /glance <file> [more files...]' })
    return next(e)
  })

  on('command.run', { command: 'glance' }, async ($, e) => {
    // note: paths split on spaces, so a path with a space in it is not supported
    const paths = e.args.trim().split(/\s+/).filter(Boolean)
    if (paths.length === 0) return { text: 'Usage: /glance <file.html | image> [more files...]' }
    const done: Shot[] = []
    for (const [i, path] of paths.entries()) done.push(await shoot($, `cmd:${e.args.trim()}#${i}`, path))
    const bad = done.filter(s => s.error)
    return { text: bad.length ? bad.map(s => `glance: ${s.error}`).join('\n') : `Rendered ${done.map(s => s.file).join(', ')}` }
  })

  // Claude writes/edits an .html or reads an image → picture under that tool row
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const path = e.tool === 'Write' || e.tool === 'Edit' ? e.file_path : e.tool === 'Read' ? e.file_path : undefined
    const wanted = path && (HTML.test(path) || (e.tool === 'Read' && IMG.test(path)))
    if (wanted && !ran.deny && !ran.isError) await shoot($, e.tool_use_id, path)
    return ran
  })

  on('ui.render', { component: 'CommandOutput', props: { command: 'glance' } }, async ($, e, next) => {
    const all = await read($, shots)
    const list: Shot[] = []
    for (let i = 0; all[`cmd:${e.props.args.trim()}#${i}`]; i++) list.push(all[`cmd:${e.props.args.trim()}#${i}`]!)
    const { Box } = $.ui.resolve(e)
    const row = await next(e)
    if (list.length === 0) return row
    return <Box flexDirection="column">{row}{await gallery($, e, list, e.viewport?.columns ?? 80)}</Box>
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const row = await next(e)
    const s = (await read($, shots))[e.props.tool_use_id]
    if (!s || e.props.isErrored) return row
    const { Box } = $.ui.resolve(e)
    return <Box flexDirection="column">{row}{await gallery($, e, [s], e.viewport?.columns ?? 80)}</Box>
  })

  // reads/edits fold into one summary line ("Read 1 file"): draw under it
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const row = await next(e)
    const all = await read($, shots)
    const found = e.props.calls.flatMap(c => (c.tool_use_id && all[c.tool_use_id] ? [all[c.tool_use_id]!] : []))
    if (found.length === 0) return row
    const { Box } = $.ui.resolve(e)
    return <Box flexDirection="column">{row}{await gallery($, e, found, e.viewport?.columns ?? 80)}</Box>
  })
}
