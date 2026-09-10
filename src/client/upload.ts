/**
 * 客户端图片上传与尺寸读取。
 *
 * 上传流程：createImageBitmap 读取像素尺寸（同时验证文件是有效图片）→
 * POST 到 Node 半边上传路由（x-upload-ext 头带扩展名）→ 返回落盘绝对路径
 * 与尺寸，供上层（apply）完成持久化与比例适配。
 *
 * 尺寸读取降级：createImageBitmap 不可用（部分旧内核）时退回 objectURL +
 * Image onload；仍然读不到尺寸时以 0 返回（调用方对 0 尺寸按默认 cover 处理）。
 *
 * @author 康小汪【kxw】
 * @date 2026-09-10
 */
import { BACKGROUND_ASSET_MAX_BYTES, BACKGROUND_IMAGE_MIME, BACKGROUND_UPLOAD_PATH } from '../background-settings.ts'

/** 一次上传的结果：落盘路径与像素尺寸。 */
export interface UploadedBackgroundImage {
  /** 服务端落盘的绝对路径（交 runtime.setImagePath 持久化）。 */
  path: string
  /** 图片像素宽。 */
  width: number
  /** 图片像素高。 */
  height: number
}

/**
 * 读取一张图片的像素尺寸（createImageBitmap 优先，objectURL+Image 兜底）。
 * @param source - 可作为图片源的 Blob 或 URL。
 * @returns 像素宽高；读不到时 width/height 为 0。
 */
export async function readImageSize(source: Blob | string): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(
        typeof source === 'string' ? await fetchImage(source) : source,
      )
      const size = { width: bitmap.width, height: bitmap.height }
      bitmap.close()
      return size
    } catch {
      // 落入 objectURL + Image 兜底；兜底失败再返回 0。
    }
  }
  return readImageSizeViaImage(source)
}

/** 经 <img> 解码读取尺寸（Image 不触发布局，jsdom 等无解码环境会失败）。 */
function readImageSizeViaImage(source: Blob | string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') {
      resolve({ width: 0, height: 0 })
      return
    }
    const url = typeof source === 'string' ? source : URL.createObjectURL(source)
    const image = new Image()
    const cleanup = (): void => {
      if (typeof source !== 'string') URL.revokeObjectURL(url)
    }
    image.onload = () => {
      cleanup()
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => {
      cleanup()
      resolve({ width: 0, height: 0 })
    }
    image.src = url
  })
}

/** 读取 URL 资源为 Blob（createImageBitmap 路径需要 Blob/ImageBitmapSource）。 */
async function fetchImage(url: string): Promise<Blob> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`dsh-ui-background: 图片读取失败 ${response.status}`)
  return response.blob()
}

/**
 * 上传一个本地图片文件：预检扩展名与大小、验证有效性、读取尺寸、POST 到上传路由。
 * @param file - 用户选择的文件。
 * @returns 落盘路径与像素尺寸。
 * @throws 扩展名不在白名单、文件超过大小上限、上传接口拒绝、或文件不是有效图片。
 */
export async function uploadBackgroundImage(file: File): Promise<UploadedBackgroundImage> {
  const ext = extensionOf(file.name)
  if (ext === undefined) {
    throw new Error(`dsh-ui-background: 不支持的图片格式（${file.name}）`)
  }
  // 客户端预检大小：避免为必然被拒的文件发起上传请求（服务端仍会二次校验）。
  if (file.size > BACKGROUND_ASSET_MAX_BYTES) {
    throw new Error(`dsh-ui-background: 图片超过 ${BACKGROUND_ASSET_MAX_BYTES} 字节上限`)
  }
  const size = await readImageSize(file)
  const response = await fetch(BACKGROUND_UPLOAD_PATH, {
    method: 'POST',
    headers: { 'x-upload-ext': ext },
    body: file,
  })
  if (!response.ok) {
    throw new Error(`dsh-ui-background: 上传失败（${response.status}）`)
  }
  const payload = (await response.json()) as { path?: unknown }
  if (typeof payload.path !== 'string' || payload.path === '') {
    throw new Error('dsh-ui-background: 上传响应缺少路径')
  }
  return { path: payload.path, width: size.width, height: size.height }
}

/** 从文件名取小写扩展名并查白名单（无扩展名或不在表内返回 undefined）。 */
function extensionOf(fileName: string): string | undefined {
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0 || dot === fileName.length - 1) return undefined
  const ext = fileName.slice(dot + 1).toLowerCase()
  return ext in BACKGROUND_IMAGE_MIME ? ext : undefined
}