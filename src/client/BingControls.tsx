/**
 * 「必应壁纸」设置区块：取图按钮 + 地区/4K/自动更新选项 + 状态提示。
 *
 * 独立于 BackgroundRow 的原因：本区块自带取图状态机（进行中/失败），把状态与
 * 渲染都收在这里，BackgroundRow 只负责摆放，不因新增功能继续膨胀。
 *
 * 状态所有权：settings 由外部 store 提供（唯一数据源）；busy/failed 是本组件私有
 * 视口状态 —— 与上传流程的处理方式一致。取图失败只提示，绝不清空当前背景。
 *
 * @author 康小汪【kxw】
 * @date 2026-09-11
 */
import { useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  BACKGROUND_PRESET_BING, BING_MARKETS,
} from '../background-settings.ts'
import css from './BackgroundRow.module.css'

/** 设置行的文案函数类型（子组件复用，避免各自再写一遍 PropsLocale 泛型）。 */
export type BackgroundTranslate = PropsLocale<'settings.background'>['t']

/** 一次取图的模式。 */
export type BingFetchMode = 'latest' | 'random'

/**
 * 本区块真正需要读取的设置子集。
 *
 * 刻意不收整份 BackgroundSettings：整对象订阅会让本区块在不相关字段（不透明度、
 * 模糊）变化时跟着重渲染，拖动滑块时白白付出渲染成本。
 */
export interface BingSettingsView {
  /** 当前预设 id（判断是否正在显示必应壁纸）。 */
  preset: string
  /** 当前图片路径（判断是否已有缓存图）。 */
  imagePath: string
  /** 地区。 */
  bingMarket: string
  /** 是否取 4K。 */
  bingUhd: boolean
  /** 是否每日自动更新。 */
  bingAutoRefresh: boolean
  /** 展示用标题。 */
  bingTitle: string
  /** 展示用日期。 */
  bingDate: string
}

/** 区块 props：设置子集 + 四个写操作（全部由 apply 注入，组件零 ctx）。 */
export interface BingControlsProps {
  /** 文案函数。 */
  t: BackgroundTranslate
  /** 本区块需要的设置子集。 */
  settings: BingSettingsView
  /** 取一张必应壁纸并应用；失败抛出，由本组件转为提示。 */
  applyBing: (mode: BingFetchMode) => Promise<void>
  /** 设置地区。 */
  setBingMarket: (market: string) => void
  /** 设置是否取 4K。 */
  setBingUhd: (enabled: boolean) => void
  /** 设置是否每日自动更新。 */
  setBingAutoRefresh: (enabled: boolean) => void
}

/**
 * 渲染必应壁纸区块。
 * @param props - 见 BingControlsProps。
 * @returns 区块元素树。
 */
export function BingControls({ t, settings, applyBing, setBingMarket, setBingUhd, setBingAutoRefresh }: BingControlsProps) {
  // 进行中的模式（undefined 表示空闲）：用于禁用按钮并切换按钮文案。
  const [busy, setBusy] = useState<BingFetchMode | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const active = isBingActive(settings)

  /**
   * 取图：进行中禁用交互，失败置提示位（保留当前背景不动）。
   * @param mode - latest 今日 / random 换一张。
   */
  const run = async (mode: BingFetchMode): Promise<void> => {
    setBusy(mode)
    setFailed(false)
    try {
      await applyBing(mode)
    } catch {
      setFailed(true)
    } finally {
      setBusy(undefined)
    }
  }

  /**
   * 选项变更：先写入设置；若当前正显示必应壁纸则立即按新设置重取一张，
   * 否则用户会以为"改了没反应"（4K 开关尤其明显：不重取就还是旧规格）。
   * @param write - 写入设置的动作。
   */
  const changeOption = (write: () => void): void => {
    write()
    if (active) void run('latest')
  }

  const buttonLabel = busy !== undefined ? t('row.bing.loading') : active ? t('row.bing.next') : t('row.bing.get')

  return (
    <>
      {/* 与「不透明度 / 模糊 / 填充方式」共用同一套「72px 标签 + 内容」网格：
          窄屏时按钮与开关在内容列内换行，不会与标签错位。 */}
      <div className={css.controlRow}>
        <span className={css.controlLabel} id="background-bing-label">{t('row.bing')}</span>
        <div className={css.controlBody} role="group" aria-labelledby="background-bing-label">
          <button
            type="button"
            className={css.applyButton}
            disabled={busy !== undefined}
            // 取图是异步动作：让读屏知道按钮正在忙，而不是"点了没反应"。
            aria-busy={busy !== undefined}
            onClick={() => { void run(active ? 'random' : 'latest') }}
          >
            {buttonLabel}
          </button>
          <BingOptions
            t={t}
            settings={settings}
            onMarket={(market) => { changeOption(() => { setBingMarket(market) }) }}
            onUhd={(enabled) => { changeOption(() => { setBingUhd(enabled) }) }}
            onAutoRefresh={setBingAutoRefresh}
          />
        </div>
      </div>
      {active && settings.bingDate !== '' && (
        <div className={css.ratioHint}>
          {t('row.bing.info', {
            // 标题缺失（部分地区不返回）时退回显示功能区名，避免出现孤立的「 · 日期」。
            title: settings.bingTitle === '' ? t('row.bing') : settings.bingTitle,
            date: settings.bingDate,
          })}
        </div>
      )}
      {failed && (
        <div className={css.errorHint} role="alert">
          {t('row.bing.error')}
        </div>
      )}
    </>
  )
}

/** 当前是否正在显示必应壁纸（preset 与缓存路径同时就绪才算）。 */
function isBingActive(settings: BingSettingsView): boolean {
  return settings.preset === BACKGROUND_PRESET_BING && settings.imagePath !== ''
}

/** 选项组 props（纯展示 + 回调，状态仍归 BingControls）。 */
interface BingOptionsProps {
  t: BackgroundTranslate
  settings: BingSettingsView
  onMarket: (market: string) => void
  onUhd: (enabled: boolean) => void
  onAutoRefresh: (enabled: boolean) => void
}

/** 地区下拉与两个开关；选项值全部来自白名单常量，组件不硬编码任何选项。 */
function BingOptions({ t, settings, onMarket, onUhd, onAutoRefresh }: BingOptionsProps) {
  return (
    <>
      <select
        className={css.select}
        aria-label={t('row.bing.market')}
        value={settings.bingMarket}
        onChange={(event) => { onMarket(event.target.value) }}
      >
        {BING_MARKETS.map(market => <option key={market} value={market}>{market}</option>)}
      </select>
      <label className={css.checkbox}>
        <input
          type="checkbox"
          checked={settings.bingUhd}
          onChange={(event) => { onUhd(event.target.checked) }}
        />
        {t('row.bing.uhd')}
      </label>
      <label className={css.checkbox}>
        <input
          type="checkbox"
          checked={settings.bingAutoRefresh}
          onChange={(event) => { onAutoRefresh(event.target.checked) }}
        />
        {t('row.bing.auto')}
      </label>
    </>
  )
}
