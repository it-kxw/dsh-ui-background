/**
 * 背景 DOM 呈现器测试（jsdom）：背景层挂载、CSS 变量写入/撤回、dispose、非浏览器 guard。
 * @author 康小汪【kxw】
 * @date 2026-09-10
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BackgroundPresenter, BG_ACTIVE_ATTRIBUTE, backgroundValues,
} from '../src/client/background-presenter.ts'
import { DEFAULT_BACKGROUND_SETTINGS, type BackgroundSettings } from '../src/background-settings.ts'
import { BACKGROUND_PRESETS, presetById } from '../src/client/presets.ts'

/** 生成一份可用的激活设置。 */
function activeSettings(over: Partial<BackgroundSettings> = {}): BackgroundSettings {
  return { ...DEFAULT_BACKGROUND_SETTINGS, preset: 'aurora', ...over }
}

/** 当前层元素（无则 null）。 */
function layer(): HTMLDivElement | null {
  return document.querySelector('div.dsh-bg-layer')
}

afterEach(() => {
  document.body.innerHTML = ''
  document.body.removeAttribute(BG_ACTIVE_ATTRIBUTE)
})

describe('背景层挂载与变量写入', () => {
  it('激活时打标记建层并写入双配色与样式变量', () => {
    const presenter = new BackgroundPresenter()
    presenter.apply(activeSettings({ opacity: 0.5, blur: 4 }))
    expect(document.body.hasAttribute(BG_ACTIVE_ATTRIBUTE)).toBe(true)
    const el = layer()
    expect(el).not.toBeNull()
    expect(el!.getAttribute('aria-hidden')).toBe('true')
    const preset = presetById('aurora')!
    expect(el!.style.getPropertyValue('--dsh-bg-image-light')).toBe(preset.light)
    expect(el!.style.getPropertyValue('--dsh-bg-image-dark')).toBe(preset.dark)
    expect(el!.style.getPropertyValue('--dsh-bg-opacity')).toBe('0.5')
    expect(el!.style.getPropertyValue('--dsh-bg-blur')).toBe('4px')
    expect(el!.style.getPropertyValue('--dsh-bg-size')).toBe('cover')
    expect(el!.style.getPropertyValue('--dsh-bg-repeat')).toBe('no-repeat')
  })

  it('tile 填充把 size 置 auto、repeat 置 repeat', () => {
    const presenter = new BackgroundPresenter()
    presenter.apply(activeSettings({ fill: 'tile' }))
    const el = layer()!
    expect(el.style.getPropertyValue('--dsh-bg-size')).toBe('auto')
    expect(el.style.getPropertyValue('--dsh-bg-repeat')).toBe('repeat')
  })

  it('旧值在重写前被撤回（不残留上一次的变量）', () => {
    const presenter = new BackgroundPresenter()
    presenter.apply(activeSettings({ blur: 8 }))
    presenter.apply(activeSettings({ blur: 0 }))
    const el = layer()!
    expect(el.style.getPropertyValue('--dsh-bg-blur')).toBe('0px')
    // 变量个数与写入集合一致（无残留）。
    expect(el.style.length).toBe(6)
  })

  it('重激活复用同一个层元素', () => {
    const presenter = new BackgroundPresenter()
    presenter.apply(activeSettings())
    const first = layer()
    presenter.apply(activeSettings({ preset: 'none' }))
    presenter.apply(activeSettings())
    expect(layer()).toBe(first)
  })
})

describe('差异写入（滑块拖动性能回归）', () => {
  it('只改不透明度时只写一个变量，且不撤回任何变量', () => {
    const presenter = new BackgroundPresenter()
    presenter.apply(activeSettings({ opacity: 1 }))
    const el = layer()!
    const setProperty = vi.spyOn(el.style, 'setProperty')
    const removeProperty = vi.spyOn(el.style, 'removeProperty')
    // 拖动滑块时每个输入事件都会 apply：旧实现"先撤 6 个再写 6 个"= 12 次 DOM
    // 写入 + 两轮整层样式失效，现在应当只有 1 次写入。
    presenter.apply(activeSettings({ opacity: 0.5 }))
    expect(setProperty).toHaveBeenCalledTimes(1)
    expect(setProperty).toHaveBeenCalledWith('--dsh-bg-opacity', '0.5')
    expect(removeProperty).not.toHaveBeenCalled()
    expect(el.style.getPropertyValue('--dsh-bg-opacity')).toBe('0.5')
    expect(el.style.length).toBe(6)
  })

  it('改模糊只写模糊变量；切换预设只重写两张背景图', () => {
    const presenter = new BackgroundPresenter()
    presenter.apply(activeSettings({ preset: 'aurora', blur: 0 }))
    const el = layer()!
    const setProperty = vi.spyOn(el.style, 'setProperty')
    presenter.apply(activeSettings({ preset: 'aurora', blur: 12 }))
    expect(setProperty).toHaveBeenCalledTimes(1)
    expect(setProperty).toHaveBeenCalledWith('--dsh-bg-blur', '12px')
    setProperty.mockClear()
    presenter.apply(activeSettings({ preset: 'sunset', blur: 12 }))
    // 只有浅色/深色两个背景图值变化。
    expect(setProperty).toHaveBeenCalledTimes(2)
    expect([...setProperty.mock.calls].map(call => call[0]).sort())
      .toEqual(['--dsh-bg-image-dark', '--dsh-bg-image-light'])
  })

  it('切到无背景时撤回全部变量（不残留内联样式）', () => {
    const presenter = new BackgroundPresenter()
    presenter.apply(activeSettings({ preset: 'aurora' }))
    const el = layer()!
    presenter.apply(activeSettings({ preset: 'none' }))
    expect(el.style.length).toBe(0)
  })

  it('相同设置的重复 apply 不产生任何 DOM 写入', () => {
    const presenter = new BackgroundPresenter()
    const settings = activeSettings({ opacity: 0.5, blur: 4 })
    presenter.apply(settings)
    const el = layer()!
    const setProperty = vi.spyOn(el.style, 'setProperty')
    const removeProperty = vi.spyOn(el.style, 'removeProperty')
    presenter.apply(settings)
    expect(setProperty).not.toHaveBeenCalled()
    expect(removeProperty).not.toHaveBeenCalled()
  })
})

describe('自定义图片', () => {
  it('custom 带路径时写 url 资源地址（双配色同一 URL）', () => {
    const presenter = new BackgroundPresenter()
    presenter.apply(activeSettings({ preset: 'custom', imagePath: 'D:/photos/a b.png' }))
    const el = layer()!
    const expected = `url("/dsh-ui-background/asset?path=${encodeURIComponent('D:/photos/a b.png')}")`
    expect(el.style.getPropertyValue('--dsh-bg-image-light')).toBe(expected)
    expect(el.style.getPropertyValue('--dsh-bg-image-dark')).toBe(expected)
    expect(backgroundValues(activeSettings({ preset: 'custom', imagePath: 'D:/photos/a b.png' }))).not.toBeNull()
  })

  it('custom 缺图视为无背景', () => {
    const presenter = new BackgroundPresenter()
    presenter.apply(activeSettings({ preset: 'custom', imagePath: '' }))
    expect(document.body.hasAttribute(BG_ACTIVE_ATTRIBUTE)).toBe(false)
    const el = layer()
    if (el !== null) expect(el.style.getPropertyValue('--dsh-bg-image-light')).toBe('')
  })
})

describe('必应壁纸（与 custom 共用同一渲染通路）', () => {
  it('bing 带缓存路径时写的 URL 与 custom 完全一致', () => {
    const presenter = new BackgroundPresenter()
    const cached = 'C:/dsh/ui-background/bing/bing-20260910-7870e237.jpg'
    presenter.apply(activeSettings({ preset: 'bing', imagePath: cached }))
    const el = layer()!
    const expected = `url("/dsh-ui-background/asset?path=${encodeURIComponent(cached)}")`
    expect(el.style.getPropertyValue('--dsh-bg-image-light')).toBe(expected)
    expect(el.style.getPropertyValue('--dsh-bg-image-dark')).toBe(expected)
  })

  it('bing 缺缓存路径视为无背景（首次拉取前不误判为激活）', () => {
    const presenter = new BackgroundPresenter()
    presenter.apply(activeSettings({ preset: 'bing', imagePath: '' }))
    expect(document.body.hasAttribute(BG_ACTIVE_ATTRIBUTE)).toBe(false)
    expect(backgroundValues(activeSettings({ preset: 'bing', imagePath: '' }))).toBeNull()
  })
})

describe('非激活与卸载', () => {
  it('none 与未知预设撤回标记并清空变量', () => {
    const presenter = new BackgroundPresenter()
    presenter.apply(activeSettings())
    const el = layer()!
    presenter.apply(activeSettings({ preset: 'none' }))
    expect(document.body.hasAttribute(BG_ACTIVE_ATTRIBUTE)).toBe(false)
    expect(el.style.getPropertyValue('--dsh-bg-image-light')).toBe('')
    presenter.apply(activeSettings({ preset: 'unknown-future' }))
    expect(document.body.hasAttribute(BG_ACTIVE_ATTRIBUTE)).toBe(false)
  })

  it('dispose 幂等：移除层与标记', () => {
    const presenter = new BackgroundPresenter()
    presenter.apply(activeSettings())
    presenter.dispose()
    expect(layer()).toBeNull()
    expect(document.body.hasAttribute(BG_ACTIVE_ATTRIBUTE)).toBe(false)
    presenter.dispose()
    expect(layer()).toBeNull()
  })
})

describe('非浏览器 guard', () => {
  it('无 document 时 apply/dispose 均为无操作', () => {
    const backup = globalThis.document
    vi.stubGlobal('document', undefined)
    try {
      const presenter = new BackgroundPresenter()
      presenter.apply(activeSettings())
      presenter.dispose()
    } finally {
      vi.unstubAllGlobals()
      expect(globalThis.document).toBe(backup)
    }
  })
})

describe('backgroundValues 纯函数', () => {
  it('解析与回退矩阵', () => {
    expect(backgroundValues(activeSettings())).toEqual({
      light: presetById('aurora')!.light,
      dark: presetById('aurora')!.dark,
    })
    expect(backgroundValues(activeSettings({ preset: 'none' }))).toBeNull()
    expect(backgroundValues(activeSettings({ preset: 'bogus' }))).toBeNull()
    expect(backgroundValues(activeSettings({ preset: 'custom', imagePath: '' }))).toBeNull()
    // 图片来源型预设（bing）与 custom 同样需要非空 imagePath。
    expect(backgroundValues(activeSettings({ preset: 'bing', imagePath: 'C:/b/x.jpg' })))
      .toEqual({
        light: `url("/dsh-ui-background/asset?path=${encodeURIComponent('C:/b/x.jpg')}")`,
        dark: `url("/dsh-ui-background/asset?path=${encodeURIComponent('C:/b/x.jpg')}")`,
      })
    // 全部预设均可解析出双值。
    for (const preset of BACKGROUND_PRESETS) {
      const values = backgroundValues(activeSettings({ preset: preset.id }))
      expect(values).not.toBeNull()
      expect(values!.light).toBe(preset.light)
      expect(values!.dark).toBe(preset.dark)
    }
  })
})