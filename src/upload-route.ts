/**
 * 图片上传路由（Node 半边）：`POST /dsh-ui-background/upload`。
 *
 * 满足"上传图片"需求：浏览器经 fetch 上传本地图片字节，落盘到
 * `$DSH_HOME/ui-background/` 下随机文件名，返回写入的绝对路径；页面随后把
 * 该路径交给 runtime.setImagePath，asset 路由按设置授权即可读出（上传与读取
 * 共用同一扩展名白名单，保证上传成功的图一定能被读出）。
 *
 * 安全边界（外部输入，全部校验）：
 * 1. 仅 POST；其余方法 405。
 * 2. 扩展名经 `x-upload-ext` 请求头传入，必须在小写白名单内（400 拒绝）。
 * 3. 大小上限：Content-Length 与流式累计双重检查，超限 413。
 * 4. 文件名用随机字节生成，绝不采用客户端提供的文件名（防覆盖/穿越）。
 * 5. 上传成功后尽力清理旧的上传文件（仅删除本上传目录内的文件）。
 *
 * @author 康小汪【kxw】
 * @date 2026-09-10
 */
import { randomBytes } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import { BACKGROUND_IMAGE_MIME, BACKGROUND_UPLOAD_PATH, type BackgroundSettings } from './background-settings.ts'

/** 上传路由参数化配置。 */
export interface BackgroundUploadRouteOptions {
  /** 背景设置的命名空间（从其中读旧 imagePath 以清理旧上传）。 */
  namespace: string
  /** 单张图片字节数上限。 */
  maxBytes: number
  /** 上传落盘目录（绝对路径，由调用方从 dshHomePath('ui-background') 解析）。 */
  uploadDir: string
}

/**
 * 创建图片上传路由。路由生命周期由调用方（apply 的 effect）管理。
 * @param ctx - 宿主上下文（请求时经 ctx.get('settings') 读旧路径）。
 * @param options - 命名空间、上限与落盘目录参数。
 * @returns 可直接注册到 ctx.webServer 的 WebRoute。
 */
export function createBackgroundUploadRoute(
  ctx: Context,
  options: BackgroundUploadRouteOptions,
): WebRoute {
  return {
    kind: 'exact',
    path: BACKGROUND_UPLOAD_PATH,
    handler: (req, res) => { void handleUploadRequest(ctx, options, req, res) },
  }
}

/** 上传请求的扩展名请求头（客户端从文件名取小写扩展名传入）。 */
const UPLOAD_EXT_HEADER = 'x-upload-ext'

/**
 * 处理一次上传请求。
 * @param ctx - 宿主上下文。
 * @param options - 路由参数。
 * @param req - 请求。
 * @param res - 响应。
 */
async function handleUploadRequest(
  ctx: Context,
  options: BackgroundUploadRouteOptions,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    respond(res, 405)
    return
  }
  const ext = uploadExtension(req)
  if (ext === undefined) {
    respond(res, 400)
    return
  }
  if (isOverLimit(req, options.maxBytes)) {
    // 预检拒绝：排空请求体，避免未被消费的连接残留。
    req.resume()
    respond(res, 413, 'payload too large')
    return
  }
  const body = await readBody(req, options.maxBytes)
  if (body === undefined) {
    respond(res, 413, 'payload too large')
    return
  }
  try {
    const path = await storeImage(options.uploadDir, ext, body)
    await removePreviousUpload(ctx, options.namespace, options.uploadDir)
    respondJson(res, 200, { path })
  } catch {
    respond(res, 500)
  }
}

/**
 * 从请求头解析上传扩展名：必须小写且在白名单内。
 * @param req - 请求。
 * @returns 白名单内的扩展名，或 undefined（无/非法）。
 */
function uploadExtension(req: IncomingMessage): string | undefined {
  const raw = req.headers[UPLOAD_EXT_HEADER]
  if (typeof raw !== 'string') return undefined
  const ext = raw.toLowerCase()
  return ext in BACKGROUND_IMAGE_MIME ? ext : undefined
}

/**
 * 用 Content-Length 预检大小（只作快速拒绝；实际以 readBody 累计为准）。
 * @param req - 请求。
 * @param maxBytes - 上限。
 * @returns 是否已明确超限。
 */
function isOverLimit(req: IncomingMessage, maxBytes: number): boolean {
  const length = Number.parseInt(String(req.headers['content-length'] ?? ''), 10)
  return Number.isFinite(length) && length > maxBytes
}

/**
 * 读取请求体并累计字节数；超限返回 undefined（调用方回 413）。
 * @param req - 请求。
 * @param maxBytes - 上限。
 * @returns 请求体字节，或 undefined（超限）。
 */
async function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer | undefined> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > maxBytes) return undefined
    chunks.push(buffer)
  }
  return Buffer.concat(chunks, total)
}

/**
 * 把字节写入上传目录：目录确保存在，文件名随机生成（不采用客户端文件名）。
 * @param uploadDir - 落盘目录（绝对路径）。
 * @param ext - 白名单扩展名。
 * @param body - 图片字节。
 * @returns 写入文件的绝对路径。
 */
async function storeImage(uploadDir: string, ext: string, body: Buffer): Promise<string> {
  await mkdir(uploadDir, { recursive: true })
  const fileName = `${randomBytes(8).toString('hex')}.${ext}`
  const filePath = join(uploadDir, fileName)
  await writeFile(filePath, body)
  return filePath
}

/**
 * 尽力删除上一次上传的文件：仅当旧 imagePath 位于本上传目录内（防误删用户
 * 其它文件）。读不到设置或文件不存在时静默跳过。
 * @param ctx - 宿主上下文。
 * @param namespace - 背景设置命名空间。
 * @param uploadDir - 上传目录（绝对路径）。
 */
async function removePreviousUpload(ctx: Context, namespace: string, uploadDir: string): Promise<void> {
  try {
    const settings = ctx.get('settings') as SettingsProvider | undefined
    const section = settings?.get(namespace) as { imagePath?: unknown } | undefined
    const previous = typeof section?.imagePath === 'string' ? section.imagePath : ''
    if (previous.startsWith(uploadDir + sep)) {
      await rm(previous, { force: true })
    }
  } catch {
    // 清理是尽力而为：失败不影响本次上传的成功响应。
  }
}

/** 写 JSON 响应。 */
function respondJson(res: ServerResponse, status: number, payload: object): void {
  if (res.headersSent) {
    res.destroy()
    return
  }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

/** 写一个极简状态响应（可带原因文本）；响应头已发送时直接掐断连接。 */
function respond(res: ServerResponse, status: number, message?: string): void {
  if (res.headersSent) {
    res.destroy()
    return
  }
  res.writeHead(status)
  res.end(message)
}