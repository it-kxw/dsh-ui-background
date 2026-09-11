/**
 * `settings.background` 命名空间字典（简体中文为源，英文补齐同键集）。
 * 预设标签也归类于此：预设表只存稳定 id，文案经 locale key 解析，
 * 保证切换语言时预设名跟随界面（对齐 DSH 的 locale-owned 规则）。
 *
 * @author 康小汪【kxw】
 * @date 2026-09-10
 */

/** 简体中文词典（键集之源）。 */
export const zh = {
  'row.title': '背景',
  'row.opacity': '不透明度',
  'row.blur': '模糊',
  'row.fill': '填充方式',
  'row.fill.cover': '铺满',
  'row.fill.contain': '适应',
  'row.fill.tile': '平铺',
  'row.clear': '清除背景',
  'row.customImage': '自定义图片',
  'row.upload': '上传图片',
  'row.uploading': '上传中…',
  'row.uploadError': '上传失败：文件格式或大小不符合要求',
  'row.ratio': '图片 {image} · 窗口 {window}',
  'row.streaks': '动态流光',
  'row.particles': '粒子效果',
  'preset.none': '无',
  'preset.aurora': '极光',
  'preset.sunset': '落日',
  'preset.emerald': '翡翠',
  'preset.midnight': '夜空',
  'preset.sand': '沙丘',
  'preset.slate': '石板',
  'toggle.label': '背景：{name}',
  'toggle.next': '切换背景',
} satisfies Record<string, string>

/** 设置命名空间的 key 联合（组件 t 的键域）。 */
export type BackgroundLocaleKey = keyof typeof zh

/** 英文词典：与 zh 键集一一对应。 */
export const en = {
  'row.title': 'Background',
  'row.opacity': 'Opacity',
  'row.blur': 'Blur',
  'row.fill': 'Fill',
  'row.fill.cover': 'Cover',
  'row.fill.contain': 'Contain',
  'row.fill.tile': 'Tile',
  'row.clear': 'Clear background',
  'row.customImage': 'Custom image',
  'row.upload': 'Upload image',
  'row.uploading': 'Uploading…',
  'row.uploadError': 'Upload failed: unsupported format or oversize',
  'row.ratio': 'Image {image} · Window {window}',
  'row.streaks': 'Light streaks',
  'row.particles': 'Particles',
  'preset.none': 'None',
  'preset.aurora': 'Aurora',
  'preset.sunset': 'Sunset',
  'preset.emerald': 'Emerald',
  'preset.midnight': 'Midnight',
  'preset.sand': 'Sand',
  'preset.slate': 'Slate',
  'toggle.label': 'Background: {name}',
  'toggle.next': 'Switch background',
} satisfies Record<BackgroundLocaleKey, string>