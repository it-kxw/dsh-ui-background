/**
 * HTTP 请求体读取（Node 半边共用）。
 *
 * 抽出的原因：上传路由与必应路由都需要「带大小上限地读 body」——Content-Length
 * 预检 + 流式累计 + 超限即止。这份逻辑一旦各写一份，很容易出现"一边补了上限、
 * 另一边漏了"的漏洞，故收敛为一处实现。
 *
 * @author 康小汪【kxw】
 * @date 2026-09-11
 */
import type { IncomingMessage } from 'node:http'

/**
 * 用 Content-Length 预检大小（只作快速拒绝；真正的上限由 readBodyWithin 累计把关）。
 * @param req - 请求。
 * @param maxBytes - 字节上限。
 * @returns 是否已明确超限。
 */
export function hasOversizedBody(req: IncomingMessage, maxBytes: number): boolean {
  const length = Number.parseInt(String(req.headers['content-length'] ?? ''), 10)
  return Number.isFinite(length) && length > maxBytes
}

/**
 * 流式读取请求体并累计字节数（不信任 Content-Length：分片传输时它可能缺失或撒谎）。
 * @param req - 请求。
 * @param maxBytes - 字节上限。
 * @returns 请求体字节；超限返回 undefined（调用方回 413）。
 */
export async function readBodyWithin(req: IncomingMessage, maxBytes: number): Promise<Buffer | undefined> {
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
