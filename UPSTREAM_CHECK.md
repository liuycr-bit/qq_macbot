# 上游版本检查记录

| 检查时间（Asia/Shanghai） | 上游 | 结果 |
|---|---|---|
| 2026-09-21（首次移植） | `K0nd1us/QQ-agent` | `main` = `72f537f947143e2e153597542cb849cbed777771`，本项目从该提交移植 |
| 2026-09-21（首次移植） | `NapNeko/NapCat-Mac-Installer` | `main` / `v1.6` = `b4fd38faa7cccea1ce0be141cb26925c8f5f6338`，据此实现 macOS 路径、启动参数和 WebUI 识别 |
| 2026-09-21 16:25:59 | `NapNeko/NapCat-Mac-Installer` release | 当前最新发布仍为 `v1.6`；已把 `NapCatInstaller_arm64.amd64.zip` 下载到项目外层 `work/downloads/`，SHA-256 为 `169f0ecda4f0460f25f4534fea98ff7bd3490f0fa28598e708ff85c9420255c1`，尚未运行安装器 |

再次引用外部上游代码或说明前，如果本记录距当前时间已超过 3 天，应先重新检查上游。
