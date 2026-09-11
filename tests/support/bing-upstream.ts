/**
 * 必应壁纸测试夹具（非测试文件：vitest 仅收集 *.spec.ts）。
 *
 * 抽出的原因：服务测试与路由测试都需要"可预测的归档 JSON + 图片响应 + 请求记录"，
 * 两份各写一遍容易出现日期/哈希拼法漂移，导致测试互相矛盾。
 *
 * @author 康小汪【kxw】
 * @date 2026-09-11
 */
/** 一张最小合法 JPEG（FFD8FF 魔数 + 填充）。 */
export const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(64, 3)])

/** 归档接口前缀（桩据此区分归档请求与图片请求）。 */
export const ARCHIVE_MARKER = 'HPImageArchive'

/**
 * 构造一条归档记录（日期与哈希都是合法形状）。
 * @param day - 日期天数（1..28），与地区偏移相加得到 startdate。
 * @param over - 需要覆盖的字段（如把 urlbase 改成非法 host）。
 * @returns 归档 JSON 的单行结构。
 */
export function entryAt(day: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  const startdate = `202609${String(day).padStart(2, '0')}`
  return {
    startdate,
    urlbase: `/th?id=OHR.Pic${day}_ZH-CN1234`,
    url: `/th?id=OHR.Pic${day}_ZH-CN1234_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp`,
    title: `标题${day}`,
    copyright: `© 作者${day}`,
    hsh: `0123456789abcdef${day.toString(16)}`,
    ...over,
  }
}

/**
 * 归档 JSON 响应。zh-CN 落在 09-1x 段、en-US 落在 09-2x 段，
 * 这样"按地区取两次"就能确定性地产生两张不同日期的图（用于缓存清理断言）。
 * @param market - 地区。
 * @param days - 该地区内要返回的天偏移（默认两天）。
 * @returns 归档接口响应。
 */
export function archiveResponse(market: string, days: number[] = [0, 1]): Response {
  const offset = market === 'en-US' ? 20 : 10
  return new Response(JSON.stringify({ images: days.map(day => entryAt(offset + day)) }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * 图片地址（与实现里 `urlbase + 后缀` 的拼法保持一致）。
 * @param id - 归档记录 id（如 Pic10）。
 * @param quality - UHD 或接口给出的 1920×1080。
 * @returns 绝对地址。
 */
export function imageUrl(id: string, quality: 'UHD' | '1920x1080'): string {
  return new URL(`/th?id=OHR.${id}_ZH-CN1234_${quality}.jpg`, 'https://cn.bing.com').toString()
}

/** 记录请求并可按地址铺桩的 fetch 替身。 */
export interface UpstreamStub {
  /** 传给被测量代码的 fetch。 */
  fetchImpl: typeof fetch
  /** 依次记录到的请求地址。 */
  urls: string[]
  /** 图片地址 → 响应（未铺桩的图片地址返回 404）。 */
  images: Map<string, Response | (() => Response)>
}

/**
 * 创建上游替身：归档请求自动应答，图片请求查表。
 * @param days - 归档返回的天偏移。
 * @returns 替身（含记录数组）。
 */
export function makeUpstreamStub(days: number[] = [0, 1]): UpstreamStub {
  const urls: string[] = []
  const images = new Map<string, Response | (() => Response)>()
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input)
    urls.push(url)
    if (url.includes(ARCHIVE_MARKER)) {
      return archiveResponse(new URL(url).searchParams.get('mkt') ?? 'zh-CN', days)
    }
    const handler = images.get(url)
    if (handler === undefined) return new Response('missing', { status: 404 })
    // Response 的 body 只能消费一次：原始对象克隆后再交出。
    return typeof handler === 'function' ? handler() : handler.clone()
  }) as unknown as typeof fetch
  return { fetchImpl, urls, images }
}

/** 图片请求地址（归档请求不计）。 */
export function imageRequests(stub: UpstreamStub): string[] {
  return stub.urls.filter(url => !url.includes(ARCHIVE_MARKER))
}
