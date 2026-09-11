/**
 * 背景运行时测试：写操作校验与持久化、adopt 吸收、revision 快照、同值无操作。
 * 呈现器用 fake（duck-typed），保持本文件在 node 环境即可运行。
 * @author 康小汪【kxw】
 * @date 2026-09-10
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// 只加载 settings-scope 子路径源码：完整 test-runtime 入口会连带 React 及其
// window 引用，本文件是纯 node 环境。
import { stubSettingsScope, type StubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime/src/settings-scope'
import type { BackgroundSettings } from '../src/background-settings.ts'
import { DEFAULT_BACKGROUND_SETTINGS } from '../src/background-settings.ts'
import { BackgroundRuntime, type BackgroundSnapshot } from '../src/client/background-runtime.ts'
import type { BackgroundPresenter } from '../src/client/background-presenter.ts'

// 持久化走 200ms 防抖：全文件使用 fake timers，断言落盘前推进窗口。
// （fake timers 不影响 Promise 微任务，setImagePath 的 await 照常工作。）
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

/** 推进持久化防抖窗口（200ms 判断 + 余量）。 */
function advancePersist(): void {
  vi.advanceTimersByTime(201)
}

/** fake 呈现器：记录 apply/dispose，不碰 DOM。 */
function fakePresenter(): { presenter: BackgroundPresenter; apply: ReturnType<typeof vi.fn> } {
  const apply = vi.fn()
  return { presenter: { apply, dispose: vi.fn() } as unknown as BackgroundPresenter, apply }
}

/** 构造运行时与配套句柄。 */
function make(): {
  runtime: BackgroundRuntime
  host: StubSettingsScope<BackgroundSettings>
  apply: ReturnType<typeof vi.fn>
  snapshots: BackgroundSnapshot[]
} {
  const host = stubSettingsScope<BackgroundSettings>()
  const { presenter, apply } = fakePresenter()
  const runtime = new BackgroundRuntime(host.scope, presenter)
  const snapshots: BackgroundSnapshot[] = []
  runtime.subscribe(() => { snapshots.push(runtime.getSnapshot()) })
  return { runtime, host, apply, snapshots }
}

describe('BackgroundRuntime 初始状态', () => {
  it('scope 无值时为默认设置，revision 0', () => {
    const { runtime } = make()
    const snapshot = runtime.getSnapshot()
    expect(snapshot.revision).toBe(0)
    expect(snapshot.settings).toEqual(DEFAULT_BACKGROUND_SETTINGS)
  })

  it('构造时吸收 scope 已存在的 section', () => {
    const host = stubSettingsScope<BackgroundSettings>()
    host.publish({ status: 'ready', value: { ...DEFAULT_BACKGROUND_SETTINGS, preset: 'aurora' }, revision: 3, writable: true })
    const { presenter, apply } = fakePresenter()
    const runtime = new BackgroundRuntime(host.scope, presenter)
    expect(runtime.getSnapshot().settings.preset).toBe('aurora')
    expect(apply).toHaveBeenCalledTimes(1)
    // 吸收不写回。
    expect(host.set).not.toHaveBeenCalled()
  })
})

describe('BackgroundRuntime 写操作', () => {
  it('setPreset 持久化并发布；未知 id 抛错且无副作用', () => {
    const { runtime, host, apply, snapshots } = make()
    runtime.setPreset('aurora')
    // 拖动类写不立即落盘（防抖）；停顿后冲刷。
    expect(host.set).not.toHaveBeenCalled()
    advancePersist()
    expect(host.set).toHaveBeenCalledWith('preset', 'aurora')
    expect(runtime.getSnapshot().settings.preset).toBe('aurora')
    expect(apply).toHaveBeenCalledWith(runtime.getSnapshot().settings)
    expect(snapshots).toHaveLength(1)
    expect(() => runtime.setPreset('bogus')).toThrow('not registered')
    expect(host.set).toHaveBeenCalledTimes(1)
    expect(snapshots).toHaveLength(1)
  })

  it('none（清除）与 custom 是合法预设值', () => {
    const { runtime, host } = make()
    runtime.setPreset('aurora')
    runtime.setPreset('none')
    expect(runtime.getSnapshot().settings.preset).toBe('none')
    advancePersist()
    expect(host.set).toHaveBeenLastCalledWith('preset', 'none')
    runtime.setPreset('custom')
    expect(runtime.getSnapshot().settings.preset).toBe('custom')
    expect(() => runtime.setPreset('bogus')).toThrow('not registered')
  })

  it('同值写为无操作（不持久化、不发布）', () => {
    const { runtime, host, snapshots } = make()
    runtime.setPreset('aurora')
    runtime.setPreset('aurora')
    runtime.setOpacity(0.5)
    runtime.setOpacity(0.5)
    advancePersist()
    expect(host.set).toHaveBeenCalledTimes(2)
    expect(snapshots).toHaveLength(2)
  })

  it('setOpacity/setBlur/setFill 校验范围并持久化', () => {
    const { runtime, host } = make()
    runtime.setOpacity(0.5)
    advancePersist()
    expect(host.set).toHaveBeenCalledWith('opacity', 0.5)
    runtime.setBlur(4)
    advancePersist()
    expect(host.set).toHaveBeenCalledWith('blur', 4)
    runtime.setFill('tile')
    advancePersist()
    expect(host.set).toHaveBeenCalledWith('fill', 'tile')
    for (const bad of [0, 1.01, Number.NaN]) {
      expect(() => runtime.setOpacity(bad)).toThrow('outside')
    }
    for (const bad of [-1, 33, 1.5]) {
      expect(() => runtime.setBlur(bad)).toThrow('outside')
    }
    expect(() => runtime.setFill('stretch' as never)).toThrow('fill')
  })

  it('setImagePath 先持久化再发布：非空时把 preset 置为 custom；空串仅清图', async () => {
    const { runtime, host } = make()
    // stub 的 host.set 立即 resolve；await 后快照才更新（先持久化后发布）。
    const pending = runtime.setImagePath('  D:/photos/a.png  ')
    expect(host.set).toHaveBeenCalledWith('imagePath', 'D:/photos/a.png')
    await pending
    expect(runtime.getSnapshot().settings.imagePath).toBe('D:/photos/a.png')
    expect(runtime.getSnapshot().settings.preset).toBe('custom')
    expect(host.set).toHaveBeenCalledWith('preset', 'custom')
    await runtime.setImagePath('')
    expect(runtime.getSnapshot().settings.imagePath).toBe('')
    expect(host.set).toHaveBeenCalledWith('imagePath', '')
  })

  it('防抖：拖动期间不落盘，停顿后按字段各写一笔最新值', () => {
    const { runtime, host } = make()
    runtime.setOpacity(0.1)
    runtime.setBlur(2)
    runtime.setOpacity(0.5) // 同字段尾沿合并
    expect(host.set).not.toHaveBeenCalled()
    vi.advanceTimersByTime(199)
    expect(host.set).not.toHaveBeenCalled()
    advancePersist()
    // 同字段只留最新一笔；不同字段各自落盘。
    expect(host.set).toHaveBeenCalledTimes(2)
    expect(host.set).toHaveBeenCalledWith('opacity', 0.5)
    expect(host.set).toHaveBeenCalledWith('blur', 2)
  })

  it('dispose 冲刷防抖中的待写字段', () => {
    const { runtime, host } = make()
    runtime.setOpacity(0.8)
    expect(host.set).not.toHaveBeenCalled()
    runtime.dispose()
    expect(host.set).toHaveBeenCalledWith('opacity', 0.8)
    // 冲刷后幂等：再次 dispose 不再重复写。
    runtime.dispose()
    expect(host.set).toHaveBeenCalledTimes(1)
  })
})

describe('BackgroundRuntime adopt 吸收', () => {
  it('host 发布新 section 时吸收并发布，不写回', () => {
    const { runtime, host, snapshots } = make()
    host.publish({ status: 'ready', value: { ...DEFAULT_BACKGROUND_SETTINGS, preset: 'midnight', blur: 8 }, revision: 1, writable: true })
    runtime.adopt()
    const snapshot = runtime.getSnapshot()
    expect(snapshot.settings).toMatchObject({ preset: 'midnight', blur: 8 })
    expect(snapshot.revision).toBe(1)
    expect(host.set).not.toHaveBeenCalled()
    expect(snapshots).toHaveLength(1)
  })

  it('值未变的发布不产生新修订', () => {
    const { runtime, host, snapshots } = make()
    host.publish({ status: 'ready', value: { ...DEFAULT_BACKGROUND_SETTINGS, preset: 'aurora' }, revision: 1, writable: true })
    runtime.adopt()
    host.publish({ value: { ...DEFAULT_BACKGROUND_SETTINGS, preset: 'aurora' }, revision: 2 })
    runtime.adopt()
    expect(runtime.getSnapshot().revision).toBe(1)
    expect(snapshots).toHaveLength(1)
  })
})

describe('BackgroundRuntime 快照与订阅', () => {
  it('无变化时 getSnapshot 引用稳定；发布后更新', () => {
    const { runtime } = make()
    const before = runtime.getSnapshot()
    expect(runtime.getSnapshot()).toBe(before)
    runtime.setPreset('emerald')
    const after = runtime.getSnapshot()
    expect(after).not.toBe(before)
    expect(runtime.getSnapshot()).toBe(after)
  })

  it('订阅者收到每次发布；一个抛错的订阅者不卡住后续', () => {
    const { runtime, snapshots } = make()
    runtime.subscribe(() => { throw new Error('boom') })
    runtime.setPreset('slate')
    expect(snapshots).toHaveLength(1)
    expect(runtime.getSnapshot().revision).toBe(1)
  })

  it('取消订阅后不再收到通知', () => {
    const { runtime, snapshots } = make()
    const unsubscribe = runtime.subscribe(() => { snapshots.push(runtime.getSnapshot()) })
    unsubscribe()
    runtime.setPreset('sand')
    expect(snapshots).toHaveLength(1)
  })
})