/**
 * 预设表与循环切换纯函数测试。
 * @author 康小汪【kxw】
 * @date 2026-09-10
 */
import { describe, expect, it } from 'vitest'
import {
  BACKGROUND_PRESET_BING, BACKGROUND_PRESET_CUSTOM, BACKGROUND_PRESET_NONE,
} from '../src/background-settings.ts'
import {
  BACKGROUND_PRESETS, BACKGROUND_PRESET_IDS, isCustomPreset, isImagePreset, nextPresetId, presetById,
} from '../src/client/presets.ts'
import { zh } from '../src/client/locales.ts'

describe('BACKGROUND_PRESETS 预设表', () => {
  it('每条预设 id 唯一、携带双配色值与可解析的文案 key', () => {
    const ids = new Set<string>()
    for (const preset of BACKGROUND_PRESETS) {
      expect(ids.has(preset.id)).toBe(false)
      ids.add(preset.id)
      expect(preset.light.trim()).not.toBe('')
      expect(preset.dark.trim()).not.toBe('')
      // labelKey 必须在 zh 字典中存在（切换语言时预设名不缺失）。
      expect(typeof zh[preset.labelKey]).toBe('string')
    }
  })

  it('BACKGROUND_PRESET_IDS 与表的 id 一一对应', () => {
    expect(BACKGROUND_PRESET_IDS).toEqual(BACKGROUND_PRESETS.map(preset => preset.id))
  })

  it('none 与图片来源型预设（custom/bing）不在可点击的预设表内', () => {
    expect(BACKGROUND_PRESETS.some(preset => preset.id === BACKGROUND_PRESET_NONE)).toBe(false)
    expect(BACKGROUND_PRESET_IDS.includes(BACKGROUND_PRESET_CUSTOM)).toBe(false)
    expect(BACKGROUND_PRESET_IDS.includes(BACKGROUND_PRESET_BING)).toBe(false)
    // bing 不是静态预设：它没有双配色 CSS 值，只能由 imagePath 提供内容。
    expect(presetById(BACKGROUND_PRESET_BING)).toBeUndefined()
  })
})

describe('presetById', () => {
  it('命中已知 id，未知 id 返回 undefined', () => {
    expect(presetById('aurora')?.kind).toBe('gradient')
    expect(presetById('sand')?.kind).toBe('solid')
    expect(presetById('unknown')).toBeUndefined()
    expect(presetById(BACKGROUND_PRESET_NONE)).toBeUndefined()
  })
})

describe('nextPresetId 循环', () => {
  it('none → 第一个预设 → … → 最后一个 → none', () => {
    let current = BACKGROUND_PRESET_NONE
    const visited: string[] = []
    // 循环一整圈（预设数 + 回到 none 的一次）。
    for (let i = 0; i < BACKGROUND_PRESET_IDS.length + 1; i += 1) {
      current = nextPresetId(current)
      visited.push(current)
    }
    expect(current).toBe(BACKGROUND_PRESET_NONE)
    // 圈内恰好包含全部预设各一次。
    expect(visited.filter(id => id !== BACKGROUND_PRESET_NONE)).toEqual(BACKGROUND_PRESET_IDS)
  })

  it('最后一个预设的下一个回到 none', () => {
    const last = BACKGROUND_PRESET_IDS[BACKGROUND_PRESET_IDS.length - 1]!
    expect(nextPresetId(last)).toBe(BACKGROUND_PRESET_NONE)
  })

  it('custom/bing 或未知值重置回 none（先关掉再选择）', () => {
    expect(nextPresetId(BACKGROUND_PRESET_CUSTOM)).toBe(BACKGROUND_PRESET_NONE)
    expect(nextPresetId(BACKGROUND_PRESET_BING)).toBe(BACKGROUND_PRESET_NONE)
    expect(nextPresetId('bogus')).toBe(BACKGROUND_PRESET_NONE)
  })

  it('空表安全：没有任何预设时 none 的下一个仍是 none', () => {
    // 防回归：若未来把所有预设移出而只留 none，循环必须仍封闭。
    expect(BACKGROUND_PRESET_IDS.length).toBeGreaterThan(0)
  })
})

describe('isCustomPreset', () => {
  it('仅 custom 返回 true', () => {
    expect(isCustomPreset(BACKGROUND_PRESET_CUSTOM)).toBe(true)
    expect(isCustomPreset('aurora')).toBe(false)
    expect(isCustomPreset(BACKGROUND_PRESET_NONE)).toBe(false)
  })
})

describe('isImagePreset', () => {
  it('custom 与 bing 为图片来源型，其余（含 none/内置预设/未知值）为 false', () => {
    expect(isImagePreset(BACKGROUND_PRESET_CUSTOM)).toBe(true)
    expect(isImagePreset(BACKGROUND_PRESET_BING)).toBe(true)
    expect(isImagePreset('aurora')).toBe(false)
    expect(isImagePreset(BACKGROUND_PRESET_NONE)).toBe(false)
    expect(isImagePreset('bogus')).toBe(false)
  })
})