/**
 * 必应壁纸服务测试：全程 stub fetch + 真实临时目录，不触网。
 *
 * 覆盖：接口 URL 构造与地区白名单、缓存命中不重复下载、4K 与 1080p 回落、
 * 「换一张」避开当前图、SSRF 白名单、超时/大小上限、魔数校验、保留数清理、
 * 在途请求合并、归档快照 TTL 与过期兜底。
 *
 * @author 康小汪【kxw】
 * @date 2026-09-11
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BingWallpaperService, normalizeMarket, type BingServiceDeps } from '../src/bing-service.ts'
import {
  entryAt, imageRequests, imageUrl, JPEG_BYTES, makeUpstreamStub, type UpstreamStub,
} from './support/bing-upstream.ts'

/** 每个用例一个临时缓存目录。 */
const dirs: string[] = []
async function makeCacheDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-ui-background-bing-'))
  dirs.push(dir)
  return dir
}

/** 组装服务与上游替身（默认字节上限 1 MiB）。 */
async function makeService(
  over: Partial<BingServiceDeps> = {},
): Promise<{ service: BingWallpaperService; stub: UpstreamStub; cacheDir: string }> {
  const cacheDir = await makeCacheDir()
  const stub = makeUpstreamStub()
  const service = new BingWallpaperService({
    fetchImpl: stub.fetchImpl,
    cacheDir,
    maxBytes: 1024 * 1024,
    ...over,
  })
  return { service, stub, cacheDir }
}

/** 缓存目录内文件名（失败时视为空目录）。 */
async function cacheFiles(cacheDir: string): Promise<string[]> {
  return await readdir(cacheDir).catch(() => [] as string[])
}

/** 目标 UHD / 1080p 地址（与实现里的拼法一致，用于铺桩）。 */
const UHD_URL = imageUrl('Pic10', 'UHD')
const FHD_URL = imageUrl('Pic10', '1920x1080')

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('normalizeMarket', () => {
  it('白名单内原样返回，白名单外（含空串/大小写不符）回退默认地区', () => {
    expect(normalizeMarket('en-US')).toBe('en-US')
    expect(normalizeMarket('zh-CN')).toBe('zh-CN')
    expect(normalizeMarket('not-a-market')).toBe('zh-CN')
    expect(normalizeMarket('')).toBe('zh-CN')
    expect(normalizeMarket('zh-cn')).toBe('zh-CN')
  })
})

describe('取图主流程', () => {
  it('latest 下载 UHD 并落盘：返回绝对路径、元数据与分辨率', async () => {
    const { service, stub, cacheDir } = await makeService()
    stub.images.set(UHD_URL, new Response(JPEG_BYTES, { status: 200 }))
    const wallpaper = await service.fetchWallpaper({ mode: 'latest', market: 'zh-CN', uhd: true })
    expect(wallpaper.cached).toBe(false)
    expect(wallpaper.resolution).toBe('UHD')
    expect(wallpaper.date).toBe('2026-09-10')
    expect(wallpaper.title).toBe('标题10')
    expect(wallpaper.copyright).toBe('© 作者10')
    expect(wallpaper.path.startsWith(cacheDir)).toBe(true)
    expect(wallpaper.path.endsWith('-uhd.jpg')).toBe(true)
    expect(await readFile(wallpaper.path)).toEqual(JPEG_BYTES)
    // 归档地址带上接口约定参数与地区。
    expect(stub.urls[0]).toContain('HPImageArchive.aspx?format=js&idx=0&n=8&mkt=zh-CN')
  })

  it('同一天再次取图命中缓存：不再下载', async () => {
    const { service, stub } = await makeService()
    stub.images.set(UHD_URL, new Response(JPEG_BYTES, { status: 200 }))
    const first = await service.fetchWallpaper({ mode: 'latest', market: 'zh-CN', uhd: true })
    const second = await service.fetchWallpaper({ mode: 'latest', market: 'zh-CN', uhd: true })
    expect(second.path).toBe(first.path)
    expect(second.cached).toBe(true)
    expect(imageRequests(stub)).toHaveLength(1)
  })

  it('uhd=false 时直接取接口给出的 1920×1080', async () => {
    const { service, stub } = await makeService()
    stub.images.set(FHD_URL, new Response(JPEG_BYTES, { status: 200 }))
    const wallpaper = await service.fetchWallpaper({ mode: 'latest', market: 'zh-CN', uhd: false })
    expect(wallpaper.resolution).toBe('1920x1080')
    expect(wallpaper.path.endsWith('-fhd.jpg')).toBe(true)
    expect(imageRequests(stub)).toEqual([FHD_URL])
  })

  it('UHD 缺失（404）时自动回落 1080p', async () => {
    const { service, stub } = await makeService()
    // 只铺 1080p：UHD 地址会命中 404 分支。
    stub.images.set(FHD_URL, new Response(JPEG_BYTES, { status: 200 }))
    const wallpaper = await service.fetchWallpaper({ mode: 'latest', market: 'zh-CN', uhd: true })
    expect(wallpaper.resolution).toBe('1920x1080')
    expect(imageRequests(stub)).toEqual([UHD_URL, FHD_URL])
  })

  it('并发同一请求只下载一次（在途合并）', async () => {
    const { service, stub } = await makeService()
    stub.images.set(UHD_URL, new Response(JPEG_BYTES, { status: 200 }))
    const [left, right] = await Promise.all([
      service.fetchWallpaper({ mode: 'latest', market: 'zh-CN', uhd: true }),
      service.fetchWallpaper({ mode: 'latest', market: 'zh-CN', uhd: true }),
    ])
    expect(left.path).toBe(right.path)
    expect(imageRequests(stub)).toHaveLength(1)
  })

  it('random 模式避开当前显示的那张', async () => {
    const { service, stub } = await makeService()
    stub.images.set(UHD_URL, new Response(JPEG_BYTES, { status: 200 }))
    stub.images.set(imageUrl('Pic11', 'UHD'), new Response(JPEG_BYTES, { status: 200 }))
    const first = await service.fetchWallpaper({ mode: 'latest', market: 'zh-CN', uhd: true })
    const second = await service.fetchWallpaper({
      mode: 'random', market: 'zh-CN', uhd: true, exclude: first.path,
    })
    // 归档只有两天：换一张必然落到另一天。
    expect(second.date).not.toBe(first.date)
  })
})

describe('安全与健壮性', () => {
  it('上游给出非白名单 host 的图床地址时拒绝（防 SSRF）', async () => {
    const { service, stub } = await makeService()
    stub.images.set(UHD_URL, new Response(JPEG_BYTES, { status: 200 }))
    // 归档被篡改：urlbase 指向外部主机。
    const patched = (async (input: string | URL | Request) => {
      const url = String(input)
      if (!url.includes('HPImageArchive')) return stub.fetchImpl(input as never)
      return new Response(JSON.stringify({ images: [entryAt(10, { urlbase: 'https://evil.example/th?id=x', url: 'https://evil.example/a.jpg' })] }), { status: 200 })
    }) as unknown as typeof fetch
    const hardened = new BingWallpaperService({
      fetchImpl: patched, cacheDir: await makeCacheDir(), maxBytes: 1024 * 1024,
    })
    await expect(hardened.fetchWallpaper({ mode: 'latest', market: 'zh-CN', uhd: true }))
      .rejects.toThrow('not allowed')
  })

  it('图片超过字节上限时抛错且不留半文件', async () => {
    // 用 uhd=false 直取 1080p：否则超限会先触发"4K 回落 1080p"分支，测不到上限本身。
    const { service, stub, cacheDir } = await makeService({ maxBytes: 8 })
    stub.images.set(FHD_URL, new Response(JPEG_BYTES, { status: 200 }))
    await expect(service.fetchWallpaper({ mode: 'latest', market: 'zh-CN', uhd: false }))
      .rejects.toThrow('exceeds size limit')
    expect(await cacheFiles(cacheDir)).toHaveLength(0)
  })

  it('字节不是受支持图片（魔数不符）时抛错且不留半文件', async () => {
    const { service, stub, cacheDir } = await makeService()
    stub.images.set(FHD_URL, new Response('<html>error</html>', { status: 200 }))
    await expect(service.fetchWallpaper({ mode: 'latest', market: 'zh-CN', uhd: false }))
      .rejects.toThrow('not a supported picture')
    expect(await cacheFiles(cacheDir)).toHaveLength(0)
  })

  it('归档结构异常或没有可用条目时报错', async () => {
    const cacheDir = await makeCacheDir()
    const empty = new BingWallpaperService({
      fetchImpl: (async () => new Response(JSON.stringify({ images: [{}, { startdate: 'bad' }] }), { status: 200 })) as unknown as typeof fetch,
      cacheDir,
      maxBytes: 1024,
    })
    await expect(empty.fetchWallpaper({ mode: 'latest', market: 'zh-CN', uhd: true }))
      .rejects.toThrow('no usable entry')
    const broken = new BingWallpaperService({
      fetchImpl: (async () => new Response('not json', { status: 200 })) as unknown as typeof fetch,
      cacheDir,
      maxBytes: 1024,
    })
    await expect(broken.fetchWallpaper({ mode: 'latest', market: 'zh-CN', uhd: true }))
      .rejects.toThrow('malformed')
  })

  it('归档接口失败且无历史快照时抛错（网络异常不吞）', async () => {
    const cacheDir = await makeCacheDir()
    const service = new BingWallpaperService({
      fetchImpl: (async () => { throw new Error('network down') }) as unknown as typeof fetch,
      cacheDir,
      maxBytes: 1024,
    })
    await expect(service.fetchWallpaper({ mode: 'latest', market: 'zh-CN', uhd: true }))
      .rejects.toThrow('network down')
  })

  it('归档快照过期后接口失败：沿用旧快照（界面仍可显示旧图）', async () => {
    const stub = makeUpstreamStub()
    let fail = false
    const service = new BingWallpaperService({
      fetchImpl: (async (input: string | URL | Request) => {
        if (fail && String(input).includes('HPImageArchive')) throw new Error('network down')
        return stub.fetchImpl(input as never)
      }) as unknown as typeof fetch,
      cacheDir: await makeCacheDir(),
      maxBytes: 1024 * 1024,
      // TTL 设 0：每次都判定快照已过期，逼出「过期 + 上游失败」的组合。
      archiveTtlMs: 0,
    })
    const uhd11 = imageUrl('Pic11', 'UHD')
    stub.images.set(UHD_URL, new Response(JPEG_BYTES, { status: 200 }))
    stub.images.set(uhd11, new Response(JPEG_BYTES, { status: 200 }))
    const first = await service.fetchWallpaper({ mode: 'latest', market: 'zh-CN', uhd: true })
    fail = true
    // 归档接口已挂，但快照还在：random 仍能从旧快照里挑出另一天。
    const second = await service.fetchWallpaper({
      mode: 'random', market: 'zh-CN', uhd: true, exclude: first.path,
    })
    expect(first.date).toBe('2026-09-10')
    expect(second.date).toBe('2026-09-11')
  })

  it('归档快照 TTL 内复用：换一张不会重复打接口', async () => {
    const { service, stub } = await makeService()
    stub.images.set(UHD_URL, new Response(JPEG_BYTES, { status: 200 }))
    stub.images.set(imageUrl('Pic11', 'UHD'), new Response(JPEG_BYTES, { status: 200 }))
    const first = await service.fetchWallpaper({ mode: 'latest', market: 'zh-CN', uhd: true })
    await service.fetchWallpaper({ mode: 'random', market: 'zh-CN', uhd: true, exclude: first.path })
    const archiveCalls = stub.urls.filter(url => url.includes('HPImageArchive'))
    expect(archiveCalls).toHaveLength(1)
  })

  it('超出保留数的旧图被清理（保留最新的 N 张）', async () => {
    const { service, stub, cacheDir } = await makeService({ keep: 1 })
    // 两个地区给不同日期段：先取 zh-CN（09-10），再取 en-US（09-20）。
    stub.images.set(UHD_URL, new Response(JPEG_BYTES, { status: 200 }))
    const fhdEn = imageUrl('Pic20', '1920x1080')
    const uhdEn = imageUrl('Pic20', 'UHD')
    stub.images.set(fhdEn, new Response(JPEG_BYTES, { status: 200 }))
    stub.images.set(uhdEn, new Response(JPEG_BYTES, { status: 200 }))
    await service.fetchWallpaper({ mode: 'latest', market: 'zh-CN', uhd: true })
    await service.fetchWallpaper({ mode: 'latest', market: 'en-US', uhd: true })
    const files = await cacheFiles(cacheDir)
    expect(files).toHaveLength(1)
    expect(files[0]).toContain('20260920')
  })
})
