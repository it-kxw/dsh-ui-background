/**
 * 「背景」设置行组件测试：直接喂 props（stub useStore + fake t + spy 回调），
 * 断言用户可见行为（选中态、点击回调、清除条件显示）。
 * @author 康小汪【kxw】
 * @date 2026-09-10
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { BackgroundRow, type BackgroundRowProps } from '../src/client/BackgroundRow.tsx'
import { DEFAULT_BACKGROUND_SETTINGS, type BackgroundSettings } from '../src/background-settings.ts'
import { zh } from '../src/client/locales.ts'

/** 查表式 fake t（含 {name} 模板参数支持）。 */
function fakeT(key: string, params?: Record<string, unknown>): string {
  const template: string = (zh as Record<string, string>)[key] ?? key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match)
}

/** 组装 props：stub useStore 读固定设置，回调全部 spy，uploadImage/applyBing 默认成功桩。 */
function makeProps(over: Partial<BackgroundSettings> = {}): {
  props: BackgroundRowProps
  callbacks: {
    setPreset: ReturnType<typeof vi.fn>
    setOpacity: ReturnType<typeof vi.fn>
    setBlur: ReturnType<typeof vi.fn>
    setFill: ReturnType<typeof vi.fn>
    setStreaks: ReturnType<typeof vi.fn>
    setParticles: ReturnType<typeof vi.fn>
    clear: ReturnType<typeof vi.fn>
    setBingMarket: ReturnType<typeof vi.fn>
    setBingUhd: ReturnType<typeof vi.fn>
    setBingAutoRefresh: ReturnType<typeof vi.fn>
  }
  uploadImage: ReturnType<typeof vi.fn>
  applyBing: ReturnType<typeof vi.fn>
} {
  const callbacks = {
    setPreset: vi.fn(), setOpacity: vi.fn(), setBlur: vi.fn(),
    setFill: vi.fn(), setStreaks: vi.fn(), setParticles: vi.fn(), clear: vi.fn(),
    setBingMarket: vi.fn(), setBingUhd: vi.fn(), setBingAutoRefresh: vi.fn(),
  }
  const uploadImage = vi.fn().mockResolvedValue({ path: '', width: 0, height: 0, fill: 'cover' })
  const applyBing = vi.fn().mockResolvedValue(undefined)
  const settings = { ...DEFAULT_BACKGROUND_SETTINGS, ...over }
  const props = {
    t: fakeT,
    useStore: (selector: (state: { settings: BackgroundSettings }) => unknown) =>
      selector({ settings, revision: 0 }),
    ...callbacks,
    uploadImage,
    applyBing,
  } as unknown as BackgroundRowProps
  return { props, callbacks, uploadImage, applyBing }
}

afterEach(cleanup)

describe('BackgroundRow 预设选择', () => {
  it('渲染标题与全部预设按钮', () => {
    const { props } = makeProps()
    const view = render(<BackgroundRow {...props} />)
    expect(view.getByText('背景')).not.toBeNull()
    expect(view.getByRole('button', { name: '无' })).not.toBeNull()
    expect(view.getByRole('button', { name: '极光' })).not.toBeNull()
    expect(view.getByRole('button', { name: '石板' })).not.toBeNull()
  })

  it('当前设置对应的预设为选中态', () => {
    const { props } = makeProps({ preset: 'aurora' })
    const view = render(<BackgroundRow {...props} />)
    expect(view.getByRole('button', { name: '极光' }).getAttribute('aria-pressed')).toBe('true')
    expect(view.getByRole('button', { name: '无' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('点击预设按钮触发 setPreset', () => {
    const { props, callbacks } = makeProps()
    const view = render(<BackgroundRow {...props} />)
    fireEvent.click(view.getByRole('button', { name: '夜空' }))
    expect(callbacks.setPreset).toHaveBeenCalledWith('midnight')
    fireEvent.click(view.getByRole('button', { name: '无' }))
    expect(callbacks.setPreset).toHaveBeenCalledWith('none')
  })
})

describe('BackgroundRow 滑块与填充', () => {
  it('滑块变化触发 setOpacity / setBlur', () => {
    const { props, callbacks } = makeProps()
    const view = render(<BackgroundRow {...props} />)
    const sliders = view.getAllByRole('slider')
    fireEvent.change(sliders[0]!, { target: { value: '0.5' } })
    expect(callbacks.setOpacity).toHaveBeenCalledWith(0.5)
    fireEvent.change(sliders[1]!, { target: { value: '8' } })
    expect(callbacks.setBlur).toHaveBeenCalledWith(8)
  })

  it('填充按钮触发 setFill 且当前值为选中态', () => {
    const { props, callbacks } = makeProps({ fill: 'contain' })
    const view = render(<BackgroundRow {...props} />)
    expect(view.getByRole('button', { name: '适应' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(view.getByRole('button', { name: '平铺' }))
    expect(callbacks.setFill).toHaveBeenCalledWith('tile')
  })
})

describe('BackgroundRow 自定义图片（上传）', () => {
  it('选择文件触发 uploadImage 并展示图片/窗口比例对比', async () => {
    const { props, uploadImage } = makeProps({ preset: 'custom', imagePath: 'D:/uploaded/a.png' })
    uploadImage.mockResolvedValue({ path: 'D:/uploaded/a.png', width: 1920, height: 1080, fill: 'cover' })
    const view = render(<BackgroundRow {...props} />)
    const fileInput = view.container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([new Uint8Array([1])], 'photo.png', { type: 'image/png' })
    fireEvent.change(fileInput, { target: { files: [file] } })
    await waitFor(() => expect(uploadImage).toHaveBeenCalledWith(file))
    // 上传成功后按返回尺寸展示比例（16:9）。
    await waitFor(() => expect(view.getByText(/图片 16:9/)).not.toBeNull())
  })

  it('上传失败展示错误提示', async () => {
    const { props, uploadImage } = makeProps()
    uploadImage.mockRejectedValue(new Error('boom'))
    const view = render(<BackgroundRow {...props} />)
    const fileInput = view.container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'a.png')] } })
    await waitFor(() => expect(view.getByText(/上传失败/)).not.toBeNull())
  })
})

describe('BackgroundRow 清除按钮', () => {
  it('仅背景激活时显示，点击触发 clear', () => {
    const inactive = makeProps()
    const viewA = render(<BackgroundRow {...inactive.props} />)
    expect(viewA.queryByRole('button', { name: '清除背景' })).toBeNull()
    cleanup()
    const active = makeProps({ preset: 'aurora' })
    const viewB = render(<BackgroundRow {...active.props} />)
    fireEvent.click(viewB.getByRole('button', { name: '清除背景' }))
    expect(active.callbacks.clear).toHaveBeenCalledTimes(1)
  })

  it('custom 缺图（无背景）时不显示清除按钮', () => {
    const { props } = makeProps({ preset: 'custom', imagePath: '' })
    const view = render(<BackgroundRow {...props} />)
    expect(view.queryByRole('button', { name: '清除背景' })).toBeNull()
  })
})

describe('BackgroundRow 动态特效单选', () => {
  it('渲染关闭/流光/粒子三个单选项并反映选中态', () => {
    const { props } = makeProps({ streaks: true, particles: false })
    const view = render(<BackgroundRow {...props} />)
    expect(view.getByRole('button', { name: '关闭' }).getAttribute('aria-pressed')).toBe('false')
    expect(view.getByRole('button', { name: '动态流光' }).getAttribute('aria-pressed')).toBe('true')
    expect(view.getByRole('button', { name: '粒子效果' }).getAttribute('aria-pressed')).toBe('false')
    cleanup()
    const particlesOn = render(<BackgroundRow {...makeProps({ particles: true }).props} />)
    expect(particlesOn.getByRole('button', { name: '粒子效果' }).getAttribute('aria-pressed')).toBe('true')
    expect(particlesOn.getByRole('button', { name: '动态流光' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('点击单选项触发对应回调（开流光/开粒子/关闭两者）', () => {
    const { props, callbacks } = makeProps()
    const view = render(<BackgroundRow {...props} />)
    fireEvent.click(view.getByRole('button', { name: '动态流光' }))
    expect(callbacks.setStreaks).toHaveBeenCalledWith(true)
    fireEvent.click(view.getByRole('button', { name: '粒子效果' }))
    expect(callbacks.setParticles).toHaveBeenCalledWith(true)
    fireEvent.click(view.getByRole('button', { name: '关闭' }))
    expect(callbacks.setStreaks).toHaveBeenCalledWith(false)
    expect(callbacks.setParticles).toHaveBeenCalledWith(false)
  })
})

describe('BackgroundRow 必应壁纸', () => {
  it('未激活时显示「获取今日壁纸」，点击触发 applyBing(latest)', async () => {
    const { props, applyBing } = makeProps()
    const view = render(<BackgroundRow {...props} />)
    fireEvent.click(view.getByRole('button', { name: '获取今日壁纸' }))
    await waitFor(() => expect(applyBing).toHaveBeenCalledWith('latest'))
  })

  it('激活时按钮变「换一张」并展示标题与日期', async () => {
    const { props, applyBing } = makeProps({
      preset: 'bing', imagePath: 'C:/b/a.jpg', bingTitle: '地中海风情尽显', bingDate: '2026-09-10',
    })
    const view = render(<BackgroundRow {...props} />)
    expect(view.getByText('地中海风情尽显 · 2026-09-10')).not.toBeNull()
    fireEvent.click(view.getByRole('button', { name: '换一张' }))
    await waitFor(() => expect(applyBing).toHaveBeenCalledWith('random'))
  })

  it('标题缺失时信息行退回功能区名（不出现孤立的「 · 日期」）', () => {
    const { props } = makeProps({ preset: 'bing', imagePath: 'C:/b/a.jpg', bingDate: '2026-09-10' })
    const view = render(<BackgroundRow {...props} />)
    expect(view.getByText('必应壁纸 · 2026-09-10')).not.toBeNull()
  })

  it('取图失败展示提示，且不清空当前背景', async () => {
    const { props, applyBing, callbacks } = makeProps({ preset: 'bing', imagePath: 'C:/b/a.jpg' })
    applyBing.mockRejectedValue(new Error('boom'))
    const view = render(<BackgroundRow {...props} />)
    fireEvent.click(view.getByRole('button', { name: '换一张' }))
    await waitFor(() => expect(view.getByText(/获取必应壁纸失败/)).not.toBeNull())
    // 失败不触发任何清除/改设置动作。
    expect(callbacks.clear).not.toHaveBeenCalled()
    expect(callbacks.setPreset).not.toHaveBeenCalled()
    expect(view.getByRole('button', { name: '换一张' })).not.toBeNull()
  })

  it('地区与 4K 变更触发回调；激活态下同时立即重取；自动更新开关不触发取图', async () => {
    const { props, callbacks, applyBing } = makeProps({ preset: 'bing', imagePath: 'C:/b/a.jpg' })
    const view = render(<BackgroundRow {...props} />)
    fireEvent.change(view.getByRole('combobox', { name: '地区' }), { target: { value: 'en-US' } })
    expect(callbacks.setBingMarket).toHaveBeenCalledWith('en-US')
    const checkboxes = view.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0]!) // 4K：默认开启 → 点击关闭
    expect(callbacks.setBingUhd).toHaveBeenCalledWith(false)
    fireEvent.click(checkboxes[1]!) // 每日自动更新：只写设置，不取图
    expect(callbacks.setBingAutoRefresh).toHaveBeenCalledWith(false)
    // 地区 + 4K 各触发一次"立即按新设置重取"，自动更新不触发。
    await waitFor(() => expect(applyBing).toHaveBeenCalledTimes(2))
    expect(applyBing).toHaveBeenCalledWith('latest')
  })
})