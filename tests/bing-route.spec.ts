/**
 * 必应壁纸路由端到端测试：真实 node http server + fetch + 临时缓存目录，
 * 上游必应用替身应答（不触网）。覆盖取图成功、默认值回落、方法与参数校验、
 * 体积上限与上游失败的 502 收敛。
 *
 * @author 康小汪【kxw】
 * @date 2026-09-11
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import { BACKGROUND_BING_PATH, BACKGROUND_SETTINGS_NAMESPACE } from '../src/background-settings.ts'
import { BingWallpaperService } from '../src/bing-service.ts'
import { createBackgroundBingRoute } from '../src/bing-route.ts'
import { imageUrl, JPEG_BYTES, makeUpstreamStub, type UpstreamStub } from './support/bing-upstream.ts'

/** 路由响应体形状（测试断言用）。 */
interface BingPayload {
  path: string
  date: string
  title: string
  cached: boolean
  resolution: string
}

/** fake settings：get() 返回固定 section。 */
function fakeSettings(section: Record<string, unknown> | undefined): SettingsProvider {
  return { get: () => section } as unknown as SettingsProvider
}

/** fake ctx：只回应 settings 查询。 */
function fakeCtx(settings: SettingsProvider | undefined): Context {
  return { get: (name: string) => (name === 'settings' ? settings : undefined) } as unknown as Context
}

interface Handle {
  /** 路由完整地址。 */
  base: string
  /** 缓存目录（断言落盘用）。 */
  cacheDir: string
  /** 上游替身（铺桩与计数用）。 */
  stub: UpstreamStub
}

const servers: Server[] = []
const dirs: string[] = []

/**
 * 起一个只挂了必应路由的 http 服务。
 * @param section - 设置 section（决定默认地区/分辨率与"当前图片"）。
 * @param maxBytes - 图片字节上限。
 * @param stub - 上游替身（默认新建）。
 * @returns 服务地址、缓存目录与替身。
 */
async function makeHandle(
  section: Record<string, unknown> | undefined = undefined,
  maxBytes = 1024 * 1024,
  stub: UpstreamStub = makeUpstreamStub(),
): Promise<Handle> {
  const cacheDir = await mkdtemp(join(tmpdir(), 'dsh-ui-background-bingroute-'))
  const service = new BingWallpaperService({ fetchImpl: stub.fetchImpl, cacheDir, maxBytes })
  const route = createBackgroundBingRoute(fakeCtx(fakeSettings(section)), {
    namespace: BACKGROUND_SETTINGS_NAMESPACE,
    service,
  })
  const server = createServer((req: IncomingMessage, res: ServerResponse) => { void route.handler(req, res) })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const port = (server.address() as AddressInfo).port
  servers.push(server)
  dirs.push(cacheDir)
  return { base: `http://127.0.0.1:${port}${BACKGROUND_BING_PATH}`, cacheDir, stub }
}

/** 发一次取图请求。 */
function postBing(base: string, body: string): Promise<Response> {
  return fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  })
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => { server.close(() => resolve()) })
  }
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('bing 路由成功路径', () => {
  it('POST mode=latest 返回缓存路径与元数据，并把图片真正落盘', async () => {
    const handle = await makeHandle()
    handle.stub.images.set(imageUrl('Pic10', 'UHD'), new Response(JPEG_BYTES, { status: 200 }))
    const response = await postBing(handle.base, JSON.stringify({ mode: 'latest' }))
    expect(response.status).toBe(200)
    const payload = (await response.json()) as BingPayload
    expect(payload.path.startsWith(handle.cacheDir + sep)).toBe(true)
    expect(payload.date).toBe('2026-09-10')
    expect(payload.title).toBe('标题10')
    expect(payload.cached).toBe(false)
    expect(payload.resolution).toBe('UHD')
    expect(await readFile(payload.path)).toEqual(JPEG_BYTES)
  })

  it('缺省参数用设置里的默认：地区 en-US + 非 4K', async () => {
    const handle = await makeHandle({ bingMarket: 'en-US', bingUhd: false })
    handle.stub.images.set(imageUrl('Pic20', '1920x1080'), new Response(JPEG_BYTES, { status: 200 }))
    // 只给 mode，地区与分辨率走设置默认值。
    const response = await postBing(handle.base, JSON.stringify({ mode: 'latest' }))
    expect(response.status).toBe(200)
    const payload = (await response.json()) as BingPayload
    expect(payload.date).toBe('2026-09-20')
    expect(payload.resolution).toBe('1920x1080')
    expect(handle.stub.urls[0]).toContain('mkt=en-US')
  })

  it('random 模式避开设置里记录的当前图片', async () => {
    const handle = await makeHandle({ imagePath: '/cache/bing-20260910-01234567-uhd.jpg' })
    handle.stub.images.set(imageUrl('Pic11', 'UHD'), new Response(JPEG_BYTES, { status: 200 }))
    const response = await postBing(handle.base, JSON.stringify({ mode: 'random' }))
    expect(response.status).toBe(200)
    expect(((await response.json()) as BingPayload).date).toBe('2026-09-11')
  })
})

describe('bing 路由安全矩阵', () => {
  it('非 POST 返回 405', async () => {
    const handle = await makeHandle()
    expect((await fetch(handle.base, { method: 'GET' })).status).toBe(405)
  })

  it('非法 JSON、未知 mode、非字符串地区、非布尔 uhd 一律 400', async () => {
    const handle = await makeHandle()
    const cases = [
      'not json',
      JSON.stringify({ mode: 'whatever' }),
      JSON.stringify({ mode: 'latest', market: 7 }),
      JSON.stringify({ mode: 'latest', uhd: 'yes' }),
    ]
    for (const body of cases) {
      expect((await postBing(handle.base, body)).status).toBe(400)
    }
    // 全部请求都未触达上游。
    expect(handle.stub.urls).toHaveLength(0)
  })

  it('请求体超过 4 KiB 返回 413', async () => {
    const handle = await makeHandle()
    const huge = JSON.stringify({ mode: 'latest', padding: 'x'.repeat(8 * 1024) })
    expect((await postBing(handle.base, huge)).status).toBe(413)
  })

  it('上游网络异常返回 502 且原因不泄露内部细节', async () => {
    const failing = (async () => { throw new Error('connect ECONNREFUSED 10.0.0.1:443') }) as unknown as typeof fetch
    const handle = await makeHandle(undefined, 1024 * 1024, {
      fetchImpl: failing, urls: [], images: new Map(),
    })
    const response = await postBing(handle.base, JSON.stringify({ mode: 'latest' }))
    expect(response.status).toBe(502)
    const payload = (await response.json()) as { error: string; reason: string }
    expect(payload.error).toBe('bing unavailable')
    // 只回归一化原因：不含上游地址/本地路径。
    expect(payload.reason).toBe('unexpected error')
    expect(JSON.stringify(payload)).not.toContain('ECONNREFUSED')
  })

  it('上游图片过大返回 502（上限透传到服务层）', async () => {
    // uhd=false：否则超限会先走"4K 回落 1080p"，掩盖上限本身的失败原因。
    const handle = await makeHandle(undefined, 8)
    handle.stub.images.set(imageUrl('Pic10', '1920x1080'), new Response(JPEG_BYTES, { status: 200 }))
    const response = await postBing(handle.base, JSON.stringify({ mode: 'latest', uhd: false }))
    expect(response.status).toBe(502)
    expect(((await response.json()) as { reason: string }).reason).toBe('bing image exceeds size limit')
  })
})
