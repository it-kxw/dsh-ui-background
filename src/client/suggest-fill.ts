/**
 * 图片宽高比格式化工具（纯函数）。
 *
 * 上传照片后界面默认以 cover 铺满全屏（用户已确认的产品语义），不再依赖
 * 自动决策函数；这里仅保留 `formatAspect` 供设置行展示「图片比例 · 窗口比例」
 * 对比信息。
 *
 * @author 康小汪【kxw】
 * @date 2026-09-10
 */

/** 计算两整数的最大公约数（欧几里得，用于比例化简）。 */
function greatestCommonDivisor(left: number, right: number): number {
  let a = left
  let b = right
  while (b !== 0) {
    const remainder = a % b
    a = b
    b = remainder
  }
  return a
}

/**
 * 把像素尺寸格式化为最简整数比（如 1920×1080 → '16:9'）。
 * 宽高比极大（如超宽壁纸）时退化为小数比，避免化简结果荒谬；普通比例的
 * 最简整数比（如 683:384）正常展示。
 * @param width - 像素宽。
 * @param height - 像素高。
 * @returns 形如 '16:9' 或 '1.78:1' 的比例字符串。
 */
export function formatAspect(width: number, height: number): string {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return `${Math.round(width)}:${Math.round(height)}`
  }
  // 宽高比超过 12 视为「极端比例」，退化为小数比。
  if (Math.max(width, height) / Math.min(width, height) > 12) {
    return `${Math.round(width / height * 100) / 100}:1`
  }
  const divisor = greatestCommonDivisor(width, height)
  return `${width / divisor}:${height / divisor}`
}