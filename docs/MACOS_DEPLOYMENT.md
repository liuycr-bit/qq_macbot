# QQ Agent Mac 本机部署说明

## 架构边界

QQ Agent Mac 只包含机器人核心、模型调用、存档/记忆和图形控制台。QQ 协议由独立运行的 NapCat 提供：

```text
QQ.app + NapCat → OneBot v11 WebSocket/HTTP → QQ Agent Mac → OpenAI 兼容模型
```

应用不会下载或注入 NapCat，不会修改 `/Applications/QQ.app`，也不会请求管理员密码。安装、更新、卸载和 QQ 入口切换均交给 NapCat 官方 Mac 安装器。

## 本机默认路径

- QQ：`/Applications/QQ.app`
- NapCat 程序：`~/Library/Containers/com.tencent.qq/Data/Documents/napcat`
- NapCat 数据：`~/Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ/NapCat`
- NapCat 配置：`~/Library/Containers/com.tencent.qq/Data/.config/QQ/NapCat`
- OneBot WebSocket：`ws://127.0.0.1:3001`
- OneBot HTTP：`http://127.0.0.1:3000`
- NapCat WebUI：从 `config/webui.json` 自动识别

以上路径均可在“设置 → QQ / OneBot（NapCat）”中修改。

## 首次部署

1. 安装并登录 macOS QQ。
2. 从 <https://github.com/NapNeko/NapCat-Mac-Installer> 获取官方安装器。
3. 在安装器中安装 NapCat，并执行“修改 QQ”。这一步可能需要在“系统设置 → 隐私与安全性 → App 管理”中授权安装器。
4. 在项目目录执行 `npm install` 和 `npm start`。
5. 打开“QQ 连接”，点击“启动 NapCat”。应用通过官方要求的 `QQ --no-sandbox` 方式启动。
6. 在 NapCat WebUI 中启用 OneBot v11 WebSocket 服务器和 HTTP 服务器。默认端口分别为 3001、3000。
7. 回到 QQ Agent，点“重新连接 OneBot”。连接成功后会显示 QQ 昵称与账号。
8. 配置 OpenAI 兼容模型、聊天白名单，再开始使用。

## 启停行为

- 启动：若普通 QQ 正在运行，界面会先询问是否退出并以 NapCat 模式重启；不会静默关闭 QQ。
- 停止：只关闭由 QQ Agent 启动的进程；若 QQ 是外部启动的，会再次确认。
- 退出 QQ Agent：不会连带退出 QQ/NapCat，避免中断正常 QQ 会话。
- 外部 OneBot：把连接方式切换为“外部 OneBot”，填写 WS/HTTP 地址即可；启动/停止由外部协议端负责。

## 数据与构建

- 开发模式数据：`runtime/data/`
- 本机构建目录：`release/`
- 打包版运行数据：`~/Library/Application Support/QQ Agent Mac/data/`
- `npm run pack:mac`：生成 arm64 `.app`
- `npm run dist:mac`：生成 arm64 DMG 和 ZIP

默认构建未签名，只适合本机开发或受控内部分发。公开分发需要 Apple Developer ID 签名与公证。

