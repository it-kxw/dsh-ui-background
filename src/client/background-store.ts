/**
 * 设置行与悬浮按钮共享的 slot store：镜像运行时快照。
 *
 * 参照 ui-theme 的 settings-store：apply 世界里的运行时发布监听是唯一写入方，
 * 组件经 props.useStore 读取；revision 守卫丢弃过期重复同步。
 * 工厂在 apply 里只创建一次，两个注册项共用同一实例（跨注册共享视图状态）。
 *
 * @author 康小汪【kxw】
 * @date 2026-09-10
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import { DEFAULT_BACKGROUND_SETTINGS, type BackgroundSettings } from '../background-settings.ts'

/** store 状态：设置 + 运行时 revision（-1 表示尚未同步，使 revision 0 生效）。 */
export interface BackgroundState {
  /** 当前生效设置。 */
  settings: Readonly<BackgroundSettings>
  /** 运行时 revision；-1 到首次同步之间。 */
  revision: number
}

/** 声明的 action 形状（给工厂一个稳定返回类型）。 */
type BackgroundActions = {
  /** 从运行时快照同步；revision 不增长则忽略（过期重复）。 */
  sync: (draft: BackgroundState, settings: Readonly<BackgroundSettings>, revision: number) => void
}

/**
 * 创建背景 store 工厂。
 * @returns store 句柄（apply 内创建一次，两个注册项共享）。
 */
export function createBackgroundStore(): EngineStoreHandle<BackgroundState, BackgroundActions> {
  return defineStore({
    init: (): BackgroundState => ({ settings: DEFAULT_BACKGROUND_SETTINGS, revision: -1 }),
    actions: {
      sync: (draft, settings, revision) => {
        if (revision <= draft.revision) return
        draft.settings = settings
        draft.revision = revision
      },
    },
  })
}