/**
 * shell.overlay 一键切换悬浮按钮。
 *
 * shell.overlay 是全局 list 座位（additive、click-through，entry 自行 opt-in
 * 交互）；本按钮固定右下角，单击把预设推进到下一个（'none' → 预设… → 'none'，
 * 自定义图片时先回到 none）。当前背景名作为次要标签展示，帮助用户理解下一次
 * 点击会切到什么之外还能看到现状。
 *
 * @author 康小汪【kxw】
 * @date 2026-09-10
 */
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BackgroundSettings } from '../background-settings.ts'
import { isCustomPreset, presetById } from './presets.ts'
import type { createBackgroundStore } from './background-store.ts'
import type { BackgroundLocaleKey } from './locales.ts'
import css from './BackgroundQuickToggle.module.css'

/** 注入的业务面：仅一个「推进到下一个预设」动作。 */
export interface BackgroundQuickToggleInjected {
  /** 把预设循环推进一位并持久化。 */
  next: () => void
}

/** 完整组件 props：运行时分享 + store 分享 + locale 座位 + 注入面。 */
export type BackgroundQuickToggleProps =
  PropsRuntime<'shell.overlay'>
  & PropsStore<ReturnType<typeof createBackgroundStore>>
  & PropsLocale<'settings.background'>
  & BackgroundQuickToggleInjected

/**
 * 当前背景的显示名：custom（有图）→ 「自定义图片」；命中预设 → 预设名；
 * 否则（none / 未知预设置）→ 「无」。
 * @param view - 只含判定所需字段的设置视图（避免传整份设置）。
 * @param t - namespace 翻译函数。
 * @returns 展示名。
 */
function backgroundName(
  view: { preset: string; imagePath: string },
  t: (key: BackgroundLocaleKey) => string,
): string {
  if (isCustomPreset(view.preset)) {
    return view.imagePath === '' ? t('preset.none') : t('row.customImage')
  }
  const preset = presetById(view.preset)
  return preset === undefined ? t('preset.none') : t(preset.labelKey)
}

/**
 * 渲染悬浮切换按钮。
 * @param props - 组合后的 slot props。
 * @returns 按钮元素。
 */
export function BackgroundQuickToggle({ t, useStore, next }: BackgroundQuickToggleProps) {
  // 逐字段订阅：拖动设置行里的滑块时本按钮不必重渲染（每次 publish 都会冻结出
  // 新的 settings 对象，整对象订阅会被无谓唤醒）。
  const preset = useStore(state => state.settings.preset)
  const imagePath = useStore(state => state.settings.imagePath)
  const name = backgroundName({ preset, imagePath }, t)
  return (
    <button
      type="button"
      className={css.toggle}
      aria-label={t('toggle.next')}
      title={t('toggle.label', { name })}
      onClick={next}
    >
      <span>{name}</span>
    </button>
  )
}

/** 供 apply 侧传递类型。 */
export type { BackgroundQuickToggleProps as BackgroundQuickToggleComponentProps }