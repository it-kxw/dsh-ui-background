/**
 * CSS 导入的类型声明（对齐 DSH packages/client 各包的 css-modules.d.ts）：
 * - `*.module.css`：导出 hashed class map，组件里以 `import css from './x.module.css'` 使用。
 * - `*.css?inline`：导出编译后的 CSS 文本，由插件生命周期 effect 手动挂载 <style>。
 */

declare module '*.module.css' {
  /** hashed 类名映射：源类名 → 构建哈希后的类名。 */
  const classes: Readonly<Record<string, string>>
  export default classes
}

declare module '*.css?inline' {
  /** 编译压缩后的 CSS 文本。 */
  const css: string
  export default css
}