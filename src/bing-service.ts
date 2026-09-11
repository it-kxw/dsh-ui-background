/**
 * 必应每日壁纸服务（Node 半边）。
 *
 * 职责：调必应首页壁纸归档接口 → 选出目标壁纸 → 确保这张图存在于本地缓存目录
 * （命中即复用、未命中才下载）→ 返回本地绝对路径与展示元数据。
 *
 * 为什么由服务端下载而不是让浏览器直连必应图床：
 * 1. 不受必应热链策略、浏览器 Referer/跨域规则影响；
 * 2. 缓存到本地后断网也能用，且同一天不会重复下载；
 * 3. 浏览器侧仍走既有 asset 路由（按已落盘设置授权），与上传图片同一条通路。
 *
 * 安全边界（外部输入全部校验）：
 * 1. 只请求白名单 host 与 `/th` 路径 —— 上游 JSON 被篡改也无法变成 SSRF 跳板；
 * 2. 地区走白名单（非法值回退默认），idx 由服务端决定，不接受外部传入；
 * 3. 流式累计大小上限（不信任 Content-Length），超限立即中断连接；
 * 4. 10s 超时；先写 `.part` 再 rename，失败不留半文件让后续请求误命中；
 * 5. 只按魔数识别类型并据此决定扩展名（不信任 URL 后缀与 Content-Type）。
 *
 * @author 康小汪【kxw】
 * @date 2026-09-11
 */
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  BACKGROUND_BING_HISTORY, BACKGROUND_BING_KEEP, BING_MARKETS,
  DEFAULT_BING_MARKET, type BingMarket,
} from './background-settings.ts'

/** 上游域名：国内可达域与主站数据一致，取前者。 */
const BING_ORIGIN = 'https://cn.bing.com'

/** 允许下载的 host 白名单。 */
const BING_ALLOWED_HOSTS: readonly string[] = Object.freeze(['cn.bing.com', 'www.bing.com'])

/** 图床路径前缀：必应图片固定走 /th?id=…，白名单化后不接受其它路径。 */
const BING_IMAGE_PATH_PREFIX = '/th'

/** 单次上游请求超时（毫秒）：超过即放弃，避免设置行长时间挂起。 */
const BING_TIMEOUT_MS = 10_000

/** 归档快照缓存时长（毫秒）：一次取回 8 天，"换一张"与刷新都不必重复打接口。 */
const BING_ARCHIVE_TTL_MS = 10 * 60 * 1000

/** 壁纸分辨率标记（写入缓存文件名：切换 4K 时两种规格各留一份，互不覆盖）。 */
export type BingResolution = 'UHD' | '1920x1080'

/** 接口返回的单条壁纸记录（只保留用得到的字段）。 */
interface BingArchiveEntry {
  /** 壁纸日期（startdate，8 位数字，如 20260910）。 */
  startdate: string
  /** 无尺寸后缀的图床地址（urlbase，形如 /th?id=OHR.XXX_ZH-CN123）。 */
  urlbase: string
  /** 接口给出的 1920×1080 完整地址。 */
  fallbackPath: string
  /** 标题（随地区语言）。 */
  title: string
  /** 版权信息（随地区语言）。 */
  copyright: string
  /** 内容哈希（hsh），与日期共同构成缓存文件名，保证同一天只下载一次。 */
  hsh: string
}

/** 一次取图请求。 */
export interface BingWallpaperRequest {
  /** latest 取最新一张；random 在最近 8 天里随机取（「换一张」）。 */
  mode: 'latest' | 'random'
  /** 地区（白名单外的值回退默认地区）。 */
  market: string
  /** 是否优先取 4K 原图（该归档没有 4K 时自动回落 1080p）。 */
  uhd: boolean
  /** 当前已显示的图片路径：random 模式据此避开它（「换一张」必须真的换）。 */
  exclude?: string
}

/** 取图结果（路由直接作为响应体返回）。 */
export interface BingWallpaper {
  /** 本地缓存文件的绝对路径（交 runtime 持久化到 imagePath）。 */
  path: string
  /** 展示用日期（YYYY-MM-DD）。 */
  date: string
  /** 展示用标题。 */
  title: string
  /** 展示用版权信息。 */
  copyright: string
  /** 是否为命中缓存（true 表示本次没有下载）。 */
  cached: boolean
  /** 实际拿到的分辨率。 */
  resolution: BingResolution
}

/** 服务依赖（全部注入：fetch 可替换，测试无需联网）。 */
export interface BingServiceDeps {
  /** fetch 实现（生产传全局 fetch，测试传桩）。 */
  fetchImpl: typeof fetch
  /** 缓存目录绝对路径（`$DSH_HOME/ui-background/bing`）。 */
  cacheDir: string
  /** 单张图片字节上限（与 asset 路由共用，超限的图存了也读不出来）。 */
  maxBytes: number
  /** 上游超时（毫秒），默认 10s。 */
  timeoutMs?: number
  /** 归档快照缓存时长（毫秒），默认 10 分钟；测试可设 0 强制每次重取。 */
  archiveTtlMs?: number
  /** 缓存保留张数，默认 BACKGROUND_BING_KEEP。 */
  keep?: number
}

/**
 * 归一化地区：白名单外的值（手改 yaml 写错、接口演进）一律回退默认地区，
 * 而不是把任意字符串拼进上游 URL。
 * @param value - 请求或设置里的地区值。
 * @returns 白名单内的地区。
 */
export function normalizeMarket(value: string): BingMarket {
  return (BING_MARKETS as readonly string[]).includes(value) ? value as BingMarket : DEFAULT_BING_MARKET
}

/** 归档接口地址：一次取回最近 BACKGROUND_BING_HISTORY 天。 */
function archiveUrl(market: BingMarket): string {
  return `${BING_ORIGIN}/HPImageArchive.aspx?format=js&idx=0&n=${BACKGROUND_BING_HISTORY}&mkt=${market}`
}

/**
 * 拼出并校验图片绝对地址：host 与路径双白名单。
 * @param path - 接口给出的相对路径（urlbase 或 url）。
 * @returns 校验通过的绝对地址。
 * @throws host 不在白名单、或路径不在 /th 前缀下。
 */
function absoluteImageUrl(path: string): string {
  const url = new URL(path, BING_ORIGIN)
  if (url.protocol !== 'https:' || !BING_ALLOWED_HOSTS.includes(url.host)
    || !url.pathname.startsWith(BING_IMAGE_PATH_PREFIX)) {
    throw new Error('bing image url is not allowed')
  }
  return url.toString()
}

/** 去掉接口 url 字段尾巴上的跟踪参数（`&rf=…&pid=hp`），只留到 .jpg 为止。 */
function stripTracking(path: string): string {
  const cut = path.indexOf('.jpg')
  return cut === -1 ? path : path.slice(0, cut + 4)
}

/** 目标图片地址与分辨率标记；UHD 走 urlbase + `_UHD.jpg`（社区通行做法，非官方文档）。 */
function imageCandidate(entry: BingArchiveEntry, uhd: boolean): { url: string; resolution: BingResolution } {
  if (!uhd) return { url: absoluteImageUrl(stripTracking(entry.fallbackPath)), resolution: '1920x1080' }
  return { url: absoluteImageUrl(`${entry.urlbase}_UHD.jpg`), resolution: 'UHD' }
}

/** 缓存文件名主干（不含分辨率标记与扩展名）。 */
function fileStem(entry: BingArchiveEntry): string {
  const hsh = /^[0-9a-f]{8,32}$/i.test(entry.hsh) ? entry.hsh.slice(0, 8).toLowerCase() : 'nohash'
  return `bing-${entry.startdate}-${hsh}`
}

/** 分辨率标记 → 文件名片段。 */
function qualityTag(uhd: boolean): string {
  return uhd ? 'uhd' : 'fhd'
}

/** 展示用日期：20260910 → 2026-09-10。 */
function displayDate(startdate: string): string {
  return `${startdate.slice(0, 4)}-${startdate.slice(4, 6)}-${startdate.slice(6, 8)}`
}

/**
 * 按魔数识别图片类型（asset 路由白名单只认这几种扩展名）。
 * 不信任 Content-Type 与 URL 后缀：上游返回 HTML 错误页时会被这里挡下。
 * @param bytes - 图片字节。
 * @returns 扩展名，或 undefined（不是受支持的图片）。
 */
function sniffExtension(bytes: Uint8Array): string | undefined {
  const startsWith = (offset: number, text: string): boolean =>
    [...text].every((char, index) => bytes[offset + index] === char.charCodeAt(0))
  if (bytes.length < 12) return undefined
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  if (bytes[0] === 0x89 && startsWith(1, 'PNG')) return 'png'
  if (startsWith(0, 'GIF')) return 'gif'
  if (startsWith(0, 'RIFF') && startsWith(8, 'WEBP')) return 'webp'
  // ISO-BMFF：ftyp box 的 brand 决定具体格式，只接受 AVIF。
  if (startsWith(4, 'ftyp') && (startsWith(8, 'avif') || startsWith(8, 'avis'))) return 'avif'
  return undefined
}

/**
 * 把接口 JSON 收敛为归档条目数组：缺字段/格式异常的行直接丢弃，
 * 全部丢弃则视为接口异常（宁可失败也不落一张来路不明的图）。
 * @param payload - 接口 JSON。
 * @returns 归档条目（最新在前）。
 * @throws 结构不符合预期或没有任何可用条目。
 */
function parseArchive(payload: unknown): BingArchiveEntry[] {
  const images = (payload as { images?: unknown } | null)?.images
  if (!Array.isArray(images)) throw new Error('bing archive response is malformed')
  const entries = images.map(toArchiveEntry).filter((entry): entry is BingArchiveEntry => entry !== undefined)
  if (entries.length === 0) throw new Error('bing archive has no usable entry')
  return entries
}

/** 单行 JSON → 归档条目；关键字段缺失或日期非法时返回 undefined。 */
function toArchiveEntry(raw: unknown): BingArchiveEntry | undefined {
  const row = raw as Partial<Record<'startdate' | 'urlbase' | 'url' | 'title' | 'copyright' | 'hsh', unknown>> | null
  const { startdate, urlbase, url } = row ?? {}
  if (typeof startdate !== 'string' || !/^\d{8}$/.test(startdate)) return undefined
  if (typeof urlbase !== 'string' || urlbase === '' || typeof url !== 'string' || url === '') return undefined
  return {
    startdate,
    urlbase,
    fallbackPath: url,
    title: typeof row?.title === 'string' ? row.title : '',
    copyright: typeof row?.copyright === 'string' ? row.copyright : '',
    hsh: typeof row?.hsh === 'string' ? row.hsh : '',
  }
}

/** 候选是否就是当前显示的那张：比对缓存文件名主干，避免规范化/解码路径。 */
function isCurrent(entry: BingArchiveEntry, excludePath: string | undefined): boolean {
  if (excludePath === undefined || excludePath === '') return false
  return basename(excludePath).startsWith(`${fileStem(entry)}-`)
}

/** 随机起点轮转：一次随机即得到一个随机排列，保证优先试到的不是固定那张。 */
function rotated(entries: BingArchiveEntry[]): BingArchiveEntry[] {
  if (entries.length <= 1) return [...entries]
  const start = Math.floor(Math.random() * entries.length)
  return [...entries.slice(start), ...entries.slice(0, start)]
}

/** 候选顺序：latest 只要最新一张；random 打乱后优先避开当前那张。 */
function candidateOrder(entries: BingArchiveEntry[], request: BingWallpaperRequest): BingArchiveEntry[] {
  const latest = entries[0]
  if (latest === undefined) return []
  if (request.mode === 'latest') return [latest]
  const pool = entries.filter(entry => !isCurrent(entry, request.exclude))
  return rotated(pool.length > 0 ? pool : entries)
}

/**
 * 读取归档 JSON：体不是合法 JSON 时归一为"归档响应异常"，
 * 而不是把原生解析错误（含响应片段）抛给上层。
 * @param response - 归档响应。
 * @returns 解析后的 JSON。
 * @throws 响应体不是合法 JSON。
 */
async function archiveJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new Error('bing archive response is malformed')
  }
}

/**
 * 流式读取响应体并在超过上限时中断（不信任 Content-Length）。
 * @param response - 上游响应。
 * @param maxBytes - 字节上限。
 * @returns 响应体字节。
 * @throws 超过上限（已中断连接）。
 */
async function readCapped(response: Response, maxBytes: number): Promise<Buffer> {
  const body = response.body
  if (body === null) return Buffer.alloc(0)
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value === undefined) continue
    total += value.byteLength
    if (total > maxBytes) {
      // 不能 await 取消：被 clone/tee 过的流要等另一分支也取消才 settle，等待会把
      // 请求永久挂住（上游异常时的真实风险）。这里放掉取消动作并立即失败。
      reader.cancel().catch(() => { /* 取消失败无所谓：本次结果已判为失败 */ })
      throw new Error('bing image exceeds size limit')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks, total)
}

/** 必应壁纸服务：进程内单例即可（归档快照与在途请求合并都在实例内维护）。 */
export class BingWallpaperService {
  private readonly fetchImpl: typeof fetch
  private readonly cacheDir: string
  private readonly maxBytes: number
  private readonly timeoutMs: number
  private readonly archiveTtlMs: number
  private readonly keep: number
  /** 归档快照缓存：key 为地区。 */
  private readonly archives = new Map<string, { at: number; entries: BingArchiveEntry[] }>()
  /** 在途请求合并：同一请求连点时复用同一个 Promise，不重复下载。 */
  private readonly inFlight = new Map<string, Promise<BingWallpaper>>()

  /**
   * @param deps - fetch 实现、缓存目录、字节上限与可选超时/保留数。
   */
  constructor(deps: BingServiceDeps) {
    this.fetchImpl = deps.fetchImpl
    this.cacheDir = deps.cacheDir
    this.maxBytes = deps.maxBytes
    this.timeoutMs = deps.timeoutMs ?? BING_TIMEOUT_MS
    this.archiveTtlMs = deps.archiveTtlMs ?? BING_ARCHIVE_TTL_MS
    this.keep = Math.max(1, deps.keep ?? BACKGROUND_BING_KEEP)
  }

  /**
   * 取一张必应壁纸（命中缓存则不下载）。
   * @param request - 模式、地区、分辨率与需避开的当前图片。
   * @returns 本地缓存路径与展示元数据。
   * @throws 归档接口不可用、找不到可用图片、或下载/落盘失败。
   */
  async fetchWallpaper(request: BingWallpaperRequest): Promise<BingWallpaper> {
    const key = [request.mode, normalizeMarket(request.market), request.uhd, request.exclude ?? ''].join('|')
    const pending = this.inFlight.get(key)
    if (pending !== undefined) return pending
    const task = this.resolve(request).finally(() => { this.inFlight.delete(key) })
    this.inFlight.set(key, task)
    return task
  }

  /** 依次尝试候选壁纸；单张失败（缺 4K、图床 404）换下一张，全部失败才抛错。 */
  private async resolve(request: BingWallpaperRequest): Promise<BingWallpaper> {
    const entries = await this.archive(normalizeMarket(request.market))
    let lastError: unknown
    for (const entry of candidateOrder(entries, request)) {
      try {
        const materialized = await this.materialize(entry, request.uhd)
        return {
          path: materialized.path,
          date: displayDate(entry.startdate),
          title: entry.title,
          copyright: entry.copyright,
          cached: materialized.cached,
          resolution: materialized.resolution,
        }
      } catch (error) {
        lastError = error
      }
    }
    throw lastError instanceof Error ? lastError : new Error('bing wallpaper unavailable')
  }

  /** 确保目标图在本地存在：命中缓存直接返回，否则下载落盘。 */
  private async materialize(
    entry: BingArchiveEntry,
    uhd: boolean,
  ): Promise<{ path: string; cached: boolean; resolution: BingResolution }> {
    const cached = await this.findCached(entry, uhd)
    if (cached !== undefined) return { path: cached, cached: true, resolution: uhd ? 'UHD' : '1920x1080' }
    const candidate = imageCandidate(entry, uhd)
    try {
      return { path: await this.store(entry, uhd, await this.download(candidate.url)), cached: false, resolution: candidate.resolution }
    } catch (error) {
      if (!uhd) throw error
      // 部分归档没有 4K 版本（或 4K 图床 404）→ 回落到接口给出的 1920×1080。
      const fallback = imageCandidate(entry, false)
      return { path: await this.store(entry, false, await this.download(fallback.url)), cached: false, resolution: fallback.resolution }
    }
  }

  /** 取归档快照：TTL 内复用；接口临时失败时沿用过期快照（界面至少还能显示旧图）。 */
  private async archive(market: BingMarket): Promise<BingArchiveEntry[]> {
    const cached = this.archives.get(market)
    const now = Date.now()
    if (cached !== undefined && now - cached.at < this.archiveTtlMs) return cached.entries
    try {
      const response = await this.fetchImpl(archiveUrl(market), { signal: AbortSignal.timeout(this.timeoutMs) })
      if (!response.ok) throw new Error(`bing archive responded ${response.status}`)
      const entries = parseArchive(await archiveJson(response))
      this.archives.set(market, { at: now, entries })
      return entries
    } catch (error) {
      if (cached !== undefined) return cached.entries
      throw error
    }
  }

  /** 在缓存目录里找这张图（同一张的不同分辨率各自一份，按文件名前缀精确匹配）。 */
  private async findCached(entry: BingArchiveEntry, uhd: boolean): Promise<string | undefined> {
    const prefix = `${fileStem(entry)}-${qualityTag(uhd)}.`
    const names = await readdir(this.cacheDir).catch(() => [] as string[])
    const match = names.find(name => name.startsWith(prefix))
    return match === undefined ? undefined : join(this.cacheDir, match)
  }

  /** 下载并落盘（魔数校验 → 先写 .part 再 rename → 按保留数清理旧图）。 */
  private async store(entry: BingArchiveEntry, uhd: boolean, bytes: Buffer): Promise<string> {
    const ext = sniffExtension(bytes)
    if (ext === undefined) throw new Error('bing image is not a supported picture')
    await mkdir(this.cacheDir, { recursive: true })
    const filePath = join(this.cacheDir, `${fileStem(entry)}-${qualityTag(uhd)}.${ext}`)
    await writeFile(`${filePath}.part`, bytes)
    await rename(`${filePath}.part`, filePath)
    await this.prune()
    return filePath
  }

  /** 按保留数清理旧图：文件名以日期开头，字典序即时间序，删掉最旧的超额部分。 */
  private async prune(): Promise<void> {
    const names = (await readdir(this.cacheDir).catch(() => [] as string[]))
      .filter(name => /^bing-\d{8}-[0-9a-z]+-(uhd|fhd)\.(jpg|png|gif|webp|avif)$/.test(name))
      .sort()
    for (const name of names.slice(0, Math.max(0, names.length - this.keep))) {
      await rm(join(this.cacheDir, name), { force: true })
    }
  }

  /** 下载一张图（超时 + 流式大小上限）。 */
  private async download(url: string): Promise<Buffer> {
    const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.timeoutMs) })
    if (!response.ok) throw new Error(`bing image responded ${response.status}`)
    return readCapped(response, this.maxBytes)
  }
}
