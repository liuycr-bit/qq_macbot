// macOS QQ/NapCat 与通用 OneBot 连接管理。
//
// 设计边界：
// - QQ Agent 不安装、不注入 NapCat，也不修改 /Applications/QQ.app。
// - macOS 上只负责识别官方 NapCat Mac Installer 的目录结构、启动 QQ、
//   展示登录/连接状态以及打开 NapCat WebUI。
// - 仍允许用户填写任意 OneBot v11 正向 WebSocket/HTTP 地址，作为外部模式使用。
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const NAPCAT_INSTALLER_URL = 'https://github.com/NapNeko/NapCat-Mac-Installer';

function expandHome(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw === '~') return os.homedir();
  if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2));
  return raw;
}

function isPermissionError(error) {
  return error?.code === 'EACCES' || error?.code === 'EPERM';
}

function readJsonResult(file) {
  try {
    return { data: JSON.parse(fs.readFileSync(file, 'utf8')), permissionDenied: false, errorCode: '' };
  } catch (error) {
    return { data: null, permissionDenied: isPermissionError(error), errorCode: String(error?.code || '') };
  }
}

function readJson(file) {
  return readJsonResult(file).data;
}

function probePath(file, mode = fs.constants.F_OK) {
  try {
    fs.accessSync(file, mode);
    return { exists: true, permissionDenied: false, errorCode: '' };
  } catch (error) {
    return { exists: false, permissionDenied: isPermissionError(error), errorCode: String(error?.code || '') };
  }
}

function endpointPort(raw, fallback) {
  try {
    const u = new URL(String(raw || ''));
    if (u.port) return Number(u.port);
    return u.protocol === 'wss:' || u.protocol === 'https:' ? 443 : 80;
  } catch {
    return fallback;
  }
}

function endpointHost(raw) {
  try {
    const u = new URL(String(raw || ''));
    return u.hostname || '127.0.0.1';
  } catch {
    return '127.0.0.1';
  }
}

function isPortOpen(host, port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

function serverUrl(protocol, server, fallbackPort) {
  if (!server) return '';
  const host = String(server.host || '127.0.0.1').replace(/^0\.0\.0\.0$/, '127.0.0.1').replace(/^::$/, '127.0.0.1');
  const port = Number(server.port) || fallbackPort;
  return `${protocol}://${host}:${port}`;
}

function pickEnabled(items, fallbackPort) {
  const list = Array.isArray(items) ? items : [];
  return list.find((item) => item?.enable !== false && Number(item?.port) === fallbackPort)
    || list.find((item) => item?.enable !== false)
    || list[0]
    || null;
}

/** 同时兼容 NapCat 4.x 的 network 与旧 SnowLuma 的 networks 字段。 */
function extractOneBotCandidate(data, source = '') {
  const network = data?.network || data?.networks || {};
  const http = pickEnabled(network.httpServers, 3000);
  const ws = pickEnabled(network.websocketServers || network.wsServers, 3001);
  if (!http && !ws) return null;
  const wsToken = String(ws?.token ?? ws?.accessToken ?? '');
  const httpToken = String(http?.token ?? http?.accessToken ?? wsToken);
  return {
    wsToken,
    httpToken,
    wsUrl: serverUrl('ws', ws, 3001),
    httpUrl: serverUrl('http', http, 3000),
    source
  };
}

export class ConnectorManager {
  constructor({ getConfig, emit, log = console.log }) {
    this.getConfig = getConfig;
    this.emit = emit;
    this.log = log;
    this.logs = [];
    this.process = null;
  }

  config() {
    return this.getConfig().connector || {};
  }

  paths() {
    const cfg = this.config();
    const container = path.join(os.homedir(), 'Library', 'Containers', 'com.tencent.qq', 'Data');
    const qqAppPath = expandHome(cfg.qqAppPath) || '/Applications/QQ.app';
    const napcatRoot = expandHome(cfg.napcatRoot) || path.join(container, 'Documents', 'napcat');
    const napcatDataDir = expandHome(cfg.napcatDataDir)
      || path.join(container, 'Library', 'Application Support', 'QQ', 'NapCat');
    const napcatConfigDir = expandHome(cfg.napcatConfigDir)
      || path.join(container, '.config', 'QQ', 'NapCat');
    return {
      qqAppPath,
      qqExecutable: path.join(qqAppPath, 'Contents', 'MacOS', 'QQ'),
      qqPackageFile: path.join(qqAppPath, 'Contents', 'Resources', 'app', 'package.json'),
      qqPackageBackupFile: path.join(qqAppPath, 'Contents', 'Resources', 'app', 'package.json.bak'),
      napcatLoaderFile: path.join(container, 'Documents', 'loadNapCat.js'),
      napcatRoot,
      napcatDataDir,
      napcatConfigDir
    };
  }

  pushLog(text, stream = 'stdout') {
    const line = { at: Date.now(), stream, text: String(text ?? '').replace(/\r?\n$/, '') };
    if (!line.text) return;
    this.logs.push(line);
    if (this.logs.length > 500) this.logs.splice(0, this.logs.length - 500);
    this.emit('connector-log', line);
  }

  recentLogs(limit = 200) {
    return this.logs.slice(-Math.max(1, Number(limit) || 200));
  }

  async qqPids() {
    if (process.platform !== 'darwin') return [];
    try {
      const { stdout } = await execFileAsync('/usr/bin/pgrep', ['-x', 'QQ']);
      return String(stdout).split(/\s+/).map(Number).filter((pid) => Number.isInteger(pid) && pid > 0);
    } catch {
      return [];
    }
  }

  onebotConfigScan() {
    const p = this.paths();
    const dirs = [
      path.join(p.napcatRoot, 'config'),
      path.join(p.napcatDataDir, 'config'),
      path.join(p.napcatConfigDir, 'config'),
      p.napcatConfigDir
    ];
    const found = new Set();
    const permissionDeniedPaths = [];
    for (const dir of dirs) {
      try {
        for (const name of fs.readdirSync(dir)) {
          if (/^(onebot11|onebot)_\d+\.json$/i.test(name) || /^onebot11\.json$/i.test(name)) {
            found.add(path.join(dir, name));
          }
        }
      } catch (error) {
        if (isPermissionError(error)) permissionDeniedPaths.push(dir);
      }
    }
    return {
      files: [...found].sort(),
      permissionDenied: permissionDeniedPaths.length > 0,
      permissionDeniedPaths
    };
  }

  onebotConfigFiles() {
    return this.onebotConfigScan().files;
  }

  readOneBotCandidates() {
    const cfg = this.config();
    const current = {
      wsToken: String(cfg.accessToken || ''),
      httpToken: String(cfg.httpAccessToken || cfg.accessToken || ''),
      wsUrl: String(cfg.wsUrl || 'ws://127.0.0.1:3001'),
      httpUrl: String(cfg.httpUrl || 'http://127.0.0.1:3000'),
      source: 'QQ Agent 设置'
    };
    const candidates = [current];
    for (const file of this.onebotConfigFiles()) {
      const candidate = extractOneBotCandidate(readJson(file), file);
      if (candidate) candidates.push(candidate);
    }
    const seen = new Set();
    return candidates.filter((candidate) => {
      const sig = `${candidate.wsUrl}|${candidate.httpUrl}|${candidate.wsToken}|${candidate.httpToken}`;
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
  }

  readWebui() {
    const p = this.paths();
    const files = [
      path.join(p.napcatDataDir, 'config', 'webui.json'),
      path.join(p.napcatConfigDir, 'webui.json'),
      path.join(p.napcatRoot, 'config', 'webui.json')
    ];
    const permissionDeniedPaths = [];
    for (const file of files) {
      const result = readJsonResult(file);
      if (result.permissionDenied) permissionDeniedPaths.push(file);
      const data = result.data;
      if (!data) continue;
      const port = Number(data.port) || 6099;
      const token = String(data.token || '');
      const webuiUrl = `http://127.0.0.1:${port}/webui${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      return { webuiUrl, webuiConfigFile: file, webuiPermissionDenied: false, webuiPermissionDeniedPaths: [] };
    }
    return {
      // macOS 的 App 数据保护可能允许连接 6099，却拒绝读取 webui.json。
      // 这种情况下仍提供本机入口，用户可使用已登录的浏览器会话访问。
      webuiUrl: permissionDeniedPaths.length ? 'http://127.0.0.1:6099/webui' : '',
      webuiConfigFile: '',
      webuiPermissionDenied: permissionDeniedPaths.length > 0,
      webuiPermissionDeniedPaths: permissionDeniedPaths
    };
  }

  installationStatus() {
    const p = this.paths();
    const napcatPackageFile = path.join(p.napcatRoot, 'package.json');
    const napcatPackageResult = readJsonResult(napcatPackageFile);
    const napcatPackage = napcatPackageResult.data;
    const qqPackage = readJson(p.qqPackageFile);
    const loaderProbe = probePath(p.napcatLoaderFile, fs.constants.R_OK);
    const main = String(qqPackage?.main || '');
    return {
      qqInstalled: fs.existsSync(p.qqExecutable),
      qqExecutableReady: (() => {
        try {
          fs.accessSync(p.qqExecutable, fs.constants.X_OK);
          return true;
        } catch {
          return false;
        }
      })(),
      napcatInstalled: !!napcatPackage,
      napcatPermissionDenied: napcatPackageResult.permissionDenied || loaderProbe.permissionDenied,
      napcatPermissionErrorCode: napcatPackageResult.errorCode || loaderProbe.errorCode,
      napcatVersion: String(napcatPackage?.version || ''),
      napcatPackageFile,
      loaderInstalled: loaderProbe.exists,
      entryPatched: main.includes('loadNapCat.js'),
      entryMain: main,
      entryBackupAvailable: fs.existsSync(p.qqPackageBackupFile),
      installerUrl: NAPCAT_INSTALLER_URL
    };
  }

  async status() {
    const cfg = this.config();
    const p = this.paths();
    const wsUrl = String(cfg.wsUrl || 'ws://127.0.0.1:3001');
    const httpUrl = String(cfg.httpUrl || 'http://127.0.0.1:3000');
    const [pids, onebotReady, onebotHttpReady] = await Promise.all([
      this.qqPids(),
      isPortOpen(endpointHost(wsUrl), endpointPort(wsUrl, 3001)),
      isPortOpen(endpointHost(httpUrl), endpointPort(httpUrl, 3000))
    ]);
    const onebotConfigScan = this.onebotConfigScan();
    const onebotConfigFiles = onebotConfigScan.files;
    return {
      type: String(cfg.type || (process.platform === 'darwin' ? 'napcat-macos' : 'external-onebot')),
      platform: process.platform,
      managed: !!this.process,
      pid: this.process?.pid ?? null,
      qqRunning: pids.length > 0,
      qqPids: pids,
      onebotReady,
      onebotHttpReady,
      onebotConfigCount: onebotConfigFiles.length,
      onebotConfigNames: onebotConfigFiles.map((file) => path.basename(file)),
      onebotConfigPermissionDenied: onebotConfigScan.permissionDenied,
      onebotConfigPermissionDeniedPaths: onebotConfigScan.permissionDeniedPaths,
      ...this.installationStatus(),
      ...this.readWebui(),
      paths: p
    };
  }

  /**
   * 只读本机体检。不会启动/停止 QQ，不会改写 QQ.app，也不会读取或返回令牌。
   * required=true 的项目全部通过，才表示协议层已经具备联调条件。
   */
  async diagnose() {
    const status = await this.status();
    const external = status.type === 'external-onebot';
    const protocolReady = status.onebotReady && status.onebotHttpReady;
    const sandboxReadRestricted = status.napcatPermissionDenied
      || status.onebotConfigPermissionDenied
      || status.webuiPermissionDenied;
    const checks = [];
    const add = (id, ok, label, detail, action = '', required = true) => {
      checks.push({ id, ok: !!ok, label, detail: String(detail || ''), action: String(action || ''), required });
    };

    add(
      'platform',
      process.platform === 'darwin' || external,
      '运行平台',
      external ? `${process.platform}（外部 OneBot 模式）` : `${process.platform} / ${process.arch}`,
      '内置 NapCat 启动只支持 macOS；其他平台请切换为外部 OneBot。'
    );

    if (!external) {
      add('architecture', process.arch === 'arm64', '处理器架构', process.arch, '当前打包配置优先支持 Apple Silicon（arm64）。', false);
      add('qq-app', status.qqInstalled, 'QQ.app', status.paths.qqAppPath, '请先安装 macOS QQ，或在设置中填写实际 QQ.app 路径。');
      add('qq-executable', status.qqExecutableReady, 'QQ 可执行文件', status.paths.qqExecutable, 'QQ.app 不完整或可执行权限异常，请重新安装 QQ。');
      const napcatConfirmed = status.napcatInstalled || (status.entryPatched && protocolReady);
      const loaderConfirmed = status.loaderInstalled || (status.entryPatched && protocolReady);
      const restrictedDetail = 'QQ 沙盒目录受 macOS App 数据保护限制；已通过 QQ 入口和 OneBot 双端口确认 NapCat 正在运行';
      add('napcat-package', napcatConfirmed, 'NapCat 程序', status.napcatInstalled ? `${status.napcatVersion || '版本未知'} · ${status.napcatPackageFile}` : (napcatConfirmed && sandboxReadRestricted ? restrictedDetail : status.paths.napcatRoot), '请使用官方 NapCat Mac Installer 安装 NapCat。');
      add('napcat-loader', loaderConfirmed, 'NapCat 加载器', status.loaderInstalled ? status.paths.napcatLoaderFile : (loaderConfirmed && sandboxReadRestricted ? restrictedDetail : status.paths.napcatLoaderFile), '请在官方安装器中重新安装或修复 NapCat。');
      add('qq-entry', status.entryPatched, 'QQ 程序入口', status.entryMain || '未读取到 main 字段', '请在官方安装器中执行“切换程序入口 NapCat”。');
      add('qq-backup', status.entryBackupAvailable, 'QQ 入口备份', status.paths.qqPackageBackupFile, '建议使用官方安装器重新执行入口切换，确保可恢复原版 QQ。', false);
      add('qq-process', status.qqRunning, 'QQ / NapCat 进程', status.qqRunning ? `运行中（${status.qqPids.join(', ')}）` : '未运行', '完成安装和入口切换后，点击“启动 NapCat”。');
      const configConfirmed = status.onebotConfigCount > 0 || (status.onebotConfigPermissionDenied && protocolReady);
      add('onebot-config', configConfirmed, 'OneBot 配置', status.onebotConfigCount > 0 ? status.onebotConfigNames.join(', ') : (configConfirmed ? '目录读取受限；已通过 WebSocket 与 HTTP 端口确认配置生效' : '尚未生成账号配置'), '请完成 QQ 登录，并在 NapCat WebUI 中启用 OneBot v11 WebSocket 与 HTTP 服务。');
      add('webui-config', !!status.webuiConfigFile || status.webuiPermissionDenied, 'NapCat WebUI 配置', status.webuiConfigFile || (status.webuiPermissionDenied ? '目录读取受限；可通过本机 6099 端口打开 WebUI' : '尚未生成'), '启动 NapCat 并完成首次登录后会自动生成。', false);
      add('napcat-read-access', !sandboxReadRestricted, 'QQ 沙盒目录读取', sandboxReadRestricted ? '受 macOS App 数据保护限制；自动读取令牌不可用，当前使用设置中保存的本机令牌' : '可读取', '如需自动识别配置，可在系统设置中为 QQ Agent Mac 授予完全磁盘访问权限。', false);
    }

    add('onebot-ws', status.onebotReady, 'OneBot WebSocket', String(this.config().wsUrl || 'ws://127.0.0.1:3001'), '请在 NapCat WebUI 中启用 WebSocket 服务，并核对地址、端口和令牌。');
    add('onebot-http', status.onebotHttpReady, 'OneBot HTTP', String(this.config().httpUrl || 'http://127.0.0.1:3000'), '请在 NapCat WebUI 中启用 HTTP 服务，并核对地址、端口和令牌。');

    const blocking = checks.filter((item) => item.required && !item.ok);
    return {
      ready: blocking.length === 0,
      mode: status.type,
      checkedAt: Date.now(),
      checks,
      nextAction: blocking[0]?.action || (blocking.length === 0 ? '协议端端口已经就绪，请重新连接 OneBot 并确认登录账号。' : '')
    };
  }

  attachProcess(child) {
    this.process = child;
    child.stdout?.on('data', (data) => {
      for (const line of String(data).split(/\r?\n/)) if (line.trim()) this.pushLog(line, 'stdout');
    });
    child.stderr?.on('data', (data) => {
      for (const line of String(data).split(/\r?\n/)) if (line.trim()) this.pushLog(line, 'stderr');
    });
    child.once('error', (error) => this.pushLog(`QQ/NapCat 启动失败：${error?.message ?? error}`, 'stderr'));
    child.once('exit', (code, signal) => {
      if (this.process === child) this.process = null;
      this.pushLog(`QQ/NapCat 进程已退出（code=${code ?? ''} signal=${signal ?? ''}）`, code === 0 ? 'stdout' : 'stderr');
      this.emit('connector-status', { running: false, pid: null });
    });
  }

  async terminateQQ() {
    if (process.platform !== 'darwin') return false;
    try {
      await execFileAsync('/usr/bin/killall', ['QQ']);
    } catch (error) {
      if ((await this.qqPids()).length) throw error;
    }
    try { await execFileAsync('/usr/bin/killall', ['QQEXDOC']); } catch { /* optional helper */ }
    await new Promise((resolve) => setTimeout(resolve, 800));
    return true;
  }

  async launch({ restart = false } = {}) {
    const cfg = this.config();
    if (String(cfg.type || 'napcat-macos') === 'external-onebot') {
      return { ok: false, code: 'EXTERNAL_MODE', error: '当前是外部 OneBot 模式，请先在协议端启动服务，再点“重新连接”。' };
    }
    if (process.platform !== 'darwin') {
      return { ok: false, code: 'UNSUPPORTED_PLATFORM', error: '此移植版本的内置启动仅支持 macOS；其他系统请使用外部 OneBot 模式。' };
    }
    const status = await this.status();
    if (status.onebotReady) {
      this.pushLog('NapCat OneBot 端口已就绪，无需重复启动。');
      return { ok: true, alreadyRunning: true, status };
    }
    if (!status.qqInstalled) {
      return { ok: false, code: 'QQ_NOT_INSTALLED', error: `未找到 QQ：${status.paths.qqAppPath}` };
    }
    if (!status.napcatInstalled && !status.napcatPermissionDenied) {
      return { ok: false, code: 'NAPCAT_NOT_INSTALLED', error: '未检测到 NapCat。请先使用官方 Mac 安装器安装并切换 QQ 入口。', installerUrl: NAPCAT_INSTALLER_URL };
    }
    if (!status.loaderInstalled && !status.napcatPermissionDenied) {
      return { ok: false, code: 'NAPCAT_LOADER_MISSING', error: `未找到 NapCat 加载器：${status.paths.napcatLoaderFile}。请使用官方 Mac 安装器重新安装或修复。`, installerUrl: NAPCAT_INSTALLER_URL };
    }
    if (!status.entryPatched) {
      return { ok: false, code: 'NAPCAT_NOT_PATCHED', error: 'NapCat 已存在，但 QQ 入口尚未切换到 NapCat。请在官方 Mac 安装器中完成“修改 QQ”。', installerUrl: NAPCAT_INSTALLER_URL };
    }
    if (status.qqRunning && !restart) {
      return { ok: false, code: 'QQ_RESTART_REQUIRED', error: 'QQ 正在以普通模式运行。启动 NapCat 需要先退出并重新打开 QQ。' };
    }
    if (status.qqRunning) {
      this.pushLog('正在退出当前 QQ，以 NapCat 模式重新启动…');
      await this.terminateQQ();
    }
    const p = this.paths();
    const child = spawn(p.qqExecutable, ['--no-sandbox'], {
      cwd: path.dirname(p.qqExecutable),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      env: { ...process.env }
    });
    this.attachProcess(child);
    this.pushLog(`QQ/NapCat 启动中（pid=${child.pid}）。首次使用请在 QQ 窗口完成登录。`);
    this.emit('connector-status', { running: true, pid: child.pid });
    return { ok: true, launched: true, pid: child.pid };
  }

  async stop({ force = false } = {}) {
    if (this.process) {
      const pid = this.process.pid;
      this.process.kill('SIGTERM');
      this.pushLog(`已请求关闭由 QQ Agent 启动的 QQ/NapCat（pid=${pid}）。`);
      return { ok: true, stopped: true, pid };
    }
    const pids = await this.qqPids();
    if (!pids.length) return { ok: true, stopped: false, alreadyStopped: true };
    if (!force) {
      return { ok: false, code: 'EXTERNAL_PROCESS', error: '当前 QQ 不是由 QQ Agent 启动。确认后可关闭正在运行的 QQ 与 NapCat。', pids };
    }
    await this.terminateQQ();
    this.pushLog('已关闭正在运行的 QQ/NapCat。');
    return { ok: true, stopped: true, pids };
  }

  async reconnect(onebot) {
    const cfg = this.config();
    onebot.wsUrl = String(cfg.wsUrl || onebot.wsUrl);
    onebot.httpUrl = String(cfg.httpUrl || onebot.httpUrl).replace(/\/+$/, '');
    onebot.accessToken = String(cfg.accessToken || '');
    onebot.httpToken = String(cfg.httpAccessToken || cfg.accessToken || '');
    await onebot.reconnect();
    this.pushLog(`正在重新连接 OneBot：${onebot.wsUrl}`);
    return { ok: true };
  }

  openTarget(target) {
    if (!target) throw new Error('没有可打开的目标');
    let child;
    if (process.platform === 'darwin') child = spawn('/usr/bin/open', [target], { detached: true, stdio: 'ignore' });
    else if (process.platform === 'win32') child = spawn('cmd.exe', ['/c', 'start', '', target], { detached: true, stdio: 'ignore', windowsHide: true });
    else child = spawn('xdg-open', [target], { detached: true, stdio: 'ignore' });
    child.unref();
  }

  openFolder() {
    const p = this.paths();
    const target = fs.existsSync(p.napcatDataDir) ? p.napcatDataDir
      : (fs.existsSync(p.napcatRoot) ? p.napcatRoot : path.dirname(p.napcatRoot));
    this.openTarget(target);
    return { ok: true, path: target };
  }

  openWebui() {
    const { webuiUrl } = this.readWebui();
    if (!webuiUrl) return { ok: false, error: '尚未发现 NapCat WebUI 配置。请先启动 NapCat 并完成 QQ 登录。' };
    this.openTarget(webuiUrl);
    return { ok: true, webuiUrl };
  }

  openInstaller() {
    this.openTarget(NAPCAT_INSTALLER_URL);
    return { ok: true, installerUrl: NAPCAT_INSTALLER_URL };
  }
}
