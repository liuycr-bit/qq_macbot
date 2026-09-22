# 本地表情生成扩展

QQ Agent Mac 内置了一条独立于大模型的表情命令链路：

```text
QQ / NapCat
    ↓ OneBot v11 消息
QQ Agent 消息入口
    ├─ #meme … → MemeGenerator → 独立 Worker → SendQueue → OneBot 图片段
    └─ 普通消息 / @机器人 → 原有大模型与人格系统
```

命中 `#meme` 后，消息会存档但对 Agent 上下文隐藏，不会产生模型调用。生成任务在 Worker 中执行，大图或 GIF 不会阻塞 QQ Agent 主线程；生成结果继续使用原有发送队列、会话间隔和分钟/小时限频。

## 来源与许可

本扩展的 QQ 路由、Worker 隔离、头像获取、缓存和 OneBot 发送代码位于本仓库，生成引擎与扩展模板来自以下独立项目：

| 项目 | 本仓库中的用途 | 固定版本 | 许可与说明 |
|---|---|---:|---|
| [MemeCrafters/meme-generator-rs](https://github.com/MemeCrafters/meme-generator-rs) | 原生生成引擎、CLI、内置模板与资源 | `v0.2.3` | MIT；版权归原作者 |
| [`@memecrafters/meme-generator`](https://www.npmjs.com/package/@memecrafters/meme-generator) | CLI 未安装时的 Node 原生回退 | `0.2.3` | 上述项目的 npm 发行包 |
| [anyliew/meme-emoji](https://github.com/anyliew/meme-emoji) | 额外模板动态库与图片资源 | `v0.0.6+build.59` | 代码仓库标注 MIT；图片素材来源与使用限制以该项目声明为准 |
| [MemeCrafters/meme-generator-contrib-rs](https://github.com/MemeCrafters/meme-generator-contrib-rs) | 官方额外模板库，包含 10 个小众、实验性或可能引起不适的模板 | `5658321` | MIT；图片素材来自网络，权利边界以该项目声明为准 |
| [SodaSizzle/astrbot_plugin_meme_generator](https://github.com/SodaSizzle/astrbot_plugin_meme_generator) | 需求与交互方案参考 | 不作为依赖 | 本实现不安装 AstrBot，也未复制该插件源码 |

安装脚本从上述项目的 GitHub Release 和固定版本下载内容，对 Release 中的两个可执行产物执行固定 SHA-256 校验，并使用与主 CLI 相同的 Rust `1.93.1` 从固定提交编译 contrib 动态库。第三方二进制、字体、模板图片和用户头像缓存均放在应用数据目录，不提交到本仓库、不写入 `.app`，也不受本仓库自身 MIT 许可重新授权。

按当前固定版本，本机加载结果为 **733 个模板**。上游版本、资源或模板键发生变化时，数量可能不同；以 `#meme 状态` 的实际结果为准。

## 部署

### 环境要求

- macOS，支持 Apple Silicon（arm64）和 Intel（x64）；本项目正式构建配置当前以 arm64 为主。
- Node.js `>= 20`、npm、Git。
- 完整安装 contrib 模板需要 Homebrew `rustup`；执行 `brew install rustup` 即可，安装脚本会自动准备与主 CLI 匹配的 Rust `1.93.1`。
- QQ、NapCat 和 OneBot v11 已按照主 README 配置完成。
- 建议预留至少 2 GB 空闲空间。首次安装需要下载原生程序、Rust 工具链、字体和大量模板图片。

### 开发模式

在项目根目录执行：

```bash
npm install
brew install rustup
npm run setup:meme
npm start
```

`setup:meme` 默认把内容安装到：

```text
runtime/data/meme-generator/
├── bin/meme
├── libraries/meme-emoji-macos-*.dylib
├── libraries/meme-generator-contrib-macos-*.dylib
├── resources/fonts/
├── resources/images/
├── cache/avatars/
└── config.toml
```

安装脚本可以重复执行，用来修复缺失资源或恢复固定版本。只需要官方内置模板时可执行：

```bash
npm run setup:meme -- --builtin-only
```

保留 `meme-emoji`、但不编译 contrib 的 10 个实验性模板时可执行：

```bash
npm run setup:meme -- --skip-contrib
```

### 打包版数据目录

打包应用使用 `~/Library/Application Support/QQ Agent Mac/data/`。从源码目录执行：

```bash
brew install rustup
node scripts/install-meme-extension.mjs \
  --data-dir "$HOME/Library/Application Support/QQ Agent Mac/data"
```

也可以用 `QQ_AGENT_DATA_DIR` 指向自定义目录。安装完成后重启 QQ Agent；无需重启 QQ 或 NapCat。

### 为什么不把资源放进 `.app`

模板图片和字体体积大、更新频率不同于应用代码，运行时还会写入头像缓存与临时生成文件。将它们留在应用数据目录可以避免修改签名后的应用包，也能在更新 QQ Agent 时继续复用资源。

## 使用

默认前缀是 `#meme`。模板名与文字之间可以用空格，也支持中文引号紧跟模板名：

```text
#meme 帮助
#meme 状态
#meme 列表
#meme 列表 举牌
#meme 举牌 “你好世界”
#meme 举牌“cucu无敌”
```

### 图片与头像输入

需要图片的模板支持以下输入：

```text
#meme 摸头                  # 没有其他图片时使用发送者头像
#meme 摸头 123456789        # 使用指定 QQ 号头像
#meme 摸头 qq:123456789     # 显式声明 QQ 号
#meme 摸头 @群友            # 使用被 @ 用户头像
```

也可以在同一条消息中附图，或引用一条包含图片的消息后发送 `#meme 摸头`。输入图片按消息中的出现顺序传给模板，多余输入会按照模板允许的最大图片数截断。

指定 QQ 号时会依次尝试多个 QQ 头像地址。已知的 40×40 企鹅占位图不会被采用或写入缓存；如果真实头像不可读取，命令会提示改用 `@群友`、附图或引用图片。

### 多段文字

只接收一段文字的模板会把剩余参数合并。需要多段文字时，分别使用引号：

```text
#meme 某模板 "第一段" "第二段"
```

模板名称不唯一时，先搜索再使用返回的模板键：

```text
#meme 列表 关键词
```

### 模板管理

群主、群管理员以及设置中配置的表情管理员可以执行：

```text
#meme 禁用 <模板键或唯一关键词>
#meme 启用 <模板键或唯一关键词>
#meme 禁用列表
```

在“设置 → 聊天设置 → 表情生成命令”中可以修改：

- 是否启用、命令前缀；
- 同一用户的冷却时间；
- 单次生成超时；
- 启动时资源检查；
- 头像缓存和有效期；
- 表情管理员与禁用模板列表。

`meme-generator-contrib-rs` 上游明确将其中的内容描述为小众、实验性或可能引起不适的表情。部署者可以先用 `#meme 列表` 查看，再通过禁用命令或设置页关闭不适合当前群聊的模板。

## 故障排查

### `#meme 状态` 的模板数少于 733

约 299 个表示只加载了官方内置模板；约 723 个表示 `meme-emoji` 已加载、但 contrib 尚未加载。执行 `brew install rustup` 后重新运行 `npm run setup:meme`，确认命令完成并重启 QQ Agent。

### 提示“找不到唯一模板”

执行 `#meme 列表 <关键词>`。如果返回多个结果，改用列表中的英文模板键。中文直角引号、弯引号以及 `举牌“文字”` 这种无空格写法均已兼容。

### 指定 QQ 号仍无法取得头像

部分账号的真实头像可能受腾讯接口、账号状态或隐私设置影响。本扩展不会用企鹅占位图冒充结果；请改用 `@群友`、当前消息图片或引用图片。

### 清理或卸载

退出 QQ Agent 后，删除数据目录中的 `meme-generator/` 即可移除生成器、模板资源和头像缓存。开发模式路径是 `runtime/data/meme-generator/`，打包版路径是 `~/Library/Application Support/QQ Agent Mac/data/meme-generator/`。该操作不会影响 QQ、NapCat、聊天存档或模型配置。
