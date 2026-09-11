/**
 * 必应取图客户端封装测试：stub 全局 fetch（不触网），覆盖请求形状、
 * 响应规范化与错误映射（客户端不解读业务原因，只保证调用方能区分失败）。
 *
 * @author 康小汪【kxw】
 * @date 2026-09-11
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BACKGROUND_BING_PATH } from '../src/background-settings.ts'
import { requestBingWallpaper } from '../src/client/bing.ts'

/** 完整的合法响应体。 */
const PAYLOAD = {
  path: 'C:/dsh/ui-background/bing/bing-20260910-01234567-uhd.jpg',
  date: '2026-09-10',
  title: '地中海风情尽显',
  copyright: '© StockByM/Getty Images',
  cached: false,
  resolution: 'UHD',
}

/** 铺一个固定响应的 fetch 桩并返回它。 */
function stubFetch(respond: () => Promise<Response> | Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => respond())
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => { vi.unstubAllGlobals() })

describe('requestBingWallpaper', () => {
  it('POST 到固定路由并携带查询参数，返回规范化结果', async () => {
    const fetchMock = stubFetch(() => new Response(JSON.stringify(PAYLOAD), { status: 200 }))
    const result = await requestBingWallpaper({ mode: 'random', market: 'en-US', uhd: false })
    expect(result).toEqual(PAYLOAD)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(BACKGROUND_BING_PATH)
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ mode: 'random', market: 'en-US', uhd: false })
    // 带超时信号：慢网不会让界面无限期等待。
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('缺失或非字符串字段降级：cached 非 true 视为 false、文本字段为空串', async () => {
    stubFetch(() => new Response(JSON.stringify({ path: 'C:/b/a.jpg', cached: 'yes', title: 42 }), { status: 200 }))
    const result = await requestBingWallpaper({ mode: 'latest', market: 'zh-CN', uhd: true })
    expect(result).toEqual({
      path: 'C:/b/a.jpg', date: '', title: '', copyright: '', cached: false, resolution: '',
    })
  })

  it('非 2xx 抛出含状态码的错误', async () => {
    stubFetch(() => new Response('boom', { status: 502 }))
    await expect(requestBingWallpaper({ mode: 'latest', market: 'zh-CN', uhd: true }))
      .rejects.toThrow('HTTP 502')
  })

  it('响应缺少非空 path 视为失败（不把半状态写进设置）', async () => {
    stubFetch(() => new Response(JSON.stringify({ date: '2026-09-10' }), { status: 200 }))
    await expect(requestBingWallpaper({ mode: 'latest', market: 'zh-CN', uhd: true }))
      .rejects.toThrow('缺少路径')
  })

  it('响应不是 JSON 对象时同样按失败处理', async () => {
    stubFetch(() => new Response('null', { status: 200 }))
    await expect(requestBingWallpaper({ mode: 'latest', market: 'zh-CN', uhd: true }))
      .rejects.toThrow('缺少路径')
  })

  it('网络层错误原样向上抛（由调用方决定提示）', async () => {
    stubFetch(() => { throw new Error('network down') })
    await expect(requestBingWallpaper({ mode: 'latest', market: 'zh-CN', uhd: true }))
      .rejects.toThrow('network down')
  })
})
