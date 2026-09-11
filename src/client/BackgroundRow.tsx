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
  backgroundAssetUrl,
  BACKGROUND_BLUR_MAX, BACKGROUND_BLUR_MIN, BACKGROUND_BLUR_STEP,
  BACKGROUND_FILLS, BACKGROUND_OPACITY_MAX, BACKGROUND_OPACITY_MIN,
  BACKGROUND_OPACITY_STEP, BACKGROUND_PRESET_NONE, type BackgroundFill,
} from '../background-settings.ts'
import { BACKGROUND_PRESETS, isCustomPreset } from './presets.ts'
import { backgroundValues } from './background-presenter.ts'
import { formatAspect } from './suggest-fill.ts'
import type { BackgroundLocaleKey } from './locales.ts'
import type { createBackgroundStore } from './background-store.ts'
import { readImageSize } from './upload.ts'
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

/** 注入的业务面：四个写操作 + 清除 + 上传。 */
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
 * 渲染背景设置行。
 * @param props - 组合后的 slot props。
 * @returns 设置行元素树。
 */
export function BackgroundRow(
  { t, useStore, setPreset, setOpacity, setBlur, setFill, clear, uploadImage }: BackgroundRowProps,
) {
  const settings = useStore(state => state.settings)
  // 激活判定与呈现器一致：可解析出背景值（none / 未知预设 / custom 缺图均为假）。
  const active = backgroundValues(settings) !== null
  const customActive = isCustomPreset(settings.preset) && settings.imagePath !== ''

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
    void readImageSize(backgroundAssetUrl(settings.imagePath)).then((size) => {
      if (!cancelled && size.width > 0) setDims(size)
    })
    return () => { cancelled = true }
  }, [customActive, settings.imagePath])

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
      <div className={css.presetRow}>
        <button
          type="button"
          className={clsx(css.presetCard, settings.preset === BACKGROUND_PRESET_NONE && css.selected)}
          aria-pressed={settings.preset === BACKGROUND_PRESET_NONE}
          onClick={() => { setPreset(BACKGROUND_PRESET_NONE) }}
        >
          <div className={css.preview} />
          {t('preset.none')}
        </button>
        {BACKGROUND_PRESETS.map(preset => (
          <button
            key={preset.id}
            type="button"
            className={clsx(css.presetCard, settings.preset === preset.id && css.selected)}
            aria-pressed={settings.preset === preset.id}
            onClick={() => { setPreset(preset.id) }}
          >
            <div className={css.preview} style={{ backgroundImage: preset.light }} />
            {t(preset.labelKey)}
          </button>
        ))}
      </div>
      <div className={css.imageRow}>
        <button
          type="button"
          className={css.applyButton}
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
      <div className={css.controlRow}>
        <label className={css.controlLabel} htmlFor="background-opacity">{t('row.opacity')}</label>
        <input
          id="background-opacity"
          className={css.slider}
          type="range"
          min={BACKGROUND_OPACITY_MIN}
          max={BACKGROUND_OPACITY_MAX}
          step={BACKGROUND_OPACITY_STEP}
          value={settings.opacity}
          onChange={(event) => { setOpacity(Number(event.target.value)) }}
        />
        <span className={css.controlValue}>{percentText(settings.opacity)}</span>
      </div>
      <div className={css.controlRow}>
        <label className={css.controlLabel} htmlFor="background-blur">{t('row.blur')}</label>
        <input
          id="background-blur"
          className={css.slider}
          type="range"
          min={BACKGROUND_BLUR_MIN}
          max={BACKGROUND_BLUR_MAX}
          step={BACKGROUND_BLUR_STEP}
          value={settings.blur}
          onChange={(event) => { setBlur(Number(event.target.value)) }}
        />
        <span className={css.controlValue}>{settings.blur}px</span>
      </div>
      <div className={css.pillRow}>
        {BACKGROUND_FILLS.map(fill => (
          <button
            key={fill}
            type="button"
            className={clsx(css.pill, settings.fill === fill && css.selected)}
            aria-pressed={settings.fill === fill}
            onClick={() => { setFill(fill) }}
          >
            {t(FILL_LABEL_KEY[fill])}
          </button>
        ))}
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