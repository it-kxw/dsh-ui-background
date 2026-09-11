# dsh-ui-background

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

为 **DeepSeek Harness Web GUI**（`dsh web`）提供的一键背景切换插件：内置渐变/纯色预设、本地图片上传与路径引用、**必应每日壁纸**，支持不透明度、模糊、填充方式调节；浅色/深色配色自动适配，背景随手持久化到设置文档。

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
- **必应每日壁纸**：一键取必应首页壁纸（可选 4K / 1920×1080、可选地区），支持「换一张」回溯最近 8 天与「每日自动更新」；图片由 Node 半边下载并**缓存到本地**，因此不依赖热链、断网也能显示已缓存的图
- **精细调节**：不透明度（0.05–1）、模糊（0–32 px）、填充方式（铺满 / 适应 / 平铺）
- **持久化**：所有选择写入 `$DSH_HOME/settings.yaml`，刷新后保持
- **可读性保护**：面板底色降为 45% 同色系半透明底衬，背景可见同时文字保持对比度
- **动态特效**：可在背景之上叠加**动态流光**（窄亮斜向光带，深色配色加色发光）或**粒子**（随配色自适应的漂浮亮点）效果（二选一、互斥开启；随背景激活，尊重系统「减少动态效果」）
- **零侵入**：不修改 DSH 内核、不占用任何既有 UI 座位；插件卸载后界面完全恢复默认

## 界面与效果

| 位置 | 内容 |
|---|---|
| 设置 → 通用 → 「背景」行 | 预设选择、上传、**必应壁纸（获取今日 / 换一张 / 地区 / 4K / 每日自动更新）**、不透明度、模糊、填充方式、动态流光/粒子开关、清除背景、比例提示 |
| 界面右下角悬浮胶囊 | 单击循环切换背景（显示当前背景名） |

## 安装

### 前置要求

- Windows / macOS / Linux 上可运行的 [`dsh web`](https://github.com/deepseek-ai/deepseek-harness) 实例（`dsh` CLI 或从源码运行）
- 仅当你需要自己**从源码构建**时才需要 Node.js ≥ 22 与 pnpm ≥ 9；直接安装预构建包不需要

### 方式一：安装预构建包（推荐，一条命令）

本插件为 `dsh.bundle` 组合包（内含 Node 半边、浏览器半边与 patch 层），以 npm 发布或本地 tarball 提供。安装（任选其一）：

```sh
dsh plugin --profile web add dsh-ui-background        # npm 已发布时
dsh plugin --profile web add ./dsh-ui-background-0.3.0.tgz   # 或本地打包文件
```

`dsh plugin` 会自动：安装依赖 → 把插件追加进 profile 的 bundle 层（`dsh.profile.bundles`）→ 插件行随组合生效。**然后重启一次 `dsh web`**，刷新浏览器即可看到设置 → 通用 →「背景」行与右下角悬浮按钮。

> 发布前请先在仓库执行 `pnpm install && pnpm run build && pnpm pack` 确保 `lib/` 产物打齐（`files` 已限定发布内容）。

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
| 首次安装 / Node 半边（`lib/index.js`：图片读取、上传、必应取图路由） | **重启一次** `dsh web`（loader 已加载的模块不会热替换） |
| 仅浏览器半边（`lib/client.js`，设置行/按钮/渲染） | 浏览器**刷新**（建议 `Ctrl+F5`） |

> 必应取图链路横跨两个半边：**新装或改过 Node 半边后必须先重启 `dsh web`**，否则点「获取今日壁纸」会拿到 405（该路径在 DSH 静态兜底里等同"未注册路由"），界面显示「获取必应壁纸失败」。

## 使用

1. 打开设置 → 通用 → **背景**：
   - 点预设卡片（极光 / 落日 / 翡翠 / 夜空 / 沙丘 / 石板 / 无）切换背景
   - 点 **上传图片** 选择本地照片（自动铺满全屏）
   - 点 **获取今日壁纸** 用必应每日壁纸作为背景；之后按钮变为 **换一张**（在最近 8 天里换）
   - 调节不透明度、模糊、填充方式；**清除背景**一键还原
2. 或直接点界面右下角的**悬浮按钮**，循环切换背景（必应壁纸不参与循环，避免一键切换触发联网）
3. 所有选择自动保存，刷新后保持；浅色/深色配色自动适配

## 设置项

设置在 `$DSH_HOME/settings.yaml` 的 `ui-background:` 节（行内编辑同样生效）：

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `preset` | string | `none` | 预设 id（`none` / `aurora` / `sunset` / `emerald` / `midnight` / `sand` / `slate` / `custom` / `bing`） |
| `opacity` | number | `1` | 背景不透明度（0.05–1，步进 0.05） |
| `blur` | number | `0` | 背景模糊半径 px（0–32） |
| `fill` | `cover`/`contain`/`tile` | `cover` | 图片填充方式 |
| `imagePath` | string | `''` | 图片来源型预设（`custom`/`bing`）的本地绝对路径；上传或取必应壁纸后自动填写 |
| `streaks` | boolean | `false` | 动态流光开关：六条窄亮斜向光带（深色配色加色发光、浅色配色深蓝灰描边）；与粒子互斥，开启其一自动关闭另一 |
| `particles` | boolean | `false` | 粒子特效开关（与流光互斥） |
| `bingMarket` | string | `zh-CN` | 必应壁纸地区（`zh-CN` / `en-US` / `en-GB` / `ja-JP` / `de-DE`），决定壁纸池与标题语言；非法值取图时回退 `zh-CN` |
| `bingUhd` | boolean | `true` | 是否取 4K（UHD）原图；关闭则用接口给出的 1920×1080；该归档缺 4K 时自动回落 |
| `bingAutoRefresh` | boolean | `true` | 进入界面时自动对齐「今日」壁纸（命中本地缓存则不重复下载） |
| `bingTitle` | string | `''` | 展示用：当前壁纸标题（随地区语言） |
| `bingDate` | string | `''` | 展示用：当前壁纸日期（`YYYY-MM-DD`） |
| `bingCopyright` | string | `''` | 展示用：当前壁纸版权信息 |

未知的 `preset` 值会被安全回退为 `none`，不会导致设置失效。

## 工作原理

```
┌──────────────────────── dsh web 进程 ───────────────────────────────┐
│  Node 半边（lib/index.js）                                           │
│   ├─ 注册 settings 命名空间 ui-background（schemastery schema）        │
│   ├─ GET  /dsh-ui-background/asset?path=…   图片读取路由               │
│   ├─ POST /dsh-ui-background/upload          图片上传路由               │
│   └─ POST /dsh-ui-background/bing            必应取图路由               │
│        └─ cn.bing.com 归档接口 → 下载图片 → 缓存到                       │
│           $DSH_HOME/ui-background/bing/（保留最近 8 张）                │
└─────────────────────────────────────────────────────────────────────┘
        │ settings.yaml（持久化）                │ /plugins/…（client.js）
        ▼                                        ▼
┌──────────────────── 浏览器半边（lib/client.js） ──────────────────────┐
│  设置行（settings.general.item）+ 悬浮按钮（shell.overlay）             │
│  背景层：position:fixed; z-index:-1 铺满视口                           │
│  面板底色：color-mix 45% 同色系半透明底衬（浅/深自动）                   │
└─────────────────────────────────────────────────────────────────────┘
```

- 背景层位于 AppFrame 之下、内容之上（负 z-index + `pointer-events: none`），不拦截任何交互
- 面板底色以 `color-mix` 降为 45% 同色系半透明底衬：背景透出可见，文字对比度保持
- 上传与读取共用同一扩展名白名单与大小上限，保证能上传的图一定能被读取
- 必应壁纸与上传图片**共用同一条渲染通路**：浏览器只认 `imagePath`，图片一律经 asset 路由按已落盘设置授权后读出（因此取图成功后先持久化再发布）
- 取图只在两种时机发生：点击「获取今日壁纸/换一张」，或开启自动更新后进入界面时对齐今日；命中本地缓存即零下载

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
图片读取 / 上传 / 必应取图路由都属于 Node 半边（`lib/index.js`），需重启 `dsh web`。典型症状：点「获取今日壁纸」立即失败，浏览器控制台里该请求是 **405**（DSH 静态兜底对未注册路径的非 GET 请求回 405）。重启后可先用一条命令自检（期望 `400`，表示路由在且正确拒绝了非法请求）：

```sh
curl -s -o /dev/null -w "%{http_code}" -X POST -H "content-type: application/json" -d "not-json" http://127.0.0.1:3080/dsh-ui-background/bing
```

**点「获取今日壁纸」提示获取失败**
按可能性依次排查：① 未重启 `dsh web`（见上一条）；② 这台机器访问不到 `cn.bing.com`（代理/防火墙）；③ 必应接口临时异常（会沿用 10 分钟内的归档快照与已缓存图片）。失败**不会**清空你当前的背景，可稍后点「换一张」重试。

**必应壁纸会一直联网吗**
不会。只在点击「获取今日壁纸 / 换一张」时请求，以及开启「每日自动更新」后进入界面时对齐今日一次；命中本地缓存（`$DSH_HOME/ui-background/bing/`，保留最近 8 张）就不下载。取图请求由 **Node 半边**发起，浏览器不直连必应。

**必应壁纸的版权**
壁纸版权归原作者与必应所有（设置行会显示标题与日期，接口也返回版权信息）。本插件仅将其作为个人桌面/GUI 背景使用，请勿用于再分发或商业用途。

**4K（UHD）开关打开了但还是 1920×1080**
必应归档中部分日期没有 4K 版本，此时会自动回落 1080p（不影响使用）。切换地区或 4K 开关时会立即按新设置重取一张。

**提示「上传失败：文件格式或大小不符合要求」**
扩展名须为 `png / jpg / jpeg / gif / webp / avif` 且 ≤ 50 MiB。

**动态流光/粒子不显示**
特效随「背景激活」生效：先选择一个背景（预设或上传图），再开启特效；系统开启「减少动态效果」时特效也会自动停。

**特效会耗资源吗**
流光/粒子仅在开启且有背景时运行 `requestAnimationFrame`，粒子数按视口面积自适应（封顶 160）、DPR 封顶 2；全部关闭即零开销。

## 开发

```sh
pnpm install     # 安装依赖（@deepseek-ai/* 以 link: 指向本机 DSH 检出）
pnpm run build   # tsc 声明 + tsdown 双半边产物
pnpm test        # vitest（138 用例：schema/预设/运行时/DOM/组件/特效/必应取图/路由端到端）
pnpm run typecheck
```

> 说明：Windows 上 vitest 启动时 vite 会调用 `net use` 探测网络驱动器，若被环境沙箱拦截，请在更宽权限下运行测试。

目录结构见下节。新增 / 修改逻辑后请先 `pnpm test` 再 `pnpm run build`。

## 目录结构

```
dsh-ui-background/
├── src/
│   ├── index.ts                 # Node 半边：schema 注册 + asset/upload/bing 路由
│   ├── background-settings.ts   # 共享常量/类型（命名空间、边界、白名单）
│   ├── background-schema.ts     # schemastery 设置 schema
│   ├── request-body.ts          # 带大小上限的请求体读取（上传/必应共用）
│   ├── asset-route.ts           # 图片读取路由（按设置授权）
│   ├── upload-route.ts          # 图片上传路由（落盘 $DSH_HOME/ui-background/）
│   ├── bing-service.ts          # 必应归档解析、下载、缓存与清理（纯逻辑，注入 fetch）
│   ├── bing-route.ts            # 必应取图路由（参数校验 + 错误收敛）
│   └── client/
│       ├── index.ts             # 浏览器半边 apply：装配 UI 入口与取图回调
│       ├── background-runtime.ts  # 状态运行时（写操作/持久化/快照）
│       ├── background-presenter.ts # 背景层 DOM 呈现器
│       ├── background-store.ts   # UI 共享 store
│       ├── background.css        # 全局背景样式（浅/深底衬）
│       ├── BackgroundRow.tsx     # 设置「背景」行
│       ├── BingControls.tsx      # 必应壁纸区块（取图按钮/地区/4K/自动更新）
│       ├── BackgroundQuickToggle.tsx # 悬浮一键切换按钮
│       ├── bing.ts               # 客户端取图封装（请求 + 响应校验）
│       ├── upload.ts             # 客户端上传与图片尺寸读取
│       ├── suggest-fill.ts       # 比例格式化（formatAspect）
│       ├── presets.ts            # 内置预设表与循环切换
│       ├── locales.ts            # 中英文案
│       └── styles.ts             # 全局样式生命周期
├── tests/                        # vitest 用例（含路由端到端；support/ 为共用夹具）
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