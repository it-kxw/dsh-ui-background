/**
 * dsh-ui-background 共享设置模型：纯常量、类型与纯函数，宿主/浏览器两个半边共用。
 *
 * 为何不含 schemastery：本文件会被浏览器半边内联进 client bundle，而 schemastery
 * 只在 Node 半边（注册设置 schema）需要；分离 schema（见 background-schema.ts）
 * 让客户端产物不携带这份运行时依赖。
 *
 * @author 康小汪【kxw】
 * @date 2026-09-10
 */

/** 设置命名空间：Node 半边注册、浏览器半边 bind 的同一个标识。 */
export const BACKGROUND_SETTINGS_NAMESPACE = 'ui-background'

/** 各设置字段在 user-settings 文档里的键名。 */
export const BACKGROUND_PRESET_FIELD = 'preset'
export const BACKGROUND_OPACITY_FIELD = 'opacity'
export const BACKGROUND_BLUR_FIELD = 'blur'
export const BACKGROUND_FILL_FIELD = 'fill'
export const BACKGROUND_IMAGE_FIELD = 'imagePath'
export const BACKGROUND_STREAKS_FIELD = 'streaks'
export const BACKGROUND_PARTICLES_FIELD = 'particles'

/** 自定义图片背景的预设标记：选了本地图片时 preset 字段置为它。 */
export const BACKGROUND_PRESET_CUSTOM = 'custom'

/** 图片填充方式：cover 铺满裁剪、contain 完整适应、tile 平铺。 */
export const BACKGROUND_FILLS = ['cover', 'contain', 'tile'] as const

/** 图片填充方式值类型。 */
export type BackgroundFill = typeof BACKGROUND_FILLS[number]

/** 不透明度边界与步进（滑杆按 0.05 步进；手写任意范围内有限值也接受）。 */
export const BACKGROUND_OPACITY_MIN = 0.05
export const BACKGROUND_OPACITY_MAX = 1
export const BACKGROUND_OPACITY_STEP = 0.05

/** 背景模糊半径边界（px）。 */
export const BACKGROUND_BLUR_MIN = 0
export const BACKGROUND_BLUR_MAX = 32
export const BACKGROUND_BLUR_STEP = 1

/** 无背景预设 id（也是设置文档的默认值）。 */
export const BACKGROUND_PRESET_NONE = 'none'

/** 默认设置：无背景、全不透明、不模糊、铺满、无图片、无动态特效。 */
export const DEFAULT_BACKGROUND_SETTINGS: Readonly<BackgroundSettings> = Object.freeze({
  preset: BACKGROUND_PRESET_NONE,
  opacity: 1,
  blur: 0,
  fill: 'cover',
  imagePath: '',
  streaks: false,
  particles: false,
})

/**
 * 一份持久化的背景设置。schema 校验通过后的值即此形状；preset 用 string
 * 而非枚举，是因为用户手改 settings.yaml 可能写入未知 id，运行时回退成
 * 'none' 更稳妥（参照计划中的边界情况表）。
 */
export interface BackgroundSettings {
  /** 内置预设 id、'custom'（自定义图片），或未知值（运行时回退 none）。 */
  preset: string
  /** 背景不透明度（BACKGROUND_OPACITY_MIN..MAX）。 */
  opacity: number
  /** 背景模糊半径（px，BACKGROUND_BLUR_MIN..MAX）。 */
  blur: number
  /** 图片填充方式。 */
  fill: BackgroundFill
  /** 自定义图片的本地绝对路径；空串表示未设置。 */
  imagePath: string
  /** 动态流光特效开关（在背景之上叠加缓慢漂移的光带）。 */
  streaks: boolean
  /** 粒子特效开关（在背景之上叠加漂浮微粒）。 */
  particles: boolean
}

/** 浏览器半边请求 Node 半边图片资源的固定路由前缀。 */
export const BACKGROUND_ASSET_PATH = '/dsh-ui-background/asset'

/** 浏览器半边上传图片到 Node 半边的固定路由前缀（POST）。 */
export const BACKGROUND_UPLOAD_PATH = '/dsh-ui-background/upload'

/** 上传文件落盘的 home 子目录名（`$DSH_HOME/ui-background/`）。 */
export const BACKGROUND_UPLOAD_DIR_NAME = 'ui-background'

/**
 * 单张自定义图片的最大字节数（50 MiB）：上传与读取共用的上限。壁纸/相机
 * 原图常见 8-25 MB，50 MiB 在「足够容纳高像素图」与「不过度占用本地磁盘」
 * 之间取平衡；超限上传返回 413，读取侧同值拒绝。
 */
export const BACKGROUND_ASSET_MAX_BYTES = 50 * 1024 * 1024

/**
 * 允许的图片扩展名（小写无点）→ MIME 类型。上传与读取共用同一白名单，
 * 保证能上传的图片一定能被 asset 路由读出。
 */
export const BACKGROUND_IMAGE_MIME: Readonly<Record<string, string>> = Object.freeze({
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
})

/**
 * 由本地图片绝对路径生成浏览器可请求的资源 URL。
 * @param imagePath - 设置里保存的本地图片绝对路径。
 * @returns 可作 CSS background-image url() 的同源资源 URL。
 */
export function backgroundAssetUrl(imagePath: string): string {
  return `${BACKGROUND_ASSET_PATH}?path=${encodeURIComponent(imagePath)}`
}