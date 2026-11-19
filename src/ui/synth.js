import { COLOUR_ROW_SHADES, LAST, LIGHT_INK, colourAt, inkRgb, isDarkInk, paletteFor, rgba, shadeRgb } from './colours.js'
import { COLOUR_ROWS, cellIndex, fillCell, musicCols, reservedCells, waveCol } from './grid.js'
import { chipSegment, reassignChips, stepChips } from './chips.js'
import { createRadial, drawFlock, drawRadial, isRadialSettled, linearShare, stepRadial } from './radial.js'
import { advanceIntro, cellReveal, createIntro, isIntroDone, INTRO_HOLD_MS, INTRO_STEPS } from './intro.js'
import { createStrip, stepStrip, stripCellAlpha } from './strip.js'
import { clearPixels, createPixels, emitPixels, pixelAlpha, stepPixels } from './pixels.js'
import { createSpectrum, decaySpectrum, readSpectrum, resizeSpectrum } from './spectrum.js'
import { TIMER_BLINK_LOW, TIMER_BLINK_MS, TIMER_OFF_ALPHA, timerAlpha, timerSize } from './timer.js'

const INK_TINT_S = 0.4
const DISABLED_ALPHA = 0.4
const INK_STEPS = 20
const INK_ALPHAS = [1, TIMER_BLINK_LOW, TIMER_OFF_ALPHA]
const SELECTOR_HALF = 1
const HOME_BAR_ALPHA = 0.3
const SELECTOR_FILL = rgba(LIGHT_INK, 1)
const HIDE_STYLES = Array.from({ length: INTRO_STEPS + 1 }, (_, step) => rgba([0, 0, 0], 1 - step / INTRO_STEPS))

export const createSynth = ({ spec, fx }) => {
  const view = {
    spec, fx,
    radial: createRadial(),
    g: spec.getContext('2d'),
    fg: fx.getContext('2d'),
    grid: null,
    chips: [],
    pixels: createPixels(),
    spectrum: createSpectrum(),
    bins: new Float32Array(0),
    tint: 0,
    wasPlaying: null,
    reserved: { grid: null, size: -1, music: '', piece: '', withMusic: null, plain: null },
    rowFills: [],
    gradients: new Map(),
    inks: buildInks(),
    intro: null,
    introDone: false,
    strip: createStrip({ locked: false }),
    fxPainted: false,
  }
  return {
    resize: grid => resize(view, grid),
    draw: frame => draw(view, frame),
    replayIntro: () => replayIntro(view),
  }
}

const replayIntro = view => {
  if (!view.grid) return
  view.introDone = false
  view.intro = { ...createIntro({ cols: view.grid.cols, rows: view.grid.rows }), elapsed: INTRO_HOLD_MS }
}

const resize = (view, grid) => {
  sizeCanvas(view.spec, grid)
  sizeCanvas(view.fx, grid)
  if (view.grid?.cols !== grid.cols) resetColumns(view)
  resizeSpectrum(view.spectrum, grid.cols)
  view.grid = grid
  view.rowFills = buildRowFills(grid)
  view.gradients.clear()
  if (!view.introDone && view.intro?.delays.length !== grid.cols * grid.rows) {
    view.intro = { ...createIntro({ cols: grid.cols, rows: grid.rows, pattern: view.intro?.pattern }), elapsed: view.intro?.elapsed ?? 0 }
  }
}

const draw = (view, frame) => {
  const { grid, chips } = view
  if (!grid) return false
  const size = timerSize(frame.timer)
  const reserved = frame.chromeAlpha > 0 ? reservedFor(view, size, frame) : openCells(view)
  const linearEmpty = isLinearEmpty(view)
  const levelsActive = updateLevels(view, frame)
  if (view.wasPlaying !== frame.playing) {
    view.wasPlaying = frame.playing
    reassignChips({ chips, cols: grid.cols, playing: frame.playing, levels: view.spectrum.levels })
  }
  stepChips({ chips, levels: view.spectrum.levels, dt: frame.dt, segments: grid.synthRows, reducedMotion: frame.reducedMotion })
  const tintSettled = stepTint(view, frame)
  const stripRevealing = stepStrip({ strip: view.strip, locked: frame.stripLocked, cols: grid.cols, dt: frame.dt, reducedMotion: frame.reducedMotion })
  const palette = paletteFor(frame)
  const { radial } = view
  stepRadial(radial, { levels: view.spectrum.levels, dt: frame.dt, volume: frame.volume, wave: frame.wave, playing: frame.playing, linearEmpty, reducedMotion: frame.reducedMotion, t: frame.now / 1000 })
  const linear = radial.morph === 0
  const ink = inkStyle(view, 1)
  view.g.clearRect(0, 0, view.spec.width, view.spec.height)
  drawBars({ view, palette, reserved: reserved.withMusic, playing: frame.playing, scale: linearShare(radial), stripLocked: frame.stripLocked })
  if (linear) drawChips(view, reserved.withMusic)
  else drawRadial({ g: view.g, grid, radial, reserved: reserved.plain, palette, ink })
  drawFlock({ g: view.g, grid, radial, chips, reserved: reserved.plain, ink, playing: frame.playing })
  const baseStyle = baseStyleFor({ view, palette, scale: linearShare(radial), chromeAlpha: frame.chromeAlpha })
  drawColourRows({ view, pos: frame.pos, chromeAlpha: frame.chromeAlpha * (frame.sliderShown ?? 1), baseStyle })
  drawHomeBarRows({ view, chromeAlpha: frame.chromeAlpha, baseStyle })
  drawControlRow({ view, frame, palette, size, reserved: reserved.withMusic })
  const pixelCount = linear ? drawPixels({ view, frame, palette, reserved: reserved.withMusic }) : 0
  if (!linear) hidePixels(view)
  const introRunning = maskIntro(view, frame)
  return introRunning || stripRevealing || !isRadialSettled(radial) || (radial.morph > 0 && radial.morph < 1) || frame.playing || levelsActive || chips.length > 0 || pixelCount > 0 || !tintSettled
    || frame.chromeAlpha < 1
}

const isLinearEmpty = ({ spectrum, chips }) => spectrum.levels.every(level => level < 0.02) && chips.every(chip => chip.y <= 0)

const updateLevels = (view, { analyser, playing, sampleRate, volume }) => {
  if (!(analyser && playing)) return decaySpectrum(view.spectrum)
  if (view.bins.length !== analyser.frequencyBinCount) view.bins = new Float32Array(analyser.frequencyBinCount)
  analyser.getFloatFrequencyData(view.bins)
  readSpectrum({ spectrum: view.spectrum, bins: view.bins, nyquist: sampleRate / 2, volume })
  return true
}

const stepTint = (view, frame) => {
  const target = isDarkInk(frame) ? 1 : 0
  view.tint += (target - view.tint) * Math.min(1, frame.dt / INK_TINT_S)
  if (Math.abs(target - view.tint) < 0.01) view.tint = target
  return view.tint === target
}

const reservedFor = (view, size, { music, piece }) => {
  const { reserved, grid } = view
  if (reserved.grid === grid && reserved.size === size && reserved.music === music && reserved.piece === piece) return reserved
  return Object.assign(reserved, {
    grid, size, music, piece,
    withMusic: reservedCells(grid, size, { music, piece }),
    plain: reservedCells(grid, size),
  })
}

const drawBars = ({ view, palette, reserved, playing, scale, stripLocked }) => {
  const { g, grid, spectrum } = view
  const lit = gradientFor(view, palette)
  let current = null
  for (let col = 0; col < grid.cols; col++) {
    const litSegments = Math.round(spectrum.levels[col] * scale * grid.synthRows)
    const restSegment = playing || stripLocked || litSegments > 0 ? -1 : 0
    for (let seg = 0; seg < grid.synthRows; seg++) {
      const row = grid.synthRows - 1 - seg
      if (reserved[cellIndex(grid, col, row)]) continue
      const style = seg < litSegments ? lit : seg === restSegment ? palette.rest : palette.ghost
      if (style !== current) g.fillStyle = current = style
      fillCell(g, grid, col, row)
    }
  }
}

const drawChips = (view, reserved) => {
  const { g, grid, chips } = view
  g.fillStyle = inkStyle(view, 1)
  for (const chip of chips) {
    if (chip.y <= 0) continue
    const row = grid.synthRows - 1 - chipSegment(chip, grid.synthRows)
    if (!reserved[cellIndex(grid, chip.col, row)]) fillCell(g, grid, chip.col, row)
  }
}

const drawColourRows = ({ view, pos, chromeAlpha, baseStyle }) => {
  const { g, grid, rowFills, strip } = view
  const selector = selectorSpan(grid, pos)
  for (let k = 0; k < COLOUR_ROWS; k++) {
    for (let col = 0; col < grid.cols; col++) {
      const alpha = stripCellAlpha({ strip, col, k }) * chromeAlpha
      if (alpha < 1) {
        g.globalAlpha = 1
        g.fillStyle = baseStyle(col)
        fillCell(g, grid, col, grid.colourTop + k)
      }
      if (!alpha) continue
      g.globalAlpha = alpha
      g.fillStyle = col >= selector.from && col <= selector.to ? SELECTOR_FILL : rowFills[k][col]
      fillCell(g, grid, col, grid.colourTop + k)
    }
  }
  g.globalAlpha = 1
}

const drawHomeBarRows = ({ view, chromeAlpha, baseStyle }) => {
  const { g, grid, rowFills, strip } = view
  const bottomShade = rowFills[COLOUR_ROWS - 1]
  for (let row = grid.colourTop + COLOUR_ROWS; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      g.fillStyle = baseStyle(col)
      fillCell(g, grid, col, row)
      g.globalAlpha = HOME_BAR_ALPHA * stripCellAlpha({ strip, col, k: COLOUR_ROWS - 1 }) * chromeAlpha
      g.fillStyle = bottomShade[col]
      fillCell(g, grid, col, row)
      g.globalAlpha = 1
    }
  }
}

const baseStyleFor = ({ view, palette, scale, chromeAlpha }) => {
  if (chromeAlpha === 1) return () => palette.ghost
  const { grid, spectrum } = view
  const lit = gradientFor(view, palette)
  return col => Math.round(spectrum.levels[col] * scale * grid.synthRows) > 0 ? lit : palette.ghost
}

const selectorSpan = (grid, pos) => {
  const centre = Math.round(pos / LAST * (grid.cols - 1))
  const clamped = Math.max(SELECTOR_HALF, Math.min(grid.cols - 1 - SELECTOR_HALF, centre))
  return { from: clamped - SELECTOR_HALF, to: clamped + SELECTOR_HALF }
}

const openCells = view => {
  const { grid } = view
  const size = grid.cols * grid.rows
  if (view.openCells?.length !== size) view.openCells = new Uint8Array(size)
  return { withMusic: view.openCells, plain: view.openCells }
}

const drawControlRow = ({ view, frame, palette, size, reserved }) => {
  if (frame.chromeAlpha === 0) return
  const { g, grid } = view
  if (frame.chromeAlpha < 1) {
    g.fillStyle = palette.ghost
    for (let col = 0; col < grid.cols; col++) {
      if (reserved[cellIndex(grid, col, grid.timerRow)]) fillCell(g, grid, col, grid.timerRow)
    }
  }
  g.globalAlpha = frame.chromeAlpha
  drawTimer({ view, frame, palette, size })
  g.globalAlpha = frame.chromeAlpha * (frame.trackOn ? DISABLED_ALPHA : 1)
  drawWaveDot({ view, frame, palette })
  drawMusic({ view, frame, palette })
  g.globalAlpha = 1
}

const drawWaveDot = ({ view, frame, palette }) => {
  const { g, grid } = view
  g.fillStyle = (frame.waveSaved ?? frame.wave) ? inkStyle(view, 1) : frame.playing ? inkStyle(view, TIMER_OFF_ALPHA) : palette.rest
  fillCell(g, grid, waveCol(grid), grid.timerRow)
}

const drawMusic = ({ view, frame, palette }) => {
  const { g, grid } = view
  const faint = frame.playing ? inkStyle(view, TIMER_OFF_ALPHA) : palette.rest
  Object.entries(musicCols(grid)).forEach(([piece, col]) => {
    const lit = frame.music !== 'off' && frame.piece === piece
    g.fillStyle = lit ? inkStyle(view, musicAlpha(frame)) : faint
    fillCell(g, grid, col, grid.timerRow)
  })
}

const musicAlpha = ({ music, playing, now, reducedMotion }) =>
  music === 'over' && playing && !reducedMotion && Math.floor(now / TIMER_BLINK_MS) % 2 ? TIMER_BLINK_LOW : 1

const drawTimer = ({ view, frame, palette, size }) => {
  const { g, grid } = view
  g.fillStyle = size || frame.playing ? inkStyle(view, timerAlpha(frame)) : palette.rest
  for (let col = grid.timerCol - Math.max(1, size) + 1; col <= grid.timerCol; col++) fillCell(g, grid, col, grid.timerRow)
}

const maskIntro = (view, frame) => {
  if (view.introDone) return false
  const { g, grid, intro } = view
  const elapsed = advanceIntro(intro, frame.dt * 1000)
  if (frame.reducedMotion || isIntroDone(elapsed)) {
    Object.assign(view, { intro: null, introDone: true })
    return false
  }
  g.globalCompositeOperation = 'destination-out'
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const step = cellReveal(intro.delays[row * grid.cols + col], elapsed) * INTRO_STEPS
      if (step === INTRO_STEPS) continue
      g.fillStyle = HIDE_STYLES[step]
      fillCell(g, grid, col, row)
    }
  }
  g.globalCompositeOperation = 'source-over'
  return true
}

const hidePixels = view => {
  clearPixels(view.pixels)
  clearFx(view)
}

const clearFx = view => {
  if (!view.fxPainted) return
  view.fg.clearRect(0, 0, view.fx.width, view.fx.height)
  view.fxPainted = false
}

const drawPixels = ({ view, frame, palette, reserved }) => {
  const { fg, grid, pixels } = view
  if (frame.playing && !frame.reducedMotion) {
    emitPixels({ pixels, chips: view.chips, segments: grid.synthRows, volume: frame.volume })
  }
  const count = stepPixels({ pixels, dt: frame.dt })
  clearFx(view)
  for (const p of pixels.pool) {
    if (!p.active || p.row < 0 || reserved[cellIndex(grid, p.col, p.row)]) continue
    fg.globalAlpha = pixelAlpha(p)
    fg.fillStyle = palette[p.tone]
    fillCell(fg, grid, p.col, p.row)
    view.fxPainted = true
  }
  fg.globalAlpha = 1
  return count
}

const gradientFor = (view, palette) => {
  const cached = view.gradients.get(palette)
  if (cached) return cached
  const { g, grid } = view
  const gradient = g.createLinearGradient(0, grid.synthRows * grid.stepY * grid.dpr, 0, 0)
  gradient.addColorStop(0, palette.low)
  gradient.addColorStop(0.55, palette.mid)
  gradient.addColorStop(1, palette.high)
  view.gradients.set(palette, gradient)
  return gradient
}

const inkStyle = (view, alpha) => view.inks[Math.round(view.tint * INK_STEPS)][alpha]

const buildInks = () => Array.from({ length: INK_STEPS + 1 }, (_, step) => {
  const rgb = inkRgb(step / INK_STEPS)
  return Object.fromEntries(INK_ALPHAS.map(alpha => [alpha, rgba(rgb, alpha)]))
})

const buildRowFills = grid => COLOUR_ROW_SHADES.map(shade => Array.from({ length: grid.cols }, (_, col) => {
  const base = colourAt(col / (grid.cols - 1) * LAST)
  return rgba(shadeRgb(base, shade), 1)
}))

const resetColumns = view => {
  view.chips.length = 0
  view.wasPlaying = null
  clearPixels(view.pixels)
}

const sizeCanvas = (canvas, grid) => {
  const width = Math.round(grid.width * grid.dpr)
  const height = Math.round(grid.height * grid.dpr)
  if (canvas.width !== width || canvas.height !== height) Object.assign(canvas, { width, height })
}
