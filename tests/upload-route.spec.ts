/**
 * 图片上传路由端到端测试：真实 node http server + fetch + 临时目录，
 * 覆盖成功落盘、旧上传清理、方法/扩展名/大小校验。
 * @author 康小汪【kxw】
 * @date 2026-09-10
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { BACKGROUND_UPLOAD_PATH, BACKGROUND_SETTINGS_NAMESPACE } from '../src/background-settings.ts'
import { createBackgroundUploadRoute } from '../src/upload-route.ts'

/** 一张假「PNG」字节（路由只按扩展名与大小处理，不解析内容）。 */
const PNG_BYTES = Buffer.alloc(64, 7)

/** fake settings：get(range 返回 imagePath）。 */
function fakeSettings(imagePath: string | undefined): SettingsProvider {
  return { get: () => (imagePath === undefined ? undefined : { imagePath }) } as unknown as SettingsProvider
}

/** fake ctx：只回应 settings 查询。 */
function fakeCtx(settings: SettingsProvider | undefined): Context {
  return { get: (name: string) => (name === 'settings' ? settings : undefined) } as unknown as Context
}

interface Handle {
  server: Server
  uploadDir: string
  base: string
}

const servers: Server[] = []
const dirs: string[] = []

async function makeHandle(imagePath?: string, maxBytes = 20 * 1024 * 1024): Promise<Handle> {
  const uploadDir = await mkdtemp(join(tmpdir(), 'dsh-ui-background-up-'))
  const route = createBackgroundUploadRoute(fakeCtx(fakeSettings(imagePath)), {
    namespace: BACKGROUND_SETTINGS_NAMESPACE,
    maxBytes,
    uploadDir,
  })
  const server = createServer((req: IncomingMessage, res: ServerResponse) => { void route.handler(req, res) })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const port = (server.address() as AddressInfo).port
  servers.push(server)
  dirs.push(uploadDir)
  return { server, uploadDir, base: `http://127.0.0.1:${port}${BACKGROUND_UPLOAD_PATH}` }
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => { server.close(() => resolve()) })
  }
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('upload 成功路径', () => {
  it('POST 图片落盘并返回绝对路径（字节一致、扩展名正确）', async () => {
    const handle = await makeHandle()
    const response = await fetch(handle.base, {
      method: 'POST',
      headers: { 'x-upload-ext': 'png' },
      body: PNG_BYTES,
    })
    expect(response.status).toBe(200)
    const payload = (await response.json()) as { path: string }
    expect(payload.path.startsWith(handle.uploadDir + sep)).toBe(true)
    expect(payload.path.endsWith('.png')).toBe(true)
    expect(await readFile(payload.path)).toEqual(PNG_BYTES)
  })

  it('上传新图后尽力清理旧上传文件（仅限上传目录内）', async () => {
    // 就地装配：旧上传文件与设置引用须指向同一个 uploadDir。
    const uploadDir = await mkdtemp(join(tmpdir(), 'dsh-ui-background-up2-'))
    const previous = join(uploadDir, 'old.png')
    await writeFile(previous, PNG_BYTES)
    const route = createBackgroundUploadRoute(fakeCtx(fakeSettings(previous)), {
      namespace: BACKGROUND_SETTINGS_NAMESPACE,
      maxBytes: 20 * 1024 * 1024,
      uploadDir,
    })
    const server = createServer((req: IncomingMessage, res: ServerResponse) => { void route.handler(req, res) })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    const port = (server.address() as AddressInfo).port
    servers.push(server)
    dirs.push(uploadDir)
    // 目录外的文件 → 保留（防误删用户其它文件）。
    const oldForeign = join(await mkdtemp(join(tmpdir(), 'dsh-ui-background-up3-')), 'kept.png')
    await writeFile(oldForeign, PNG_BYTES)
    const response = await fetch(`http://127.0.0.1:${port}${BACKGROUND_UPLOAD_PATH}`, {
      method: 'POST',
      headers: { 'x-upload-ext': 'jpeg' },
      body: Buffer.alloc(16, 1),
    })
    expect(response.status).toBe(200)
    // 属于上传目录的旧文件被清理；目录外的保留。
    await expect(stat(previous)).rejects.toThrow()
    await expect(stat(oldForeign)).resolves.toBeTruthy()
  })
})

describe('upload 安全矩阵', () => {
  it('非 POST 返回 405', async () => {
    const handle = await makeHandle()
    const response = await fetch(handle.base, { method: 'GET' })
    expect(response.status).toBe(405)
  })

  it('非法或缺失扩展名返回 400', async () => {
    const handle = await makeHandle()
    const noExt = await fetch(handle.base, { method: 'POST', body: PNG_BYTES })
    expect(noExt.status).toBe(400)
    const badExt = await fetch(handle.base, {
      method: 'POST',
      headers: { 'x-upload-ext': 'svg' },
      body: PNG_BYTES,
    })
    expect(badExt.status).toBe(400)
  })

  it('超过大小上限返回 413 且不落盘', async () => {
    const handle = await makeHandle(undefined, 32)
    const response = await fetch(handle.base, {
      method: 'POST',
      headers: { 'x-upload-ext': 'png' },
      body: PNG_BYTES, // 64 字节 > 32 上限
    })
    expect(response.status).toBe(413)
    const entries = await (await import('node:fs/promises')).readdir(handle.uploadDir)
    expect(entries).toHaveLength(0)
  })

  it('客户端文件名不影响落盘名（随机文件名且只含扩展名）', async () => {
    const handle = await makeHandle()
    const response = await fetch(handle.base, {
      method: 'POST',
      headers: { 'x-upload-ext': 'webp' },
      body: PNG_BYTES,
    })
    expect(response.status).toBe(200)
    const payload = (await response.json()) as { path: string }
    const name = payload.path.slice(payload.path.lastIndexOf(sep) + 1)
    expect(name).toMatch(/^[0-9a-f]{16}\.webp$/)
  })
})