/**
 * 背景 DOM 呈现器：把生效的设置投影到文档，纯 DOM 写入，无 React 参与。
 *
 * 职责（对齐 ThemePresenter 的"只回收自己写的东西"模式）：
 * - 惰性创建并挂载背景层 `<div class="dsh-bg-layer">`（body 直接子节点）。
 * - 背景激活时给 body 打 `data-dsh-bg-active`（CSS 依此让出 AppFrame 的
 *   语义底色），并把背景值写成层的内联 CSS 变量（变量作用域天然限在层内）。
 * - 未激活或卸载时撤回 attribute、移除层、清空变量，界面回到 DSH 原样。
 * 配色切换完全交给 CSS 的 `body[data-ds-dark-theme]` 选择器，本类不感知。
 *
 * @author 康小汪【kxw】
 * @date 2026-09-10
 */
import { backgroundAssetUrl, type BackgroundSettings } from '../background-settings.ts'
import { isImagePreset, presetById } from './presets.ts'

/** body 上的背景激活标记（background.css 据此透明化 --dsw-alias-bg-base）。 */
export const BG_ACTIVE_ATTRIBUTE = 'data-dsh-bg-active'

/** 背景层类名（唯一，用于查询/创建）。 */
const LAYER_CLASS = 'dsh-bg-layer'

/** 呈现器写入层的全部 CSS 变量（dispose/重写时按此集合撤回）。 */
const APPLIED_VARIABLES = [
  '--dsh-bg-image-light',
  '--dsh-bg-image-dark',
  '--dsh-bg-opacity',
  '--dsh-bg-blur',
  '--dsh-bg-size',
  '--dsh-bg-repeat',
] as const

/** 解析后的背景值：每个配色一套 CSS background-image 值。 */
export interface BackgroundValues {
  /** 浅色配色背景图。 */
  light: string
  /** 深色配色背景图。 */
  dark: string
}

/**
 * 本次生效设置对应的变量全集。
 *
 * 返回 Map 是为了与上一次写入的值逐项比对：拖动不透明度/模糊滑块时每帧都会
 * apply，而真正变化的只有一个变量（见 writeVariables 的差异写入）。
 * @param values - 解析后的双配色背景值。
 * @param settings - 生效设置。
 * @returns 变量名 → 值。
 */
function desiredVariables(
  values: BackgroundValues,
  settings: Readonly<BackgroundSettings>,
): Map<string, string> {
  return new Map<string, string>([
    ['--dsh-bg-image-light', values.light],
    ['--dsh-bg-image-dark', values.dark],
    ['--dsh-bg-opacity', String(settings.opacity)],
    ['--dsh-bg-blur', `${settings.blur}px`],
    // tile 用原始尺寸平铺；cover/contain 直接作为 background-size 保留字。
    ['--dsh-bg-size', settings.fill === 'tile' ? 'auto' : settings.fill],
    ['--dsh-bg-repeat', settings.fill === 'tile' ? 'repeat' : 'no-repeat'],
  ])
}

/**
 * 从生效设置解析背景值；无背景（'none'、未知预设、图片来源型预设缺图片）返回 null。
 * 模块级纯函数便于单独测试。
 * @param settings - 生效的背景设置。
 * @returns 两套配色的 background-image 值，或 null（不激活背景）。
 */
export function backgroundValues(settings: Readonly<BackgroundSettings>): BackgroundValues | null {
  if (isImagePreset(settings.preset)) {
    if (settings.imagePath === '') return null
    // 引号包裹 URL：路径经 encodeURIComponent 编码后引号内始终安全。
    const url = `url("${backgroundAssetUrl(settings.imagePath)}")`
    return { light: url, dark: url }
  }
  const preset = presetById(settings.preset)
  if (preset === undefined) return null
  return { light: preset.light, dark: preset.dark }
}

/** 背景层元素类型（jsdom/浏览器一致的 DOM 接口）。 */
export type BackgroundLayerElement = HTMLDivElement

/**
 * 投影生效设置到 DOM。
 * @param settings - 生效的设置快照（每次 publish 重算）。
 */
export class BackgroundPresenter {
  /** 已挂载的背景层；undefined 表示尚未创建或非浏览器环境。 */
  private layer: BackgroundLayerElement | undefined
  /**
   * 上一次写入层的「变量名 → 值」。
   *
   * 保留值而不只是变量名，是为了做差异写入：拖动不透明度/模糊滑块时每个输入
   * 事件都会 apply，旧实现"先撤 6 个再写 6 个"会让整层样式失效两轮（每次写入
   * 都触发全屏背景的样式重算），而实际变化的只有一个变量。
   */
  private appliedValues = new Map<string, string>()

  /**
   * 应用一份设置到 DOM：激活时建层+写变量，非激活时撤回全部痕迹。
   * @param settings - 生效的背景设置。
   */
  apply(settings: Readonly<BackgroundSettings>): void {
    if (typeof document === 'undefined') return
    const values = backgroundValues(settings)
    if (values === null) {
      document.body.removeAttribute(BG_ACTIVE_ATTRIBUTE)
      this.clearLayer()
      return
    }
    document.body.setAttribute(BG_ACTIVE_ATTRIBUTE, '')
    const layer = this.ensureLayer()
    if (layer === undefined) return
    this.writeVariables(layer, desiredVariables(values, settings))
  }

  /**
   * 卸载：移除背景层、撤回 body 标记。幂等。
   */
  dispose(): void {
    if (typeof document === 'undefined') return
    document.body.removeAttribute(BG_ACTIVE_ATTRIBUTE)
    if (this.layer !== undefined) {
      this.layer.remove()
      this.layer = undefined
    }
    this.appliedValues.clear()
  }

  /**
   * 差异写入：只写值变了的变量，并撤掉本次不再需要的变量（撤回上一次的痕迹）。
   * @param layer - 背景层元素。
   * @param next - 本次应生效的变量全集。
   */
  private writeVariables(layer: BackgroundLayerElement, next: Map<string, string>): void {
    for (const [name, value] of next) {
      if (this.appliedValues.get(name) === value) continue
      layer.style.setProperty(name, value)
      this.appliedValues.set(name, value)
    }
    // 上次写过、这次不需要的变量（如从自定义图片切回内置预设）必须撤掉。
    for (const name of [...this.appliedValues.keys()]) {
      if (next.has(name)) continue
      layer.style.removeProperty(name)
      this.appliedValues.delete(name)
    }
  }

  /** 找到已挂载的背景层，否则创建并追加到 body。 */
  private ensureLayer(): BackgroundLayerElement | undefined {
    if (this.layer !== undefined) return this.layer
    const existing = document.querySelector(`div.${LAYER_CLASS}`)
    if (existing instanceof HTMLDivElement) {
      this.layer = existing
      return this.layer
    }
    if (!(document.body instanceof HTMLElement)) return undefined
    const layer = document.createElement('div')
    layer.className = LAYER_CLASS
    layer.setAttribute('aria-hidden', 'true')
    document.body.appendChild(layer)
    this.layer = layer
    return this.layer
  }

  /** 撤回层上的全部内联变量；层不存在时（非浏览器）为无操作。 */
  private clearLayer(): void {
    if (this.layer !== undefined) {
      for (const name of this.appliedValues.keys()) this.layer.style.removeProperty(name)
    }
    this.appliedValues.clear()
  }
}