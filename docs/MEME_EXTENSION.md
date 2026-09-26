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
| 本仓库 `qq-agent-trending-memes-rs` | 近期热梗模板包，提供背手负鼠、SBTI、牛来、旋转猫等 11 个模板 | `0.1.0` | 扩展代码随本仓库按 MIT 发布；背手负鼠图片来自 MIT 许可的 [claw16/codex-pet-beishoufushu](https://github.com/claw16/codex-pet-beishoufushu)，其余图片由代码绘制 |
| [anyliew/crazy-emoji](https://github.com/anyliew/crazy-emoji)（B1） | 38 个 Rust 模板；其中两个键与既有模板重复，最终增加 36 个可用键 | `51f6a21` | MIT 代码；素材权利边界以该项目声明为准 |
| [LRZ9712/tudou-meme](https://github.com/LRZ9712/tudou-meme)（B2） | 122 个 Python 模板模块，通过 Worker 的独立子进程生成 | `016f46b` + `meme-generator 0.1.14` | MIT 代码；包含 NSFW、粗俗等内容，素材权利边界以该项目声明为准 |
| [cholf5/gengtu](https://github.com/cholf5/gengtu)（B3） | 32 个图片/JSON 模板，安装时转换为 C1 模板包 | `cd17bfa` | MIT 仓库；素材权利边界以该项目声明为准 |
| [kartikkabadi/meme-maker](https://github.com/kartikkabadi/meme-maker)（C1） | 610 个经典静态/GIF 模板及本地 CLI 渲染器 | `0e8531e` | MIT 代码；逐模板来源和素材条款保留在安装后的 manifest/CREDITS 中 |
| [NapNeko/NapCatQQ](https://github.com/NapNeko/NapCatQQ) | 使用已登录 QQ 会话的 `NodeIKernelAvatarService` 下载群成员头像 | 本机 `4.18.28` | NapCat 本身按其仓库许可发布；本仓库只提供独立的本机头像桥接插件 |
| [SodaSizzle/astrbot_plugin_meme_generator](https://github.com/SodaSizzle/astrbot_plugin_meme_generator) | 需求与交互方案参考 | 不作为依赖 | 本实现不安装 AstrBot，也未复制该插件源码 |

安装脚本从上述项目的 GitHub Release 或固定提交下载内容，并对下载归档执行固定 SHA-256 校验。Rust 扩展使用固定的 `1.93.1` 工具链编译；B2 使用独立 Python 虚拟环境；B3/C1 使用独立 Node CLI。第三方二进制、运行环境、字体、模板图片和用户头像缓存均放在应用数据目录，不提交到本仓库、不写入 `.app`，也不受本仓库自身 MIT 许可重新授权。

按当前固定版本，本机加载结果为 **1544 个模板**：原生引擎 780 个，B2 122 个，B3 32 个，C1 610 个。以 `#meme 状态` 的实际结果为准。近期热梗、关键词别名和 GitHub 来源清单见 [表情模板来源与待选清单](MEME_CANDIDATES.md)。

## 部署

### 环境要求

- macOS，支持 Apple Silicon（arm64）和 Intel（x64）；本项目正式构建配置当前以 arm64 为主。
- Node.js `>= 20`、npm、Git，以及 Python `>= 3.9`（用于 B2 隔离环境）。
- 完整安装 contrib 模板需要 Homebrew `rustup`；执行 `brew install rustup` 即可，安装脚本会自动准备与主 CLI 匹配的 Rust `1.93.1`。
- QQ、NapCat 和 OneBot v11 已按照主 README 配置完成。
- 建议预留至少 4 GB 空闲空间。当前完整数据目录约 1.7 GB，首次安装还需要临时构建空间。

### 开发模式

在项目根目录执行：

```bash
npm install
brew install rustup
npm run setup:meme
npm run setup:avatar-bridge
npm start
```

`setup:avatar-bridge` 会把 `qq-avatar-bridge` 插件和随机生成的访问令牌复制到 NapCat 数据目录，启用插件，并在本机 NapCat 4.18.x 的插件白名单中加入该插件 ID。它不会修改 `QQ.app`。安装完成后需要重启 QQ/NapCat 和 QQ Agent；NapCat 更新覆盖 `napcat.mjs` 后重新执行一次即可。

`setup:meme` 默认把内容安装到：

```text
runtime/data/meme-generator/
├── bin/meme
├── libraries/meme-emoji-macos-*.dylib
├── libraries/meme-generator-contrib-macos-*.dylib
├── libraries/qq-agent-trending-memes-macos-*.dylib
├── libraries/crazy-emoji-macos-*.dylib
├── engines/tudou-meme/        # B2 源码、Python venv 与应用数据
├── engines/classic-memes/     # C1 渲染器，以及 C1/B3 模板和来源清单
├── resources/fonts/
├── resources/images/
├── resources/qq-agent-trending/back_hand_opossum/
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

只更新本次选定的 B1/B2/B3/C1，可执行 `npm run setup:meme -- --expanded-only`；若明确不安装这四组，可在完整安装时追加 `--skip-expanded`。B2 模板键使用 `tudou_` 前缀，B3 使用 `gengtu_`，C1 使用 `classic_`；日常也可以直接用中文名或英文名搜索。原生 B1 模板保持上游键名。

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

指定 QQ 号或 `@群友` 时，QQ Agent 依次使用：新鲜本地缓存、NapCat 已登录 QQ 会话、公网 QQ 头像源、过期但仍有效的本地缓存。NapCat 头像桥只接受本机环回请求，并要求安装时生成的随机令牌；头像资源仍写入应用数据目录。已知的 40×40 企鹅和 120×120“暂时无法查看”等占位图不会被采用或写入缓存。

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

### `#meme 状态` 的模板数少于 1544

780 个表示 B1 已进入原生引擎，但 B2/B3/C1 独立引擎没有完成加载。执行 `brew install rustup`，确认 Python 3.9+ 可用，再重新运行 `npm run setup:meme` 并重启 QQ Agent。`#meme 状态` 会分别显示 native、tudou、gengtu、classic 的数量，便于定位缺少的来源。

### 提示“找不到唯一模板”

执行 `#meme 列表 <关键词>`。如果返回多个结果，改用列表中的英文模板键。中文直角引号、弯引号以及 `举牌“文字”` 这种无空格写法均已兼容。

### 指定 QQ 号仍无法取得头像

先执行 `npm run setup:avatar-bridge`，再重启 QQ/NapCat 与 QQ Agent。发送 `#meme 状态` 可查看“NapCat 头像桥”是否已连接。插件只监听本机访问，令牌保存在 NapCat 的 `config/plugins/qq-avatar-bridge/config.json`，不要提交或分享。账号已注销、被冻结，或 QQ 客户端本身也无法显示头像时仍可能失败；本扩展不会用企鹅占位图冒充结果，此时请使用当前消息图片或引用图片。

### 清理或卸载

退出 QQ Agent 后，删除数据目录中的 `meme-generator/` 即可移除生成器、模板资源和头像缓存。开发模式路径是 `runtime/data/meme-generator/`，打包版路径是 `~/Library/Application Support/QQ Agent Mac/data/meme-generator/`。该操作不会影响 QQ、NapCat、聊天存档或模型配置。
