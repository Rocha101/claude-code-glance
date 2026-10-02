import { expect, test } from 'claude-code/testing'

test('/glance draws the page inline under the command row', async ($, on) => {
  const ran: string[][] = []
  on('process.run', (_$, e) => {
    ran.push([...e.argv])
    const stdout = e.argv[0] === 'realpath' ? '/abs/page.html\n' : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='
  on('clock.now', () => ({ value: 0 }))
  on('fs.read', (_$, e) => ({
    value: { base64: e.path.endsWith('.png') ? PNG : new Uint8Array(512 * 512 * 3).fill(200).toBase64() },
  }))
  on('env.get', (_$, e) => ({ value: e.name === 'GLANCE_MODE' ? mode : undefined }))
  let mode: string | undefined
  // stands for the engine's own command row
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e); return <Text>row</Text> })

  const res = await $.command.run({
    command: 'glance', args: 'page.html',
    origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 },
  })
  expect(res.text).toBe('Rendered /abs/page.html')
  expect(ran[1]).toContain('file:///abs/page.html')

  const row = { plugin: 'glance', surface: 'terminal', component: 'CommandOutput',
    props: { command: 'glance', args: 'page.html', text: res.text ?? '', isErrored: false } } as const

  const cells = await $.ui.mount(row)
  expect(await cells.find({ type: 'Raster' })).toBeDefined()
  expect(ran.some(a => a[0] === 'magick')).toBe(true)
  await cells.unmount()

  mode = 'image'
  const image = await $.ui.mount(row)
  expect(await image.find({ type: 'Image' })).toBeDefined()
  await image.unmount()
})

test('/glance with several files lays them out side by side', async ($, on) => {
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='
  on('process.run', (_$, e) => {
    const out = e.argv[0] === 'realpath' ? `/abs/${e.argv[2]}\n` : e.argv[1] === 'identify' ? '800 600' : ''
    return { value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('clock.now', () => ({ value: 0 }))
  on('fs.read', () => ({ value: { base64: PNG } }))
  on('env.get', (_$, e) => ({ value: e.name === 'GLANCE_MODE' ? 'image' : undefined }))
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e); return <Text>row</Text> })

  const args = 'a.png b.png c.png'
  const res = await $.command.run({
    command: 'glance', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 },
  })
  expect(res.text).toBe('Rendered /abs/a.png, /abs/b.png, /abs/c.png')

  const ui = await $.ui.mount({ plugin: 'glance', surface: 'terminal', component: 'CommandOutput',
    viewport: { columns: 160, rows: 50 },
    props: { command: 'glance', args, text: res.text ?? '', isErrored: false } })
  expect((await ui.findAll({ type: 'Image' })).length).toBe(3)
  expect(await ui.find({ type: 'Text', text: 'b.png' })).toBeDefined()
  await ui.unmount()
})

test('pictures are resized to the exact pixels of their box when the terminal reports its cell size', async ($, on) => {
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='
  const ran: string[][] = []
  on('process.run', (_$, e) => {
    ran.push([...e.argv])
    const out = e.argv[0] === 'python3' ? '200 50 1800 1000\n' // 9x20 px cells
      : e.argv[0] === 'realpath' ? '/abs/shot.png\n' : e.argv[1] === 'identify' ? '1440 900' : ''
    return { value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('clock.now', () => ({ value: 0 }))
  on('fs.read', () => ({ value: { base64: PNG } }))
  on('env.get', (_$, e) => ({ value: e.name === 'GLANCE_MODE' ? 'image' : undefined }))
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e); return <Text>row</Text> })

  const res = await $.command.run({
    command: 'glance', args: 'shot.png', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 },
  })
  const ui = await $.ui.mount({ plugin: 'glance', surface: 'terminal', component: 'CommandOutput',
    viewport: { columns: 120, rows: 50 },
    props: { command: 'glance', args: 'shot.png', text: res.text ?? '', isErrored: false } })
  const image = await ui.find({ type: 'Image' })
  expect(image).toBeDefined()
  // 1440px / 12px per column = 120 cols, capped at 116; ratio 20/9 -> rows = 116 * (900/1440) / 2.22
  const resize = ran.find(a => a[0] === 'magick' && a.includes('Lanczos'))
  expect(resize).toBeDefined()
  const box = resize![resize!.indexOf('-resize') + 1]!
  const [pw, ph] = box.split('x').map(Number)
  expect(pw! % 9).toBe(0)
  expect(ph! % 20).toBe(0)
  await ui.unmount()
})

test('⤢ enlarges a picture to the whole chat width, ⤡ shrinks it back, ↗ opens the source', async ($, on) => {
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='
  const ran: string[][] = []
  on('process.run', (_$, e) => {
    ran.push([...e.argv])
    const out = e.argv[0] === 'realpath' ? '/abs/small.png\n' : e.argv[1] === 'identify' ? '400 300' : ''
    return { value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('clock.now', () => ({ value: 0 }))
  on('fs.read', () => ({ value: { base64: PNG } }))
  on('env.get', (_$, e) => ({ value: e.name === 'GLANCE_MODE' ? 'image' : undefined }))
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e); return <Text>row</Text> })

  const res = await $.command.run({
    command: 'glance', args: 'small.png', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 },
  })
  const ui = await $.ui.mount({ plugin: 'glance', surface: 'terminal', component: 'CommandOutput',
    viewport: { columns: 120, rows: 50 },
    props: { command: 'glance', args: 'small.png', text: res.text ?? '', isErrored: false } })
  const width = async () => Number(JSON.stringify(await ui.find({ type: 'Image' })).match(/"columns":(\d+)/)?.[1])

  const compact = await width()
  expect(compact).toBeLessThan(40) // 400px / 12 ≈ 33 columns
  await ui.press({ key: 'zoom1' })
  expect(await width()).toBeGreaterThan(108) // the whole chat width, less row rounding
  await ui.press({ key: 'zoom1' })
  expect(await width()).toBe(compact)

  await ui.press({ key: 'open1' })
  expect(ran.some(a => a.join(' ') === 'setsid -f xdg-open /abs/small.png')).toBe(true)
  await ui.unmount()
})
