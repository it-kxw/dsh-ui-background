/**
 * 背景状态运行时：设置命名空间读写、revision 快照与订阅的单一事实源。
 *
 * 设计对齐 ui-theme 的 ThemeRuntime：
 * - 写操作只有 set* 一组入口，每个入口校验参数、经 host scope 持久化、发布快照；
 * - host 发布的变更经 adopt() 吸收（不写回），浏览器与其它标签页的写入得以同步；
 * - 发布时把快照投影给呈现器（DOM），并通知订阅者（UI store 同步用）。
 * 不持有 ctx：生命周期（host 订阅、卸载）由装配方（apply）负责。
 *
 * @author 康小汪【kxw】
 * @date 2026-09-10
 */
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only：SettingsPathOpView 为原子 mutate 的操作描述类型。
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import {
  BACKGROUND_BING_AUTO_REFRESH_FIELD, BACKGROUND_BING_COPYRIGHT_FIELD,
  BACKGROUND_BING_DATE_FIELD, BACKGROUND_BING_MARKET_FIELD, BACKGROUND_BING_TITLE_FIELD,
  BACKGROUND_BING_UHD_FIELD, BACKGROUND_BLUR_FIELD, BACKGROUND_BLUR_MAX, BACKGROUND_BLUR_MIN,
  BACKGROUND_FILL_FIELD, BACKGROUND_FILLS, BACKGROUND_IMAGE_FIELD,
  BACKGROUND_OPACITY_FIELD, BACKGROUND_OPACITY_MAX, BACKGROUND_OPACITY_MIN,
  BACKGROUND_PARTICLES_FIELD, BACKGROUND_PRESET_BING, BACKGROUND_PRESET_CUSTOM,
  BACKGROUND_PRESET_FIELD, BACKGROUND_PRESET_NONE, BACKGROUND_STREAKS_FIELD,
  BING_MARKETS, DEFAULT_BACKGROUND_SETTINGS,
  type BackgroundFill, type BackgroundSettings,
} from '../background-settings.ts'
import type { BackgroundPresenter } from './background-presenter.ts'
import { isImagePreset, presetById } from './presets.ts'

/** 一次发布的不可变状态快照（uSES 安全：变化之间引用稳定）。 */
export interface BackgroundSnapshot {
  /** 当前生效的设置。 */
  readonly settings: Readonly<BackgroundSettings>
  /** 单调递增的变更计数。 */
  readonly revision: number
}

/**
 * 需要随必应壁纸一并持久化的部分（服务端返回结果里与展示/渲染相关的字段）。
 * 刻意不复用 client/bing.ts 的结果类型：运行时不该依赖取图模块（低耦合）。
 */
export interface BingWallpaperInput {
  /** 服务端落盘的本地绝对路径。 */
  path: string
  /** 展示用标题。 */
  title: string
  /** 展示用日期（YYYY-MM-DD）。 */
  date: string
  /** 展示用版权信息。 */
  copyright: string
}

/**
 * 逐个字段比较两份设置，避免 adopt 时无变化也发布一次。
 * @param left - 前一份设置。
 * @param right - 后一份设置。
 * @returns 是否完全相等。
 */
function sameSettings(left: Readonly<BackgroundSettings>, right: Readonly<BackgroundSettings>): boolean {
  return left.preset === right.preset
    && left.opacity === right.opacity
    && left.blur === right.blur
    && left.fill === right.fill
    && left.imagePath === right.imagePath
    && left.streaks === right.streaks
    && left.particles === right.particles
    && left.bingMarket === right.bingMarket
    && left.bingUhd === right.bingUhd
    && left.bingAutoRefresh === right.bingAutoRefresh
    && left.bingTitle === right.bingTitle
    && left.bingDate === right.bingDate
    && left.bingCopyright === right.bingCopyright
}

/**
 * 动态特效投影目标：每次发布与 presenter 平级调用；由特效渲染器
 * （BackgroundEffects）实现，装配方负责其 dispose 生命周期。
 */
export interface BackgroundEffectsLike {
  /** 依最新设置投影特效开关；未开启时回收特效。 */
  apply(settings: Readonly<BackgroundSettings>): void
  /** 卸载清理（取消动画帧、移除画布）。 */
  dispose(): void
}

/**
 * 背景设置的运行时。
 *
 * 连续写（滑杆拖动）时只即时更新本地状态并发布（DOM/UI 立即响应），
 * 持久化走 200ms 尾沿防抖：停顿后才把最新值写入 host，避免每一档都触发
 * 一次设置 RPC + YAML 落盘（高频拖动会串行堆积导致卡顿）。
 *
 * @param host - 装配方 bind 的同名设置 scope。
 * @param presenter - 负责背景 DOM 投影的呈现器。
 * @param effects - 可选的动态特效投影目标（与 presenter 平级；缺省时跳过）。
 */
export class BackgroundRuntime {
  /** 当前生效设置（adopt 或写操作后更新）。 */
  private settings: Readonly<BackgroundSettings> = DEFAULT_BACKGROUND_SETTINGS
  private revision = 0
  private snapshot: BackgroundSnapshot = Object.freeze({ settings: this.settings, revision: 0 })
  private readonly listeners = new Set<() => void>()
  /** 持久化防抖计时器（值为 undefined 表示当前无待写）。 */
  private persistTimer: ReturnType<typeof setTimeout> | undefined
  /** 待持久化的字段写（按字段合并：同字段只留最新，不同字段各自落盘）。 */
  private readonly pendingWrites = new Map<string, unknown>()

  constructor(
    private readonly host: SettingsScope<BackgroundSettings>,
    private readonly presenter: BackgroundPresenter,
    private readonly effects?: BackgroundEffectsLike,
  ) {
    // 构造时即吸收一次：scope 可能已带 host 已接受的 section。
    this.adopt()
  }

  /**
   * 读当前不可变快照（引用稳定，uSES 安全）。
   * @returns 当前快照。
   */
  getSnapshot(): BackgroundSnapshot {
    return this.snapshot
  }

  /**
   * 订阅快照变更。
   * @param listener - 每次发布后的回调。
   * @returns 取消订阅函数。
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * 吸收 host 已接受的 section（不写回）。装配方在 host.subscribe 里调用。
   */
  adopt(): void {
    const value = this.host.getSnapshot().value
    if (value === undefined || sameSettings(this.settings, value)) return
    this.settings = value
    this.publish()
  }

  /**
   * 切换背景预设（唯一入口）。
   * @param id - 内置预设 id、'none'（清除）或图片来源型预设（'custom'/'bing'，
   *   后者的图片由 setImagePath/setBing 一并写入）。
   * @throws 未知预设 id（非 none、非图片来源型、也不在预设表）。
   */
  setPreset(id: string): void {
    if (!isImagePreset(id) && id !== BACKGROUND_PRESET_NONE && presetById(id) === undefined) {
      throw new Error(`background preset "${id}" is not registered`)
    }
    if (this.settings.preset === id) return
    this.settings = { ...this.settings, preset: id }
    this.schedulePersist(BACKGROUND_PRESET_FIELD, id)
    this.publish()
  }

  /**
   * 设置不透明度。
   * @param value - BACKGROUND_OPACITY_MIN..MAX 的有限值。
   * @throws 越界或非有限值。
   */
  setOpacity(value: number): void {
    if (!Number.isFinite(value) || value < BACKGROUND_OPACITY_MIN || value > BACKGROUND_OPACITY_MAX) {
      throw new Error(`background opacity ${value} is outside ${BACKGROUND_OPACITY_MIN}..${BACKGROUND_OPACITY_MAX}`)
    }
    if (this.settings.opacity === value) return
    this.settings = { ...this.settings, opacity: value }
    this.schedulePersist(BACKGROUND_OPACITY_FIELD, value)
    this.publish()
  }

  /**
   * 设置背景模糊半径。
   * @param value - BACKGROUND_BLUR_MIN..MAX 的整数 px。
   * @throws 越界或非整数。
   */
  setBlur(value: number): void {
    if (!Number.isInteger(value) || value < BACKGROUND_BLUR_MIN || value > BACKGROUND_BLUR_MAX) {
      throw new Error(`background blur ${value} is outside ${BACKGROUND_BLUR_MIN}..${BACKGROUND_BLUR_MAX}`)
    }
    if (this.settings.blur === value) return
    this.settings = { ...this.settings, blur: value }
    this.schedulePersist(BACKGROUND_BLUR_FIELD, value)
    this.publish()
  }

  /**
   * 设置图片填充方式。
   * @param value - 填充方式枚举之一。
   * @throws 未知枚举值。
   */
  setFill(value: BackgroundFill): void {
    if (!BACKGROUND_FILLS.includes(value)) {
      throw new Error(`background fill "${value}" is not one of ${BACKGROUND_FILLS.join(', ')}`)
    }
    if (this.settings.fill === value) return
    this.settings = { ...this.settings, fill: value }
    this.schedulePersist(BACKGROUND_FILL_FIELD, value)
    this.publish()
  }

  /**
   * 设置自定义图片路径；非空时同时把 preset 置为 'custom'，空串仅清除图片。
   *
   * 与其它字段不同，这里**先持久化再发布**：自定义图片的背景 URL 需要服务端
   * asset 路由按已落盘的设置授权，若先发布再异步持久化，首帧图片请求会命中
   * 旧设置返回 404，背景图不加载（"点击没反应"）。等待 host.set 落定后再
   * 发布，首次请求即为有效授权。持久化失败则抛错且不产生半状态。
   * @param path - 本地图片绝对路径（trim 后存储）。
   * @returns 持久化与发布的完成信号（调用方 fire-and-forget 时用 void 包裹）。
   */
  async setImagePath(path: string): Promise<void> {
    const trimmed = path.trim()
    if (this.settings.imagePath === trimmed) return
    await this.host.set(BACKGROUND_IMAGE_FIELD, trimmed)
    if (trimmed !== '') await this.host.set(BACKGROUND_PRESET_FIELD, BACKGROUND_PRESET_CUSTOM)
    this.settings = trimmed === ''
      ? { ...this.settings, imagePath: '' }
      : { ...this.settings, imagePath: trimmed, preset: BACKGROUND_PRESET_CUSTOM }
    this.publish()
  }

  /**
   * 应用一张必应壁纸：先持久化（图片路径 + preset + 展示元数据）再发布。
   *
   * 与 setImagePath 同因：背景 URL 需要服务端 asset 路由按已落盘的 imagePath
   * 授权，若先发布再异步持久化，首帧图片请求会命中旧设置返回 404（"没反应"）。
   * 五笔写走一次原子 mutate（同一 revision）：既省往返，也避免出现"已是必应图
   * 但 preset 还没切换"的中间态快照（会闪一下无背景）。
   * @param wallpaper - 服务端返回的缓存路径与展示元数据。
   * @throws 路径为空（服务端契约破坏时不写入任何字段）。
   */
  async setBing(wallpaper: BingWallpaperInput): Promise<void> {
    const path = wallpaper.path.trim()
    if (path === '') throw new Error('background bing wallpaper path is empty')
    const ops: SettingsPathOpView[] = [
      { op: 'set', path: [BACKGROUND_IMAGE_FIELD], value: path },
      { op: 'set', path: [BACKGROUND_PRESET_FIELD], value: BACKGROUND_PRESET_BING },
      { op: 'set', path: [BACKGROUND_BING_TITLE_FIELD], value: wallpaper.title },
      { op: 'set', path: [BACKGROUND_BING_DATE_FIELD], value: wallpaper.date },
      { op: 'set', path: [BACKGROUND_BING_COPYRIGHT_FIELD], value: wallpaper.copyright },
    ]
    await this.host.mutate(ops)
    this.settings = {
      ...this.settings,
      imagePath: path,
      preset: BACKGROUND_PRESET_BING,
      bingTitle: wallpaper.title,
      bingDate: wallpaper.date,
      bingCopyright: wallpaper.copyright,
    }
    this.publish()
  }

  /**
   * 设置必应壁纸地区（决定壁纸池与标题语言；下一次取图生效）。
   * @param value - BING_MARKETS 白名单之一。
   * @throws 不在白名单内的地区值。
   */
  setBingMarket(value: string): void {
    if (!(BING_MARKETS as readonly string[]).includes(value)) {
      throw new Error(`background bing market "${value}" is not supported`)
    }
    if (this.settings.bingMarket === value) return
    this.settings = { ...this.settings, bingMarket: value }
    this.schedulePersist(BACKGROUND_BING_MARKET_FIELD, value)
    this.publish()
  }

  /**
   * 设置必应壁纸是否取 4K 原图（切换后两种规格各留一份缓存，互不覆盖）。
   * @param enabled - true 取 UHD，false 取接口给出的 1920×1080。
   * @throws 非布尔值。
   */
  setBingUhd(enabled: boolean): void {
    if (typeof enabled !== 'boolean') {
      throw new Error(`background bing uhd expects a boolean, received ${typeof enabled}`)
    }
    if (this.settings.bingUhd === enabled) return
    this.settings = { ...this.settings, bingUhd: enabled }
    this.schedulePersist(BACKGROUND_BING_UHD_FIELD, enabled)
    this.publish()
  }

  /**
   * 设置是否在进入界面时自动对齐「今日」壁纸。
   * @param enabled - true 开启（命中缓存则零下载）。
   * @throws 非布尔值。
   */
  setBingAutoRefresh(enabled: boolean): void {
    if (typeof enabled !== 'boolean') {
      throw new Error(`background bing auto refresh expects a boolean, received ${typeof enabled}`)
    }
    if (this.settings.bingAutoRefresh === enabled) return
    this.settings = { ...this.settings, bingAutoRefresh: enabled }
    this.schedulePersist(BACKGROUND_BING_AUTO_REFRESH_FIELD, enabled)
    this.publish()
  }

  /**
   * 切换动态流光特效（与粒子互斥：开启流光会同时关闭粒子）。
   * @param enabled - true 开启、false 关闭。
   * @throws 非布尔值。
   */
  setStreaks(enabled: boolean): void {
    if (typeof enabled !== 'boolean') {
      throw new Error(`background streaks expects a boolean, received ${typeof enabled}`)
    }
    if (this.settings.streaks === enabled) return
    const mustDisableParticles = enabled && this.settings.particles
    this.settings = {
      ...this.settings,
      streaks: enabled,
      particles: mustDisableParticles ? false : this.settings.particles,
    }
    this.schedulePersist(BACKGROUND_STREAKS_FIELD, enabled)
    if (mustDisableParticles) this.schedulePersist(BACKGROUND_PARTICLES_FIELD, false)
    this.publish()
  }

  /**
   * 切换粒子特效（与流光互斥：开启粒子会同时关闭流光）。
   * @param enabled - true 开启、false 关闭。
   * @throws 非布尔值。
   */
  setParticles(enabled: boolean): void {
    if (typeof enabled !== 'boolean') {
      throw new Error(`background particles expects a boolean, received ${typeof enabled}`)
    }
    if (this.settings.particles === enabled) return
    const mustDisableStreaks = enabled && this.settings.streaks
    this.settings = {
      ...this.settings,
      particles: enabled,
      streaks: mustDisableStreaks ? false : this.settings.streaks,
    }
    this.schedulePersist(BACKGROUND_PARTICLES_FIELD, enabled)
    if (mustDisableStreaks) this.schedulePersist(BACKGROUND_STREAKS_FIELD, false)
    this.publish()
  }

  /** 发布新快照：投影到背景呈现器与特效渲染器、递增 revision、通知订阅者。 */
  private publish(): void {
    this.revision += 1
    this.settings = Object.freeze({ ...this.settings })
    this.snapshot = Object.freeze({ settings: this.settings, revision: this.revision })
    this.presenter.apply(this.settings)
    this.effects?.apply(this.settings)
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch (error) {
        // 一个抛错的订阅者不能卡住后续订阅者（对齐 locale publish 的兜底）。
        console.error('dsh-ui-background subscriber crashed:', error)
      }
    }
  }

  /**
   * 安排一笔持久化写（尾沿防抖）：按字段合并，停顿后把待写字段一并落盘。
   * @param field - 设置字段。
   * @param value - 字段值。
   */
  private schedulePersist(field: string, value: unknown): void {
    this.pendingWrites.set(field, value)
    if (this.persistTimer !== undefined) return
    this.persistTimer = setTimeout(() => { this.flushPersist() }, PERSIST_DELAY_MS)
  }

  /**
   * 立即落盘全部待写字段并清空计时器（卸载冲刷用）。幂等。
   */
  flushPersist(): void {
    if (this.persistTimer !== undefined) {
      clearTimeout(this.persistTimer)
      this.persistTimer = undefined
    }
    if (this.pendingWrites.size === 0) return
    for (const [field, value] of this.pendingWrites) void this.host.set(field, value)
    this.pendingWrites.clear()
  }

  /**
   * 卸载：冲刷未落盘的防抖写（避免最后一笔设置丢失）。
   */
  dispose(): void {
    this.flushPersist()
  }
}

/** 持久化防抖延迟：滑杆停顿 200ms 后才落盘一次。 */
const PERSIST_DELAY_MS = 200