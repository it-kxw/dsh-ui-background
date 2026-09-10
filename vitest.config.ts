/**
 * vitest 配置：默认 node 环境；需要 DOM 的用例用 `// @vitest-environment jsdom`
 * 文件头 pragma（对齐 DSH 客户端测试惯例）。
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
  },
})