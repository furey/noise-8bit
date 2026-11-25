import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { appRoot, ensureDir, ffmpeg, launchBrowser, mediaDir } from './demo-stage.mjs'

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: mediaDir },
    size: { type: 'string', default: '256' },
    fps: { type: 'string', default: '12' },
  },
})

const HOLD = 2
const PERIOD = 8
const CELLS = /<rect data-col="(\d+)" fill="(#[0-9a-f]{6})" x="(-?[\d.]+)" y="(-?[\d.]+)"([^>]*)\/>/g

const main = async () => {
  const source = await fs.readFile(path.join(appRoot, 'build', 'icon-source', 'icon.svg'), 'utf8')
  const svgs = Array.from({ length: PERIOD * HOLD }, (_, frame) => frameSvg({ source, frame }))
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'noise-icon-gif-'))
  await renderFrames({ svgs, size: Number(values.size), dir: work })
  await ensureDir(values.out)
  await encodeGif({ dir: work, fps: values.fps, out: path.join(values.out, 'app-icon.gif') })
  await ffmpeg(['-i', path.join(appRoot, 'build', 'icon.png'), '-vf', 'scale=512:512:flags=area', path.join(values.out, 'app-icon.png')])
  await fs.rm(work, { recursive: true })
  console.log(`app-icon.gif: ${svgs.length} frames at ${values.fps} fps; app-icon.png written`)
}

const frameSvg = ({ source, frame }) => {
  const grid = readGrid(source)
  const step = Math.floor(frame / HOLD)
  const blocks = grid.columns.flatMap(({ column, fill, x }) =>
    grid.columns[wrap(column - step, PERIOD)].ys.map(y => block({ column, fill, x, y, rest: grid.rest })))
  return `${source.slice(0, grid.start)}${blocks.join('')}${source.slice(grid.end)}`
}

const readGrid = source => {
  const matches = [...source.matchAll(CELLS)]
  const columns = matches.reduce((list, [, column, fill, x, y]) => {
    const index = Number(column)
    list[index] ??= { column: index, fill, x, ys: [] }
    list[index].ys.push(y)
    return list
  }, [])
  const last = matches.at(-1)
  return { columns, rest: matches[0][5], start: matches[0].index, end: last.index + last[0].length }
}

const block = ({ column, fill, x, y, rest }) => `<rect data-col="${column}" fill="${fill}" x="${x}" y="${y}"${rest}/>`

const wrap = (value, length) => ((value % length) + length) % length

const renderFrames = async ({ svgs, size, dir }) => {
  const browser = await launchBrowser()
  try {
    const page = await browser.newPage({ viewport: { width: size, height: size } })
    for (const [index, svg] of svgs.entries()) {
      const sized = svg.replace('width="1024" height="1024"', `width="${size}" height="${size}"`)
      await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${sized}`)
      await page.screenshot({ path: path.join(dir, `f${String(index).padStart(3, '0')}.png`), omitBackground: true })
    }
  } finally {
    await browser.close()
  }
}

const encodeGif = async ({ dir, fps, out }) => {
  const input = ['-framerate', fps, '-i', path.join(dir, 'f%03d.png')]
  const palette = path.join(dir, 'palette.png')
  await ffmpeg([...input, '-vf', 'palettegen=reserve_transparent=1:stats_mode=full', palette])
  await ffmpeg([...input, '-i', palette, '-lavfi', 'paletteuse=dither=none:alpha_threshold=128', '-loop', '0', out])
}

await main()
