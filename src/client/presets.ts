/**
 * 内置背景预设表与两个纯查询函数。
 *
 * 每个预设携带 light/dark 两个 CSS `background-image` 值：由
 * `body[data-ds-dark-theme]` 选择器切换，无需 JS 感知配色（呈现器只管写入
 * 两个变量）。kind 用于设置行渲染预览形态（渐变/纯色），展示文案走 locale key。
 *
 * @author 康小汪【kxw】
 * @date 2026-09-10
 */
import {
  BACKGROUND_IMAGE_PRESETS, BACKGROUND_PRESET_CUSTOM, BACKGROUND_PRESET_NONE,
} from '../background-settings.ts'
import type { BackgroundLocaleKey } from './locales.ts'

/** 预设的形态分类（决定设置行的预览样式；none/custom 除外）。 */
export type BackgroundPresetKind = 'none' | 'gradient' | 'solid'

/** 一个内置背景预设。 */
export interface BackgroundPreset {
  /** 稳定 id，保存在设置文档的 preset 字段。 */
  id: string
  /** 形态分类。 */
  kind: BackgroundPresetKind
  /** 展示名 locale key（t('preset.aurora') 等）。 */
  labelKey: BackgroundLocaleKey
  /** 浅色配色下的 CSS background-image 值。 */
  light: string
  /** 深色配色下的 CSS background-image 值。 */
  dark: string
}

/**
 * 渐变与纯色预设，按展示顺序排列（'none' 恒在循环首位，见 nextPresetId）。
 * 色板取与 DSH 中性色系一致的浅/深两端，避免任一配色下背景刺眼。
 */
export const BACKGROUND_PRESETS: readonly BackgroundPreset[] = Object.freeze([
  Object.freeze({
    id: 'aurora', kind: 'gradient' as const, labelKey: 'preset.aurora' as const,
    light: 'linear-gradient(160deg, #eef2fb 0%, #dbe4f6 45%, #cddaf2 100%)',
    dark: 'linear-gradient(160deg, #23293a 0%, #1c2233 50%, #151a28 100%)',
  }),
  Object.freeze({
    id: 'sunset', kind: 'gradient' as const, labelKey: 'preset.sunset' as const,
    light: 'linear-gradient(160deg, #fdf0ec 0%, #fbe3dc 45%, #f4d3cd 100%)',
    dark: 'linear-gradient(160deg, #3a2726 0%, #2f201f 50%, #241817 100%)',
  }),
  Object.freeze({
    id: 'emerald', kind: 'gradient' as const, labelKey: 'preset.emerald' as const,
    light: 'linear-gradient(160deg, #eaf6f1 0%, #dcefe5 45%, #cfe7dc 100%)',
    dark: 'linear-gradient(160deg, #1e2c27 0%, #182521 50%, #121d19 100%)',
  }),
  Object.freeze({
    id: 'midnight', kind: 'gradient' as const, labelKey: 'preset.midnight' as const,
    light: 'linear-gradient(160deg, #e9ecf1 0%, #dfe3ea 45%, #d3d8e1 100%)',
    dark: 'linear-gradient(160deg, #10131a 0%, #0d1016 50%, #0a0c11 100%)',
  }),
  Object.freeze({
    id: 'sand', kind: 'solid' as const, labelKey: 'preset.sand' as const,
    light: 'linear-gradient(180deg, #f3eee3, #f3eee3)',
    dark: 'linear-gradient(180deg, #2b271f, #2b271f)',
  }),
  Object.freeze({
    id: 'slate', kind: 'solid' as const, labelKey: 'preset.slate' as const,
    light: 'linear-gradient(180deg, #e6eaf0, #e6eaf0)',
    dark: 'linear-gradient(180deg, #16181d, #16181d)',
  }),
])

/** 内置预设的 id 全集（不含 none/custom，它们不是可点击的表项）。 */
export const BACKGROUND_PRESET_IDS: readonly string[] = Object.freeze(
  BACKGROUND_PRESETS.map(preset => preset.id),
)

/**
 * 按 id 查预设；未知 id 返回 undefined（调用方回退到 none）。
 * @param id - 设置的 preset 字段值。
 * @returns 匹配的预设，或 undefined。
 */
export function presetById(id: string): BackgroundPreset | undefined {
  return BACKGROUND_PRESETS.find(preset => preset.id === id)
}

/**
 * 悬浮按钮的循环切换：'none' → 第一个预设 → … → 最后一个 → 'none'。
 * 当前值不在循环列表（自定义图片 'custom'、必应壁纸 'bing'）时重置到 'none'，
 * 保证按钮语义可预期（先关掉再选择；也避免一键切换触发网络请求）。
 * @param currentId - 当前设置的 preset 字段值。
 * @returns 下一个 preset 字段值。
 */
export function nextPresetId(currentId: string): string {
  if (currentId === BACKGROUND_PRESET_NONE) return BACKGROUND_PRESET_IDS[0] ?? BACKGROUND_PRESET_NONE
  const index = BACKGROUND_PRESET_IDS.indexOf(currentId)
  if (index === -1) return BACKGROUND_PRESET_NONE
  return BACKGROUND_PRESET_IDS[index + 1] ?? BACKGROUND_PRESET_NONE
}

/** 当前值是否为自定义图片预设（供设置行区分「上传图片」与「必应壁纸」）。 */
export function isCustomPreset(id: string): boolean {
  return id === BACKGROUND_PRESET_CUSTOM
}

/**
 * 当前值是否为「图片来源型」预设（custom/bing）：背景内容来自 imagePath。
 * 呈现器、特效与 asset 路由只认 imagePath，因此两类来源共用同一条通路。
 * @param id - 设置的 preset 字段值。
 * @returns 是否由 imagePath 提供背景内容。
 */
export function isImagePreset(id: string): boolean {
  return BACKGROUND_IMAGE_PRESETS.includes(id)
}