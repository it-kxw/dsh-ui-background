/**
 * 本地图片资源路由（Node 半边）。
 *
 * 浏览器不能直接引用 `file://` 本地图片，因此这里注册一个同源只读路由：
 * `GET|HEAD /dsh-ui-background/asset?path=<absolute>`。
 *
 * 安全边界（外部输入，全部校验）：
 * 1. 只允许读取「设置里用户配置的那张图」——规范化路径后与当前 imagePath
 *    严格相等，防任意文件读取（攻击者无法用任意路径枚举文件）。
 * 2. 扩展名白名单（png/jpg/jpeg/gif/webp/avif）。
 * 3. 文件大小上限（BACKGROUND_ASSET_MAX_BYTES，超限 413）。
 * 4. 只读流式响应；非 GET/HEAD 一律 405；错误响应不携带路径细节。
 *
 * @author 康小汪【kxw】
 * @date 2026-09-10
 */
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import { BACKGROUND_IMAGE_MIME, BACKGROUND_ASSET_PATH } from './background-settings.ts'

/** 路由参数化配置。 */
export interface BackgroundAssetRouteOptions {
  /** 背景设置的命名空间（从其中读 imagePath）。 */
  namespace: string
  /** 单张图片字节数上限。 */
  maxBytes: number
}

/**
 * 创建背景图片资源路由。路由生命周期由调用方（apply 的 effect）管理。
 * @param ctx - 宿主上下文（请求时经 ctx.get('settings') 读配置）。
 * @param options - 命名空间与上限参数。
 * @returns 可直接注册到 ctx.webServer 的 WebRoute。
 */
export function createBackgroundAssetRoute(
  ctx: Context,
  options: BackgroundAssetRouteOptions,
): WebRoute {
  return {
    kind: 'exact',
    path: BACKGROUND_ASSET_PATH,
    handler: (req, res) => { void handleAssetRequest(ctx, options, req, res) },
  }
}

/**
 * 处理一次图片请求：方法检查 → 参数解析 → 配置比对 → 流式返回。
 * @param ctx - 宿主上下文。
 * @param options - 路由参数。
 * @param req - 请求。
 * @param res - 响应。
 */
async function handleAssetRequest(
  ctx: Context,
  options: BackgroundAssetRouteOptions,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    respond(res, 405)
    return
  }
  const requested = imagePathFromRequest(req)
  if (requested === undefined) {
    respond(res, 400)
    return
  }
  const allowedPath = resolveConfiguredImagePath(ctx, options.namespace, requested)
  if (allowedPath === undefined) {
    respond(res, 404)
    return
  }
  await streamImage(res, allowedPath, options.maxBytes, req.method)
}

/**
 * 从请求 URL 解析唯一一个 path 参数（encodeURIComponent 编码的绝对路径）。
 * 参数缺失、重复或空串都视为无效（拒绝 —— 多重取值有歧义，不一概取第一个）。
 * @param req - 请求。
 * @returns 解码后的路径，或 undefined。
 */
function imagePathFromRequest(req: IncomingMessage): string | undefined {
  if (req.url === undefined) return undefined
  const url = new URL(req.url, 'http://dsh.invalid')
  const values = url.searchParams.getAll('path')
  if (values.length !== 1) return undefined
  const trimmed = values[0]!.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * 解析「被允许读取的路径」：只有当前设置里配置的 imagePath（规范化后与
 * 请求路径严格相等）可以读取；settings 未提供或未配置图片时一律拒绝。
 * @param ctx - 宿主上下文。
 * @param namespace - 背景设置命名空间。
 * @param requested - 请求方提供的路径。
 * @returns 规范化后的配置路径，或 undefined（拒绝）。
 */
function resolveConfiguredImagePath(
  ctx: Context,
  namespace: string,
  requested: string,
): string | undefined {
  const settings = ctx.get('settings') as SettingsProvider | undefined
  if (settings === undefined) return undefined
  const section = settings.get(namespace) as { imagePath?: unknown } | undefined
  if (typeof section?.imagePath !== 'string' || section.imagePath === '') return undefined
  const configured = resolve(section.imagePath)
  // 严格相等：两边都经 resolve 规范化，`..` 逃逸与相对路径在比较前已归一。
  return configured === resolve(requested) ? configured : undefined
}

/**
 * 把图片文件流式返回给浏览器（HEAD 只回响应头）。
 * @param res - 响应。
 * @param filePath - 已通过校验的绝对路径。
 * @param maxBytes - 大小上限。
 * @param method - GET 或 HEAD。
 */
async function streamImage(
  res: ServerResponse,
  filePath: string,
  maxBytes: number,
  method: string,
): Promise<void> {
  let fileStat
  try {
    fileStat = await stat(filePath)
  } catch {
    respond(res, 404)
    return
  }
  if (!fileStat.isFile() || fileStat.size > maxBytes) {
    respond(res, fileStat.isFile() ? 413 : 404)
    return
  }
  const mime = mimeTypeOf(filePath)
  if (mime === undefined) {
    respond(res, 404)
    return
  }
  res.writeHead(200, { 'content-type': mime, 'content-length': fileStat.size })
  if (method === 'HEAD') {
    res.end()
    return
  }
  try {
    await pipeline(createReadStream(filePath), res)
  } catch {
    // 流中途失败（TOCTOU 等）：未发送响应头回 404，已发送则掐断，不泄露细节。
    if (!res.headersSent) respond(res, 404)
    else res.destroy()
  }
}

/**
 * 按扩展名查 MIME；不在白名单（含无扩展名）返回 undefined。
 * @param filePath - 文件绝对路径。
 * @returns MIME 类型或 undefined。
 */
function mimeTypeOf(filePath: string): string | undefined {
  return BACKGROUND_IMAGE_MIME[extname(filePath).toLowerCase().slice(1)]
}

/**
 * 写一个极简状态响应；若响应头已发送则无法改写，直接掐断连接。
 * @param res - 响应。
 * @param status - HTTP 状态码。
 */
function respond(res: ServerResponse, status: number): void {
  if (res.headersSent) {
    res.destroy()
    return
  }
  res.writeHead(status)
  res.end()
}