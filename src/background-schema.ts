/**
 * dsh-ui-background 设置的 schemastery schema（Node 半边专用）。
 *
 * 由宿主 settings 服务校验并补全默认值；浏览器半边只读取 schema 解析后的
 * 值（类型见 background-settings.ts），因此本文件不进入 client bundle。
 *
 * 键名刻意写显式字面量而非常量：schemastery z.object 对 computed key 的
 * 类型推断会退化成 index signature，导致 schema 类型与 BackgroundSettings
 * 无法对应（键名由 background-settings.ts 的 FIELD 常量文档约束）。
 *
 * @author 康小汪【kxw】
 * @date 2026-09-10
 */
import z from '@deepseek-ai/schemastery'
import {
  BACKGROUND_BLUR_MAX, BACKGROUND_BLUR_MIN, BACKGROUND_BLUR_STEP,
  BACKGROUND_FILLS, BACKGROUND_OPACITY_MAX, BACKGROUND_OPACITY_MIN,
  BACKGROUND_OPACITY_STEP, BACKGROUND_PRESET_NONE, type BackgroundSettings,
} from './background-settings.ts'

/**
 * 背景设置的持久化 schema。
 * - preset 用自由字符串而非枚举：允许预设表后续演进，未知值由运行时回退。
 * - imagePath 默认空串：settings 文档里字段始终存在且为 JSON 友好形状。
 */
export const BackgroundSettingsSchema: z<BackgroundSettings> = z.object({
  preset: z.string().default(BACKGROUND_PRESET_NONE),
  opacity: z.number()
    .step(BACKGROUND_OPACITY_STEP)
    .min(BACKGROUND_OPACITY_MIN)
    .max(BACKGROUND_OPACITY_MAX)
    .default(1),
  blur: z.number()
    .step(BACKGROUND_BLUR_STEP)
    .min(BACKGROUND_BLUR_MIN)
    .max(BACKGROUND_BLUR_MAX)
    .default(0),
  fill: z.union([...BACKGROUND_FILLS]).default('cover'),
  imagePath: z.string().default(''),
})