# **Core Capabilities Available Now**

## **1. Handle macOS QQ messaging through NapCat / OneBot and run the signed-in account as a QQ bot**

## **2. Create and send memes locally with `#meme` commands, without invoking the LLM**

<p align="right">
  <a href="README.md">简体中文</a> | <strong>English</strong>
</p>

# QQ Agent Mac

![Platform](https://img.shields.io/badge/platform-macOS%20Apple%20Silicon-lightgrey)
![Release](https://img.shields.io/badge/release-v0.3.0--macos.1-blue)
![Protocol](https://img.shields.io/badge/protocol-OneBot%20v11-blue)
![License](https://img.shields.io/badge/license-MIT-green)

QQ Agent Mac is a macOS port of [K0nd1us/QQ-agent](https://github.com/K0nd1us/QQ-agent).

It runs the QQ Agent Electron console and bot core on Apple Silicon Macs and connects to macOS QQ through a **separately installed NapCat**. QQ Agent receives events over a OneBot v11 forward WebSocket connection and invokes actions through the HTTP API. Model providers remain compatible with OpenAI-style APIs.

> `v0.3.0-macos.1` is a macOS Apple Silicon (arm64) release. DMG and ZIP packages are available from [GitHub Releases](https://github.com/liuycr-bit/mac_qq_bot/releases/tag/v0.3.0-macos.1). The core paths for OneBot connectivity, model calls, real QQ message handling, custom personas, and image retrieval have been manually integrated and tested. Full automated regression testing, multi-machine compatibility verification, Apple code signing, and notarization have not yet been completed.

## Current Status

Status updated on September 22, 2026.

| Item | Status | Details |
|---|---|---|
| macOS porting plan | Complete | The implementation uses Electron, a separately installed NapCat, and OneBot v11 |
| macOS connection manager | Complete | Added QQ/NapCat path detection, status reporting, guarded start/stop operations, WebUI access, and OneBot configuration discovery |
| “QQ Connection” UI | Complete | Replaced the Windows SnowLuma control entry with QQ, NapCat, login, and OneBot status and controls |
| Deployment diagnostics | Complete | Read-only checks for QQ, NapCat, the loader, entry point, configuration, and both OneBot ports |
| Local privacy boundary | Complete | Upstream telemetry, update checks, and community uploads are disabled by default in this port |
| External OneBot mode | Retained | Custom WebSocket and HTTP endpoints and access tokens can be configured |
| Apple Silicon packages | Published | arm64 DMG and ZIP packages are published as [`v0.3.0-macos.1`](https://github.com/liuycr-bit/mac_qq_bot/releases/tag/v0.3.0-macos.1) |
| NapCat installation | Complete | NapCat 4.18.28 was installed with the official Mac installer and the QQ entry point was switched to NapCat |
| QQ login and protocol connection | Complete | QQ login succeeded; WebSocket port 3001 and HTTP port 3000 are reachable; QQ Agent reads the logged-in account information |
| Model API calls | Complete | DeepSeek model requests work, including real-DNS fallback under Clash Fake-IP |
| Real message handling | Complete | Real QQ message receipt, sending, and bot replies were manually verified |
| Custom personas | Complete | New local personas can be selected and applied at runtime; local test persona cards are not committed |
| Image retrieval | Complete | Fake-IP addresses are resolved to public addresses before the existing private-network safety checks run |
| Local meme extension | Complete | A deterministic `#meme` route, isolated Worker/subprocesses, authenticated NapCat avatar bridge, message-image inputs, and 902 pinned-version templates are enabled locally |
| Restricted macOS permissions | Complete | An unreadable QQ sandbox no longer produces a false “not installed” result; manual tokens can be used |
| Full post-port test suite | Not run | Upstream test scripts remain, but their presence does not mean the port has passed the complete suite |
| Apple signing and notarization | Not implemented | The release is unsigned and unnotarized; first launch may require right-clicking the app and choosing **Open** |

See the [Phase 1 design](docs/PHASE1_DESIGN.md), [macOS deployment notes](docs/MACOS_DEPLOYMENT.md), and [local meme-generator extension guide](docs/MEME_EXTENSION.md) for detailed design, deployment, sources, and usage. These documents are currently in Chinese.

## Architecture

```text
macOS QQ.app + NapCat
          │
          │ OneBot v11
          │ WebSocket events / HTTP actions
          ▼
QQ Agent Mac
├── ConnectorManager: QQ/NapCat discovery, lifecycle, configuration, and WebUI
├── OneBotClient: message events and action calls
├── MemeGenerator: deterministic #meme routing, image inputs, and isolated multi-engine generation
├── Orchestrator: session orchestration and tool calls
├── Store / Memory: local message archive and long-term memory
└── Electron + Web UI: desktop control console
          │
          │ OpenAI-compatible API
          ▼
Model provider, proxy service, or local model gateway
```

### Design Boundaries

- **The protocol component is installed separately:** NapCat is not bundled with this repository. Its official Mac installer handles installation, updates, removal, and QQ entry-point switching.
- **QQ is never terminated silently:** if standard QQ is running while OneBot is unavailable, the UI asks for confirmation before restarting QQ.
- **Exiting QQ Agent does not exit QQ:** closing QQ Agent does not terminate QQ or NapCat.
- **No model-provider lock-in:** the application retains an OpenAI-compatible interface and does not bind NapCat to a specific provider.
- **Sensitive data must not be committed:** real API keys, QQ login state, chat archives, and long-term memory must stay out of Git.
- **External services are disabled by default:** upstream telemetry, update checks, feedback uploads, and quote uploads are not contacted unless explicitly enabled in settings.

## Porting Changes

Compared with the upstream baseline, this repository includes the following changes:

- Added `src/connector-manager.js` for macOS QQ/NapCat status, path discovery, lifecycle controls, and OneBot configuration candidates.
- Replaced Windows SnowLuma process controls in `src/app.js` with a generic connector manager and added `/api/connector/*` endpoints.
- Added `napcat-macos` and `external-onebot` connection modes in `src/config.js` while retaining legacy configuration migration.
- Reworked the SnowLuma page into “QQ Connection,” with NapCat, QQ, WebUI, OneBot status, and related actions.
- Updated Electron data directories, tray icon behavior, hardware acceleration, and startup behavior for macOS.
- Added Apple Silicon build configuration, the Phase 1 design, and macOS deployment documentation.
- Added read-only deployment diagnostics and disabled nonessential upstream online services by default.
- Added support for macOS app-data protection by distinguishing missing directories from unreadable directories and accepting the QQ entry point plus both OneBot ports as runtime evidence.
- Fixed QQ process detection returning an invalid PID of `0`.
- Added a deterministic `#meme` route that bypasses the LLM, runs native generation in an isolated Worker, and reuses the existing OneBot send queue and rate limits.
- Added `meme-emoji`, the official `meme-generator-contrib-rs`, the QQ Agent trending pack, and the selected B1/B2 sources; the pinned local setup loads 902 templates and keeps third-party binaries, resources, and caches in the app-data directory. B3/C1 were removed because they do not support avatar insertion.
- Added the local `qq-avatar-bridge` NapCat plugin. It retrieves group-member avatars through the signed-in QQ session first, retains the public QQ endpoints and stale cache as fallbacks, accepts loopback requests only, and requires a separate random token.

## Inherited Upstream Features

The following features come from the direct upstream project, `K0nd1us/QQ-agent`. Core paths for model calls, OneBot connectivity, real QQ messages, custom personas, and image retrieval have been manually integrated and tested. The remaining features have not yet undergone a complete automated regression run for this macOS port:

- Group and private-message ingestion and response policies.
- OpenAI-compatible model configuration, model catalog, and cost tracking.
- Personas, context orchestration, long-term memory, and local message storage.
- Image understanding, web search, stickers, and OneBot tool calls.
- Allow lists, block lists, usage statistics, and the graphical console.
- Electron tray operation, headless server mode, and retained upstream test scripts.

Behavior should be determined from the current source and subsequent integration results.

## Environment and Directories

- Platform: macOS, with Apple Silicon (arm64) as the current primary target.
- Node.js: `>= 20`.
- Default QQ path: `/Applications/QQ.app`.
- Default NapCat program path: `~/Library/Containers/com.tencent.qq/Data/Documents/napcat`.
- Default NapCat data path: `~/Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ/NapCat`.
- Default OneBot endpoints: WebSocket `ws://127.0.0.1:3001`, HTTP `http://127.0.0.1:3000`.
- Development data: `runtime/data/`.
- Packaged-app data: `~/Library/Application Support/QQ Agent Mac/data/`.
- Build output: `release/`.

Paths and protocol endpoints can be changed under **Settings → QQ / OneBot (NapCat)**.

## Installation and Configuration

The following procedure is based on an actual installation and integration run performed on September 21, 2026, rather than source inspection alone. The verified environment used an Apple Silicon Mac, QQ `6.9.99-51802`, NapCat `4.18.28`, NapCat Mac Installer `v1.6`, Node.js `24.19.0`, and npm `12.0.2`. Other versions may differ in their UI or directory layout.

### 1. Install QQ for macOS

1. Install QQ and confirm that it is located at `/Applications/QQ.app`.
2. Start QQ normally once, then quit it so that the installer does not modify the entry point while QQ is running.
3. Do not manually remove or overwrite files inside `QQ.app`. Use NapCat Mac Installer to switch or restore the entry point.

### 2. Install NapCat and Switch the QQ Entry Point

1. Download the macOS installer from [NapCat-Mac-Installer](https://github.com/NapNeko/NapCat-Mac-Installer). The verified setup used the Apple Silicon build of `v1.6`.
2. Open the installer and install NapCat. The resulting default program directory is:

   ```text
   ~/Library/Containers/com.tencent.qq/Data/Documents/napcat
   ```

3. If the installer cannot write to the QQ container, open **System Settings → Privacy & Security** and grant the **NapCat installer**:

   - App Management;
   - Full Disk Access.

   Quit and reopen the installer after granting access, then run the installation again. Disabling SIP is not required, and untrusted injection scripts should not be used.

4. In the installer, switch the program entry point to **NapCat**. If macOS requests an administrator password, enter it only in the system authorization dialog. Never place the password in a command, configuration file, or chat message.
5. Use the installer’s terminal-launch option, or run:

   ```bash
   '/Applications/QQ.app/Contents/MacOS/QQ' --no-sandbox
   ```

6. Log in through the QQ window. When the terminal displays a NapCat WebUI address, the protocol component has started with QQ.

### 3. Configure NapCat OneBot v11

1. Open `http://127.0.0.1:6099/webui`. The first login requires the WebUI token from the NapCat startup log or the local `webui.json`. Never commit or share this token.
2. Under **Network Configuration**, create and enable an HTTP server:

   | Field | Value |
   |---|---|
   | Name | `QQ Agent HTTP` |
   | Host | `127.0.0.1` |
   | Port | `3000` |
   | Message format | `Array` |
   | CORS | Off |
   | WebSocket | Off |
   | Token | Use a strong random token |

3. Create and enable a WebSocket server:

   | Field | Value |
   |---|---|
   | Name | `QQ Agent WebSocket` |
   | Host | `127.0.0.1` |
   | Port | `3001` |
   | Message format | `Array` |
   | Report self messages | Off |
   | Force event push | On |
   | Heartbeat interval | `30000` ms |
   | Token | Use a strong random token |

4. Save the configuration and verify that both cards are enabled. Bind the services to `127.0.0.1`; do not expose them to the LAN by changing the host to `0.0.0.0`.

### 4. Install and Start QQ Agent

Run the following commands from the repository directory:

```bash
npm install
npm run setup:avatar-bridge
npm start
```

The avatar-bridge installer writes only to NapCat's program and application-data directories; it does not modify `QQ.app`. Run it once after initial setup and again after a NapCat update, then restart QQ/NapCat and QQ Agent. See the [local meme-generator extension guide](docs/MEME_EXTENSION.md) for the complete 902-template setup.

The current `package-lock.json` records npmmirror download URLs. npm 12 may report `EALLOWREMOTE` when the active registry differs from the lockfile source. In that case, install from the same mirror:

```bash
npm install --registry=https://registry.npmmirror.com
```

If the Electron install script ran but the binary download failed, rebuild Electron through the same mirror and start the app again:

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
  npm rebuild electron --registry=https://registry.npmmirror.com
npm start
```

npmmirror is a third-party mirror. Use the official npm and Electron sources when they are available. The project permits the Electron installation script required for development and explicitly blocks the `electron-winstaller` installation script, which is unused for macOS builds.

### 5. Connect QQ Agent to NapCat

1. Open **Settings → QQ / OneBot (NapCat)**.
2. Keep the default endpoints:

   - WebSocket: `ws://127.0.0.1:3001`
   - HTTP: `http://127.0.0.1:3000`

3. Enter the tokens configured for the NapCat WebSocket and HTTP servers, then save. QQ Agent reconnects immediately; QQ does not need to be restarted.
4. Open the **QQ Connection** page. If it shows “OneBot connected” and the active QQ nickname, the process, port, authentication, and login-information path is working.
5. macOS may allow QQ Agent to connect to loopback ports while preventing it from reading the QQ sandbox. The page will show that directory access is restricted without falsely reporting that NapCat is missing. Manually saved tokens are sufficient for the protocol connection; Full Disk Access only affects automatic discovery.

When Clash Fake-IP causes DeepSeek to fail before establishing TLS, QQ Agent detects an `api.deepseek.com` result in `198.18.0.0/15`, obtains a real address through DNSPod DoH, and retries. Image safety downloads use the same real-address fallback before applying the existing private-network blocking rules. The DoH request contains only the domain name; it does not transmit model keys, prompts, chat content, or images. HTTPS certificates are still verified against the original hostname. Set `QQ_AGENT_REAL_DNS_FALLBACK=0` to disable the model-request fallback, or set `QQ_AGENT_DOH_URL` to use a different DoH JSON endpoint for model and image resolution.

### 6. Model and Message Permissions

After OneBot connects, configure a model API, a model, and the chat allow list in QQ Agent. Do not enable responses for all chats until the allow list and automatic-response policy have been reviewed.

Core flows for model connectivity, real QQ message handling, custom persona activation, and image retrieval have been verified. This does not constitute full automated regression testing, multi-machine compatibility verification, Apple signing, or notarization.

### 7. Local Meme Generator

Install the pinned native generator, community extension, fonts, and template resources from the project root:

```bash
brew install rustup
npm run setup:meme
```

Commands use the `#meme` prefix and bypass the language model:

```text
#meme petpet @member
#meme 摸头 123456789
#meme 举牌 “hello”
#meme list 举牌
#meme status
```

The route supports QQ numbers, `@` mentions, images attached to the current message, and images from a replied-to message. Configuration for cooldowns, generation timeout, disabled templates, administrators, resource checks, and avatar caching is under **Settings → Chat Settings → Meme Commands**.

The engine comes from [MemeCrafters/meme-generator-rs](https://github.com/MemeCrafters/meme-generator-rs), with additional templates from [anyliew/meme-emoji](https://github.com/anyliew/meme-emoji), [MemeCrafters/meme-generator-contrib-rs](https://github.com/MemeCrafters/meme-generator-contrib-rs), [anyliew/crazy-emoji](https://github.com/anyliew/crazy-emoji), [LRZ9712/tudou-meme](https://github.com/LRZ9712/tudou-meme), and this repository's trending-meme pack. See the [extension guide](docs/MEME_EXTENSION.md) and [complete candidate catalog](docs/MEME_CANDIDATES.md) for pinned versions, licenses, content boundaries, packaged-app installation, disk usage, and troubleshooting.

### 8. Restore Standard QQ

To stop using NapCat, quit QQ first and switch the program entry point back to **QQ** in NapCat Mac Installer. Confirm that standard QQ starts normally before uninstalling NapCat or revoking installer permissions. Do not delete entry-point files manually, as doing so may prevent QQ from starting.

## Development and Builds

The following development and build entry points are configured in the repository. Manual integration does not constitute full automated testing, Apple signing, or notarization:

```bash
npm install
brew install rustup # Build the pinned official contrib meme extension
npm run setup:meme # Install/update the local meme engine and extension resources
npm start
```

Additional scripts:

```bash
npm run server      # Headless server at http://127.0.0.1:3210 by default
npm run setup:meme  # Install or repair the pinned meme engine and template extension
npm test            # Run the retained upstream test collection
npm run pack:mac    # Build an unsigned arm64 .app
npm run dist:mac    # Build unsigned arm64 DMG and ZIP packages
```

NapCat must be installed independently through [NapCat-Mac-Installer](https://github.com/NapNeko/NapCat-Mac-Installer), and the QQ entry point must be switched to NapCat. OneBot v11 WebSocket and HTTP services must also be enabled in the NapCat WebUI. If macOS prevents QQ Agent from reading the QQ sandbox, enter the OneBot tokens manually in settings; restricted directory access does not affect a correctly configured protocol connection.

### Packaged `.app` Notes

1. The `.app` contains QQ Agent only. QQ and NapCat must be installed separately.
2. The release is unsigned and unnotarized. On first launch, you may need to right-click the app and choose **Open**.

## Sources and Attribution

This repository has the following source relationships:

1. **Direct code upstream:** [K0nd1us/QQ-agent](https://github.com/K0nd1us/QQ-agent). This port uses commit [`72f537f`](https://github.com/K0nd1us/QQ-agent/commit/72f537f947143e2e153597542cb849cbed777771) as its baseline.
2. **Historical source identified by upstream:** [Derpyu520/qq-bridge](https://github.com/Derpyu520/qq-bridge). The `K0nd1us/QQ-agent` README identifies that project as its starting point; this macOS port was not started directly from that repository.
3. **macOS protocol-component reference:** [NapNeko/NapCat-Mac-Installer](https://github.com/NapNeko/NapCat-Mac-Installer). Phase 1 used the paths and launch behavior from v1.6 / commit [`b4fd38f`](https://github.com/NapNeko/NapCat-Mac-Installer/commit/b4fd38faa7cccea1ce0be141cb26925c8f5f6338). NapCat and its installer are separate projects and are not distributed with this repository.
4. **QQ client:** QQ is proprietary software provided by Tencent. It is not part of this repository and is not covered by this repository’s license.
5. **Meme engine:** [MemeCrafters/meme-generator-rs](https://github.com/MemeCrafters/meme-generator-rs), pinned to `v0.2.3`. Its CLI, Node binding, built-in templates, and resources remain independently licensed MIT third-party content.
6. **Additional templates:** [anyliew/meme-emoji](https://github.com/anyliew/meme-emoji), pinned to `v0.0.6+build.59`. Its repository identifies the code as MIT; image rights and usage boundaries remain subject to that project’s own notice.
7. **Official extra templates:** [MemeCrafters/meme-generator-contrib-rs](https://github.com/MemeCrafters/meme-generator-contrib-rs), pinned to commit `5658321`. The project is MIT-licensed and explicitly contains niche, experimental, or potentially uncomfortable templates.
8. **Trending-meme pack:** Source lives in `extensions/qq-agent-trending-memes-rs`. Its back-handed opossum image is downloaded with a pinned SHA-256 from the MIT-licensed [claw16/codex-pet-beishoufushu](https://github.com/claw16/codex-pet-beishoufushu); the SBTI card follows open-project layout ideas, and the remaining cards are drawn by this repository's code. See the [candidate catalog](docs/MEME_CANDIDATES.md) for full provenance.
9. **B1 template extension:** [anyliew/crazy-emoji](https://github.com/anyliew/crazy-emoji), pinned to commit `51f6a21` and compiled locally with Rust `1.93.1`.
10. **B2 Python templates:** [LRZ9712/tudou-meme](https://github.com/LRZ9712/tudou-meme), pinned to commit `016f46b`; its 122 actual template modules run in an isolated Python `meme-generator 0.1.14` environment.
11. **Design reference:** [SodaSizzle/astrbot_plugin_meme_generator](https://github.com/SodaSizzle/astrbot_plugin_meme_generator). This implementation does not depend on AstrBot and does not copy that plugin’s source into this repository.

See [UPSTREAM_CHECK.md](UPSTREAM_CHECK.md) for the upstream version-check record. The port retains the repository’s existing MIT license and copyright notices; see [LICENSE](LICENSE). Users must also comply with the licenses and terms governing QQ, NapCat, and other third-party dependencies.

---

## Important: Codex + GPT-5.6 Sol Development Statement

> **Source checkout, macOS port design and development, compilation, packaging, documentation, Git commits, and GitHub Release publishing for this project were completed by OpenAI Codex + GPT-5.6 Sol with the user’s authorization and cooperation.**
>
> Work performed with Codex + GPT-5.6 Sol builds on the open-source projects and original authors credited above. It does not alter their authorship, copyright notices, or third-party licenses. Core flows have been manually integrated and an arm64 release has been published; full automated testing, multi-machine compatibility verification, signing, and notarization remain subject to future results.

---

<p align="center">
  <a href="https://openai.com/codex/"><strong>Source checkout, macOS port design and development, compilation, packaging, documentation, Git commits, and GitHub Release publishing for this project were completed by OpenAI Codex + GPT-5.6 Sol with the user’s authorization and cooperation.</strong></a>
</p>
