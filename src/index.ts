/**
 * dsh-ui-background Node 半边（宿主侧插件入口）。
 *
 * 被宿主 Loader 作为普通 Cordis 插件 import，职责：
 * 1. 注册 `ui-background` 设置命名空间的 schemastery schema（settings 服务的
 *    持久化与校验基础，浏览器半边经同步的 scope 读写同一份文档）；
 * 2. 注册本地图片资源路由（读）、上传路由（写，落盘到 $DSH_HOME/ui-background）
 *    与必应壁纸路由（下载并缓存到 $DSH_HOME/ui-background/bing）。
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
  BACKGROUND_ASSET_MAX_BYTES, BACKGROUND_BING_DIR_NAME, BACKGROUND_SETTINGS_NAMESPACE,
  BACKGROUND_UPLOAD_DIR_NAME,
} from './background-settings.ts'
import { BackgroundSettingsSchema } from './background-schema.ts'
import { createBackgroundAssetRoute } from './asset-route.ts'
import { createBackgroundUploadRoute } from './upload-route.ts'
import { createBackgroundBingRoute } from './bing-route.ts'
import { BingWallpaperService } from './bing-service.ts'

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
    // 必应壁纸服务：实例内维护归档快照与在途请求合并，故装配期创建一次即可。
    // fetch 用箭头包一层：避免把全局 fetch 当方法调用时依赖 this 绑定。
    const bingService = new BingWallpaperService({
      fetchImpl: (input, init) => fetch(input, init),
      cacheDir: dshHomePath(BACKGROUND_UPLOAD_DIR_NAME, BACKGROUND_BING_DIR_NAME),
      maxBytes: BACKGROUND_ASSET_MAX_BYTES,
    })
    webCtx.effect(
      () => webCtx.webServer.register(createBackgroundBingRoute(ctx, {
        namespace: BACKGROUND_SETTINGS_NAMESPACE,
        service: bingService,
      })),
      'dsh-ui-background: bing route',
    )
  })
}