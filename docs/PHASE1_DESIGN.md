# 第一阶段设计：QQ Agent macOS 本机移植

## 1. 阶段目标

第一阶段完成 macOS 本机版的技术路线固化和基础改造，使原 Windows 项目具备以下能力：

1. 在 Apple Silicon Mac 上运行 Electron 控制台和机器人核心。
2. 使用独立安装的 NapCat 作为 QQ 协议端，通过 OneBot v11 正向 WebSocket 收消息、HTTP 发消息。
3. 在应用内查看 QQ、NapCat、OneBot 和登录状态。
4. 在用户确认后启动或停止 QQ/NapCat，并能打开 NapCat WebUI。
5. 保留外部 OneBot 模式，不把模型接口绑定到单一厂商。
6. 提供 arm64 `.app`、DMG 和 ZIP 的本机构建入口。

第一阶段不负责自动安装 NapCat、不修改 QQ.app、不处理 Apple Developer ID 签名和公证，也不写入真实 QQ 账号或模型密钥。

## 2. 已确认的本机基线

- 架构：Apple Silicon（arm64）
- QQ：`/Applications/QQ.app`
- Node.js：24.x
- 包管理：npm 11.x
- 原始工程：`K0nd1us/QQ-agent`
- 原始工程基线提交：`72f537f947143e2e153597542cb849cbed777771`
- NapCat Mac 安装路线：`NapNeko/NapCat-Mac-Installer` v1.6 / `b4fd38faa7cccea1ce0be141cb26925c8f5f6338`

## 3. 总体架构

```text
┌──────────────────────┐
│ macOS QQ.app         │
│ + NapCat             │
└──────────┬───────────┘
           │ OneBot v11
           │ WS 3001 / HTTP 3000
┌──────────▼───────────┐
│ QQ Agent Mac         │
│                      │
│ ConnectorManager     │  启停、探测、WebUI、配置同步
│ OneBotClient         │  消息接收与动作调用
│ Orchestrator         │  会话编排与工具调用
│ Store / Memory       │  本地存档与长期记忆
│ Electron + Web UI    │  本机控制台
└──────────┬───────────┘
           │ OpenAI-compatible API
┌──────────▼───────────┐
│ 任意模型提供商       │
└──────────────────────┘
```

## 4. 关键设计决策

### 4.1 协议端独立部署

NapCat 不进入 QQ Agent 安装包。安装、注入、更新和卸载均由官方 Mac 安装器负责。QQ Agent 只读取官方目录结构并进行运行期控制，从而降低 QQ/NapCat 升级导致整个应用重新打包的风险。

### 4.2 不静默退出 QQ

普通 QQ 已在运行而 OneBot 未就绪时，启动操作返回 `QQ_RESTART_REQUIRED`。界面必须再次询问，用户确认后才退出 QQ 并以 `--no-sandbox` 参数重新启动。

停止外部启动的 QQ 时也采用二次确认。退出 QQ Agent 本身不会连带退出 QQ/NapCat。

### 4.3 OneBot 配置自动识别

连接管理器按以下顺序收集候选配置：

1. QQ Agent 设置页显式填写的地址和令牌。
2. NapCat 程序、数据和配置目录中的 `onebot11_<账号>.json`。
3. 兼容旧版 `onebot_<账号>.json` 与 `networks` 配置结构。

遇到 401 时重新读取磁盘并轮换候选，适配首次登录后配置才落盘和多账号场景。

### 4.4 本地数据边界

- 开发模式：`runtime/data/`
- 打包版：`~/Library/Application Support/QQ Agent Mac/data/`
- 构建输出：`release/`
- 开发中间资料：项目外层 `/Users/***/Desktop/qqbot/work/`

任何真实 API Key、QQ 登录态、聊天存档和记忆均不得提交到 Git。

### 4.5 模型接口保持开放

继续使用现有 OpenAI 兼容提供商目录，支持官方 API、中转站和本地网关。NapCat 只承担 QQ 协议，不与模型供应商耦合。

## 5. 模块改造

### `src/connector-manager.js`

- 识别 QQ.app、NapCat 程序/数据/配置目录。
- 识别 NapCat 版本和 QQ 入口是否已切换。
- 检查 QQ 进程与 OneBot 端口。
- 启动、停止、重新连接。
- 读取 WebUI 地址与令牌并交给系统浏览器打开。
- 收集 OneBot 地址/令牌候选。
- 维护最近 500 行连接管理日志并通过 SSE 推送。

### `src/app.js`

- 由 `ConnectorManager` 替代 Windows SnowLuma 进程控制。
- 新增 `/api/connector/*` 接口。
- 保留旧 `/api/snowluma/*` 路径作为迁移期兼容别名。
- 保存连接设置后立即重连 OneBot。

### `src/config.js`

- 新增 `connector` 配置段。
- 默认采用 `napcat-macos`。
- 旧 `snowluma` 配置仅迁移 OneBot 地址和令牌，迁移后使用外部模式。

### Electron 与界面

- macOS 保留硬件加速，Windows 才使用旧的禁用策略。
- 开发数据改到 `runtime/data/`，打包版使用 Application Support。
- 托盘图标适配 macOS 尺寸。
- “SnowLuma”页改为“QQ 连接”，集中展示安装、入口、进程、登录、OneBot 和 WebUI 状态。
- 设置页新增 NapCat 路径、连接模式和即时重连能力。

## 6. 第一阶段交付物

- macOS 连接管理基础实现。
- QQ 连接与登录状态 UI。
- 外部 OneBot 兜底模式。
- arm64 本机构建脚本与 electron-builder 配置。
- macOS 部署说明。
- 上游版本检查记录。

## 7. 后续阶段

### 第二阶段：本机联调

- 已增加只读的本机联调体检和本地隐私边界，详见 [第二阶段本机联调准备](PHASE2_LOCAL_INTEGRATION.md)。
- 由用户通过官方安装器安装 NapCat 并切换 QQ 入口。
- 配置 OneBot 正向 WebSocket/HTTP。
- 完成首次 QQ 登录和真实消息链路联调。
- 根据真实 NapCat 配置文件补充兼容分支。

### 第三阶段：本机常驻与发布

- 生成 arm64 应用包。
- 配置登录启动、睡眠恢复和异常重连。
- 如需交付其他 Mac，补充 Developer ID 签名、公证和升级策略。
