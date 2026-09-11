/**
 * 必应壁纸路由（Node 半边）：`POST /dsh-ui-background/bing`。
 *
 * 浏览器半边点「必应壁纸」或「换一张」时调用它，拿回一张已缓存在本地的图片路径，
 * 随后由 runtime 持久化到 imagePath —— 与上传图片共用同一条 asset 路由渲染通路。
 *
 * 安全边界（外部输入全部校验）：
 * 1. 仅 POST；其余方法 405。
 * 2. body 上限 4 KiB（Content-Length 预检 + 流式累计双保险），超限 413。
 * 3. body 必须是合法 JSON 对象，mode 必须是枚举值，market/uhd 类型不符即 400。
 * 4. 上游失败统一 502，且只回我们自己定义的短原因（不带本地路径等内部细节）。
 * 5. 本路由不写任何设置（持久化由浏览器半边按序完成，避免半状态）。
 *
 * @author 康小汪【kxw】
 * @date 2026-09-11
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import { BACKGROUND_BING_PATH, DEFAULT_BING_MARKET } from './background-settings.ts'
import { normalizeMarket, type BingWallpaperRequest, type BingWallpaperService } from './bing-service.ts'
import { hasOversizedBody, readBodyWithin } from './request-body.ts'

/** 请求体上限：只有 mode/market/uhd 三个短字段，4 KiB 足够且能挡住超大 body。 */
const BING_BODY_MAX_BYTES = 4 * 1024

/** 允许的取图模式。 */
const BING_MODES: readonly string[] = Object.freeze(['latest', 'random'])

/** 路由参数化配置。 */
export interface BackgroundBingRouteOptions {
  /** 背景设置命名空间（读取必应默认值与当前图片）。 */
  namespace: string
  /** 必应壁纸服务（由 apply 注入，测试可传桩）。 */
  service: BingWallpaperService
}

/**
 * 创建必应壁纸路由。路由生命周期由调用方（apply 的 effect）管理。
 * @param ctx - 宿主上下文（请求时经 ctx.get('settings') 读默认值与当前图片）。
 * @param options - 命名空间与服务实例。
 * @returns 可直接注册到 ctx.webServer 的 WebRoute。
 */
export function createBackgroundBingRoute(
  ctx: Context,
  options: BackgroundBingRouteOptions,
): WebRoute {
  return {
    kind: 'exact',
    path: BACKGROUND_BING_PATH,
    handler: (req, res) => { void handleBingRequest(ctx, options, req, res) },
  }
}

/**
 * 处理一次取图请求：方法 → 体积 → body 校验 → 取图 → 响应。
 * @param ctx - 宿主上下文。
 * @param options - 路由参数。
 * @param req - 请求。
 * @param res - 响应。
 */
async function handleBingRequest(
  ctx: Context,
  options: BackgroundBingRouteOptions,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    respond(res, 405)
    return
  }
  if (hasOversizedBody(req, BING_BODY_MAX_BYTES)) {
    // 预检拒绝：排空请求体，避免未被消费的连接残留。
    req.resume()
    respond(res, 413, 'payload too large')
    return
  }
  const body = await readBodyWithin(req, BING_BODY_MAX_BYTES)
  if (body === undefined) {
    respond(res, 413, 'payload too large')
    return
  }
  const request = parseBingRequest(body, settingsDefaults(ctx, options.namespace))
  if (request === undefined) {
    respond(res, 400, 'invalid request')
    return
  }
  try {
    respondJson(res, 200, await options.service.fetchWallpaper(request))
  } catch (error) {
    // 上游不可用/图片异常对界面是同一件事：这次没拿到图。细节收敛后返回。
    respondJson(res, 502, { error: 'bing unavailable', reason: reasonOf(error) })
  }
}

/**
 * 解析请求体为取图参数：mode 必须显式合法，market/uhd 缺省时用设置里的默认值
 * （便于手写 curl 调试，也让界面不必重复发送自己的配置）。
 * @param body - 请求体字节。
 * @param defaults - 设置里的默认地区、分辨率偏好与当前图片路径。
 * @returns 取图请求，或 undefined（不合法）。
 */
function parseBingRequest(
  body: Buffer,
  defaults: { market: string; uhd: boolean; exclude: string },
): BingWallpaperRequest | undefined {
  let payload: unknown
  try {
    payload = JSON.parse(body.toString('utf8'))
  } catch {
    return undefined
  }
  const record = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>
  const mode = record.mode ?? 'latest'
  const market = record.market ?? defaults.market
  const uhd = record.uhd ?? defaults.uhd
  if (typeof mode !== 'string' || !BING_MODES.includes(mode)) return undefined
  if (typeof market !== 'string' || typeof uhd !== 'boolean') return undefined
  return {
    mode: mode as BingWallpaperRequest['mode'],
    market: normalizeMarket(market),
    uhd,
    exclude: defaults.exclude,
  }
}

/**
 * 读取设置里的必应默认值与当前图片路径。
 * @param ctx - 宿主上下文。
 * @param namespace - 背景设置命名空间。
 * @returns 地区、分辨率偏好与当前图片（换一张时避开它）。
 */
function settingsDefaults(ctx: Context, namespace: string): { market: string; uhd: boolean; exclude: string } {
  const settings = ctx.get('settings') as SettingsProvider | undefined
  const section = settings?.get(namespace) as Partial<Record<'bingMarket' | 'bingUhd' | 'imagePath', unknown>> | undefined
  return {
    market: typeof section?.bingMarket === 'string' ? section.bingMarket : DEFAULT_BING_MARKET,
    uhd: typeof section?.bingUhd === 'boolean' ? section.bingUhd : true,
    exclude: typeof section?.imagePath === 'string' ? section.imagePath : '',
  }
}

/**
 * 把内部错误收敛为界面可读的短原因：只放行我们自己抛出的 `bing …` 文案，
 * 网络栈错误一律归一 —— 避免把本地路径/上游地址等内部细节带进响应。
 * @param error - 捕获到的错误。
 * @returns 短原因文本。
 */
function reasonOf(error: unknown): string {
  if (error instanceof Error) {
    if (/^bing [a-z0-9 ]+$/.test(error.message)) return error.message
    if (error.name === 'TimeoutError') return 'bing request timed out'
  }
  return 'unexpected error'
}

/** 写 JSON 响应；响应头已发送时直接掐断连接。 */
function respondJson(res: ServerResponse, status: number, payload: object): void {
  if (res.headersSent) {
    res.destroy()
    return
  }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

/** 写一个极简状态响应（可带原因文本）。 */
function respond(res: ServerResponse, status: number, message?: string): void {
  if (res.headersSent) {
    res.destroy()
    return
  }
  res.writeHead(status)
  res.end(message)
}
