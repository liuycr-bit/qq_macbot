# 表情模板来源与待选清单

更新时间：2026-09-26。

这份清单同时记录已经装入 QQ Agent 的近期热梗、仅增加关键词的别名，以及从 GitHub 找到的其他模板源。搜索过程**没有按 NSFW 内容过滤**；是否启用由部署者最终决定。当前只接入 B1、B2；B3、C1 因不支持头像嵌入已移除，其他来源不接入。

## 当前已安装：N1–N8

下面 11 个模板由本仓库的 `qq-agent-trending-memes-rs` 原生扩展提供，已经计入当前 **902 个模板**。

| 编号 | 模板键 | 可用关键词 | 输入 | 实现与来源 |
|---|---|---|---|---|
| N1 | `back_hand_opossum` | 背手负鼠、领导视察、老干部视察 | 0–1 段文字 | 图像来自 MIT 许可的 [claw16/codex-pet-beishoufushu](https://github.com/claw16/codex-pet-beishoufushu)，安装时固定 SHA-256 |
| N2 | `sbti_result` | SBTI测试、SBTI、测测精神状态 | 0–2 段文字 | 本仓库绘制卡片；只参考公开项目的测试卡片思路 |
| N3 | `niu_lai` | 牛来、牛市来、牛来保佑 | 0–1 段文字 | 本仓库绘制 |
| N4 | `hello_eat_some` | 你好我吃一点、我吃一点 | 0–1 段文字 | 本仓库绘制 |
| N5 | `calm_unhurried` | 从从容容、游刃有余、连滚带爬 | 0–2 段文字 | 本仓库绘制 |
| N6 | `basic_not_basic` | 基础不基础、就不基础 | 0–2 段文字 | 本仓库绘制 |
| N7 | `spinning_cat_oiiai` | 旋转猫、OIIAI、哈基米旋转 | 1 张图片，默认发送者头像 | 本仓库逐帧生成 GIF |
| N8a | `monthly_salary_cat` | 月薪喵 | 0–2 段文字 | 本仓库绘制 |
| N8b | `alive_feeling` | 活人感 | 0–2 段文字 | 本仓库绘制 |
| N8c | `steamer_city` | 蒸笼city | 0–2 段文字 | 本仓库绘制 |
| N8d | `dont_disturb_you` | 勿扰吧你 | 0–1 段文字 | 本仓库绘制 |

## 当前已安装：A1–A7 热词别名

这一组不复制模板图片，只把近期说法稳定路由到现有模板，因此不增加 902 的模板数量。

| 编号 | 新关键词 | 现有模板键 |
|---|---|---|
| A1 | 爱你老己、老己、老己辛苦了 | `love_you` |
| A2 | 别来沾边 | `dont_go_near` |
| A3 | 搞抽象、太抽象了、抽象 | `confuse` |
| A4 | 梁圣、DeepSeek锐评、让梁圣说 | `deepseek_say` |
| A5 | 摆烂、躺平、不干了 | `slacking_off` |
| A6 | 红温了、汗流浃背了 | `flush` |
| A7 | 我勒个豆、家人谁懂啊、被拿捏了 | `peas`、`family_know`、`tease` |

## 已接入：B1、B2

### B1. anyliew/crazy-emoji

- 来源：[anyliew/crazy-emoji](https://github.com/anyliew/crazy-emoji)
- 状态：**已接入**，固定提交 `51f6a21`。
- 许可：MIT；图片素材仍需遵守上游的素材声明。
- 规模：38 个 Rust 扩展模板；`huochailu`、`moistening_water` 与既有键重复，实际为原生引擎增加 **36 个键**。
- 适配：与当前 `meme-generator-rs` 动态库路线一致，优先级最高。
- 内容：包含成人用品、性暗示和动作类模板；清单不作过滤。

完整模板键与关键词：

| 模板键 | 关键词 |
|---|---|
| `behind_do` | 后撅 |
| `big_eagle_cute_girl` | 大屌萌妹、大吊萌妹、大雕萌妹 |
| `fleshlight_air_play` | 空气玩法 |
| `fleshlight_angel` | 天使心 |
| `fleshlight_cleaning_liquid` | 清洗液 |
| `fleshlight_commemorative_edition_saint_sister` | 纪念版圣修女 |
| `fleshlight_hoshino_alice` | 啦啦队偶像、拉拉队偶像 |
| `fleshlight_idol_heartbeat` | 偶像心跳 |
| `fleshlight_jissbon` | 杰士邦 |
| `fleshlight_kuileishushi` | 白丝壁女 |
| `fleshlight_limited_edition_saint_sister` | 限定版圣修女 |
| `fleshlight_liuli_zi` | 琉璃子 |
| `fleshlight_machinery` | 机械龙女、机械龙女EVA、机械龙女eva |
| `fleshlight_mengxin_packs` | 萌新礼包 |
| `fleshlight_miyuko_kamimiya` | 神宫美优子 |
| `fleshlight_mizuki_shiranui` | 水城不知火 |
| `fleshlight_nrn` | 乳入娘 |
| `fleshlight_pure_buttocks` | 纯洁臀 |
| `fleshlight_purple_spirit` | 紫域精灵 |
| `fleshlight_qiaobenyouxi` | 桥本友希 |
| `fleshlight_random` | 随机杯子 |
| `fleshlight_saint_sister` | 圣修女 |
| `fleshlight_saki_haruna` | 春奈纱希 |
| `fleshlight_selena` | 魔女之森 |
| `fleshlight_starter_pack` | 新手礼包 |
| `fleshlight_summer_liuli_zi` | 夏日琉璃子 |
| `fleshlight_taimanin_asgi` | 对魔忍 |
| `fleshlight_xingnai` | 杏奈 |
| `huochailu` | 火柴撸（当前已有） |
| `kurogames_iuno_hug` | 尤诺抱 |
| `laydown_do` | 躺撅 |
| `masturbate` | 导、打飞机 |
| `mihoyo_elysia_come` | 爱莉希雅降临 |
| `moistening_water` | 滋水（当前已有） |
| `nailoong_do` | 奶龙撅 |
| `oral_sex` | 口 |
| `sitdown_do` | 坐撅 |
| `spraypee` | 滋你 |

### B2. LRZ9712/tudou-meme

- 来源：[LRZ9712/tudou-meme](https://github.com/LRZ9712/tudou-meme)
- 状态：**已接入**，固定提交 `016f46b`，使用独立 Python 子进程。
- 许可：MIT；它也被 `MemeCrafters/meme-generator` 官方 README 列为“其他表情仓库”。
- 规模：固定提交实际发现 **122 个可加载模块**；其中两个位于上游嵌套目录，两个模块共享 `huanying` 内部键，QQ Agent 为它们分配独立公开键并全部保留。
- 适配：保留 Python 版 `meme-generator` 实现，由 Worker 启动独立子进程，不阻塞 QQ Agent 主进程；内部键继续使用 `tudou_` 前缀，命令列表统一显示“土豆＋中文名”，并保留不带前缀的中文关键词输入。
- 内容：包含 NSFW、排泄物、性暗示和粗俗内容，以下不删减。

<details>
<summary>展开上游记录的模板目录名（固定提交另含两个嵌套模块）</summary>

`3p`、`aichuai`、`beiwodao`、`cha`、`doro臭美`、`duidi`、`fangpi`、`huanying`、`huanying2`、`huanying3`、`huanying被戳`、`huochailu`、`jibao`、`kaimen`、`katitia_holdsign`、`kou`、`llq`、`maomaochong`、`moni`、`nailongpao`、`nantongjue`、`niulai`、`nizhejiah`、`nvtongjue`、`pao`、`pingdiguo`、`qi`、`qian`、`qilongwang`、`qiu`、`shouxie`、`shuai`、`shuainiuzi`、`shuaiqunwu`、`wanju`、`wanweiba`、`wodeniuniu`、`wudizhen`、`yao`、`zaoleipi`、`zixingche`、`zuo`、`仓鼠亲`、`你出生了`、`兔哈郎`、`全自动`、`关冰箱`、`割鸡鸡`、`去o屎`、`吃屎`、`吃我一锤`、`哥们抱`、`嘬嘬嘬`、`嘬高跟`、`噜噜喂猪`、`噜噜骑狗`、`大便攻击`、`导冒烟`、`导爆`、`小熊帽子`、`巨物`、`带走`、`弹牛子`、`懵逼猫`、`我有意见`、`我来了`、`戳死你`、`打气`、`打气球`、`扔屎`、`托尼`、`抓咪`、`抓头`、`拉屎`、`拍你头`、`拖垃圾`、`拖垃圾人`、`招牌`、`挠挠头`、`捏兔帽`、`捏鸡蛋`、`揪咪`、`摇子`、`桌角`、`正在找你`、`汉堡耄耋`、`没意见`、`渔网袜`、`熊骑`、`牛牛打球`、`猛撅`、`猪舞`、`猫咪膜拜`、`猫猫撅`、`王`、`玩火`、`甩鸡鸡`、`白嫖怪`、`睡不着`、`耄耋篮球`、`舔咪`、`舔屁股`、`蠕动`、`跑步机`、`跳劈`、`跳绳`、`跳舞猫`、`踩人`、`蹲马桶`、`这边请`、`遛狗`、`鞭打`、`鞭策`、`飞鸡`、`骑恐龙`、`骑熊`、`骑猪`、`骑猫`、`鲁鲁喂猪`、`鲁鲁骑猪`

</details>

## 不接入：B3、C1 及其余候选

### B3. cholf5/gengtu

- 来源：[cholf5/gengtu](https://github.com/cholf5/gengtu)
- 状态：**已移除，不接入**。模板只有文字坐标，没有头像/图片嵌入槽位。
- 许可：MIT。
- 规模：32 个图片加 JSON 坐标模板。
- 适配记录：大部分是经典静态梗图。`食屎啦你` 与当前 `shishilani` 语义重复。

完整模板键：

`atlas-holding-earth`、`batman-slapping-robin`、`bike-fall`、`bow-down`、`change-my-mind`、`comrade-wake-up`、`crazy-fans`、`dam`、`distracted-boyfriend`、`do-whatever-you-want`、`drake-hotline-bling`、`fan-club-support`、`grave-victory`、`horse-drawing`、`hysterical-arguments`、`iceberg`、`left-exit-12-off-ramp`、`leonardo-laugh`、`linus-fuck`、`ma-huateng-think`、`meloni-slap-trump`、`mother-ignoring-kid-drowning-in-a-pool`、`scooby-doo-mask-reveal`、`squid-game`、`support-tower`、`terminator-and-fear-girl`、`trump-blank-executive-order`、`two-buttons`、`whisper-and-goosebumps`、`yhorm-dark-souls`、`你尽管-算我输`、`食屎啦你`

### C1. kartikkabadi/meme-maker

- 来源：[kartikkabadi/meme-maker](https://github.com/kartikkabadi/meme-maker)
- 状态：**已移除，不接入**。610 个模板都是经典文字槽/GIF 模板，没有头像/图片嵌入槽位。
- 规模记录：610 个模板。

以下来源保留为调研记录，但按本轮选择**不安装、不下载、不加入运行时模板清单**。

### B4. Python 版 MemeCrafters 上游差异

- 来源：[MemeCrafters/meme-generator](https://github.com/MemeCrafters/meme-generator)
- 对比原 Rust 模板后曾记录的差异是：
  - `not_call_me`：关键词“不喊我”，默认文案“开银趴不喊我是吧”；
  - `play`：关键词“顶、玩”，需要 1 张图片；
  - `top_notch`：关键词“顶尖”，默认文案“运营”。
- `bluearchive`≈当前 `batitle`，`my_friend`≈当前 `my_friend_say`，`gif_subtitle` 是聚合模块，不作为新模板。

## 未接入的大型本地模板库

这些项目不是现成的 `meme-generator-rs` 动态库，但能提供大量真正不同的模板。导入前应先自动比对感知哈希、文本槽位和来源许可。

| 编号 | 项目 | 当前规模 | 特点 | 接入判断 |
|---|---|---:|---|---|
| C2 | [jstmemit/jstmemit](https://github.com/jstmemit/jstmemit) | 769 个 TSX 模板文件 | 经典梗、动漫梗很多，模板可声明多图、多文字和本地化名称 | MIT；需把 JSX/SVG 合成逻辑迁移到当前 Worker，工作量中高 |
| C3 | [baoxinwen/meme-maker](https://github.com/baoxinwen/meme-maker) | 327 个 `data.json` 模板目录 | 中文、GIF、头像槽位丰富，纯浏览器本地生成 | MIT 只覆盖代码，项目明确说图片和字体不在 MIT 范围；与当前模板重合度可能很高 |
| C4 | [wasabipesto/automeme](https://github.com/wasabipesto/automeme) | 99 个 JSON 模板 | Rust 引擎、模板坐标结构清楚、README 逐图记录来源 | MIT；主要是英文经典梗，迁移难度中等 |
| C5 | [julianbrandt/MemePy](https://github.com/julianbrandt/MemePy) | 24 个内置模板 | 结构简单，包含 Balloon、TradeOffer、BellCurve、PredatorHandshake 等 | MIT；数量小且部分重复，适合按缺口挑选 |
| C6 | [gsantner/memetastic](https://github.com/gsantner/memetastic) | 48 张内置素材 | 成熟 Android 项目的经典梗图库，另有素材来源说明 | GPL-3.0；不建议直接混入 MIT 扩展代码，可只作为人工找图线索 |

## 第三优先级：远程目录或专用模板源

| 编号 | 项目 | 当前规模 | 价值与限制 |
|---|---|---:|---|
| D1 | [jacebrowning/memegen](https://github.com/jacebrowning/memegen) / [memegen.link](https://memegen.link/) | API 当前返回 211 个模板 | 项目活跃、MIT、URL API 很成熟；但直接调用会破坏当前“完全本地生成”的边界，适合只导入目录和缺失素材，不建议成为运行时依赖 |
| D2 | [JustMeme-wtf/justmeme-api](https://github.com/JustMeme-wtf/justmeme-api) | API 声明 2,400+，返回格式示例显示 2,393 | 检索量最大、无需账号；仓库的 MIT 主要覆盖 API 代码，模板素材来源和再分发许可不够清晰，只适合候选发现 |
| D3 | [WincerChan/Meme-generator](https://github.com/WincerChan/Meme-generator) | 6 个中文 GIF | 王境泽、我说的、为所欲为、谁赞成谁反对、星际还是魔兽、打工是不可能打工的；GPL-3.0，且年代较早 |
| D4 | [lgc-NB2Dev/nonebot-plugin-meme-stickers](https://github.com/lgc-NB2Dev/nonebot-plugin-meme-stickers) | 远程贴纸包，仓库未内置固定素材数 | PJSK 样式贴纸生成器，MIT；项目已归档，适合借鉴样式，需另行解析贴纸包来源 |
| D5 | [Dituon/petpet-js](https://github.com/Dituon/petpet-js) | 核心仓库当前索引只带 `osu` 数据包 | AGPL-3.0；模板生态通过外部数据仓库加载，不能把框架仓库误算成大量新模板 |
| D6 | [n0spaces/get-stick-bugged-lol](https://github.com/n0spaces/get-stick-bugged-lol) | 1 个专用动画 | MIT、已归档；可补 “Get Stick Bugged” 动图 |
| D7 | [mat3e/brains](https://github.com/mat3e/brains) | 1 类扩展脑洞模板 | MIT、老项目；现有库已有类似模板，优先级低 |
| D8 | [opsxcq/meme-vibing-cat](https://github.com/opsxcq/meme-vibing-cat) | 1 个专用动画 | Vibing Cat；仓库未识别到明确 SPDX 许可，除非另获授权，否则不直接打包 |

## 不是新模板源的相关项目

以下项目有参考价值，但本身主要是适配器或上层机器人插件，不应重复计算模板数：

- [SodaSizzle/astrbot_plugin_meme_generator](https://github.com/SodaSizzle/astrbot_plugin_meme_generator)：AstrBot 到 `meme-generator` 的接入层；
- [MemeCrafters/nonebot-plugin-memes](https://github.com/MemeCrafters/nonebot-plugin-memes)：NoneBot 接入层，实际模板仍来自 MemeCrafters 引擎；
- [MemeCrafters/nonebot-plugin-petpet](https://github.com/MemeCrafters/nonebot-plugin-petpet)：旧版项目，模板已迁往 `meme-generator`；
- [cssxsh/meme-helper](https://github.com/cssxsh/meme-helper)：Mirai 侧帮助插件，主要连接 petpet 数据生态；
- [kozko2001/meme-generator-mcp](https://github.com/kozko2001/meme-generator-mcp)：把 memegen.link 的模板包装成 MCP，并不提供另一套独立素材。

远程 API 类来源和上表其他仓库均未接入。当前运行时只包含原有来源以及 B1、B2；本地生成、独立 Worker/子进程、应用数据目录和 OneBot 发送路径保持不变。
