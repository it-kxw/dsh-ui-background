/**
 * 设置 schema：默认值补全与边界校验测试（schemastery schema 是 callable，
 * 非法输入抛错、缺失输入按 default 补全）。
 * @author 康小汪【kxw】
 * @date 2026-09-10
 */
import { describe, expect, it } from 'vitest'
import { BackgroundSettingsSchema } from '../src/background-schema.ts'
import { BACKGROUND_PRESET_NONE } from '../src/background-settings.ts'

/** 完整默认值快照（schema 对空对象解析的产物）。 */
const DEFAULTS = {
  preset: BACKGROUND_PRESET_NONE,
  opacity: 1,
  blur: 0,
  fill: 'cover',
  imagePath: '',
  streaks: false,
  particles: false,
} as const

describe('BackgroundSettingsSchema 默认值', () => {
  it('空对象解析为全部默认值', () => {
    expect(BackgroundSettingsSchema({})).toEqual(DEFAULTS)
  })

  it('缺省字段按 default 补全，显式字段保留', () => {
    const parsed = BackgroundSettingsSchema({ preset: 'aurora', blur: 6 })
    expect(parsed).toEqual({ ...DEFAULTS, preset: 'aurora', blur: 6 })
  })

  it('null 输入同样落到默认值', () => {
    expect(BackgroundSettingsSchema(null)).toEqual(DEFAULTS)
  })
})

describe('BackgroundSettingsSchema 边界校验', () => {
  it('拒绝未知 fill、越界或不符合 step 的数值', () => {
    expect(() => BackgroundSettingsSchema({ fill: 'stretch' })).toThrow()
    expect(() => BackgroundSettingsSchema({ opacity: 0 })).toThrow()
    expect(() => BackgroundSettingsSchema({ opacity: 1.02 })).toThrow()
    // 0.21 不是 0.05 的整数倍。
    expect(() => BackgroundSettingsSchema({ opacity: 0.21 })).toThrow()
    expect(() => BackgroundSettingsSchema({ blur: -1 })).toThrow()
    expect(() => BackgroundSettingsSchema({ blur: 33 })).toThrow()
    // 1.5 非整数步进。
    expect(() => BackgroundSettingsSchema({ blur: 1.5 })).toThrow()
  })

  it('接受边界值与合法 step 倍数', () => {
    expect(BackgroundSettingsSchema({ opacity: 0.05 }).opacity).toBe(0.05)
    expect(BackgroundSettingsSchema({ opacity: 1 }).opacity).toBe(1)
    expect(BackgroundSettingsSchema({ opacity: 0.2 }).opacity).toBe(0.2)
    expect(BackgroundSettingsSchema({ blur: 32 }).blur).toBe(32)
    expect(BackgroundSettingsSchema({ fill: 'tile' }).fill).toBe('tile')
  })

  it('preset 与 imagePath 是自由字符串（未知 preset 由运行时回退）', () => {
    expect(BackgroundSettingsSchema({ preset: 'future-preset' }).preset).toBe('future-preset')
    expect(BackgroundSettingsSchema({ imagePath: 'D:/a.png' }).imagePath).toBe('D:/a.png')
  })

  it('特效开关：默认关闭、接受显式布尔、拒绝非布尔值', () => {
    expect(BackgroundSettingsSchema({}).streaks).toBe(false)
    expect(BackgroundSettingsSchema({}).particles).toBe(false)
    expect(BackgroundSettingsSchema({ streaks: true }).streaks).toBe(true)
    expect(BackgroundSettingsSchema({ particles: true }).particles).toBe(true)
    expect(() => BackgroundSettingsSchema({ streaks: 'yes' })).toThrow()
    expect(() => BackgroundSettingsSchema({ particles: 1 })).toThrow()
  })
})