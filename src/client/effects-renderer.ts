/**
 * 动态特效渲染器：在背景之上叠加「流光」与「粒子」（共用同一全屏 canvas）。
 *
 * 层级上 canvas 与背景层同级（z-index:-1、pointer-events:none），但插入
 * body 的顺序在背景层之后，因此绘制于背景图之上、AppFrame 内容之下。
 *
 * 关键边界：
 * - 仅当「背景处于激活状态」且「流光/粒子至少一项开启」时才启动
 *   requestAnimationFrame 循环；全关即停，保证零空闲开销。
 * - 尊重系统「减少动态效果」（prefers-reduced-motion）——命中则不启动。
 * - 设备像素比封顶 2、粒子数按视口面积自适应（封顶 160），低配友好。
 * - getContext('2d') 不可用（无 GPU/测试环境）时静默禁用，不抛错。
 * - 生命周期随插件：dispose() 取消动画帧、断开观察器、移除画布。
 *
 * @author 康小汪【kxw】
 * @date 2026-09-11
 */
import type { BackgroundEffectsLike } from './background-runtime.ts'
import { backgroundValues } from './background-presenter.ts'
import { DEFAULT_BACKGROUND_SETTINGS, type BackgroundSettings } from '../background-settings.ts'

/** 画布类名（供查询/样式定位）。 */
export const EFFECTS_CANVAS_CLASS = 'dsh-effects-canvas'

/** 设备像素比上限：更高分辨率只增开销，画面增益有限。 */
const EFFECTS_MAX_DPR = 2

/** 粒子密度：每 8000 平方 CSS 像素约 1 个（更浓，满足「明显」诉求）。 */
const PARTICLE_AREA_DENSITY = 8000

/** 粒子数量上限。 */
const PARTICLE_CAP = 160

/** 流光条数（六条窄光带，靠数量铺满视野而非靠单条铺满屏幕）。 */
const STREAK_COUNT = 6

/** 浅色配色的流光强度系数：深色描边在浅背景上对比天然更强，收敛一点免得糊成一片。 */
const STREAK_LIGHT_SCALE = 0.72

/** 粒子填充色：深色配色用白、浅色配色用深蓝灰（保证两种背景都可见）。 */
const PARTICLE_FILL_DARK = 'rgba(255, 255, 255, 1)'
const PARTICLE_FILL_LIGHT = 'rgba(80, 92, 115, 1)'

/** 流光渐变 RGB（成对：深色配色白/浅蓝；浅色配色深蓝灰系，浅背景下同样明显）。 */
const STREAK_RGB_DARK = ['255, 255, 255', '150, 185, 255'] as const
const STREAK_RGB_LIGHT = ['80, 92, 115', '120, 145, 180'] as const

/** 一个漂浮粒子。 */
interface Particle {
  /** CSS 像素坐标（绘制前随帧更新）。 */
  x: number
  y: number
  /** 每帧位移量。 */
  vx: number
  vy: number
  /** 半径（px）。 */
  radius: number
  /** 基础透明度（呼吸围绕它波动）。 */
  alpha: number
  /** 相位（用于独立呼吸/漂移）。 */
  phase: number
}

/** 一条流光带（窄而亮的光带，斜向掠过视口）。 */
interface Streak {
  /** 纵向位置比例（0..1）。 */
  y: number
  /** 横向漂移速度（每秒扫过的视口比例）。 */
  speed: number
  /** 光带半长（视口宽度的比例）。 */
  halfLength: number
  /** 外圈光晕半高（px）：宽而淡，负责流动感。 */
  haloHeight: number
  /** 内圈核心半高（px）：窄而亮，负责「看得见」。 */
  coreHeight: number
  /** 倾斜角（弧度）。 */
  angle: number
  /** 基准透明度（呼吸围绕它波动，随配色再乘系数）。 */
  alpha: number
  /** 相位（起漂起点）。 */
  phase: number
}

/** 归一化到 0..1。 */
function wrap(value: number): number {
  return value - Math.floor(value)
}

/**
 * 动态特效渲染器。由装配方创建并注入 BackgroundRuntime 的 effects 投影；
 * apply 每个生效设置，dispose 随插件卸载。
 */
export class BackgroundEffects implements BackgroundEffectsLike {
  private canvas: HTMLCanvasElement | undefined
  private ctx: CanvasRenderingContext2D | undefined
  private frameRequest: number | undefined
  private settings: Readonly<BackgroundSettings> = DEFAULT_BACKGROUND_SETTINGS
  private particles: Particle[] = []
  private streaks: Streak[] = []
  private readonly resizeObserver: ResizeObserver | undefined
  /** 视口 CSS 尺寸（绘制坐标系；画布物理像素 = 尺寸 × dpr）。 */
  private viewportWidth = 0
  private viewportHeight = 0
  /** 是否命中系统「减少动态效果」。 */
  private readonly reducedMotion: boolean

  constructor() {
    // 非浏览器（node 测试/引导）与 reduce-motion 环境一律不启动渲染。
    if (typeof window !== 'undefined' && typeof matchMedia === 'function') {
      this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
      // ResizeObserver 缺失（受限/测试环境）时仅放弃尺寸跟踪，不影响功能。
      this.resizeObserver = typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => { this.resizeCanvas() })
        : undefined
    } else {
      this.reducedMotion = true
      this.resizeObserver = undefined
    }
  }

  /**
   * 依最新设置投影特效开关：满足运行条件则启动渲染，否则停止并清屏。
   * @param settings - 生效的背景设置。
   */
  apply(settings: Readonly<BackgroundSettings>): void {
    this.settings = settings
    const active = backgroundValues(settings) !== null
    const enabled = active && (settings.streaks || settings.particles)
    if (enabled && !this.reducedMotion) this.start()
    else this.stop()
  }

  /**
   * 卸载：取消动画帧、断开观察器、移除画布并释放状态。
   */
  dispose(): void {
    this.stop()
    this.resizeObserver?.disconnect()
    this.canvas?.remove()
    this.canvas = undefined
    this.ctx = undefined
    this.particles = []
    this.streaks = []
  }

  /** 启动渲染循环（幂等）；画布不可用（无 2d 上下文）时静默放弃。 */
  private start(): void {
    if (this.frameRequest !== undefined) return
    if (!this.ensureCanvas()) return
    this.ensureStreaks()
    if (this.settings.particles) this.ensureParticles()
    this.frameRequest = requestAnimationFrame((time) => { this.tick(time) })
  }

  /** 停止渲染循环并清屏（幂等；画布保留复用）。 */
  private stop(): void {
    if (this.frameRequest !== undefined) {
      cancelAnimationFrame(this.frameRequest)
      this.frameRequest = undefined
    }
    this.ctx?.clearRect(0, 0, this.canvas!.width, this.canvas!.height)
  }

  /** 一帧：更新并绘制流光/粒子，续订下一帧。运行时保证互斥；双 true（手改设置）时流光优先。 */
  private tick(time: number): void {
    const ctx = this.ctx
    const width = this.viewportWidth
    const height = this.viewportHeight
    if (ctx === undefined || width === 0 || height === 0) {
      this.stop()
      return
    }
    ctx.clearRect(0, 0, width, height)
    const seconds = time / 1000
    if (this.settings.streaks) this.drawStreaks(ctx, width, height, seconds)
    else if (this.settings.particles) this.drawParticles(ctx, width, height, seconds)
    this.frameRequest = requestAnimationFrame((next) => { this.tick(next) })
  }

  /** 惰性创建画布并绑定 2d 上下文与尺寸（返回是否可用）。 */
  private ensureCanvas(): boolean {
    if (this.canvas !== undefined) return this.ctx !== undefined
    if (typeof document === 'undefined') return false
    const canvas = document.createElement('canvas')
    canvas.className = EFFECTS_CANVAS_CLASS
    canvas.setAttribute('aria-hidden', 'true')
    const ctx = canvas.getContext('2d')
    if (ctx === null) {
      // 无 2d 上下文（无 GPU/受限环境）：静默禁用，不留空层。
      return false
    }
    document.body.appendChild(canvas)
    this.canvas = canvas
    this.ctx = ctx
    this.resizeCanvas()
    this.resizeObserver?.observe(document.body)
    return true
  }

  /** 依视口与 DPR 重设画布物理尺寸；粒子分布随视口重建。 */
  private resizeCanvas(): void {
    const canvas = this.canvas
    const ctx = this.ctx
    if (canvas === undefined || ctx === undefined) return
    const dpr = Math.min(globalThis.devicePixelRatio ?? 1, EFFECTS_MAX_DPR)
    this.viewportWidth = window.innerWidth
    this.viewportHeight = window.innerHeight
    canvas.width = Math.max(1, Math.round(this.viewportWidth * dpr))
    canvas.height = Math.max(1, Math.round(this.viewportHeight * dpr))
    // 坐标系对齐 CSS 像素：之后一律按 viewportWidth/Height 绘制。
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (this.settings.particles) this.ensureParticles()
  }

  /** 是否深色配色：主题呈现器在 body 打 `data-ds-dark-theme` 标记；每帧读取开销可忽略。 */
  private isDarkScheme(): boolean {
    return typeof document !== 'undefined' && document.body.hasAttribute('data-ds-dark-theme')
  }

  /** 生成或重建粒子（覆盖当前视口，数量按面积自适应；明显度参数：更大、更亮、更快）。 */
  private ensureParticles(): void {
    const count = Math.min(
      Math.floor((this.viewportWidth * this.viewportHeight) / PARTICLE_AREA_DENSITY),
      PARTICLE_CAP,
    )
    const random = Math.random
    this.particles = Array.from({ length: count }, () => ({
      x: random() * this.viewportWidth,
      y: random() * this.viewportHeight,
      vx: (random() - 0.5) * 18,
      vy: 10 + random() * 24,
      radius: 0.9 + random() * 2,
      alpha: 0.35 + random() * 0.45,
      phase: random() * Math.PI * 2,
    }))
  }

  /**
   * 生成或重建流光条（六条窄亮光带）。
   * 参数取向：半长仅占视口 9%~22%，配合 0.55~0.85 的基准 alpha 与高亮核心。
   * （旧参数是半长 30%~70% 视口、峰值 alpha 0.22 的巨型柔光带，逐像素亮度差
   * 穿过 45% 半透明底衬后不足 0.06，实测肉眼几乎不可见。）
   */
  private ensureStreaks(): void {
    const random = Math.random
    this.streaks = Array.from({ length: STREAK_COUNT }, () => ({
      y: 0.12 + random() * 0.76,
      speed: 0.045 + random() * 0.075,
      halfLength: 0.09 + random() * 0.13,
      haloHeight: 16 + random() * 26,
      coreHeight: 0.9 + random() * 1.2,
      angle: (random() - 0.5) * 0.45,
      alpha: 0.55 + random() * 0.3,
      phase: random(),
    }))
  }

  /**
   * 绘制六条斜向漂移的流光。
   * 深色配色走加色混合（'lighter'）形成真正的发光；浅色配色下加色会把光带推成
   * 白色糊在浅底上，故保持普通混合、用深蓝灰实色描边。
   */
  private drawStreaks(ctx: CanvasRenderingContext2D, width: number, height: number, seconds: number): void {
    const dark = this.isDarkScheme()
    const palette = dark ? STREAK_RGB_DARK : STREAK_RGB_LIGHT
    ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over'
    for (const [index, streak] of this.streaks.entries()) {
      this.drawStreak(ctx, streak, palette[index % palette.length]!, dark, width, height, seconds)
    }
    // 复位为普通混合：粒子走 source-over，不能沿用流光的加色叠加。
    ctx.globalCompositeOperation = 'source-over'
  }

  /** 绘制单条流光：外圈光晕 + 内圈高亮核心（同一位置两段同向渐变）。 */
  private drawStreak(
    ctx: CanvasRenderingContext2D,
    streak: Streak,
    color: string,
    dark: boolean,
    width: number,
    height: number,
    seconds: number,
  ): void {
    const halfWidth = streak.halfLength * width
    // 横向循环扫描：wrap 保证双向进出视口都不露空。
    const progress = wrap(streak.phase + seconds * streak.speed)
    const centerX = progress * (width + 2 * halfWidth) - halfWidth
    const breath = 0.75 + 0.25 * Math.sin(seconds * 1.1 + streak.phase * Math.PI * 2)
    const alpha = streak.alpha * (dark ? 1 : STREAK_LIGHT_SCALE) * breath
    ctx.save()
    ctx.translate(centerX, streak.y * height)
    ctx.rotate(streak.angle)
    this.paintBand(ctx, color, halfWidth, streak.haloHeight, alpha)
    // 核心亮度再抬 0.45（封顶 1）：窄亮线是「流光」可辨的关键。
    this.paintBand(ctx, color, halfWidth, streak.coreHeight, Math.min(1, alpha + 0.45))
    ctx.restore()
  }

  /** 以当前变换原点为中心画一条水平渐隐光带（两端 alpha 归零，避免硬边）。 */
  private paintBand(
    ctx: CanvasRenderingContext2D,
    color: string,
    halfWidth: number,
    halfHeight: number,
    alpha: number,
  ): void {
    const gradient = ctx.createLinearGradient(-halfWidth, 0, halfWidth, 0)
    gradient.addColorStop(0, `rgba(${color}, 0)`)
    gradient.addColorStop(0.5, `rgba(${color}, ${alpha})`)
    gradient.addColorStop(1, `rgba(${color}, 0)`)
    ctx.fillStyle = gradient
    ctx.fillRect(-halfWidth, -halfHeight, halfWidth * 2, halfHeight * 2)
  }

  /** 绘制漂浮粒子（上浮 + 横向摆动，呼吸明显；颜色随配色适配）。 */
  private drawParticles(ctx: CanvasRenderingContext2D, width: number, height: number, seconds: number): void {
    ctx.fillStyle = this.isDarkScheme() ? PARTICLE_FILL_DARK : PARTICLE_FILL_LIGHT
    for (const particle of this.particles) {
      // 上浮并轻微横向摆动；出边界后回绕到另一侧（保持恒定粒子数、无分配）。
      particle.x += (particle.vx + Math.sin(seconds + particle.phase) * 12) * 0.016
      particle.y -= particle.vy * 0.016
      if (particle.x < 0) particle.x += width
      else if (particle.x > width) particle.x -= width
      if (particle.y < 0) particle.y += height
      ctx.globalAlpha = particle.alpha * (0.5 + 0.5 * Math.sin(seconds * 1.2 + particle.phase))
      ctx.beginPath()
      ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }
}