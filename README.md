# **目前已经实现的核心能力**

## **1. 通过 NapCat / OneBot 接管 macOS QQ 的消息收发，让当前账号作为 QQ 机器人运行**

## **2. 使用 `#meme` 命令在本地制作并直接发送表情包，无需调用大模型**

<p align="right">
  <strong>简体中文</strong> | <a href="README_EN.md">English</a>
</p>

# QQ Agent Mac

![平台](https://img.shields.io/badge/platform-macOS%20Apple%20Silicon-lightgrey)
![阶段](https://img.shields.io/badge/release-v0.3.0--macos.1-blue)
![协议](https://img.shields.io/badge/protocol-OneBot%20v11-blue)
![许可](https://img.shields.io/badge/license-MIT-green)

QQ Agent Mac 是对 [K0nd1us/QQ-agent](https://github.com/K0nd1us/QQ-agent) 进行的 macOS 本机移植。

本仓库已在 Apple Silicon Mac 上运行 QQ Agent 的 Electron 控制台和机器人核心，并通过**独立安装的 NapCat**连接 macOS QQ。QQ Agent 与 NapCat 之间使用 OneBot v11 正向 WebSocket 接收事件、使用 HTTP API 调用动作；模型侧继续兼容 OpenAI 风格的 API。

> `v0.3.0-macos.1` 是 macOS Apple Silicon（arm64）发布版本，已在 [GitHub Releases](https://github.com/liuycr-bit/mac_qq_bot/releases/tag/v0.3.0-macos.1) 提供 DMG 和 ZIP。OneBot 连接、模型调用、真实 QQ 消息收发、自定义人设和图片获取已完成人工联调；完整自动化回归、多机器兼容验证、Apple 签名和公证尚未完成。

## 当前进度

状态更新于 2026-09-22。

| 项目 | 状态 | 说明 |
|---|---|---|
| macOS 移植方案 | 已完成 | 已确定 Electron + 独立 NapCat + OneBot v11 的实现路线 |
| macOS 连接管理基础代码 | 已完成 | 已增加 QQ/NapCat 路径探测、状态读取、启停确认、WebUI 打开和 OneBot 配置候选读取 |
| “QQ 连接”控制界面 | 已完成 | 已替换原 Windows SnowLuma 控制入口，展示 QQ、NapCat、登录和 OneBot 状态 |
| 部署体检 | 已完成 | 只读检查 QQ、NapCat、加载器、入口、配置和 OneBot 双端口，并提示下一步 |
| 本地隐私边界 | 已完成 | 上游遥测、更新检查和社区上传在本机移植版中默认关闭 |
| 外部 OneBot 模式 | 已保留 | 可填写自定义 WebSocket、HTTP 地址和访问令牌 |
| Apple Silicon 发布包 | 已发布 | 已发布 arm64 DMG 和 ZIP，版本为 [`v0.3.0-macos.1`](https://github.com/liuycr-bit/mac_qq_bot/releases/tag/v0.3.0-macos.1) |
| NapCat 本机安装 | 已完成 | 已通过官方 Mac 安装器安装 NapCat 4.18.28，并将 QQ 入口切换为 NapCat |
| QQ 登录与协议连接 | 已完成 | QQ 已登录；WebSocket 3001、HTTP 3000 可达；QQ Agent 已读取登录信息 |
| 模型 API 调用 | 已完成 | DeepSeek 模型请求已在本机通过，Clash Fake-IP 环境下可自动回退到真实 DNS 解析 |
| 真实消息收发 | 已完成 | 用户已在真实 QQ 环境完成人工联调并确认收发和机器人响应正常 |
| 自定义人设 | 已完成 | 新增本地人设可被选择并在运行时生效；本地测试角色卡不提交到仓库 |
| 图片获取 | 已完成 | Fake-IP 环境下先解析真实公网地址，再执行原有内网地址安全拦截；本机人工测试正常 |
| 本地表情扩展 | 已完成 | `#meme` 独立路由、Worker 隔离、QQ 头像/消息图片输入和 733 个固定版本模板已在本机启用 |
| macOS 权限受限适配 | 已完成 | QQ 沙盒目录不可读时不再误报未安装，可使用手动令牌完成本机连接 |
| 移植后的完整测试 | 未执行 | 上游测试脚本仍在，但不能据此声称当前移植版测试通过 |
| Apple 签名和公证 | 未实施 | 当前发布包未签名、未公证，首次打开可能需要右键选择“打开” |

详细设计见 [第一阶段设计](docs/PHASE1_DESIGN.md)，部署边界和后续联调步骤见 [macOS 部署说明](docs/MACOS_DEPLOYMENT.md)，表情能力的来源、安装和完整命令见 [本地表情生成扩展](docs/MEME_EXTENSION.md)。

## 架构

```text
macOS QQ.app + NapCat
          │
          │ OneBot v11
          │ WebSocket 事件 / HTTP 动作
          ▼
QQ Agent Mac
├── ConnectorManager：QQ/NapCat 探测、启停、配置同步、WebUI
├── OneBotClient：消息接收与动作调用
├── MemeGenerator：#meme 独立路由、头像/图片输入与 Worker 原生生成
├── Orchestrator：会话编排与工具调用
├── Store / Memory：本地消息存档与长期记忆
└── Electron + Web UI：本机图形控制台
          │
          │ OpenAI-compatible API
          ▼
模型提供商、中转服务或本地模型网关
```

### 设计边界

- **协议端独立部署**：NapCat 不进入本仓库的安装包，由其官方 Mac 安装器负责安装、更新、卸载和 QQ 入口切换。
- **不静默关闭 QQ**：普通 QQ 正在运行而 OneBot 未就绪时，界面应先要求用户确认，再重新启动 QQ。
- **退出应用不退出 QQ**：关闭 QQ Agent 不会连带终止 QQ/NapCat。
- **模型供应商不锁定**：保留 OpenAI 兼容接口，不把 NapCat 与特定模型厂商绑定。
- **敏感数据不入库**：真实 API Key、QQ 登录态、聊天存档和长期记忆不得提交到 Git。
- **外部服务默认关闭**：原上游遥测、更新检查、意见和金句上传不会在本机版中自动访问，只有用户在设置中明确开启后才启用。

## 当前移植改动

本仓库相对上游基线主要完成了以下改动：

- 新增 `src/connector-manager.js`，负责 macOS QQ/NapCat 状态、路径、启停和 OneBot 配置候选管理。
- 在 `src/app.js` 中用通用连接管理器替代 Windows SnowLuma 进程控制，并增加 `/api/connector/*` 接口。
- 在 `src/config.js` 中增加 `napcat-macos` 与 `external-onebot` 两种连接方式，同时保留旧配置迁移逻辑。
- 将界面中的 SnowLuma 页面改为“QQ 连接”，增加 NapCat、QQ、WebUI 和 OneBot 状态及操作入口。
- 调整 Electron 的 macOS 数据目录、托盘图标、硬件加速和启动行为。
- 增加 Apple Silicon 的本机构建配置，以及第一阶段设计和 macOS 部署文档。
- 增加只读的本机联调体检，并将非必要的上游在线服务改为默认关闭。
- 适配 macOS App 数据保护：区分目录不存在与读取受限，并允许用 QQ 入口和 OneBot 双端口作为运行证据。
- 修正 QQ 进程检测可能出现无效 PID `0` 的问题。
- 增加 `#meme` 确定性表情命令路由：命令不进入大模型，原生生成在独立 Worker 中运行，结果继续复用 OneBot 发送队列和限频。
- 增加 `meme-emoji` 与官方 `meme-generator-contrib-rs` 额外模板库；固定版本在本机共加载 733 个模板，第三方程序和资源只写入应用数据目录。

## 继承的上游能力

以下能力来自直接上游 `K0nd1us/QQ-agent`。其中模型调用、OneBot 连接、真实 QQ 消息收发、自定义人设和图片获取的核心路径已完成人工联调；其余能力仍未针对本次 macOS 移植完成完整自动化回归：

- 群聊、私聊消息接入和响应策略。
- OpenAI 兼容模型配置、模型目录与成本记录。
- 人设、上下文编排、长期记忆和本地消息存档。
- 图片理解、联网搜索、表情包和 OneBot 工具调用。
- 白名单、屏蔽名单、用量统计和图形控制台。
- Electron 托盘运行、Headless 服务模式及上游测试脚本。

具体行为应以当前源码和后续实机联调结果为准。

## 环境与目录

- 运行平台：macOS，当前优先支持 Apple Silicon（arm64）。
- Node.js：`>= 20`。
- QQ 默认路径：`/Applications/QQ.app`。
- NapCat 程序默认路径：`~/Library/Containers/com.tencent.qq/Data/Documents/napcat`。
- NapCat 数据默认路径：`~/Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ/NapCat`。
- OneBot 默认地址：WebSocket `ws://127.0.0.1:3001`，HTTP `http://127.0.0.1:3000`。
- 开发数据：`runtime/data/`。
- 打包版数据：`~/Library/Application Support/QQ Agent Mac/data/`。
- 构建输出：`release/`。

路径和协议地址可以在“设置 → QQ / OneBot（NapCat）”中修改。

## 本机安装与配置

以下流程来自 2026-09-21 的实际安装和联调，不是仅根据源码推测。当前走通的环境为 Apple Silicon Mac、QQ `6.9.99-51802`、NapCat `4.18.28`、NapCat Mac Installer `v1.6`、Node.js `24.19.0` 和 npm `12.0.2`。其他版本可能出现界面或目录差异。

### 1. 安装 macOS QQ

1. 安装 QQ，并确认应用位于 `/Applications/QQ.app`。
2. 正常启动一次 QQ 后退出，避免安装器修改程序入口时 QQ 仍在运行。
3. 不要手工删除或覆盖 `QQ.app` 内的文件，入口切换和恢复统一交给 NapCat Mac Installer。

### 2. 安装 NapCat 并切换 QQ 入口

1. 从 [NapCat-Mac-Installer](https://github.com/NapNeko/NapCat-Mac-Installer) 获取 macOS 安装器。本次联调使用 `v1.6` 的 Apple Silicon 安装包。
2. 打开安装器并执行 NapCat 安装。当前安装结果位于：

   ```text
   ~/Library/Containers/com.tencent.qq/Data/Documents/napcat
   ```

3. 如果安装器提示无法写入 QQ 容器目录，在“系统设置 → 隐私与安全性”中为 **NapCat 安装器**开启：

   - App 管理；
   - 完全磁盘访问权限。

   授权后退出并重新打开安装器，再重新执行安装。无需关闭 SIP，也不要使用来源不明的注入脚本。

4. 在安装器中把“程序入口”切换为 **NapCat**。系统要求管理员密码时，只在 macOS 自带的授权窗口中输入，不要把密码写进命令、配置文件或聊天记录。
5. 使用安装器的“使用终端打开”，或运行：

   ```bash
   '/Applications/QQ.app/Contents/MacOS/QQ' --no-sandbox
   ```

6. 在 QQ 窗口完成登录。终端日志出现 NapCat WebUI 地址后，说明协议端已经随 QQ 启动。

### 3. 配置 NapCat OneBot v11

1. 打开 `http://127.0.0.1:6099/webui`。首次进入需要使用 NapCat 启动日志或本机 `webui.json` 中的 WebUI 令牌；令牌不要提交到 Git，也不要发给其他人。
2. 进入“网络配置”，新建并启用 HTTP 服务器：

   | 项目 | 值 |
   |---|---|
   | 名称 | `QQ Agent HTTP` |
   | Host | `127.0.0.1` |
   | Port | `3000` |
   | 消息格式 | `Array` |
   | CORS | 关闭 |
   | 启用 WebSocket | 关闭 |
   | Token | 使用随机强令牌 |

3. 新建并启用 WebSocket 服务器：

   | 项目 | 值 |
   |---|---|
   | 名称 | `QQ Agent WebSocket` |
   | Host | `127.0.0.1` |
   | Port | `3001` |
   | 消息格式 | `Array` |
   | 上报自身消息 | 关闭 |
   | 强制推送事件 | 开启 |
   | 心跳间隔 | `30000` 毫秒 |
   | Token | 使用随机强令牌 |

4. 保存后确认两张配置卡片均处于启用状态。服务只绑定 `127.0.0.1`，不要为了省事改成 `0.0.0.0` 对局域网开放。

### 4. 安装并启动 QQ Agent

在仓库目录执行：

```bash
npm install
npm start
```

当前 `package-lock.json` 记录的是 npmmirror 下载地址。npm 12 在“当前 registry 与锁文件来源不一致”时可能报 `EALLOWREMOTE`，此时使用与锁文件一致的镜像安装：

```bash
npm install --registry=https://registry.npmmirror.com
```

如果 Electron 安装脚本已执行但主程序下载失败，可使用同一镜像补充下载后再启动：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
  npm rebuild electron --registry=https://registry.npmmirror.com
npm start
```

npmmirror 是第三方镜像；有条件访问 npm 和 Electron 官方下载源时，可使用官方来源。项目仅允许 Electron 必需的安装脚本，Windows 打包依赖 `electron-winstaller` 的安装脚本在本机 macOS 开发中明确禁用。

### 5. 在 QQ Agent 中连接 NapCat

1. 打开“设置 → QQ / OneBot（NapCat）”。
2. 保持默认地址：

   - WebSocket：`ws://127.0.0.1:3001`
   - HTTP：`http://127.0.0.1:3000`

3. 分别填写 NapCat WebSocket 和 HTTP 配置中的 Token，然后保存。保存后 QQ Agent 会立即重连，无需重启 QQ。
4. 打开“QQ 连接”页面。出现“OneBot 已连接”并能显示当前 QQ 昵称，表示进程、端口、鉴权和登录信息链路已经打通。
5. macOS 可能允许 QQ Agent 连接本机端口，却阻止它读取 QQ 沙盒目录。此时页面会显示“目录读取受限”，但不会再误报 NapCat 未安装。手动保存两个 Token 即可正常连接；完全磁盘访问权限只影响自动识别，不是协议连接的必需条件。

如果同时使用 Clash Fake-IP，且 DeepSeek 报“TLS connection was established 前连接断开”，QQ Agent 会在发现 `api.deepseek.com` 被解析到 `198.18.0.0/15` 时，通过 DNSPod DoH 获取真实地址后重试。图片安全下载遇到 Fake-IP 时也会先获取真实地址，再继续执行原有的内网地址拦截。该过程只查询域名，不传输模型 Key、提示词、聊天内容或图片，HTTPS 仍按原域名校验证书。模型请求的回退可通过 `QQ_AGENT_REAL_DNS_FALLBACK=0` 关闭；也可用 `QQ_AGENT_DOH_URL` 为模型和图片解析指定自己的 DoH JSON 接口。

### 6. 模型和消息权限

OneBot 连接成功后，还需在 QQ Agent 中配置模型 API、模型和聊天白名单。白名单与自动响应策略确认前，不要开启全量聊天响应。

已验证模型连通、真实 QQ 消息收发、自定义人设生效和图片获取的核心流程。该验证不等同于完整自动化回归、多机器兼容验证、Apple 签名或公证。

### 7. 表情生成命令

先在项目根目录安装固定版本的生成器、扩展库和模板资源：

```bash
brew install rustup
npm run setup:meme
```

表情命令默认使用 `#meme` 前缀，并在消息入口直接处理，不会唤醒模型：

```text
#meme 摸头 @群友
#meme 摸头 123456789
#meme 举牌 "你好世界"
#meme 列表 摸头
#meme 状态
```

命令支持当前消息图片和引用消息图片。模板开关可由群主、群管理员或设置中指定的表情管理员通过 `#meme 禁用 <模板>`、`#meme 启用 <模板>` 管理。前缀、冷却、生成超时、模板禁用、资源检查和头像缓存位于“设置 → 聊天设置 → 表情生成命令”。资源与缓存写入开发版 `runtime/data/meme-generator/` 或打包版 Application Support 数据目录，不写入 `.app`。

生成引擎来自 [MemeCrafters/meme-generator-rs](https://github.com/MemeCrafters/meme-generator-rs)，额外模板来自 [anyliew/meme-emoji](https://github.com/anyliew/meme-emoji) 和 [MemeCrafters/meme-generator-contrib-rs](https://github.com/MemeCrafters/meme-generator-contrib-rs)。它们是独立第三方项目；版本、许可、内容边界、磁盘占用、打包版部署方法和故障排查见 [本地表情生成扩展](docs/MEME_EXTENSION.md)。

### 8. 恢复原版 QQ

需要停用 NapCat 时，先退出 QQ，再在 NapCat Mac Installer 中把程序入口切换回 **QQ**。确认原版 QQ 可以正常启动后，再决定是否卸载 NapCat 或撤销安装器权限。不要直接删除入口文件，否则可能导致 QQ 无法启动。

## 开发运行

以下命令是仓库中已经配置的开发和构建入口。人工联调不等于完整自动化测试、Apple 签名或公证：

```bash
npm install
brew install rustup # 编译固定版本的官方 contrib 表情扩展
npm run setup:meme # 安装/更新本地表情生成器与扩展资源
npm start
```

其他脚本：

```bash
npm run server      # Headless 服务，默认访问 http://127.0.0.1:3210
npm test            # 运行上游保留的测试集合
npm run pack:mac    # 构建未签名的 arm64 .app
npm run dist:mac    # 构建未签名的 arm64 DMG 和 ZIP
```

NapCat 需通过 [NapCat-Mac-Installer](https://github.com/NapNeko/NapCat-Mac-Installer) 独立安装并切换 QQ 入口，同时在 NapCat WebUI 中启用 OneBot v11 WebSocket 和 HTTP 服务。若 macOS 阻止 QQ Agent 读取 QQ 沙盒目录，可在设置中手动填写 OneBot 令牌；目录读取权限不影响已正确配置的协议连接。

### `.app` 打包版说明

1. `.app` 只包含 QQ Agent，QQ 和 NapCat 仍需独立安装。
2. 当前发布包未签名、未公证，首次打开可能需要右键选择“打开”。

## 源码来源与归属

本仓库的来源关系如下：

1. **直接代码上游**：[K0nd1us/QQ-agent](https://github.com/K0nd1us/QQ-agent)，本次移植以提交 [`72f537f`](https://github.com/K0nd1us/QQ-agent/commit/72f537f947143e2e153597542cb849cbed777771) 为基线。
2. **上游标注的历史来源**：[Derpyu520/qq-bridge](https://github.com/Derpyu520/qq-bridge)。该项目是 `K0nd1us/QQ-agent` README 中说明的改造起点；本次 macOS 移植并非直接从该仓库开始。
3. **macOS 协议端参考**：[NapNeko/NapCat-Mac-Installer](https://github.com/NapNeko/NapCat-Mac-Installer)，第一阶段按 v1.6 / 提交 [`b4fd38f`](https://github.com/NapNeko/NapCat-Mac-Installer/commit/b4fd38faa7cccea1ce0be141cb26925c8f5f6338) 的目录和启动方式设计。NapCat 及其安装器是独立项目，不随本仓库分发。
4. **QQ 客户端**：由腾讯提供，是独立的闭源软件，不属于本仓库，也不受本仓库许可覆盖。
5. **表情生成引擎**：[MemeCrafters/meme-generator-rs](https://github.com/MemeCrafters/meme-generator-rs)，本仓库固定使用 `v0.2.3`；其 CLI、Node 原生包、内置模板和资源是独立的 MIT 许可第三方内容。
6. **扩展模板库**：[anyliew/meme-emoji](https://github.com/anyliew/meme-emoji)，本仓库安装脚本固定使用 `v0.0.6+build.59`；代码仓库标注 MIT，图片素材权利与用途边界以该项目自己的说明为准。
7. **官方额外模板库**：[MemeCrafters/meme-generator-contrib-rs](https://github.com/MemeCrafters/meme-generator-contrib-rs)，固定使用提交 `5658321`；项目标注 MIT，并明确包含小众、实验性或可能引起不适的模板。
8. **方案参考**：[SodaSizzle/astrbot_plugin_meme_generator](https://github.com/SodaSizzle/astrbot_plugin_meme_generator)。本仓库的实现不依赖 AstrBot，也未把该插件源码复制进来。

上游版本检查记录见 [UPSTREAM_CHECK.md](UPSTREAM_CHECK.md)。移植代码沿用仓库现有 MIT 许可证和版权声明，详见 [LICENSE](LICENSE)。使用本项目时还应分别遵守 QQ、NapCat 及其他第三方依赖的许可和使用规则。

---

## 重要：Codex + GPT-5.6 Sol 移植开发声明

> **本项目的源码拉取、macOS 移植设计与开发、编译、构建、文档整理、Git 提交和 GitHub Release 发布等工作，均由 OpenAI Codex + GPT-5.6 Sol 在用户授权与配合下完成。**
>
> Codex + GPT-5.6 Sol 的工作建立在上述开源项目和原作者成果之上，不改变原项目的作者归属、版权声明或第三方许可。核心流程已完成人工联调并发布 arm64 版本；完整自动化测试、多机器兼容验证、签名和公证仍以之后的实际结果为准。

---

<p align="center">
  <a href="https://openai.com/codex/"><strong>本项目的源码拉取、macOS 移植设计与开发、编译、构建、文档整理、Git 提交和 GitHub Release 发布等工作，均由 OpenAI Codex + GPT-5.6 Sol 在用户授权与配合下完成。</strong></a>
</p>
