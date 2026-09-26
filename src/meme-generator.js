// 独立表情命令路由：#meme ... → 本地 meme-generator Worker → SendQueue。
// 命中本路由的消息由 app.js 标成“已读且对 Agent 隐藏”，绝不会唤醒大模型。
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { DATA_DIR, getConfig, updateConfig } from './config.js';
import { extractMediaFromSegments } from './onebot.js';
import { safeFetchBinary } from './safe-fetch.js';

const MEME_HOME = path.join(DATA_DIR, 'meme-generator');
const AVATAR_CACHE_DIR = path.join(MEME_HOME, 'cache', 'avatars');
const QQ_RE = /^\d{5,12}$/;
const KNOWN_QQ_AVATAR_PLACEHOLDERS = new Set([
  // qlogo 的 40x40 JPEG 默认企鹅。
  'd3b86c828178ce7a598e86eb74c8dc1b1c3948f9cbd01aece8eeb3915a7dcc06',
  // Qzone 的 120x120“暂时无法查看”占位图。
  '1b8214ac4449461450d94a808d42e658d6aaac13581554e6776a8e2b83d75125'
]);

function commandText(event) {
  if (Array.isArray(event?.message)) {
    return event.message
      .filter((seg) => seg?.type === 'text')
      .map((seg) => String(seg?.data?.text || ''))
      .join('')
      .trim();
  }
  return String(event?.raw_message ?? event?.message ?? '')
    .replace(/\[CQ:(?:at|image|reply)[^\]]*\]/gi, ' ')
    .trim();
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function commandBody(event, prefix) {
  const text = commandText(event);
  const match = new RegExp(`^${escapeRegExp(prefix)}(?:\\s+|$)`, 'i').exec(text);
  if (!match) return null;
  return text.slice(match[0].length).trim();
}

function splitArgs(text) {
  const normalized = String(text || '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    // 兼容群聊里常见的“模板名紧跟引号”写法：举牌“你好”。
    .replace(/^([^\s"']+)(?=["'])/, '$1 ');
  const out = [];
  const re = /"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'|(\S+)/g;
  let match;
  while ((match = re.exec(normalized))) {
    const value = match[1] ?? match[2] ?? match[3] ?? '';
    out.push(value.replace(/\\([\\"'])/g, '$1'));
  }
  return out;
}

function detectMime(buffer) {
  if (!buffer || buffer.length < 12) return 'image/png';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.toString('ascii', 0, 8) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return 'image/png';
}

function extensionForMime(mime) {
  if (mime === 'image/gif') return 'gif';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  return 'png';
}

function isDefaultQQAvatar(buffer) {
  // qlogo/Qzone 在账号头像不可直接读取时会返回多种格式的占位图。
  // 不把该占位图写入缓存，否则后续即使换源也会一直复用错误头像。
  if (!buffer || buffer.length < 24) return false;
  const fingerprint = createHash('sha256').update(buffer).digest('hex');
  if (KNOWN_QQ_AVATAR_PLACEHOLDERS.has(fingerprint)) return true;
  if (buffer.toString('ascii', 1, 4) !== 'PNG') return false;
  try {
    return buffer.readUInt32BE(16) === 40 && buffer.readUInt32BE(20) === 40;
  } catch {
    return false;
  }
}

function isImageBuffer(buffer) {
  if (!buffer || buffer.length < 12) return false;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
  if (buffer.subarray(0, 3).toString('ascii') === 'GIF') return true;
  return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
}

function expandHome(value) {
  const raw = String(value || '').trim();
  if (raw === '~') return os.homedir();
  if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2));
  return raw;
}

function readableBytes(bytes) {
  const n = Math.max(0, Number(bytes) || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

class MemeWorkerClient {
  constructor({ log }) {
    this.log = log;
    this.worker = null;
    this.pending = new Map();
    this.nextId = 1;
    this.state = 'stopped';
    this.lastStatus = null;
    this.lastError = '';
    this.initPromise = null;
    this.closing = false;
    this.intentionalStops = new WeakSet();
  }

  start() {
    if (this.worker) return this.initPromise;
    this.closing = false;
    this.state = 'starting';
    fs.mkdirSync(MEME_HOME, { recursive: true });
    const worker = new Worker(new URL('./meme-worker.js', import.meta.url), {
      type: 'module',
      workerData: { memeHome: MEME_HOME }
    });
    this.worker = worker;
    worker.on('message', (message) => this.#onMessage(message));
    worker.on('error', (error) => {
      if (this.worker !== worker && this.intentionalStops.has(worker)) return;
      this.lastError = String(error?.message ?? error);
      this.state = 'error';
      this.log('[meme] Worker 出错:', this.lastError);
    });
    worker.on('exit', (code) => {
      if (this.worker === worker) this.worker = null;
      for (const [id, item] of this.pending) {
        if (item.worker !== worker) continue;
        const { reject, timer } = item;
        clearTimeout(timer);
        reject(new Error(`表情 Worker 已退出（code=${code}）`));
        this.pending.delete(id);
      }
      const intentional = this.intentionalStops.has(worker);
      this.intentionalStops.delete(worker);
      if (!this.closing && !intentional && code !== 0) {
        this.state = 'error';
        this.lastError = `Worker 已退出（code=${code}）`;
      }
    });
    this.state = 'checking';
    const initWorker = worker;
    this.initPromise = this.request('initialize', {
      checkResources: getConfig().meme?.resourceCheckOnStart !== false
    }, 10 * 60 * 1000).then((status) => {
      if (this.worker === initWorker) {
        this.lastStatus = status;
        this.state = status?.state || 'ready';
        this.lastError = status?.error || '';
      }
      return status;
    }).catch((error) => {
      if (this.worker === initWorker) {
        this.state = 'error';
        this.lastError = String(error?.message ?? error);
      }
      throw error;
    });
    // 启动阶段不让未等待的拒绝变成 unhandledRejection；generate() 仍会读到同一个失败。
    this.initPromise.catch(() => {});
    return this.initPromise;
  }

  #onMessage(message) {
    const item = this.pending.get(message?.id);
    if (!item) return;
    this.pending.delete(message.id);
    clearTimeout(item.timer);
    if (message.ok) item.resolve(message.result);
    else item.reject(new Error(String(message.error || '表情 Worker 操作失败')));
  }

  request(type, payload = {}, timeoutMs = 30000) {
    if (!this.worker) throw new Error('表情 Worker 未启动');
    const worker = this.worker;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`表情生成超时（${Math.round(timeoutMs / 1000)} 秒）`));
        this.restart();
      }, Math.max(1000, Number(timeoutMs) || 30000));
      this.pending.set(id, { resolve, reject, timer, worker });
      worker.postMessage({ id, type, payload });
    });
  }

  async ready() {
    if (!this.worker) this.start();
    await this.initPromise;
    if (this.state === 'error') throw new Error(this.lastError || '表情 Worker 初始化失败');
  }

  restart() {
    const old = this.worker;
    this.worker = null;
    if (old) this.intentionalStops.add(old);
    try { old?.terminate(); } catch { /* ignore */ }
    this.start();
  }

  async status() {
    if (!this.worker) return { state: this.state, error: this.lastError };
    if (this.state === 'checking' || this.state === 'starting') {
      return { ...(this.lastStatus || {}), state: this.state, error: this.lastError };
    }
    try {
      const status = await this.request('status', {}, 5000);
      this.lastStatus = status;
      return status;
    } catch {
      return { ...(this.lastStatus || {}), state: this.state, error: this.lastError };
    }
  }

  async stop() {
    this.closing = true;
    const worker = this.worker;
    this.worker = null;
    if (worker) this.intentionalStops.add(worker);
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error('表情 Worker 已停止'));
    }
    this.pending.clear();
    if (worker) await worker.terminate().catch(() => {});
    this.state = 'stopped';
  }
}

export class MemeGenerator {
  constructor({ onebot, sender, log = console.log }) {
    this.onebot = onebot;
    this.sender = sender;
    this.log = log;
    this.worker = new MemeWorkerClient({ log });
    this.cooldowns = new Map();
    this.avatarBridge = { state: 'unknown', lastError: '', lastSuccessAt: 0 };
  }

  start() {
    this.worker.start();
  }

  stop() {
    return this.worker.stop();
  }

  prefix() {
    return String(getConfig().meme?.prefix || '#meme').trim() || '#meme';
  }

  matches(event) {
    return commandBody(event, this.prefix()) !== null;
  }

  async status() {
    const worker = await this.worker.status();
    const cache = await this.#avatarCacheStats();
    return {
      ...worker,
      enabled: getConfig().meme?.enabled !== false,
      prefix: this.prefix(),
      disabledTemplates: [...(getConfig().meme?.disabledTemplates || [])],
      avatarCache: cache,
      avatarBridge: {
        enabled: getConfig().meme?.avatarBridgeEnabled !== false,
        ...this.avatarBridge
      },
      dataDirectory: MEME_HOME
    };
  }

  async handle({ chatKey, kind, chatId, event, senderId }) {
    const body = commandBody(event, this.prefix());
    if (body === null) return false;
    const args = splitArgs(body);
    const action = String(args.shift() || '').trim();
    const replyToMessageId = event?.message_id ?? null;

    try {
      if (!action || ['帮助', 'help', '?'].includes(action.toLowerCase())) {
        await this.#sendText(chatKey, this.#helpText(), replyToMessageId);
        return true;
      }
      if (['状态', 'status', '资源', 'resource'].includes(action.toLowerCase())) {
        await this.#sendText(chatKey, await this.#statusText(), replyToMessageId);
        return true;
      }
      if (getConfig().meme?.enabled === false) {
        await this.#sendText(chatKey, '表情生成模块当前已停用。', replyToMessageId);
        return true;
      }
      if (['列表', 'list', '搜索', 'search'].includes(action.toLowerCase())) {
        await this.#listTemplates(chatKey, args.join(' '), replyToMessageId);
        return true;
      }
      if (['禁用列表', 'disabled'].includes(action.toLowerCase())) {
        const disabled = getConfig().meme?.disabledTemplates || [];
        await this.#sendText(chatKey, disabled.length ? `已禁用模板：${disabled.join('、')}` : '当前没有禁用模板。', replyToMessageId);
        return true;
      }
      if (['禁用', 'disable', '启用', 'enable'].includes(action.toLowerCase())) {
        await this.#manageTemplate({ chatKey, action, query: args.join(' '), event, senderId, replyToMessageId });
        return true;
      }

      await this.#generate({ chatKey, kind, chatId, event, senderId, templateQuery: action, args, replyToMessageId });
      return true;
    } catch (error) {
      const message = String(error?.message ?? error);
      this.log(`[meme] ${chatKey} 处理失败:`, message);
      await this.#sendText(chatKey, `表情生成失败：${message}`, replyToMessageId).catch(() => {});
      return true;
    }
  }

  #helpText() {
    const p = this.prefix();
    return [
      `表情命令：${p} <模板/关键词> [文字、QQ号、@群友或图片]`,
      `示例：${p} 摸头 @群友`,
      `示例：${p} 举牌 "你好世界"`,
      `示例：引用一张图片后发送 ${p} 摸头`,
      `查询：${p} 列表 [关键词]；${p} 状态`
    ].join('\n');
  }

  async #statusText() {
    const status = await this.status();
    const stateNames = {
      idle: '未初始化', starting: '正在启动', checking: '正在检查/下载资源',
      ready: '就绪', partial: '资源不完整', error: '异常', stopped: '已停止'
    };
    const images = status.resources?.images || {};
    const fonts = status.resources?.fonts || {};
    return [
      `表情模块：${stateNames[status.state] || status.state || '未知'}`,
      `生成器：${status.version || '加载中'}；模板 ${status.templates || 0} 个`,
      status.engines ? `模板来源：原生 ${status.engines.native || 0}，tudou ${status.engines.tudou || 0}，gengtu ${status.engines.gengtu || 0}，经典模板 ${status.engines.classic || 0}` : '',
      `资源：图片 ${images.files || 0} 个 / ${readableBytes(images.bytes)}，字体 ${fonts.files || 0} 个 / ${readableBytes(fonts.bytes)}`,
      `头像缓存：${status.avatarCache?.files || 0} 个 / ${readableBytes(status.avatarCache?.bytes)}`,
      `NapCat 头像桥：${status.avatarBridge?.enabled === false ? '已关闭' : (status.avatarBridge?.state === 'ready' ? '已连接' : status.avatarBridge?.state === 'error' ? '暂不可用（自动使用公网回退）' : '等待首次使用')}`,
      `禁用模板：${status.disabledTemplates?.length || 0} 个`,
      status.error ? `错误：${status.error}` : ''
    ].filter(Boolean).join('\n');
  }

  async #listTemplates(chatKey, query, replyToMessageId) {
    await this.worker.ready();
    const all = await this.worker.request('list', { query }, 10000);
    const disabled = new Set((getConfig().meme?.disabledTemplates || []).map(String));
    const list = all.filter((item) => !disabled.has(item.key));
    const shown = list.slice(0, 60).map((item) => item.keywords[0] ? `${item.key}（${item.keywords[0]}）` : item.key);
    const suffix = list.length > shown.length ? `\n……另有 ${list.length - shown.length} 个，请加关键词搜索。` : '';
    await this.#sendText(chatKey, `${query ? `匹配“${query}”` : '可用模板'} ${list.length} 个：\n${shown.join('、') || '无'}${suffix}`, replyToMessageId);
  }

  #isAdmin(event, senderId) {
    const role = String(event?.sender?.role || '').toLowerCase();
    if (role === 'owner' || role === 'admin') return true;
    return (getConfig().meme?.adminQQs || []).map(String).includes(String(senderId));
  }

  async #manageTemplate({ chatKey, action, query, event, senderId, replyToMessageId }) {
    if (!this.#isAdmin(event, senderId)) throw new Error('只有群主、群管理员或配置中的表情管理员可以修改模板开关');
    if (!query) throw new Error('请填写模板名或关键词');
    await this.worker.ready();
    const info = await this.worker.request('resolve', { query }, 10000);
    if (!info) throw new Error(`找不到唯一模板：${query}`);
    const disabled = new Set((getConfig().meme?.disabledTemplates || []).map(String));
    const disabling = ['禁用', 'disable'].includes(String(action).toLowerCase());
    if (disabling) disabled.add(info.key); else disabled.delete(info.key);
    updateConfig({ meme: { disabledTemplates: [...disabled].sort() } });
    await this.#sendText(chatKey, `已${disabling ? '禁用' : '启用'}模板：${info.key}`, replyToMessageId);
  }

  #checkCooldown(chatKey, senderId) {
    const seconds = Math.min(60, Math.max(0, Number(getConfig().meme?.cooldownSeconds) || 0));
    if (!seconds) return;
    const key = `${chatKey}:${senderId}`;
    const now = Date.now();
    const last = this.cooldowns.get(key) || 0;
    const remain = seconds * 1000 - (now - last);
    if (remain > 0) throw new Error(`冷却中，请 ${Math.ceil(remain / 1000)} 秒后再试`);
    this.cooldowns.set(key, now);
    if (this.cooldowns.size > 2000) {
      const cutoff = now - 60 * 60 * 1000;
      for (const [k, ts] of this.cooldowns) if (ts < cutoff) this.cooldowns.delete(k);
    }
  }

  async #generate({ chatKey, kind, chatId, event, senderId, templateQuery, args, replyToMessageId }) {
    this.#checkCooldown(chatKey, senderId);
    await this.worker.ready();
    const info = await this.worker.request('resolve', { query: templateQuery }, 10000);
    if (!info) throw new Error(`找不到唯一模板：${templateQuery}（可用“${this.prefix()} 列表 ${templateQuery}”搜索）`);
    if ((getConfig().meme?.disabledTemplates || []).map(String).includes(info.key)) {
      throw new Error(`模板 ${info.key} 已被禁用`);
    }

    const explicitQQs = [];
    const bareQQs = [];
    const textArgs = [];
    for (const arg of args) {
      const explicit = /^qq:(\d{5,12})$/i.exec(arg);
      if (explicit) explicitQQs.push(explicit[1]);
      else if (QQ_RE.test(arg)) bareQQs.push(arg);
      else textArgs.push(arg);
    }

    const sources = await this.#segmentSources(event);
    for (const qq of explicitQQs) sources.push({ type: 'avatar', qq });
    // 纯数字只有在模板还需要图片时才解释为 QQ 号；纯文字模板里的数字仍作为文字。
    if (info.params.maxImages > 0) {
      const availableSlots = Math.max(0, info.params.maxImages - sources.length);
      sources.push(...bareQQs.slice(0, availableSlots).map((qq) => ({ type: 'avatar', qq })));
      textArgs.push(...bareQQs.slice(availableSlots));
    } else {
      textArgs.push(...bareQQs);
    }

    const maxImages = Math.max(info.params.minImages, info.params.maxImages);
    const images = [];
    for (const source of sources) {
      if (images.length >= maxImages) break;
      try {
        const image = source.type === 'avatar'
          ? await this.#avatarImage(source.qq, { groupId: kind === 'group' ? chatId : '' })
          : await this.#mediaImage(source.media, images.length);
        if (image) images.push(image);
      } catch (error) {
        this.log('[meme] 输入图片获取失败:', error?.message ?? error);
      }
    }
    if (images.length < info.params.minImages && QQ_RE.test(String(senderId))) {
      const already = new Set(sources.filter((s) => s.type === 'avatar').map((s) => String(s.qq)));
      if (!already.has(String(senderId))) {
        try { images.push(await this.#avatarImage(String(senderId), { groupId: kind === 'group' ? chatId : '' })); } catch { /* 最终由数量校验报错 */ }
      }
    }
    if (images.length < info.params.minImages) {
      throw new Error(`模板 ${info.key} 需要 ${info.params.minImages}-${info.params.maxImages} 张图片；请 @群友、填写 QQ 号、附图或引用图片`);
    }

    const texts = this.#prepareTexts(textArgs, info.params);
    const timeout = Math.min(120000, Math.max(5000, Number(getConfig().meme?.generationTimeoutMs) || 30000));
    const result = await this.worker.request('generate', {
      key: info.key,
      images,
      texts,
      options: {}
    }, timeout);
    const buffer = Buffer.from(result.data || []);
    if (!buffer.length) throw new Error('生成结果为空');
    await this.sender.sendImage(chatKey, buffer, {
      label: `表情生成:${info.key}`,
      replyToMessageId
    });
  }

  #prepareTexts(tokens, params) {
    const min = Number(params.minTexts) || 0;
    const max = Number(params.maxTexts) || 0;
    let texts = [];
    if (tokens.length && max === 1) texts = [tokens.join(' ')];
    else if (tokens.length && max > 1) {
      texts = tokens.slice(0, max);
      if (tokens.length > max) texts[max - 1] = tokens.slice(max - 1).join(' ');
    }
    const defaults = Array.isArray(params.defaultTexts) ? params.defaultTexts : [];
    while (texts.length < min && defaults[texts.length] !== undefined) texts.push(String(defaults[texts.length]));
    if (texts.length < min) throw new Error(`该模板需要 ${min}-${max} 段文字；多段文字请分别用引号包住`);
    return texts.slice(0, max || 0);
  }

  async #segmentSources(event) {
    const segments = Array.isArray(event?.message) ? event.message : [];
    const sources = [];
    for (const segment of segments) {
      const data = segment?.data || {};
      if (segment?.type === 'at' && data.qq !== 'all' && QQ_RE.test(String(data.qq || ''))) {
        sources.push({ type: 'avatar', qq: String(data.qq) });
      } else if (segment?.type === 'image') {
        sources.push({ type: 'media', media: {
          kind: 'image', file: String(data.file || ''), url: String(data.url || '')
        } });
      } else if (segment?.type === 'reply' && data.id != null) {
        try {
          const quoted = await this.onebot.getMsg(String(data.id));
          const media = Array.isArray(quoted?.message) ? extractMediaFromSegments(quoted.message) : [];
          for (const item of media.filter((m) => m.kind === 'image')) sources.push({ type: 'media', media: item });
        } catch (error) {
          this.log('[meme] 读取引用图片失败:', error?.message ?? error);
        }
      }
    }

    // CQ 字符串形态兜底：至少识别 @ 与 reply；图片 URL 通常仍会由 NapCat 给数组形态。
    const raw = String(event?.raw_message || '');
    for (const match of raw.matchAll(/\[CQ:at,[^\]]*qq=(\d+)[^\]]*\]/gi)) {
      if (!sources.some((s) => s.type === 'avatar' && s.qq === match[1])) sources.push({ type: 'avatar', qq: match[1] });
    }
    return sources;
  }

  async #mediaImage(media, index) {
    let url = String(media?.url || '');
    const file = String(media?.file || '');
    if (!url && /^https?:\/\//i.test(file)) url = file;
    if (!url && file) {
      try {
        const resolved = await this.onebot.call('get_image', { file });
        url = String(resolved?.url || '');
        if (!url && resolved?.file && fs.existsSync(String(resolved.file))) {
          const data = await fsp.readFile(String(resolved.file));
          const mime = detectMime(data);
          return { name: `quoted-${index + 1}.${extensionForMime(mime)}`, data };
        }
      } catch { /* fall through */ }
    }
    if (!url) throw new Error('消息图片没有可读取的地址');
    const maxBytes = Math.min(30 * 1024 * 1024, Math.max(1024 * 1024, Number(getConfig().meme?.maxInputImageBytes) || 12 * 1024 * 1024));
    const { buffer, contentType } = await safeFetchBinary(url, maxBytes);
    const mime = String(contentType || '').split(';')[0] || detectMime(buffer);
    return { name: `message-${index + 1}.${extensionForMime(mime)}`, data: buffer };
  }

  async #avatarBridgeToken() {
    const cfg = getConfig();
    const explicit = String(cfg.meme?.avatarBridgeToken || '').trim();
    if (explicit) return explicit;
    const napcatDataDir = expandHome(cfg.connector?.napcatDataDir)
      || path.join(os.homedir(), 'Library', 'Containers', 'com.tencent.qq', 'Data', 'Library', 'Application Support', 'QQ', 'NapCat');
    const configFile = path.join(napcatDataDir, 'config', 'plugins', 'qq-avatar-bridge', 'config.json');
    try {
      const parsed = JSON.parse(await fsp.readFile(configFile, 'utf8'));
      return String(parsed?.token || '').trim();
    } catch {
      return '';
    }
  }

  async #avatarFromBridge(qq, groupId = '') {
    const cfg = getConfig().meme || {};
    if (cfg.avatarBridgeEnabled === false) {
      this.avatarBridge.state = 'disabled';
      return null;
    }
    const rawUrl = String(cfg.avatarBridgeUrl || 'http://127.0.0.1:6099/plugin/qq-avatar-bridge/api/avatar').trim();
    let url;
    try { url = new URL(rawUrl); } catch { throw new Error('NapCat 头像桥地址无效'); }
    if (url.protocol !== 'http:' || !['127.0.0.1', '::1', 'localhost'].includes(url.hostname)) {
      throw new Error('NapCat 头像桥仅允许本机 HTTP 地址');
    }
    const token = await this.#avatarBridgeToken();
    if (!token) throw new Error('NapCat 头像桥令牌不存在，请重新运行安装脚本');
    const timeoutMs = Math.min(15000, Math.max(2000, Number(cfg.avatarBridgeTimeoutMs) || 6000));
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'image/*'
      },
      body: JSON.stringify({ uin: String(qq), group_id: String(groupId || '') }),
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) throw new Error(`NapCat 头像桥 HTTP ${response.status}`);
    const announced = Number(response.headers.get('content-length')) || 0;
    if (announced > 5 * 1024 * 1024) throw new Error('NapCat 头像超过大小限制');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > 5 * 1024 * 1024 || !isImageBuffer(buffer) || isDefaultQQAvatar(buffer)) {
      throw new Error('NapCat 头像桥没有返回有效头像');
    }
    this.avatarBridge = { state: 'ready', lastError: '', lastSuccessAt: Date.now() };
    return { buffer, contentType: String(response.headers.get('content-type') || detectMime(buffer)).split(';')[0] };
  }

  async #avatarImage(qq, { groupId = '' } = {}) {
    const id = String(qq || '');
    if (!QQ_RE.test(id)) throw new Error(`QQ 号无效：${id}`);
    const cfg = getConfig().meme || {};
    const cacheEnabled = cfg.avatarCacheEnabled !== false;
    const maxAge = Math.min(168, Math.max(1, Number(cfg.avatarCacheExpireHours) || 24)) * 60 * 60 * 1000;
    const file = path.join(AVATAR_CACHE_DIR, `${id}.img`);
    let staleCache = null;
    if (cacheEnabled) {
      try {
        const stat = await fsp.stat(file);
        const data = await fsp.readFile(file);
        if (data.length && isImageBuffer(data) && !isDefaultQQAvatar(data)) {
          if (Date.now() - stat.mtimeMs < maxAge) {
            return { name: `qq-${id}.${extensionForMime(detectMime(data))}`, data };
          }
          staleCache = data;
        }
      } catch { /* cache miss */ }
    }
    let selected = null;
    try {
      selected = await this.#avatarFromBridge(id, groupId);
    } catch (error) {
      this.avatarBridge = {
        state: getConfig().meme?.avatarBridgeEnabled === false ? 'disabled' : 'error',
        lastError: String(error?.message ?? error),
        lastSuccessAt: this.avatarBridge.lastSuccessAt || 0
      };
    }
    const urls = [
      // qlogo.cn/g 对部分账号只返回默认企鹅；Qzone 头像源通常仍能取到真实头像。
      `https://qlogo4.store.qq.com/qzone/${encodeURIComponent(id)}/${encodeURIComponent(id)}/640`,
      `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(id)}&s=640`,
      `https://q4.qlogo.cn/headimg_dl?dst_uin=${encodeURIComponent(id)}&spec=640&img_type=jpg`
    ];
    for (const url of selected ? [] : urls) {
      try {
        const fetched = await safeFetchBinary(url, 5 * 1024 * 1024);
        if (!fetched.buffer?.length || !isImageBuffer(fetched.buffer) || isDefaultQQAvatar(fetched.buffer)) continue;
        selected = fetched;
        break;
      } catch { /* try next official QQ avatar source */ }
    }
    if (!selected && staleCache) selected = { buffer: staleCache, contentType: detectMime(staleCache) };
    if (!selected) {
      const bridgeHint = this.avatarBridge.lastError ? `；NapCat 头像桥：${this.avatarBridge.lastError}` : '';
      throw new Error(`QQ ${id} 的真实头像不可读取${bridgeHint}；请附图或引用图片`);
    }
    const { buffer, contentType } = selected;
    if (cacheEnabled) {
      await fsp.mkdir(AVATAR_CACHE_DIR, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, buffer);
      await fsp.rename(tmp, file);
    }
    const mime = String(contentType || '').split(';')[0] || detectMime(buffer);
    return { name: `qq-${id}.${extensionForMime(mime)}`, data: buffer };
  }

  async #avatarCacheStats() {
    let files = 0;
    let bytes = 0;
    try {
      const names = await fsp.readdir(AVATAR_CACHE_DIR);
      for (const name of names) {
        try {
          const stat = await fsp.stat(path.join(AVATAR_CACHE_DIR, name));
          if (stat.isFile()) { files += 1; bytes += stat.size; }
        } catch { /* ignore */ }
      }
    } catch { /* cache not created yet */ }
    return { enabled: getConfig().meme?.avatarCacheEnabled !== false, files, bytes };
  }

  #sendText(chatKey, text, replyToMessageId = null) {
    return this.sender.sendTextBatch(chatKey, [text], { replyToMessageId });
  }
}
