/**
 * 图片宽高比格式化纯函数测试（suggestFill 已随「照片铺满全屏」需求移除）。
 * @author 康小汪【kxw】
 * @date 2026-09-10
 */
import { describe, expect, it } from 'vitest'
import { formatAspect } from '../src/client/suggest-fill.ts'

describe('formatAspect 比例格式化', () => {
  it('最简整数比', () => {
    expect(formatAspect(1920, 1080)).toBe('16:9')
    expect(formatAspect(1366, 768)).toBe('683:384')
  })

  it('超大比值退化为小数比（避免荒谬文本）', () => {
    const wide = formatAspect(21000, 100)
    expect(wide).toMatch(/^210:1$/)
  })

  it('非法输入原样返回（不抛错）', () => {
    expect(formatAspect(0, 0)).toBe('0:0')
    expect(formatAspect(10.5, 5)).toBe('11:5')
  })
})