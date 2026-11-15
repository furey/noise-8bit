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

const FRAMES = 36
const GRADIENT = /x1="(-?[\d.]+)" y1="0" x2="(-?[\d.]+)" y2="0"/

const main = async () => {
  const source = await fs.readFile(path.join(appRoot, 'build', 'icon-source', 'icon.svg'), 'utf8')
  const svgs = Array.from({ length: FRAMES }, (_, frame) => frameSvg({ source, frame }))
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'noise-icon-gif-'))
  await renderFrames({ svgs, size: Number(values.size), dir: work })
  await ensureDir(values.out)
  await encodeGif({ dir: work, fps: values.fps, out: path.join(values.out, 'app-icon.gif') })
  await ffmpeg(['-i', path.join(appRoot, 'build', 'icon.png'), '-vf', 'scale=512:512:flags=area', path.join(values.out, 'app-icon.png')])
  await fs.rm(work, { recursive: true })
  console.log(`app-icon.gif: ${svgs.length} frames at ${values.fps} fps; app-icon.png written`)
}

const frameSvg = ({ source, frame }) => source.replace(GRADIENT, (_, x1, x2) => {
  const span = Number(x2) - Number(x1)
  const shift = frame / FRAMES * span * 2
  return `spreadMethod="reflect" x1="${Number(x1) + shift}" y1="0" x2="${Number(x2) + shift}" y2="0"`
})

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
