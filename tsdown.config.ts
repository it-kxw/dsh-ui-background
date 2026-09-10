/**
 * dsh-ui-background 自包含构建配置（tsdown）。
 *
 * 为什么自包含：独立仓库无法复用 DSH 仓库内的 `packages/client/tsdown.client.ts`
 * 预设（跨仓库相对导入会失败），因此这里内联等价的构建规则，产出与 DSH 内置
 * 客户端插件完全相同的两类产物：
 *
 * 1. `lib/index.js`（Node 半边，ESM）：被宿主 Loader 直接 import 的 Cordis 插件，
 *    注册设置 schema 与图片资源路由。除 Node 内建模块外全部内联，运行时零外部依赖。
 * 2. `lib/client.js`（浏览器半边，CJS）：被 `dsh.client` 扫描进 window.__DSH_BOOT__
 *    entry 图的插件 bundle。格式必须是闭包工厂：调用 window.__ModuleLoader__.load
 *    ({ id, factory })，并把平台外部依赖交给 shell 注入的 require（模块表）。
 *
 * CSS 契约（与 DSH tsdown.client.ts 一致）：
 * - `x.module.css` → lightningcss 产出 hashed class map，并注入一个带去重守卫的
 *   <style> 标签（工厂执行时挂载）。
 * - `x.css?inline` → 导出编译后的 CSS 文本，由插件自己的生命周期 effect 挂载。
 */

import { readFile } from 'node:fs/promises'
import { isBuiltin } from 'node:module'
import { dirname, resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'
import { transform } from 'lightningcss'

/** 插件 id（包名）：写入 __ModuleLoader__.load 交接与注入的 style 标签标记。 */
const PLUGIN_ID = 'dsh-ui-background'

/**
 * 浏览器半边的平台外部依赖：由 shell 冻结的模块表提供（packages/client/web/src/platform.ts
 * 的 PLATFORM_MODULES 全集）。请求它们保持 import，其它 specifier 全部内联——
 * 这是模块图契约：插件不得把 React/cordis/共享 store 打包成自己的副本。
 */
const PLATFORM_EXTERNALS = new Set([
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

/** CSS 虚拟 id 前缀/后缀（避免与真实路径冲突；后缀避开 tsdown 的 .css 守卫）。 */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const GLOBAL_CSS_VIRTUAL_PREFIX = '\0dsh-global-css:'
const INLINE_CSS_VIRTUAL_PREFIX = '\0dsh-inline-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'
const INLINE_CSS_QUERY = '?inline'

/**
 * 生成一个插件拥有的 style 注入器模块：带 data-plugin / data-plugin-css 标记，
 * 按标记去重（HMR 重建后同一样式只存在一份），可选导出 CSS Modules 的 class map。
 * @param id - 插件 id，写入 style 标签的 plugin 标记。
 * @param fileId - 源样式表绝对路径，作为稳定的 data-plugin-css 标识。
 * @param css - 编译并压缩后的 CSS 文本。
 * @param classMap - CSS Modules 导出表；无则导出空对象。
 * @returns 可执行的模块源码。
 */
function styleInjectionModule(
  id: string,
  fileId: string,
  css: string,
  classMap?: Readonly<Record<string, string>>,
): string {
  const source = [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(`${id}/${fileId.split(/[\\/]/).pop()}`)};`,
    'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
    '  const tag = document.createElement(\'style\');',
    `  tag.dataset.plugin = ${JSON.stringify(id)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
  ]
  source.push(classMap === undefined ? 'export {};' : `export default ${JSON.stringify(classMap)};`)
  return source.join('\n')
}

/** 把相对路径 specifier 解析为绝对路径（相对 importer 所在目录；供 CSS 虚拟模块读取内容）。 */
function sourceAssetPath(source: string, importer: string): string {
  const base = importer.startsWith('file:') ? pathToFileURL(importer).pathname : importer
  return resolvePath(dirname(base), source)
}

/**
 * CSS 插件组（仅浏览器半边使用）。三个 resolveId/load 钩子把三类样式导入
 * 转为虚拟模块，并把物理样式表登记进 rolldown 的 watch 图。
 */
function cssPlugins(): object[] {
  return [{
    name: 'dsh-css-modules-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
      return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      const { code, exports: cssExports } = transform({
        filename: fileId,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap: Record<string, string> = {}
      const exportEntries = Object.entries(cssExports ?? {})
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      for (const [local, exp] of exportEntries) classMap[local] = exp.name
      return styleInjectionModule(PLUGIN_ID, fileId, code.toString(), classMap)
    },
  }, {
    name: 'dsh-css-text-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith(`.css${INLINE_CSS_QUERY}`)) return null
      const stylesheet = source.slice(0, -INLINE_CSS_QUERY.length)
      const abs = importer !== undefined ? sourceAssetPath(stylesheet, importer) : stylesheet
      return INLINE_CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(INLINE_CSS_VIRTUAL_PREFIX)) return null
      const fileId = virtualId.slice(INLINE_CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      const { code } = transform({ filename: fileId, code: source, minify: true })
      return `export default ${JSON.stringify(code.toString())};`
    },
  }, {
    name: 'dsh-css-global-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.css') || source.endsWith('.module.css')) return null
      const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
      return GLOBAL_CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(GLOBAL_CSS_VIRTUAL_PREFIX)) return null
      const fileId = virtualId.slice(GLOBAL_CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      const { code } = transform({ filename: fileId, code: source, minify: true })
      return styleInjectionModule(PLUGIN_ID, fileId, code.toString())
    },
  }]
}

export default [
  {
    // ── Node 半边：lib/index.js（宿主 Loader 直接 import）──────────────
    // 除 Node 内建模块外全部内联，让插件从任意位置被加载都不需要额外的
    // 运行时依赖解析（独立仓库不假设与 DSH 检出并排安装）。
    name: PLUGIN_ID,
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    // 保持输出名为 lib/index.js（否则 tsdown 会写成 .mjs，与 package.json main/exports 不符）。
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: {
      neverBundle: (specifier: string) => isBuiltin(specifier),
      alwaysBundle: (specifier: string) => !isBuiltin(specifier),
    },
  },
  {
    // ── 浏览器半边：lib/client.js（dsh.client 扫描进 __DSH_BOOT__）──────
    // CJS 闭包工厂：调用 __ModuleLoader__.load 注册自己，平台外部依赖保持
    // require 交由模块表提供；CSS 经上面的插件组内联为注入式样式模块。
    name: `${PLUGIN_ID}/client`,
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2024',
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: (specifier: string) => PLATFORM_EXTERNALS.has(specifier),
      alwaysBundle: (specifier: string) => !PLATFORM_EXTERNALS.has(specifier),
    },
    plugins: cssPlugins(),
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
]