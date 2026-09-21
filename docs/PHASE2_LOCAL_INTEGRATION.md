# 第二阶段：macOS 本机联调准备

## 阶段目标

第二阶段将第一阶段的静态移植代码推进到真实 QQ/NapCat 联调。本机已完成 NapCat 安装、QQ 入口切换、真实账号登录、OneBot 双端口启用和 QQ Agent 登录信息读取；尚未发送测试消息，也未执行完整测试或安装包构建。

## 本次已实现

### 1. 只读联调体检

“QQ 连接”页面现在会检查：

- 当前运行平台与处理器架构。
- `QQ.app` 和 QQ 可执行文件。
- NapCat 程序、版本和加载器。
- QQ Electron 入口是否已经切换到 `loadNapCat.js`。
- 官方安装器是否保留了 `package.json.bak`。
- QQ/NapCat 进程状态。
- NapCat WebUI 和 OneBot 账号配置是否已生成。
- OneBot WebSocket 与 HTTP 两个端口是否可达。

体检接口为 `GET /api/connector/diagnose`。接口不会启动或停止 QQ，不会修改 `QQ.app`，不会读取或返回访问令牌。

### 2. 启动前保护

在原有 NapCat 程序和 QQ 入口检查之外，启动流程增加了加载器检查。若 `loadNapCat.js` 缺失，应用会停止启动并引导用户使用官方 Mac 安装器修复，避免在入口已修改但加载器缺失时直接拉起异常 QQ。

### 3. 本地隐私边界

直接上游包含匿名用量遥测、线上版本检查、意见上传和金句上传。这些能力会访问原作者的在线服务，并不是 QQ Agent 本机运行所必需的部分。

本机移植版新增 `externalServices` 配置，默认值全部为 `false`：

```json
{
  "externalServices": {
    "telemetryEnabled": false,
    "updateCheckEnabled": false,
    "communityEnabled": false
  }
}
```

用户可以在“设置 → 桌面端”中明确开启。不开启时，不启动遥测循环、不自动检查原上游版本，也不显示意见和金句上传入口。

配置保存接口现在返回脱敏后的配置，避免把 API Key 或 OneBot 令牌重新暴露给前端页面。

### 4. 真实本机联调结果

本机联调于 2026-09-21 完成以下步骤：

- 使用官方 NapCat Mac Installer v1.6 安装 NapCat 4.18.28。
- 将 QQ 6.9.99-51802 的程序入口切换为 NapCat，并成功启动、登录 QQ。
- 在 NapCat WebUI 启用 `127.0.0.1:3001` WebSocket 服务器与 `127.0.0.1:3000` HTTP 服务器。
- 启动 QQ Agent Electron 开发版，保存两端本机令牌后成功读取 OneBot 登录信息。
- 未发送群聊或私聊消息，因此这里只确认“进程、端口、鉴权、登录信息”链路，不宣称消息收发已经验收。

### 5. macOS App 数据保护适配

真实联调发现：未获得完全磁盘访问权限的 QQ Agent 可以正常连接本机 OneBot，但 macOS 会阻止它直接读取 QQ 沙盒目录。旧逻辑会因此误报“NapCat 未安装”，并把已经可用的协议端判为未就绪。

现已调整为：

- 明确区分“路径不存在”和 `EPERM` / `EACCES` 权限受限。
- 当 QQ 入口已切换且 WebSocket、HTTP 双端口均可达时，按运行证据确认 NapCat 已就绪，不再误报未安装。
- 权限受限时保留本机 WebUI 入口，并提示令牌自动识别不可用；用户可在 QQ Agent 设置中手动保存本机令牌。
- 修正 QQ 进程列表把空行解析成 PID `0` 的问题。

## 尚未执行

- 尚未发送 OneBot 测试消息，也未验证真实群聊/私聊的收消息与回复行为。
- 尚未配置模型 API、白名单和实际机器人响应策略。
- 尚未运行完整测试、构建 DMG/ZIP、签名或公证。

## 下一步

1. 配置模型 API 与聊天白名单。
2. 只读验证群列表和好友列表。
3. 经用户明确确认后，向指定测试会话发送测试消息。
4. 验证收消息、回复、断线重连和异常恢复。
5. 再执行完整测试与 Apple Silicon 安装包构建。
