/**
 * dsh-ui-background 浏览器半边（dsh.client 插件入口）。
 *
 * apply 把阶段 1+2 的模块装配为两个 UI 入口：
 * 1. `settings.general.item` 的「背景」设置行；
 * 2. `shell.overlay` 的一键切换悬浮按钮。
 * 两个注册项共享同一个 store 工厂（renderer 各自创建实例，因此 apply 维护
 * 两个 bound，sync 全部同步）；store 是运行时快照的镜像，写入永远走
 * BackgroundRuntime 的 set* 入口。
 *
 * @author 康小汪【kxw】
 * @date 2026-09-10
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only：拉取 ctx.settingsScope Context merge 与设置行安全类型。
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only：拉取 ctx.locale 与 ctx.slots 的 Context merge。
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only：拉取 ui-layout 声明的 SlotMap（'sidebar'|'main'|'rightbar'|'shell.overlay'）。
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { BACKGROUND_PRESET_NONE, BACKGROUND_SETTINGS_NAMESPACE, type BackgroundFill, type BackgroundSettings } from '../background-settings.ts'
import { BackgroundPresenter } from './background-presenter.ts'
import { BackgroundEffects } from './effects-renderer.ts'
import { BackgroundRuntime } from './background-runtime.ts'
import { createBackgroundStore } from './background-store.ts'
import { installBackgroundStyles } from './styles.ts'
import { nextPresetId } from './presets.ts'
import { uploadBackgroundImage } from './upload.ts'
import { en, zh, type BackgroundLocaleKey } from './locales.ts'
import { BackgroundRow, type BackgroundRowInjected, type UploadedBackground } from './BackgroundRow.tsx'
import { BackgroundQuickToggle, type BackgroundQuickToggleInjected } from './BackgroundQuickToggle.tsx'

export type { BackgroundRowComponentProps, BackgroundRowInjected } from './BackgroundRow.tsx'
export type { BackgroundQuickToggleComponentProps, BackgroundQuickToggleInjected } from './BackgroundQuickToggle.tsx'
export type { BackgroundLocaleKey } from './locales.ts'
export type { BackgroundSettings } from '../background-settings.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 背景功能的所有文案。 */
    'settings.background': BackgroundLocaleKey
  }
}

/** 本插件拥有的 locale 命名空间。 */
export const NS = 'settings.background'

/** 依赖的服务：slots/locale/remote/settingsScope（remote 供 settingsScope 转发的失效订阅）。 */
export const inject = ['slots', 'locale', 'remote', 'settingsScope']

/**
 * 浏览器插件激活：装配运行时、dict 与两个 UI 入口。
 * @param ctx - 浏览器 Cordis 上下文。
 */
export function apply(ctx: ClientContext): void {
  installBackgroundStyles(ctx)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-ui-background: dictionaries')

  // 运行时：scope 持久化 + presenter 投影 DOM + 特效投影画布 + adopt 跟随 host。
  const host = ctx.settingsScope.bind<BackgroundSettings>({ namespace: BACKGROUND_SETTINGS_NAMESPACE })
  const presenter = new BackgroundPresenter()
  const effects = new BackgroundEffects()
  const runtime = new BackgroundRuntime(host, presenter, effects)
  ctx.effect(() => host.subscribe(() => { runtime.adopt() }), 'dsh-ui-background: settings adoption')
  // 卸载时冲刷防抖中的持久化写，并随插件释放特效渲染器（取消动画帧、移除画布）。
  ctx.effect(() => () => {
    runtime.dispose()
    effects.dispose()
  }, 'dsh-ui-background: persist flush')

  // store 镜像：两个注册项各自持有实例，apply 维护两个 bound 一并同步。
  const store = createBackgroundStore()
  let rowBound: BoundActions<typeof store> | undefined
  let toggleBound: BoundActions<typeof store> | undefined
  const sync = (): void => {
    const snapshot = runtime.getSnapshot()
    rowBound?.sync(snapshot.settings, snapshot.revision)
    toggleBound?.sync(snapshot.settings, snapshot.revision)
  }
  ctx.effect(() => runtime.subscribe(sync), 'dsh-ui-background: store sync')
  sync()

  // 设置行：inject 工厂返回纯回调（写操作全部落到 runtime）。
  const rowInjected = (actions: BoundActions<typeof store>): BackgroundRowInjected => {
    rowBound = actions
    // 注册与首帧渲染之间没有丢事件保证：从 getter 重同步一次（revision 守卫丢弃重复）。
    sync()
    return {
      setPreset: (id) => { runtime.setPreset(id) },
      setOpacity: (value) => { runtime.setOpacity(value) },
      setBlur: (value) => { runtime.setBlur(value) },
      setFill: (fill) => { runtime.setFill(fill) },
      setStreaks: (enabled) => { runtime.setStreaks(enabled) },
      setParticles: (enabled) => { runtime.setParticles(enabled) },
      clear: () => {
        // 复合清除：预设回 none、图片清空（图片持久化为异步，fire-and-forget）。
        runtime.setPreset(BACKGROUND_PRESET_NONE)
        void runtime.setImagePath('')
      },
      // 上传：读取尺寸 → 上传落盘 → 先持久化（asset 路由授权）→ 固定 cover
      // 铺满全屏（照片背景的用户预期；比例对比仅作展示提示，不自动切 contain，
      // 需要完整显示时用户可手动在「填充方式」切换）。
      uploadImage: async (file): Promise<UploadedBackground> => {
        const uploaded = await uploadBackgroundImage(file)
        await runtime.setImagePath(uploaded.path)
        const fill: BackgroundFill = 'cover'
        if (fill !== runtime.getSnapshot().settings.fill) runtime.setFill(fill)
        return { path: uploaded.path, width: uploaded.width, height: uploaded.height, fill }
      },
    }
  }
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'background',
    order: 20,
    store,
    locale: NS,
    inject: rowInjected,
  }, BackgroundRow))

  // 悬浮按钮：单击推进到下一个预设。
  const toggleInjected = (actions: BoundActions<typeof store>): BackgroundQuickToggleInjected => {
    toggleBound = actions
    sync()
    return {
      next: () => { runtime.setPreset(nextPresetId(runtime.getSnapshot().settings.preset)) },
    }
  }
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'background-toggle',
    order: 100,
    store,
    locale: NS,
    inject: toggleInjected,
  }, BackgroundQuickToggle))
}