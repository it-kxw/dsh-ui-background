/**
 * 把全局背景样式表挂到文档头的生命周期安装器。
 *
 * 与 ui-theme 的 installThemeStyles 同款契约：样式经 ?inline 编译成文本，
 * 由插件自己的 ctx.effect 挂载/卸载 <style>，并打上 data-plugin /
 * data-plugin-css 标记（构建产物的 CSS 注入器按同一标记去重）。
 *
 * @author 康小汪【kxw】
 * @date 2026-09-10
 */
import type { Context } from '@deepseek-ai/cordis'
import backgroundCss from './background.css?inline'

/** 插件 id（包名），写入 style 标签标记。 */
const PLUGIN_ID = 'dsh-ui-background'

/**
 * 为背景功能挂载全局样式；插件卸载时随 effect 移除。
 * @param ctx - 浏览器插件上下文。
 */
export function installBackgroundStyles(ctx: Context): void {
  if (typeof document === 'undefined') return
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = PLUGIN_ID
    tag.dataset.pluginCss = `${PLUGIN_ID}/background.css`
    tag.textContent = backgroundCss
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'dsh-ui-background: background stylesheet')
}