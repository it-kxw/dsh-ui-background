/**
 * 浏览器半边取必应壁纸：请 Node 半边下载并缓存到本地，拿回本地缓存路径与展示元数据。
 *
 * 为什么不让浏览器直接引用必应图床：见 bing-service.ts 顶部说明（热链/跨域/离线）。
 * 本模块只负责"请求 + 响应校验"这一件事，错误一律抛出，由调用方决定提示方式与
 * 是否保留当前背景。
 *
 * @author 康小汪【kxw】
 * @date 2026-09-11
 */
import { BACKGROUND_BING_PATH } from '../background-settings.ts'

/** 一次取图请求。 */
export interface BingWallpaperQuery {
  /** latest 取最新一张（进入界面/首次选择）；random 换一张。 */
  mode: 'latest' | 'random'
  /** 地区（BING_MARKETS 之一）。 */
  market: string
  /** 是否取 4K 原图。 */
  uhd: boolean
}

/** 取图结果（服务端已落盘，path 为本地绝对路径）。 */
export interface BingWallpaperResult {
  /** 本地缓存文件绝对路径。 */
  path: string
  /** 展示用日期（YYYY-MM-DD）。 */
  date: string
  /** 展示用标题。 */
  title: string
  /** 展示用版权信息。 */
  copyright: string
  /** 是否为命中缓存（未重新下载）。 */
  cached: boolean
  /** 实际拿到的分辨率标记。 */
  resolution: string
}

/**
 * 客户端等待上限：Node 侧归档与图片各有 10s 超时，加上落盘与慢网留 30s 余量。
 * 超过即放弃（AbortSignal.timeout 会让 fetch 直接拒绝），避免界面无限期等待。
 */
const BING_CLIENT_TIMEOUT_MS = 30_000

/**
 * 取一张必应壁纸。
 * @param query - 模式、地区与分辨率偏好。
 * @returns 本地缓存路径与展示元数据。
 * @throws 网络失败/超时、非 2xx 响应、或响应缺少可用路径。
 */
export async function requestBingWallpaper(query: BingWallpaperQuery): Promise<BingWallpaperResult> {
  const response = await fetch(BACKGROUND_BING_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(query),
    signal: AbortSignal.timeout(BING_CLIENT_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`dsh-ui-background: 获取必应壁纸失败（HTTP ${response.status}）`)
  }
  return parseBingWallpaper(await response.json())
}

/**
 * 校验并收敛响应体：只认识自己关心的字段，其余一律降级为空值。
 * 服务端与客户端同版本，但响应仍是外部输入 —— 缺 path 视为失败。
 * @param payload - 响应 JSON。
 * @returns 规范化后的取图结果。
 * @throws 缺少非空 path。
 */
function parseBingWallpaper(payload: unknown): BingWallpaperResult {
  const record = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>
  if (typeof record.path !== 'string' || record.path === '') {
    throw new Error('dsh-ui-background: 必应壁纸响应缺少路径')
  }
  return {
    path: record.path,
    date: textOrEmpty(record.date),
    title: textOrEmpty(record.title),
    copyright: textOrEmpty(record.copyright),
    cached: record.cached === true,
    resolution: textOrEmpty(record.resolution),
  }
}

/** 字符串字段兜底（非字符串一律视为空串，避免把 undefined 带进设置文档）。 */
function textOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
