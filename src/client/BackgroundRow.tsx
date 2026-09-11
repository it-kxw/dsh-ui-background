/**
 * 「背景」设置行（settings.general.item 贡献）。
 *
 * 四份 props share 派生：运行时 + store + locale + inject 业务面。业务写操作
 * 全部经 injected 回调进入 runtime（组件零 ctx、零直接订阅外部数据）。
 * 自定义图片有两路：路径手输（应用按钮提交）与本地文件上传（uploadImage
 * 注入回调，内部完成上传、持久化与比例适配）；上传后可展示图片与窗口的比例
 * 对比。上传/错误/尺寸均为本组件私有视口状态。
 *
 * @author 康小汪【kxw】
 * @date 2026-09-10
 */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only：拉取 SettingsScope Context merge（契约一致）。
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  backgroundAssetUrl, DEFAULT_BACKGROUND_SETTINGS,
  BACKGROUND_BLUR_MAX, BACKGROUND_BLUR_MIN, BACKGROUND_BLUR_STEP,
  BACKGROUND_FILLS, BACKGROUND_OPACITY_MAX, BACKGROUND_OPACITY_MIN,
  BACKGROUND_OPACITY_STEP, BACKGROUND_PRESET_NONE, type BackgroundFill,
  type BackgroundSettings,
} from '../background-settings.ts'
import { BACKGROUND_PRESETS, isCustomPreset } from './presets.ts'
import { backgroundValues } from './background-presenter.ts'
import { formatAspect } from './suggest-fill.ts'
import type { BackgroundLocaleKey } from './locales.ts'
import type { BackgroundState, createBackgroundStore } from './background-store.ts'
import { readImageSize } from './upload.ts'
import { BingControls, type BackgroundTranslate, type BingFetchMode } from './BingControls.tsx'
import css from './BackgroundRow.module.css'

/** 填充方式 → 文案 key 的显式映射（t 需要字面量键，不能用模板拼接）。 */
const FILL_LABEL_KEY: Record<BackgroundFill, BackgroundLocaleKey> = {
  cover: 'row.fill.cover',
  contain: 'row.fill.contain',
  tile: 'row.fill.tile',
}

/** 图片上传的结果（uploadImage 注入回调的返回）。 */
export interface UploadedBackground {
  /** 服务端落盘的绝对路径（已持久化）。 */
  path: string
  /** 图片像素宽。 */
  width: number
  /** 图片像素高。 */
  height: number
  /** 按比例适配选定的填充方式。 */
  fill: BackgroundFill
}

/** 注入的业务面：四个写操作 + 清除 + 上传 + 两个特效开关 + 必应壁纸四操作。 */
export interface BackgroundRowInjected {
  /** 切换预设（'none' 或内置预设 id）。 */
  setPreset: (id: string) => void
  /** 设置不透明度（0.05..1）。 */
  setOpacity: (value: number) => void
  /** 设置模糊半径（0..32 px）。 */
  setBlur: (value: number) => void
  /** 设置图片填充方式。 */
  setFill: (value: BackgroundFill) => void
  /** 一键清除背景（预设置 none、图片清空）。 */
  clear: () => void
  /** 上传本地图片：完成上传、持久化与比例适配，返回结果供展示。 */
  uploadImage: (file: File) => Promise<UploadedBackground>
  /** 切换动态流光特效。 */
  setStreaks: (enabled: boolean) => void
  /** 切换粒子特效。 */
  setParticles: (enabled: boolean) => void
  /** 取一张必应壁纸并应用（latest 今日 / random 换一张）；失败抛出。 */
  applyBing: (mode: BingFetchMode) => Promise<void>
  /** 设置必应壁纸地区。 */
  setBingMarket: (market: string) => void
  /** 设置必应壁纸是否取 4K。 */
  setBingUhd: (enabled: boolean) => void
  /** 设置必应壁纸是否每日自动更新。 */
  setBingAutoRefresh: (enabled: boolean) => void
}

/** 完整组件 props：运行时分享 + store 分享 + locale 座位 + 注入面。 */
export type BackgroundRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsStore<ReturnType<typeof createBackgroundStore>>
  & PropsLocale<'settings.background'>
  & BackgroundRowInjected

/** 一行长度的纯展示换算：不透明度小数 → 百分比整数文本。 */
function percentText(value: number): string {
  return `${Math.round(value * 100)}%`
}

/** 当前窗口像素尺寸（挂载时取一次；比例提示足够精确即可）。 */
function readViewport(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight }
}

/**
 * 生成「设置快照 → 单个字段」的订阅选择器。
 *
 * 为什么不用 `useStore(state => state.settings)`：每次 publish 都会冻结出一个
 * 新的 settings 对象，整对象订阅会让本行在**任何**字段变化时重渲染——拖动
 * 不透明度/模糊滑块时每帧都会重渲染预设卡片、必应区块与全部胶囊，滑块的拇指
 * 因此跟手迟滞。逐字段订阅后，拖动只重渲染对应的一小行。
 * @param field - 需要订阅的字段名。
 * @returns 供 useStore 使用的选择器。
 */
function selectField<K extends keyof BackgroundSettings>(field: K) {
  return (state: BackgroundState): BackgroundSettings[K] => state.settings[field]
}

/**
 * 数值滑块行（不透明度 / 模糊）。
 *
 * 拖动期间用本地态驱动 input 的 value：拇指跟随指针不需要等待
 * 「运行时发布 → store 同步 → React 渲染」这条链路，手感与原生滑块一致；
 * 同时照常把每次变化写回运行时（持久化仍有 200ms 尾沿防抖）。
 * 外部值变化（采纳磁盘设置、清除背景）会回填本地态，拖动中不被覆盖。
 *
 * @param props - 见 SliderFieldProps。
 * @returns 一行「标签 + 滑块 + 读数」。
 */
function SliderField(
  { id, label, value, min, max, step, formatText, onChange }: SliderFieldProps,
): React.ReactElement {
  const [draft, setDraft] = useState(value)
  useEffect(() => {
    // 外部值变化（采纳磁盘设置、程序化重置）时回填本地态。拖动期间 store 里的
    // 值与本地点同步推进，这次回填是等值写入，React 会直接跳过重渲染。
    setDraft(current => (current === value ? current : value))
  }, [value])

  return (
    <div className={css.controlRow}>
      <label className={css.controlLabel} htmlFor={id}>{label}</label>
      <div className={css.controlBody}>
        <input
          id={id}
          className={css.slider}
          type="range"
          min={min}
          max={max}
          step={step}
          value={draft}
          // 读屏读「100%」「8px」而不是裸数字。
          aria-valuetext={formatText(draft)}
          onChange={(event) => {
            const next = Number(event.target.value)
            setDraft(next)
            onChange(next)
          }}
        />
        <span className={css.controlValue}>{formatText(draft)}</span>
      </div>
    </div>
  )
}

/** 数值滑块行的 props。 */
interface SliderFieldProps {
  /** input 的 id（与 label 的 htmlFor 配对）。 */
  id: string
  /** 可见标签文本。 */
  label: string
  /** 当前生效值。 */
  value: number
  /** 最小值。 */
  min: number
  /** 最大值。 */
  max: number
  /** 步进。 */
  step: number
  /** 读数与 aria-valuetext 的格式化。 */
  formatText: (value: number) => string
  /** 值变化回调（写回运行时）。 */
  onChange: (value: number) => void
}

/** 单个滑块包装组件的公用 props（自行订阅所需字段）。 */
interface FieldSliderProps {
  /** 文案函数。 */
  t: BackgroundTranslate
  /** slot store 的订阅钩子。 */
  useStore: BackgroundRowProps['useStore']
  /** 值变化回调。 */
  onChange: (value: number) => void
}

/**
 * 不透明度滑块：只订阅 opacity。
 *
 * 单独成组件而不是内联在整行里，是为了把重渲染范围压到这一行——拖动
 * 不透明度时预设卡片、必应区块与全部胶囊都不会重渲染。
 * @param props - 见 FieldSliderProps。
 * @returns 不透明度滑块行。
 */
function OpacitySlider({ t, useStore, onChange }: FieldSliderProps): React.ReactElement {
  const value = useStore(selectField('opacity'))
  return (
    <SliderField
      id="background-opacity"
      label={t('row.opacity')}
      value={value}
      min={BACKGROUND_OPACITY_MIN}
      max={BACKGROUND_OPACITY_MAX}
      step={BACKGROUND_OPACITY_STEP}
      formatText={percentText}
      onChange={onChange}
    />
  )
}

/**
 * 模糊滑块：只订阅 blur。
 * @param props - 见 FieldSliderProps。
 * @returns 模糊滑块行。
 */
function BlurSlider({ t, useStore, onChange }: FieldSliderProps): React.ReactElement {
  const value = useStore(selectField('blur'))
  return (
    <SliderField
      id="background-blur"
      label={t('row.blur')}
      value={value}
      min={BACKGROUND_BLUR_MIN}
      max={BACKGROUND_BLUR_MAX}
      step={BACKGROUND_BLUR_STEP}
      formatText={blur => `${blur}px`}
      onChange={onChange}
    />
  )
}

/**
 * 渲染背景设置行。
 * @param props - 组合后的 slot props。
 * @returns 设置行元素树。
 */
export function BackgroundRow(
  { t, useStore, setPreset, setOpacity, setBlur, setFill, clear, uploadImage, setStreaks, setParticles, applyBing, setBingMarket, setBingUhd, setBingAutoRefresh }: BackgroundRowProps,
) {
  // 逐字段订阅：拖动滑块不会让整行重渲染（见 selectField 的说明）。
  const preset = useStore(selectField('preset'))
  const imagePath = useStore(selectField('imagePath'))
  const fill = useStore(selectField('fill'))
  const streaks = useStore(selectField('streaks'))
  const particles = useStore(selectField('particles'))
  const bingMarket = useStore(selectField('bingMarket'))
  const bingUhd = useStore(selectField('bingUhd'))
  const bingAutoRefresh = useStore(selectField('bingAutoRefresh'))
  const bingTitle = useStore(selectField('bingTitle'))
  const bingDate = useStore(selectField('bingDate'))

  // 激活判定与呈现器一致：可解析出背景值（none / 未知预设 / 图片来源型缺图均为假）。
  const active = backgroundValues({ ...DEFAULT_BACKGROUND_SETTINGS, preset, imagePath }) !== null
  const customActive = isCustomPreset(preset) && imagePath !== ''

  // 上传流程状态。
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(false)

  // 当前自定义图片尺寸（上传时直接取得；刷新后按 asset URL 重读）。
  const [dims, setDims] = useState<{ width: number; height: number } | undefined>(undefined)
  useEffect(() => {
    if (!customActive) {
      setDims(undefined)
      return
    }
    let cancelled = false
    void readImageSize(backgroundAssetUrl(imagePath)).then((size) => {
      if (!cancelled && size.width > 0) setDims(size)
    })
    return () => { cancelled = true }
  }, [customActive, imagePath])

  const [viewport] = useState(readViewport)

  /** 处理文件选择：转 uploadImage 注入回调；失败置错误提示。 */
  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    if (file === undefined) return
    setUploading(true)
    setUploadError(false)
    try {
      const uploaded = await uploadImage(file)
      setDims({ width: uploaded.width, height: uploaded.height })
    } catch {
      setUploadError(true)
    } finally {
      setUploading(false)
      // 清空以便同一文件可再次选择。
      event.target.value = ''
    }
  }

  return (
    <div className={css.group}>
      <div className={css.title}>{t('row.title')}</div>

      {/* 来源组：预设卡片 / 上传 / 必应壁纸。子组标签用 aria-labelledby 关联，
          读屏会把整组读成「来源，分组」而不是一串孤立按钮。 */}
      <div className={css.cluster} role="group" aria-labelledby="background-source-label">
        <div className={css.subLabel} id="background-source-label">{t('row.group.source')}</div>
        <div className={css.presetRow}>
          <button
            type="button"
            className={clsx(css.presetCard, preset === BACKGROUND_PRESET_NONE && css.selected)}
            aria-pressed={preset === BACKGROUND_PRESET_NONE}
            onClick={() => { setPreset(BACKGROUND_PRESET_NONE) }}
          >
            <div className={css.preview} />
            {t('preset.none')}
          </button>
          {BACKGROUND_PRESETS.map(item => (
            <button
              key={item.id}
              type="button"
              className={clsx(css.presetCard, preset === item.id && css.selected)}
              aria-pressed={preset === item.id}
              onClick={() => { setPreset(item.id) }}
            >
              <div className={css.preview} style={{ backgroundImage: item.light }} />
              {t(item.labelKey)}
            </button>
          ))}
        </div>
        <div className={css.imageRow}>
          {/* 行内只保留一个实心主 CTA（必应取图），上传降级为幽灵按钮。 */}
          <button
            type="button"
            className={css.ghostButton}
            disabled={uploading}
            onClick={() => { fileInputRef.current?.click() }}
          >
            {uploading ? t('row.uploading') : t('row.upload')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
            hidden
            onChange={(event) => { void handleFileChange(event) }}
          />
        </div>
        {customActive && dims !== undefined && (
          <div className={css.ratioHint}>
            {t('row.ratio', {
              image: formatAspect(dims.width, dims.height),
              window: formatAspect(viewport.width, viewport.height),
            })}
          </div>
        )}
        {uploadError && (
          <div className={css.errorHint} role="alert">
            {t('row.uploadError')}
          </div>
        )}
        <BingControls
          t={t}
          settings={{ preset, imagePath, bingMarket, bingUhd, bingAutoRefresh, bingTitle, bingDate }}
          applyBing={applyBing}
          setBingMarket={setBingMarket}
          setBingUhd={setBingUhd}
          setBingAutoRefresh={setBingAutoRefresh}
        />
      </div>

      {/* 显示组：三行共用「72px 标签 + 内容」网格，窄屏时内容列内换行。 */}
      <div className={css.cluster} role="group" aria-labelledby="background-display-label">
        <div className={css.subLabel} id="background-display-label">{t('row.group.display')}</div>
        {/* 两个滑块各自订阅自己的值：拖动只重渲染对应的一行。 */}
        <OpacitySlider t={t} useStore={useStore} onChange={setOpacity} />
        <BlurSlider t={t} useStore={useStore} onChange={setBlur} />
        <div className={css.controlRow}>
          <span className={css.controlLabel} id="background-fill-label">{t('row.fill')}</span>
          <div className={css.controlBody} role="group" aria-labelledby="background-fill-label">
            {BACKGROUND_FILLS.map(item => (
              <button
                key={item}
                type="button"
                className={clsx(css.pill, fill === item && css.selected)}
                aria-pressed={fill === item}
                onClick={() => { setFill(item) }}
              >
                {t(FILL_LABEL_KEY[item])}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 特效组：关闭 / 流光 / 粒子（互斥，同时只能开启一个）。 */}
      <div className={css.cluster} role="group" aria-labelledby="background-effects-label">
        <div className={css.subLabel} id="background-effects-label">{t('row.group.effects')}</div>
        <div className={css.controlBody}>
          <button
            type="button"
            className={clsx(css.pill, !streaks && !particles && css.selected)}
            aria-pressed={!streaks && !particles}
            onClick={() => { setStreaks(false); setParticles(false) }}
          >
            {t('row.effect.off')}
          </button>
          <button
            type="button"
            className={clsx(css.pill, streaks && css.selected)}
            aria-pressed={streaks}
            onClick={() => { setStreaks(true) }}
          >
            {t('row.streaks')}
          </button>
          <button
            type="button"
            className={clsx(css.pill, particles && css.selected)}
            aria-pressed={particles}
            onClick={() => { setParticles(true) }}
          >
            {t('row.particles')}
          </button>
        </div>
      </div>

      {active && (
        <button type="button" className={css.clearButton} onClick={clear}>
          {t('row.clear')}
        </button>
      )}
    </div>
  )
}

/** 供 apply 侧传递类型（无值导出则仅类型）。 */
export type { BackgroundRowProps as BackgroundRowComponentProps }