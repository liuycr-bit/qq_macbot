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

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
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
      return String(stdout).split(/\s+/).map(Number).filter(Number.isFinite);
    } catch {
      return [];
    }
  }

  onebotConfigFiles() {
    const p = this.paths();
    const dirs = [
      path.join(p.napcatRoot, 'config'),
      path.join(p.napcatDataDir, 'config'),
      path.join(p.napcatConfigDir, 'config'),
      p.napcatConfigDir
    ];
    const found = new Set();
    for (const dir of dirs) {
      try {
        for (const name of fs.readdirSync(dir)) {
          if (/^(onebot11|onebot)_\d+\.json$/i.test(name) || /^onebot11\.json$/i.test(name)) {
            found.add(path.join(dir, name));
          }
        }
      } catch { /* directory absent */ }
    }
    return [...found].sort();
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
    for (const file of files) {
      const data = readJson(file);
      if (!data) continue;
      const port = Number(data.port) || 6099;
      const token = String(data.token || '');
      const webuiUrl = `http://127.0.0.1:${port}/webui${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      return { webuiUrl, webuiConfigFile: file };
    }
    return { webuiUrl: '', webuiConfigFile: '' };
  }

  installationStatus() {
    const p = this.paths();
    const napcatPackage = readJson(path.join(p.napcatRoot, 'package.json'));
    const qqPackage = readJson(p.qqPackageFile);
    const main = String(qqPackage?.main || '');
    return {
      qqInstalled: fs.existsSync(p.qqExecutable),
      napcatInstalled: !!napcatPackage,
      napcatVersion: String(napcatPackage?.version || ''),
      entryPatched: main.includes('loadNapCat.js'),
      installerUrl: NAPCAT_INSTALLER_URL
    };
  }

  async status() {
    const cfg = this.config();
    const p = this.paths();
    const wsUrl = String(cfg.wsUrl || 'ws://127.0.0.1:3001');
    const [pids, onebotReady] = await Promise.all([
      this.qqPids(),
      isPortOpen(endpointHost(wsUrl), endpointPort(wsUrl, 3001))
    ]);
    return {
      type: String(cfg.type || (process.platform === 'darwin' ? 'napcat-macos' : 'external-onebot')),
      platform: process.platform,
      managed: !!this.process,
      pid: this.process?.pid ?? null,
      qqRunning: pids.length > 0,
      qqPids: pids,
      onebotReady,
      ...this.installationStatus(),
      ...this.readWebui(),
      paths: p
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
    if (!status.napcatInstalled) {
      return { ok: false, code: 'NAPCAT_NOT_INSTALLED', error: '未检测到 NapCat。请先使用官方 Mac 安装器安装并切换 QQ 入口。', installerUrl: NAPCAT_INSTALLER_URL };
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

