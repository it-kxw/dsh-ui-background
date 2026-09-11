/**
 * 动态特效渲染器测试（jsdom）：画布挂载、渲染循环启动/停止、降级与清理。
 *
 * 环境桩：mock 2d 上下文、手动驱动的 requestAnimationFrame、可切换的
 * matchMedia 与可触发的 ResizeObserver——不依赖真实绘制。
 * @author 康小汪【kxw】
 * @date 2026-09-11
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BackgroundEffects, EFFECTS_CANVAS_CLASS } from '../src/client/effects-renderer.ts'
import { DEFAULT_BACKGROUND_SETTINGS, type BackgroundSettings } from '../src/background-settings.ts'

/** 构造一份「背景激活 + 特效开启」的设置。 */
function enabledSettings(over: Partial<BackgroundSettings> = {}): BackgroundSettings {
  return {
    ...DEFAULT_BACKGROUND_SETTINGS,
    preset: 'aurora',
    streaks: true,
    particles: true,
    ...over,
  }
}

/** mock 2d 上下文：记录绘制调用与混合模式切换。 */
type MockCtx = ReturnType<typeof makeMockCtx>
function makeMockCtx() {
  const calls = {
    setTransform: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(),
    beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(),
    save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  }
  // 混合模式是普通属性，用访问器记录赋值序列供断言（加色/普通混合的行为差异靠它验证）。
  const compositeOps: string[] = []
  let compositeOperation = 'source-over'
  return {
    calls,
    compositeOps,
    ctx: {
      setTransform: calls.setTransform, clearRect: calls.clearRect, fillRect: calls.fillRect,
      beginPath: calls.beginPath, arc: calls.arc, fill: calls.fill,
      save: calls.save, restore: calls.restore, translate: calls.translate, rotate: calls.rotate,
      createLinearGradient: calls.createLinearGradient,
      fillStyle: '', globalAlpha: 1,
      get globalCompositeOperation(): string { return compositeOperation },
      set globalCompositeOperation(value: string) { compositeOperation = value; compositeOps.push(value) },
    } as unknown as CanvasRenderingContext2D,
  }
}

/** 本帧全部渐变停止点（形如 'rgba(255, 255, 255, 0.72)'）。 */
function gradientStops(): string[] {
  return mockCtx.calls.createLinearGradient.mock.results
    .flatMap(result => (result.value as { addColorStop: ReturnType<typeof vi.fn> }).addColorStop.mock.calls)
    .map(call => call[1] as string)
}

/** 从渐变停止点里抽出 alpha 数值（用于「明显度」回归防护）。 */
function stopAlphas(): number[] {
  return gradientStops()
    .map(stop => Number(/, ([\d.]+)\)$/.exec(stop)?.[1] ?? '0'))
    .filter(alpha => !Number.isNaN(alpha))
}

let mockCtx: MockCtx
let currentFrame: FrameRequestCallback | undefined

/** 手动推进一帧（驱动渲染器的下一帧续订）。 */
function driveFrame(time = 16): void {
  const callback = currentFrame
  currentFrame = undefined
  callback?.(time)
}

beforeEach(() => {
  // 重置模块级帧指针，避免上一用例 tick 续订的回调残留污染断言。
  currentFrame = undefined
  mockCtx = makeMockCtx()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx.ctx)
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    currentFrame = callback
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn(() => {
    // 模拟真实取消语义：取消后不再有待执行帧。
    currentFrame = undefined
  }))
  // 可控的 ResizeObserver：收集回调供测试手动触发。
  const resizeCallbacks: Array<() => void> = []
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resizeCallbacks.push(callback) }
    observe(): void {}
    disconnect(): void {}
    static trigger(): void { for (const callback of resizeCallbacks) callback() }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

/** 页面中特效画布元素（无则 null）。 */
function canvas(): HTMLCanvasElement | null {
  return document.querySelector(`canvas.${EFFECTS_CANVAS_CLASS}`)
}

describe('渲染循环启停', () => {
  it('开启特效后挂载画布并启动渲染循环', () => {
    const effects = new BackgroundEffects()
    effects.apply(enabledSettings())
    expect(canvas()).not.toBeNull()
    expect(canvas()!.getAttribute('aria-hidden')).toBe('true')
    expect(currentFrame).toBeDefined()
    effects.dispose()
  })

  it('仅开启流光：绘制渐变不绘制粒子', () => {
    const effects = new BackgroundEffects()
    effects.apply(enabledSettings({ particles: false }))
    driveFrame()
    expect(mockCtx.calls.clearRect).toHaveBeenCalled()
    expect(mockCtx.calls.createLinearGradient).toHaveBeenCalled() // 流光渐变
    expect(mockCtx.calls.arc).not.toHaveBeenCalled() // 无粒子
    effects.dispose()
  })

  it('仅开启粒子：绘制粒子不绘制渐变', () => {
    const effects = new BackgroundEffects()
    effects.apply(enabledSettings({ streaks: false }))
    driveFrame()
    expect(mockCtx.calls.arc).toHaveBeenCalled() // 粒子
    expect(mockCtx.calls.createLinearGradient).not.toHaveBeenCalled() // 无流光
    effects.dispose()
  })

  it('两字段同时为真（手改设置）时仅流光优先绘制（互斥防御）', () => {
    const effects = new BackgroundEffects()
    effects.apply(enabledSettings({ streaks: true, particles: true }))
    driveFrame()
    expect(mockCtx.calls.createLinearGradient).toHaveBeenCalled()
    expect(mockCtx.calls.arc).not.toHaveBeenCalled()
    effects.dispose()
  })

  it('全部关闭后停止循环并清屏', () => {
    const effects = new BackgroundEffects()
    effects.apply(enabledSettings())
    expect(currentFrame).toBeDefined()
    effects.apply(enabledSettings({ streaks: false, particles: false }))
    expect(currentFrame).toBeUndefined()
    expect(vi.mocked(cancelAnimationFrame)).toHaveBeenCalled()
    // 关闭后的清屏走 clearRect（含首帧绘制前的一次）。
    expect(mockCtx.calls.clearRect).toHaveBeenCalled()
    effects.dispose()
  })

  it('无背景（none）时不启动特效', () => {
    const effects = new BackgroundEffects()
    effects.apply(enabledSettings({ preset: 'none' }))
    expect(canvas()).toBeNull()
    expect(currentFrame).toBeUndefined()
    effects.dispose()
  })

  it('系统减少动态效果时不启动渲染', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const effects = new BackgroundEffects()
    effects.apply(enabledSettings())
    expect(canvas()).toBeNull()
    expect(currentFrame).toBeUndefined()
    effects.dispose()
  })
})

describe('降级与清理', () => {
  it('getContext 不可用时静默降级（不抛错、不留空层）', () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null)
    const effects = new BackgroundEffects()
    expect(() => effects.apply(enabledSettings())).not.toThrow()
    expect(canvas()).toBeNull()
    expect(currentFrame).toBeUndefined()
    effects.dispose()
  })

  it('dispose 移除画布并取消动画帧', () => {
    const effects = new BackgroundEffects()
    effects.apply(enabledSettings())
    expect(canvas()).not.toBeNull()
    effects.dispose()
    expect(canvas()).toBeNull()
    expect(vi.mocked(cancelAnimationFrame)).toHaveBeenCalled()
    // dispose 后无帧残留：再次推进不应抛错。
    expect(() => driveFrame()).not.toThrow()
  })

  it('resize 依视口重设画布物理尺寸', () => {
    const effects = new BackgroundEffects()
    effects.apply(enabledSettings())
    const el = canvas()!
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    expect(el.width).toBe(Math.max(1, Math.round(window.innerWidth * dpr)))
    expect(el.height).toBe(Math.max(1, Math.round(window.innerHeight * dpr)))
    const transformCalls = mockCtx.calls.setTransform.mock.calls.length
    ;(ResizeObserver as unknown as { trigger(): void }).trigger()
    expect(mockCtx.calls.setTransform.mock.calls.length).toBeGreaterThan(transformCalls)
    effects.dispose()
  })
})

describe('配色适配', () => {
  it('浅色配色下粒子为深蓝灰（白粒子在浅背景不可见）', () => {
    document.body.removeAttribute('data-ds-dark-theme')
    const effects = new BackgroundEffects()
    effects.apply(enabledSettings({ streaks: false }))
    driveFrame()
    expect(mockCtx.ctx.fillStyle).toBe('rgba(80, 92, 115, 1)')
    effects.dispose()
  })

  it('深色配色下粒子为白色', () => {
    document.body.setAttribute('data-ds-dark-theme', '')
    const effects = new BackgroundEffects()
    effects.apply(enabledSettings({ streaks: false }))
    driveFrame()
    expect(mockCtx.ctx.fillStyle).toBe('rgba(255, 255, 255, 1)')
    effects.dispose()
  })

  it('流光颜色随配色：浅色为深蓝灰系、深色为白/浅蓝系', () => {
    document.body.removeAttribute('data-ds-dark-theme')
    const light = new BackgroundEffects()
    light.apply(enabledSettings({ particles: false }))
    driveFrame()
    const lightGradient = mockCtx.calls.createLinearGradient.mock.results[0]?.value as { addColorStop: ReturnType<typeof vi.fn> }
    const lightStops = lightGradient.addColorStop.mock.calls.map(call => call[1] as string)
    expect(lightStops.some(stop => stop.includes('80, 92, 115'))).toBe(true)
    light.dispose()

    vi.clearAllMocks()
    document.body.setAttribute('data-ds-dark-theme', '')
    const dark = new BackgroundEffects()
    dark.apply(enabledSettings({ particles: false }))
    driveFrame()
    const darkGradient = mockCtx.calls.createLinearGradient.mock.results[0]?.value as { addColorStop: ReturnType<typeof vi.fn> }
    const darkStops = darkGradient.addColorStop.mock.calls.map(call => call[1] as string)
    expect(darkStops.some(stop => stop.includes('255, 255, 255'))).toBe(true)
    dark.dispose()
  })
})

describe('流光明显度（防「看不到」回归）', () => {
  it('核心 alpha 峰值 ≥ 0.6（旧实现峰值仅 0.22，穿不过半透明底衬）', () => {
    document.body.setAttribute('data-ds-dark-theme', '')
    const effects = new BackgroundEffects()
    effects.apply(enabledSettings({ particles: false }))
    driveFrame()
    expect(Math.max(...stopAlphas())).toBeGreaterThanOrEqual(0.6)
    effects.dispose()
  })

  it('光带收窄为条带（全长 ≤ 视口 44%），不再是铺满半屏的柔光', () => {
    const effects = new BackgroundEffects()
    effects.apply(enabledSettings({ particles: false }))
    driveFrame()
    const widths = mockCtx.calls.fillRect.mock.calls.map(call => call[2] as number)
    expect(widths.length).toBeGreaterThan(0)
    expect(Math.max(...widths)).toBeLessThanOrEqual(window.innerWidth * 0.44)
    effects.dispose()
  })

  it('深色配色走加色混合形成发光，浅色配色回落普通混合', () => {
    document.body.setAttribute('data-ds-dark-theme', '')
    const dark = new BackgroundEffects()
    dark.apply(enabledSettings({ particles: false }))
    driveFrame()
    expect(mockCtx.compositeOps).toContain('lighter')
    // 帧末必须复位：否则后续粒子会沿用加色叠加而被冲白。
    expect(mockCtx.ctx.globalCompositeOperation).toBe('source-over')
    dark.dispose()

    // compositeOps 是普通数组，clearAllMocks 不会清它，手动归零后再验浅色分支。
    mockCtx.compositeOps.length = 0
    document.body.removeAttribute('data-ds-dark-theme')
    const light = new BackgroundEffects()
    light.apply(enabledSettings({ particles: false }))
    driveFrame()
    expect(mockCtx.compositeOps).not.toContain('lighter')
    light.dispose()
  })

  it('每条光带画两层（光晕 + 高亮核心），核心比光晕更亮', () => {
    document.body.setAttribute('data-ds-dark-theme', '')
    const effects = new BackgroundEffects()
    effects.apply(enabledSettings({ particles: false }))
    driveFrame()
    // 六条光带 × 两层 = 12 次 fillRect（无粒子），渐变也按「光晕→核心」成对生成。
    expect(mockCtx.calls.fillRect).toHaveBeenCalledTimes(12)
    const bands = gradientStops().map(stop => Number(/, ([\d.]+)\)$/.exec(stop)?.[1] ?? '0'))
      .filter(alpha => alpha > 0)
    expect(bands).toHaveLength(12)
    for (let index = 0; index < bands.length; index += 2) {
      expect(bands[index + 1]).toBeGreaterThan(bands[index]!)
    }
    effects.dispose()
  })
})