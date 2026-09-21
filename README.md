# QQ Agent Mac

![平台](https://img.shields.io/badge/platform-macOS%20Apple%20Silicon-lightgrey)
![阶段](https://img.shields.io/badge/status-Phase%201-yellow)
![协议](https://img.shields.io/badge/protocol-OneBot%20v11-blue)
![许可](https://img.shields.io/badge/license-MIT-green)

QQ Agent Mac 是对 [K0nd1us/QQ-agent](https://github.com/K0nd1us/QQ-agent) 进行的 macOS 本机移植。

本仓库计划在 Apple Silicon Mac 上运行 QQ Agent 的 Electron 控制台和机器人核心，并通过**独立安装的 NapCat**连接 macOS QQ。QQ Agent 与 NapCat 之间使用 OneBot v11 正向 WebSocket 接收事件、使用 HTTP API 调用动作；模型侧继续兼容 OpenAI 风格的 API。

> 当前仓库处于第一阶段：已完成移植设计和基础代码改造，尚未完成真实 QQ 登录、消息收发、完整测试、应用构建、签名或发布验收。本文不会把“已有代码”表述成“已经实机验证可用”。

## 当前进度

状态更新于 2026-09-21。

| 项目 | 状态 | 说明 |
|---|---|---|
| macOS 移植方案 | 已完成 | 已确定 Electron + 独立 NapCat + OneBot v11 的实现路线 |
| macOS 连接管理基础代码 | 已完成 | 已增加 QQ/NapCat 路径探测、状态读取、启停确认、WebUI 打开和 OneBot 配置候选读取 |
| “QQ 连接”控制界面 | 已完成 | 已替换原 Windows SnowLuma 控制入口，展示 QQ、NapCat、登录和 OneBot 状态 |
| 外部 OneBot 模式 | 已保留 | 可填写自定义 WebSocket、HTTP 地址和访问令牌 |
| Apple Silicon 构建配置 | 已写入 | 提供 arm64 `.app`、DMG 和 ZIP 构建命令，但本阶段未执行构建 |
| NapCat 本机安装 | 未执行 | 本仓库不自动安装、不注入 NapCat，也不修改 `QQ.app` |
| QQ 登录与真实消息链路 | 未验证 | 留待第二阶段使用真实账号和 NapCat 配置联调 |
| 移植后的完整测试 | 未执行 | 上游测试脚本仍在，但不能据此声称当前移植版测试通过 |
| 签名、公证和正式分发 | 未实施 | 当前构建配置默认无签名，仅面向本机开发 |

详细设计见 [第一阶段设计](docs/PHASE1_DESIGN.md)，部署边界和后续联调步骤见 [macOS 部署说明](docs/MACOS_DEPLOYMENT.md)。

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

## 第一阶段的移植改动

本仓库相对上游基线主要完成了以下改动：

- 新增 `src/connector-manager.js`，负责 macOS QQ/NapCat 状态、路径、启停和 OneBot 配置候选管理。
- 在 `src/app.js` 中用通用连接管理器替代 Windows SnowLuma 进程控制，并增加 `/api/connector/*` 接口。
- 在 `src/config.js` 中增加 `napcat-macos` 与 `external-onebot` 两种连接方式，同时保留旧配置迁移逻辑。
- 将界面中的 SnowLuma 页面改为“QQ 连接”，增加 NapCat、QQ、WebUI 和 OneBot 状态及操作入口。
- 调整 Electron 的 macOS 数据目录、托盘图标、硬件加速和启动行为。
- 增加 Apple Silicon 的本机构建配置，以及第一阶段设计和 macOS 部署文档。

## 继承的上游能力

以下能力来自直接上游 `K0nd1us/QQ-agent`，相关代码仍保留在本仓库中，但**尚未针对本次 macOS 移植完成回归验证**：

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

## 开发运行

以下命令是仓库中已经配置的开发入口，不代表本阶段已经完成运行验收：

```bash
npm install
npm start
```

其他脚本：

```bash
npm run server      # Headless 服务，默认访问 http://127.0.0.1:3210
npm test            # 运行上游保留的测试集合
npm run pack:mac    # 构建未签名的 arm64 .app
npm run dist:mac    # 构建未签名的 arm64 DMG 和 ZIP
```

第一次真实联调还需要用户通过 [NapCat-Mac-Installer](https://github.com/NapNeko/NapCat-Mac-Installer) 安装 NapCat、切换 QQ 入口，并在 NapCat WebUI 中启用 OneBot v11 WebSocket 和 HTTP 服务。

## 源码来源与归属

本仓库的来源关系如下：

1. **直接代码上游**：[K0nd1us/QQ-agent](https://github.com/K0nd1us/QQ-agent)，本次移植以提交 [`72f537f`](https://github.com/K0nd1us/QQ-agent/commit/72f537f947143e2e153597542cb849cbed777771) 为基线。
2. **上游标注的历史来源**：[Derpyu520/qq-bridge](https://github.com/Derpyu520/qq-bridge)。该项目是 `K0nd1us/QQ-agent` README 中说明的改造起点；本次 macOS 移植并非直接从该仓库开始。
3. **macOS 协议端参考**：[NapNeko/NapCat-Mac-Installer](https://github.com/NapNeko/NapCat-Mac-Installer)，第一阶段按 v1.6 / 提交 [`b4fd38f`](https://github.com/NapNeko/NapCat-Mac-Installer/commit/b4fd38faa7cccea1ce0be141cb26925c8f5f6338) 的目录和启动方式设计。NapCat 及其安装器是独立项目，不随本仓库分发。
4. **QQ 客户端**：由腾讯提供，是独立的闭源软件，不属于本仓库，也不受本仓库许可覆盖。

上游版本检查记录见 [UPSTREAM_CHECK.md](UPSTREAM_CHECK.md)。移植代码沿用仓库现有 MIT 许可证和版权声明，详见 [LICENSE](LICENSE)。使用本项目时还应分别遵守 QQ、NapCat 及其他第三方依赖的许可和使用规则。

---

## 重要：Codex 移植开发声明

> **本仓库当前的 macOS 第一阶段移植设计、基础代码改造、文档整理和 Git 提交由 OpenAI Codex 协助完成。**
>
> Codex 的工作建立在上述开源项目和原作者成果之上，不改变原项目的作者归属、版权声明或第三方许可。当前内容仍处于开发阶段，实际运行效果应以之后的人工联调、测试和验收结果为准。
