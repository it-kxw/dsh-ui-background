/**
 * 图片资源路由端到端测试：真实 node http server + fetch + 临时文件，
 * 覆盖方法限制、参数校验、配置比对、扩展名白名单、大小上限与成功流。
 * @author 康小汪【kxw】
 * @date 2026-09-10
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { BACKGROUND_ASSET_PATH } from '../src/background-settings.ts'
import { createBackgroundAssetRoute } from '../src/asset-route.ts'

/** 一张 20 字节的假「PNG」（路由只按扩展名与大小服务，不解析内容）。 */
const PNG_BYTES = Buffer.alloc(20, 7)

/** 测试装配：临时目录 + 配置图像 + 绑定随机端口的服务器 + 路由。 */
interface Harness {
  server: Server
  port: number
  configuredPath: string
  dir: string
  base: string
}

/** 构造宿主 context 的 settings 桩（get 返回固定 section）。 */
function fakeSettings(section: { imagePath: string } | undefined): SettingsProvider {
  return { get: () => section } as unknown as SettingsProvider
}

/** fake ctx：只回应 settings 查询，其它服务一律缺省。 */
function fakeCtx(settings: SettingsProvider | undefined): Context {
  return { get: (name: string) => (name === 'settings' ? settings : undefined) } as unknown as Context
}

/** 建服务器并把路由挂上去，返回句柄。 */
async function startServer(
  route: WebRoute,
): Promise<{ server: Server; port: number; base: string }> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void route.handler(req, res)
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const port = (server.address() as AddressInfo).port
  return { server, port, base: `http://127.0.0.1:${port}${BACKGROUND_ASSET_PATH}` }
}

/** 建一份完整 harness：临时目录 + 图片 + 服务器。 */
async function makeHarness(over: { maxBytes?: number; imagePath?: string; settings?: boolean } = {}): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-ui-background-'))
  const configuredPath = join(dir, 'photo.png')
  await writeFile(configuredPath, PNG_BYTES)
  const settings = over.settings === false ? undefined : fakeSettings({ imagePath: over.imagePath ?? configuredPath })
  const route = createBackgroundAssetRoute(fakeCtx(settings), {
    namespace: 'ui-background',
    maxBytes: over.maxBytes ?? 20 * 1024 * 1024,
  })
  const { server, port, base } = await startServer(route)
  return { server, port, configuredPath, dir, base }
}

/** 一个 harness 对应一次描述级 setup，测试间各自清理。 */
const servers: Server[] = []
const dirs: string[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => { server.close(() => resolve()) })
  }
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('asset 路由成功路径', () => {
  it('GET 返回 200、正确 MIME、content-length 与一致字节', async () => {
    const harness = await makeHarness()
    servers.push(harness.server)
    dirs.push(harness.dir)
    const response = await fetch(`${harness.base}?path=${encodeURIComponent(harness.configuredPath)}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('content-length')).toBe(String(PNG_BYTES.length))
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG_BYTES)
  })

  it('HEAD 返回 200 且无响应体', async () => {
    const harness = await makeHarness()
    servers.push(harness.server)
    dirs.push(harness.dir)
    const response = await fetch(`${harness.base}?path=${encodeURIComponent(harness.configuredPath)}`, { method: 'HEAD' })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe(String(PNG_BYTES.length))
    expect(await response.text()).toBe('')
  })
})

describe('asset 路由安全矩阵', () => {
  it('非 GET/HEAD 方法返回 405', async () => {
    const harness = await makeHarness()
    servers.push(harness.server)
    dirs.push(harness.dir)
    const response = await fetch(`${harness.base}?path=${encodeURIComponent(harness.configuredPath)}`, { method: 'POST' })
    expect(response.status).toBe(405)
  })

  it('path 参数缺失或重复返回 400', async () => {
    const harness = await makeHarness()
    servers.push(harness.server)
    dirs.push(harness.dir)
    const missing = await fetch(harness.base)
    expect(missing.status).toBe(400)
    const two = await fetch(`${harness.base}?path=a&path=b`)
    expect(two.status).toBe(400)
  })

  it('请求路径与配置不一致返回 404（防任意文件读取）', async () => {
    const harness = await makeHarness()
    servers.push(harness.server)
    dirs.push(harness.dir)
    const other = join(harness.dir, 'other.png')
    await writeFile(other, PNG_BYTES)
    const response = await fetch(`${harness.base}?path=${encodeURIComponent(other)}`)
    expect(response.status).toBe(404)
    // `..` 逃逸变体同样被规范化比较挡住。
    const escaping = `${harness.dir}${sep}..${sep}photo.png`
    const escapeResponse = await fetch(`${harness.base}?path=${encodeURIComponent(escaping)}`)
    expect(escapeResponse.status).toBe(404)
  })

  it('配置为空或 settings 缺失返回 404', async () => {
    const none = await makeHarness({ imagePath: '' })
    servers.push(none.server)
    dirs.push(none.dir)
    const empty = await fetch(`${none.base}?path=${encodeURIComponent(none.configuredPath)}`)
    expect(empty.status).toBe(404)
    const noSettings = await makeHarness({ settings: false })
    servers.push(noSettings.server)
    dirs.push(noSettings.dir)
    const missing = await fetch(`${noSettings.base}?path=${encodeURIComponent(noSettings.configuredPath)}`)
    expect(missing.status).toBe(404)
  })

  it('超过大小上限返回 413', async () => {
    const harness = await makeHarness({ maxBytes: 10 })
    servers.push(harness.server)
    dirs.push(harness.dir)
    const response = await fetch(`${harness.base}?path=${encodeURIComponent(harness.configuredPath)}`)
    expect(response.status).toBe(413)
  })

  it('扩展名不在白名单返回 404', async () => {
    const harness = await makeHarness()
    servers.push(harness.server)
    dirs.push(harness.dir)
    const text = join(harness.dir, 'notes.txt')
    await writeFile(text, 'hello')
    const routeText = createBackgroundAssetRoute(fakeCtx(fakeSettings({ imagePath: text })), {
      namespace: 'ui-background',
      maxBytes: 20 * 1024 * 1024,
    })
    const { server, base } = await startServer(routeText)
    servers.push(server)
    const response = await fetch(`${base}?path=${encodeURIComponent(text)}`)
    expect(response.status).toBe(404)
  })

  it('文件不存在返回 404', async () => {
    const missingPath = join(tmpdir(), 'dsh-ui-background-missing', 'missing.png')
    const harness = await makeHarness({ imagePath: missingPath })
    servers.push(harness.server)
    dirs.push(harness.dir)
    const response = await fetch(`${harness.base}?path=${encodeURIComponent(missingPath)}`)
    expect(response.status).toBe(404)
  })
})