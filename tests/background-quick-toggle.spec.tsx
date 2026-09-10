/**
 * shell.overlay 悬浮按钮测试：当前背景名展示、aria/title、单击推进。
 * @author 康小汪【kxw】
 * @date 2026-09-10
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import {
  BackgroundQuickToggle, type BackgroundQuickToggleProps,
} from '../src/client/BackgroundQuickToggle.tsx'
import { DEFAULT_BACKGROUND_SETTINGS, type BackgroundSettings } from '../src/background-settings.ts'
import { zh } from '../src/client/locales.ts'

/** 查表式 fake t（含 {name} 模板参数支持）。 */
function fakeT(key: string, params?: Record<string, unknown>): string {
  const template: string = (zh as Record<string, string>)[key] ?? key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match)
}

/** 组装 props：stub useStore 读固定设置，next spy。 */
function makeProps(over: Partial<BackgroundSettings> = {}): {
  props: BackgroundQuickToggleProps
  next: ReturnType<typeof vi.fn>
} {
  const next = vi.fn()
  const settings = { ...DEFAULT_BACKGROUND_SETTINGS, ...over }
  const props = {
    t: fakeT,
    useStore: (selector: (state: { settings: BackgroundSettings }) => unknown) =>
      selector({ settings, revision: 0 }),
    next,
  } as unknown as BackgroundQuickToggleProps
  return { props, next }
}

afterEach(cleanup)

describe('BackgroundQuickToggle 展示', () => {
  it('none 显示「无」，title 含当前名，aria-label 为切换', () => {
    const { props } = makeProps()
    const view = render(<BackgroundQuickToggle {...props} />)
    const button = view.getByRole('button')
    expect(button.textContent).toBe('无')
    expect(button.getAttribute('aria-label')).toBe('切换背景')
    expect(button.getAttribute('title')).toBe('背景：无')
  })

  it('内置预设显示预设名', () => {
    const { props } = makeProps({ preset: 'aurora' })
    expect(render(<BackgroundQuickToggle {...props} />).getByRole('button').textContent).toBe('极光')
  })

  it('自定义图片显示「自定义图片」；custom 缺图回退「无」', () => {
    const withImage = makeProps({ preset: 'custom', imagePath: 'D:/a.png' })
    expect(render(<BackgroundQuickToggle {...withImage.props} />).getByRole('button').textContent)
      .toBe('自定义图片')
    cleanup()
    const withoutImage = makeProps({ preset: 'custom', imagePath: '' })
    expect(render(<BackgroundQuickToggle {...withoutImage.props} />).getByRole('button').textContent)
      .toBe('无')
  })

  it('未知预设置回退「无」', () => {
    const { props } = makeProps({ preset: 'future-preset' })
    expect(render(<BackgroundQuickToggle {...props} />).getByRole('button').textContent).toBe('无')
  })
})

describe('BackgroundQuickToggle 交互', () => {
  it('单击触发 next', () => {
    const { props, next } = makeProps()
    fireEvent.click(render(<BackgroundQuickToggle {...props} />).getByRole('button'))
    expect(next).toHaveBeenCalledTimes(1)
  })
})