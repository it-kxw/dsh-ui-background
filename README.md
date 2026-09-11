# dsh-ui-background

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

为 **DeepSeek Harness Web GUI**（`dsh web`）提供的一键背景切换插件：内置渐变/纯色预设、本地图片上传与路径引用，支持不透明度、模糊、填充方式调节；浅色/深色配色自动适配，背景随手持久化到设置文档。

插件以独立仓库形式自包含构建（不修改 DSH 内核），通过 Web profile 的 patch 层接入运行中的实例即可使用。

---

## 目录

- [特性](#特性)
- [界面与效果](#界面与效果)
- [安装](#安装)
- [使用](#使用)
- [设置项](#设置项)
- [工作原理](#工作原理)
- [常见问题](#常见问题)
- [开发](#开发)
- [目录结构](#目录结构)
- [支持与打赏](#支持与打赏)
- [许可证](#许可证)

## 特性

- **一键切换**：界面右下角悬浮按钮在「无背景 → 预设… → 无背景」间循环切换
- **内置预设**：4 个渐变 + 2 个纯色；每个预设在浅色/深色配色下各有一套取值，切换主题不失效
- **自定义图片**：支持**本地文件上传**（落盘到 `$DSH_HOME/ui-background/`）
- **比例提示**：上传后展示「图片 16:9 · 窗口 16:9」对比；上传默认以 `cover` **铺满全屏**
- **精细调节**：不透明度（0.05–1）、模糊（0–32 px）、填充方式（铺满 / 适应 / 平铺）
- **持久化**：所有选择写入 `$DSH_HOME/settings.yaml`，刷新后保持
- **可读性保护**：面板底色降为 45% 同色系半透明底衬，背景可见同时文字保持对比度
- **零侵入**：不修改 DSH 内核、不占用任何既有 UI 座位；插件卸载后界面完全恢复默认

## 界面与效果

| 位置 | 内容 |
|---|---|
| 设置 → 通用 → 「背景」行 | 预设选择、上传/路径、不透明度、模糊、填充方式、清除背景、比例提示 |
| 界面右下角悬浮胶囊 | 单击循环切换背景（显示当前背景名） |

## 安装

### 前置要求

- Windows / macOS / Linux 上可运行的 [`dsh web`](https://github.com/deepseek-ai/deepseek-harness) 实例（`dsh` CLI 或从源码运行）
- 仅当你需要自己**从源码构建**时才需要 Node.js ≥ 22 与 pnpm ≥ 9；直接安装预构建包不需要

### 方式一：安装预构建包（推荐，一条命令）

本插件已打包为 `dsh-ui-background-0.1.0.tgz`（`dsh.bundle` 组合包，内含 Node 半边、浏览器半边与 patch 层）。在你的机器上执行：

```sh
dsh plugin --profile web add ./dsh-ui-background-0.1.0.tgz
```

`dsh plugin` 会自动：安装依赖 → 把插件追加进 profile 的 bundle 层（`dsh.profile.bundles`）→ 插件行随组合生效。**然后重启一次 `dsh web`**，刷新浏览器即可看到设置 → 通用 →「背景」行与右下角悬浮按钮。

> 安装到 npm 注册表后，同样的命令按包名安装即可：`dsh plugin --profile web add dsh-ui-background`。发布前请先在仓库执行 `pnpm install && pnpm run build && pnpm pack` 确保 `lib/` 产物打齐（`files` 已限定发布内容）。

卸载：

```sh
dsh plugin --profile web remove dsh-ui-background
```

### 方式二：从源码接入（开发/调试用）

克隆仓库并构建：

```sh
git clone <本仓库地址> dsh-ui-background
cd dsh-ui-background
pnpm install
pnpm run build      # 产出 lib/index.js（Node 半边）与 lib/client.js（浏览器半边）
```

在 `$DSH_HOME/profiles/web/cordis.patch.yml` 追加（`$DSH_HOME` 默认 `~/.dsh`，可用环境变量确认）：

```yaml
- insert:
    - id: ui-background
      name: 'D:/绝对/路径/to/dsh-ui-background/lib/index.js'
```

### 生效条件

| 变更内容 | 生效方式 |
|---|---|
| 首次安装 / Node 半边（`lib/index.js`，上传/读取路由） | **重启一次** `dsh web`（loader 已加载的模块不会热替换） |
| 仅浏览器半边（`lib/client.js`，设置行/按钮/渲染） | 浏览器**刷新**（建议 `Ctrl+F5`） |

## 使用

1. 打开设置 → 通用 → **背景**：
   - 点预设卡片（极光 / 落日 / 翡翠 / 夜空 / 沙丘 / 石板 / 无）切换背景
   - 点 **上传图片** 选择本地照片（自动铺满全屏）
   - 调节不透明度、模糊、填充方式；**清除背景**一键还原
2. 或直接点界面右下角的**悬浮按钮**，循环切换背景
3. 所有选择自动保存，刷新后保持；浅色/深色配色自动适配

## 设置项

设置在 `$DSH_HOME/settings.yaml` 的 `ui-background:` 节（行内编辑同样生效）：

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `preset` | string | `none` | 预设 id（`none` / `aurora` / `sunset` / `emerald` / `midnight` / `sand` / `slate` / `custom`） |
| `opacity` | number | `1` | 背景不透明度（0.05–1，步进 0.05） |
| `blur` | number | `0` | 背景模糊半径 px（0–32） |
| `fill` | `cover`/`contain`/`tile` | `cover` | 图片填充方式 |
| `imagePath` | string | `''` | 自定义图片的本地路径（上传后自动填写） |

未知的 `preset` 值会被安全回退为 `none`，不会导致设置失效。

## 工作原理

```
┌──────────────────────── dsh web 进程 ───────────────────────┐
│  Node 半边（lib/index.js）                                    │
│   ├─ 注册 settings 命名空间 ui-background（schemastery schema） │
│   ├─ GET  /dsh-ui-background/asset?path=…   图片读取路由        │
│   └─ POST /dsh-ui-background/upload          图片上传路由        │
└──────────────────────────────────────────────────────────────┘
        │ settings.yaml（持久化）                │ /plugins/…（client.js）
        ▼                                        ▼
┌──────────────────── 浏览器半边（lib/client.js） ──────────────┐
│  设置行（settings.general.item）+ 悬浮按钮（shell.overlay）      │
│  背景层：position:fixed; z-index:-1 铺满视口                    │
│  面板底色：color-mix 45% 同色系半透明底衬（浅/深自动）           │
└──────────────────────────────────────────────────────────────┘
```

- 背景层位于 AppFrame 之下、内容之上（负 z-index + `pointer-events: none`），不拦截任何交互
- 面板底色以 `color-mix` 降为 45% 同色系半透明底衬：背景透出可见，文字对比度保持
- 上传与读取共用同一扩展名白名单与大小上限，保证能上传的图一定能被读取

## 常见问题

**上传返回 413（Payload Too Large）**
图片超过 50 MiB 上限。选择更小的图片，或在 `src/background-settings.ts` 调整 `BACKGROUND_ASSET_MAX_BYTES` 后重建。

**更换背景后文字看不清 / 背景不明显**
面板底衬百分比调节（`src/client/background.css` 中的 `color-mix(… 45%, …)`，数值越大文字越清晰、背景越弱）。

**上传后照片没有铺满**
点击「填充方式」的「铺满」（cover）；上传默认即为 cover。

**左侧栏 / 右侧面板不显示背景**
确认页面已硬刷新；背景层为全屏固定层，面板为半透明底衬，正常应透出背景。

**修改 Node 半边后不生效**
上传/读取路由属于 Node 半边，需重启 `dsh web`。

**提示「上传失败：文件格式或大小不符合要求」**
扩展名须为 `png / jpg / jpeg / gif / webp / avif` 且 ≤ 50 MiB。

## 开发

```sh
pnpm install     # 安装依赖（@deepseek-ai/* 以 link: 指向本机 DSH 检出）
pnpm run build   # tsc 声明 + tsdown 双半边产物
pnpm test        # vitest（71+ 用例：schema/预设/运行时/DOM/组件/路由端到端）
pnpm run typecheck
```

> 说明：Windows 上 vitest 启动时 vite 会调用 `net use` 探测网络驱动器，若被环境沙箱拦截，请在更宽权限下运行测试。

目录结构见下节。新增 / 修改逻辑后请先 `pnpm test` 再 `pnpm run build`。

## 目录结构

```
dsh-ui-background/
├── src/
│   ├── index.ts                 # Node 半边：schema 注册 + asset/upload 路由
│   ├── background-settings.ts   # 共享常量/类型（命名空间、边界、白名单）
│   ├── background-schema.ts     # schemastery 设置 schema
│   ├── asset-route.ts           # 图片读取路由（按设置授权）
│   ├── upload-route.ts          # 图片上传路由（落盘 $DSH_HOME/ui-background/）
│   └── client/
│       ├── index.ts             # 浏览器半边 apply：装配两个 UI 入口
│       ├── background-runtime.ts  # 状态运行时（写操作/持久化/快照）
│       ├── background-presenter.ts # 背景层 DOM 呈现器
│       ├── background-store.ts   # UI 共享 store
│       ├── background.css        # 全局背景样式（浅/深底衬）
│       ├── BackgroundRow.tsx     # 设置「背景」行
│       ├── BackgroundQuickToggle.tsx # 悬浮一键切换按钮
│       ├── upload.ts             # 客户端上传与图片尺寸读取
│       ├── suggest-fill.ts       # 比例格式化（formatAspect）
│       ├── presets.ts            # 内置预设表与循环切换
│       ├── locales.ts            # 中英文案
│       └── styles.ts             # 全局样式生命周期
├── tests/                        # vitest 用例（含路由端到端）
├── cordis.patch.yml              # 接入 overlay 示例
├── tsdown.config.ts              # 自包含构建配置（Node + 浏览器双产物）
└── package.json
```

## 支持与打赏

如果本项目对你有帮助，欢迎扫码支持（自愿，感谢你的鼓励）：

<p align="center">
  <img src="docs/donate/zfb.jpg" alt="支付宝收款码" width="200" />
  &nbsp;&nbsp;
  <img src="docs/donate/wx.jpg" alt="微信收款码" width="200" />
</p>

## 许可证

[MIT](LICENSE)

本项目为独立开源插件，与 DeepSeek Harness（Apache-2.0 兼容生态）无关的第三方贡献；使用 DeepSeek Harness 请遵循其自身许可证。