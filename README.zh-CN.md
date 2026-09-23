<div align="center">

<img src="favicon.svg" width="72" height="72" alt="Luxel 标志">

# Luxel

**在浏览器里打开就能用的设计小工具。**
配色、压图、截图美化、做图表，设计里那些零碎的活，在这里一步做完。

[**在线体验 →**](https://swif-7.github.io/Luxel-design-studio/)

[![License: MIT](https://img.shields.io/badge/license-MIT-black.svg)](LICENSE)
[![Deploy](https://github.com/Swif-7/Luxel-design-studio/actions/workflows/pages.yml/badge.svg)](https://github.com/Swif-7/Luxel-design-studio/actions/workflows/pages.yml)
![Dependencies: 0](https://img.shields.io/badge/dependencies-0-black.svg)
![Languages](https://img.shields.io/badge/i18n-中文%20·%20EN%20·%20한국어%20·%20日本語%20·%20FR-black.svg)

[English](README.md) · 简体中文

</div>

---

## 简介

Luxel（*lux* 光 × *pixel* 像素）是一组设计工具，专做设计工作里零碎又重复的活：生成背景、整理配色规范、压缩素材、美化截图、把数据做成动画。

每个工具都是在浏览器里运行的静态页面。图片和数据只在你自己的设备上处理，不会发送到任何地方。不需要账号，没有后端，也不做任何统计追踪。

- **零依赖**：原生 ES 模块、WebGL 和 Canvas 2D。不用框架，不用打包工具，也不走 CDN。
- **隐私优先**：文件不离开浏览器，设置保存在本机的 `localStorage`。
- **五种界面语言**：简体中文、English、한국어、日本語、Français。自动识别，每一页都能切换。
- **浅色 / 深色双主题**，单色界面，手机宽度也能正常使用。

## 工具

| 工具 | 用途 | 导出 |
|---|---|---|
| [**Rheo**](https://swif-7.github.io/Luxel-design-studio/rheo.html) | 实时流动着色器工作台：按种子生成流动色带，支持景深、表面纹理、粒子和 ASCII 字符点阵 | PNG（最高 4K）· 10 秒 WebM 视频 · JSON 参数 · 独立 HTML |
| [**Rubric**](https://swif-7.github.io/Luxel-design-studio/rubric.html) | 用滑块整理浅深两套配色与字体，检查对比度，一键复制成可直接交给 agent 的 Markdown UI 规范 | Markdown 规范（剪贴板） |
| [**Recast**](https://swif-7.github.io/Luxel-design-studio/recast.html) | 批量压缩图片、转换格式、缩放尺寸，在 Web Worker 里编码 | WebP · JPEG · PNG · AVIF（视浏览器支持）· ZIP |
| [**Relief**](https://swif-7.github.io/Luxel-design-studio/relief.html) | 把截图放进好看的背景：裁切、圆角、浏览器 / 手机外框、阴影、画幅和 9 种文字排版 | PNG · JPG · 复制到剪贴板 |
| [**Rise**](https://swif-7.github.io/Luxel-design-studio/rise.html) | 粘贴数据，做成会动的图表：18 种图表、10 套风格，最多 7 组数据 | PNG · JPG · PNG 序列（可带透明）· MP4 或 WebM · 独立 HTML |
| **Roll** | 在线视频剪辑 | *开发中，不在本次发布范围内* |

<details>
<summary><b>Rheo</b>：详细功能</summary>

- 四类流动：潮汐铺展、交汇融流、双涡卷流、层流漫涌。支持 2–8 个色标，随机配色按 OKLCH 生成协调的颜色。
- 可调色彩流动、宽度、柔度、浓度、角度、速度、主体大小、X/Y 偏移、扭曲和折叠层次。
- 背景染色与扩散、色带景深、表面纹理（颗粒、像素、网点、抖色）和粒子层。
- ASCII 字符点阵：二进制、数字、英文、符号、中文、日文或自定义字符。
- 种子可复现：同一种子和锁定项会生成同样的参数。
- PNG 与视频按完整分辨率离线渲染。视频使用 WebCodecs VP9 或 VP8，WebM 封装是本项目自己写的。
- 独立 HTML 自带渲染代码、参数和许可证，不请求任何外部资源。

</details>

<details>
<summary><b>Rubric</b>：详细功能</summary>

- 单色或多色（2–6 个）强调色，提供对比色和同色阶推荐。
- 主体背景、卡片、边框：可用默认值、自定义，或按背景与主色推荐。
- 浅深两套可以联动，也可以分开编辑。深色由同一组参数生成，不是逐色反相。
- 正文、强调、标题、等宽四种字体用途，各自设置字重和字号，可按推荐比例联动。
- 按 WCAG 检查文字与非文本元素的对比度，并对色相过近、边缘振动、小字字重给出建议。
- 复制出的规范包含 CSS 自定义属性 token、对比度和实现规则，语言跟随当前界面。

</details>

<details>
<summary><b>Recast</b>：详细功能</summary>

- 拖入、选择或粘贴 JPG / PNG / WebP，单张或批量都可以。
- 可选输出格式、质量和最长边（800–3840 px，或保持原尺寸）。
- 编码在 Web Worker 里进行；输出比原图还大时会明确提示。
- 单张前后对比、逐个显示体积变化，打包成一个 ZIP 下载。

</details>

<details>
<summary><b>Relief</b>：详细功能</summary>

- 五步：裁切 → 背景 → 构图 → 文字 → 导出。
- 背景可以现场生成 Rheo 流动（随机颜色或样式），也可以导入 Rheo 画面、用纯色，或用自己的图片（可调模糊）。
- 浏览器与手机外框，阴影、圆角和大小可调，并提供常用画幅比例。
- 九种排版：标题居上、左文右图、底部说明、贴底露出、角标签、要点列表、引语、杂志大字等。

</details>

<details>
<summary><b>Rise</b>：详细功能</summary>

- 七步：数据 → 图表 → 风格 → 动效 → 背景 → 排版 → 导出。
- 胶囊行输入数据：可以整段粘贴 CSV 或制表符分隔的数据，自动识别千分位和小数点；任意一行都能设为横轴。
- 批量模式每组各出一张；合成模式把所有组放进一张图，不支持的图表类型会说明原因。
- 弹簧动效，提供多种缓动曲线和入场方式。
- 带透明通道的 PNG 序列可直接导入剪辑软件；独立 HTML 可嵌入网页，点击重播。

</details>

## 快速开始

直接使用在线版：**<https://swif-7.github.io/Luxel-design-studio/>**，或者在本地运行。

需要 Node.js 18 或以上，不用安装任何依赖：

```sh
git clone https://github.com/Swif-7/Luxel-design-studio.git
cd Luxel-design-studio
npm start
```

打开 <http://localhost:4173>。开发服务器只监听 `127.0.0.1`。换端口：

```sh
PORT=4174 npm start
```

站点是纯静态的，任何静态文件服务器都能托管。资源路径全部是相对路径，放在子路径下也能正常访问。

## 浏览器支持

支持 Chrome、Edge、Safari、Firefox 的最近两个版本。

| 功能 | 要求 |
|---|---|
| Rheo 渲染 | 开启硬件加速的 WebGL |
| 视频导出 | Rheo 使用 WebCodecs（Chromium 内核浏览器、较新的 Safari）；Rise 用 `MediaRecorder` 录制 MP4 或 WebM |
| AVIF 输出（Recast） | 浏览器能从画布编码 AVIF |
| 复制到剪贴板 | 安全上下文（HTTPS 或 `localhost`） |

浏览器不支持某项功能时，工具会直接提示，不会悄悄失败。

## 目录结构

```
.
├── index.html            # 首页：工具索引与实时缩略图
├── rheo.html · rubric.html · recast.html · relief.html · rise.html
├── tokens.css            # 共用设计 token（颜色、字体、圆角），含浅深两套
├── *.css                 # 每个页面一份样式
├── src/
│   ├── shader.js         # Rheo 的 WebGL 渲染与后处理
│   ├── model.js          # Rheo 参数、种子、校验与版本迁移
│   ├── export.js         # 独立 HTML 打包
│   ├── spec.js           # Rubric：主题生成、对比度、Markdown 规范（不碰 DOM）
│   ├── recast-*.js       # Recast：格式、编码 Worker、文件头检查
│   ├── relief-*.js       # Relief：排版计算与画布渲染
│   ├── rise-*.js         # Rise：数据解析、图表模型、绘制、合成
│   ├── i18n.js           # 翻译查找、句式匹配、字体回退
│   ├── i18n-dom.js       # 页面自动翻译与语言切换按钮
│   └── lang/             # 对照表：中文原句 → [en, ko, ja, fr]
├── fonts/                # 自托管 IBM Plex 字体（SIL OFL 1.1）
├── tests/                # node:test 测试，以及浏览器内的 GPU / 媒体检查页
└── server.mjs            # 白名单式本地开发服务器（只用 Node 内置模块）
```

## 开发

```sh
npm test
```

测试使用 Node 内置的测试运行器，覆盖参数模型、规范生成、数据解析、图表计算、编码工具、处理队列，以及**多语言完整性**：每一条中文界面文字都必须有四种译文，占位符也必须对得上。另有两个浏览器内检查页：

- `tests/render.html`：Rheo 的 GPU 渲染确定性与时间连续性。
- `tests/media.html`：导出 PNG 与 WebM 的实际尺寸和时长。

### 添加翻译

源码里的界面文字用中文书写，中文原句本身就是对照表的键。在 `src/lang/` 对应的文件里加一行：

```js
'复制规范': ['Copy spec', '스펙 복사', '仕様をコピー', 'Copier la spéc.'],
```

品牌名、工具名、文件格式和技术术语（HEX、CSV、token、WCAG、FPS、KB/MB）在所有语言里都保留英文。缺了译文，`npm test` 会报错。

## 部署

每次推送到 `main`，[`.github/workflows/pages.yml`](.github/workflows/pages.yml) 会先跑测试，再把运行所需的文件发布到 GitHub Pages。测试、文档和开发服务器不会发布出去。

## 开源范围

本仓库的代码以 **MIT 许可证**开源，范围是这里公开的全部内容：上面列出的五个工具、共用的设计系统和多语言层。

Luxel 仍在持续开发。**后续的工具和功能（包括 Roll，以及尚未公开的模块）不一定开源**，可能采用其他许可，或者保持闭源。MIT 许可只适用于本仓库中已公开的代码，不涉及任何未在此发布的内容。

## 参与贡献

欢迎提交 Issue 和 Pull Request：

- 提交 PR 前请先运行 `npm test`。
- 请保持零依赖。如果要引入依赖或构建步骤，请先开 Issue 讨论。
- 新增界面文字需要在 `src/lang/` 里补齐四种语言。
- 代码风格与周围保持一致：原生 ES 模块、函数短小，逻辑不直观的地方写注释。

## 联系我们

邮箱：**[Mindshell@126.com](mailto:Mindshell@126.com)**。也可以点首页的「联系我们」，邮箱会自动复制到剪贴板。

## 许可

[MIT](LICENSE) © 2026 Swif-7 and Luxel contributors.

IBM Plex 字体版权归 IBM Corp. 所有，采用 [SIL Open Font License 1.1](fonts/LICENSE.txt)。字体随仓库分发，但不属于 MIT 许可的范围。
