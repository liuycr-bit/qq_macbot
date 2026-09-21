# 第二阶段：macOS 本机联调准备

## 阶段目标

第二阶段将第一阶段的静态移植代码推进到真实 QQ/NapCat 联调。为避免直接修改 QQ 后才发现路径、配置或端口问题，本阶段先加入只读体检与本地隐私边界，再进入 NapCat 安装和消息链路验证。

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

## 尚未执行

- 尚未安装 NapCat。
- 尚未修改 QQ 程序入口。
- 尚未登录真实 QQ 账号。
- 尚未执行 OneBot 消息收发联调。
- 尚未运行测试、构建 DMG/ZIP、签名或公证。

## 下一步

1. 使用官方 NapCat Mac Installer 安装 NapCat。
2. 由用户在安装器中授权并切换 QQ 入口。
3. 启动 QQ/NapCat，完成真实 QQ 登录。
4. 在 NapCat WebUI 启用 OneBot v11 WebSocket 和 HTTP 服务。
5. 使用“QQ 连接”页面确认体检必需项全部通过。
6. 再进行登录信息、群列表、收消息、发消息和异常恢复验证。
