/**
 * dsh-ui-background Node 半边（宿主侧插件入口）。
 *
 * 被宿主 Loader 作为普通 Cordis 插件 import，职责：
 * 1. 注册 `ui-background` 设置命名空间的 schemastery schema（settings 服务的
 *    持久化与校验基础，浏览器半边经同步的 scope 读写同一份文档）；
 * 2. 注册本地图片资源路由（读）与上传路由（写，落盘到 $DSH_HOME/ui-background）。
 * settings / webServer 均为 web 组合中的常驻服务，用 ctx.inject 等待即可。
 *
 * @author 康小汪【kxw】
 * @date 2026-09-10
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only：拉取 ctx.settings 与 ctx.webServer 的 Context merge。
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import {
  BACKGROUND_ASSET_MAX_BYTES, BACKGROUND_SETTINGS_NAMESPACE,
  BACKGROUND_UPLOAD_DIR_NAME,
} from './background-settings.ts'
import { BackgroundSettingsSchema } from './background-schema.ts'
import { createBackgroundAssetRoute } from './asset-route.ts'
import { createBackgroundUploadRoute } from './upload-route.ts'

export const name = 'dsh-ui-background'

/**
 * 插件激活入口。
 * @param ctx - 宿主 Cordis 上下文。
 */
export function apply(ctx: Context): void {
  // 注册设置命名空间：schema 负责默认值与边界，注册随本 fiber 生命周期。
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(BACKGROUND_SETTINGS_NAMESPACE, BackgroundSettingsSchema)
  })
  // 注册路由：随 webServer 就绪后挂载，效果化管理以随 fiber 卸载。
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () => webCtx.webServer.register(createBackgroundAssetRoute(ctx, {
        namespace: BACKGROUND_SETTINGS_NAMESPACE,
        maxBytes: BACKGROUND_ASSET_MAX_BYTES,
      })),
      'dsh-ui-background: asset route',
    )
    webCtx.effect(
      () => webCtx.webServer.register(createBackgroundUploadRoute(ctx, {
        namespace: BACKGROUND_SETTINGS_NAMESPACE,
        maxBytes: BACKGROUND_ASSET_MAX_BYTES,
        uploadDir: dshHomePath(BACKGROUND_UPLOAD_DIR_NAME),
      })),
      'dsh-ui-background: upload route',
    )
  })
}