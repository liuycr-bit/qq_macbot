// meme-generator-rs 原生绑定专用 Worker。
//
// 这个文件故意不 import QQ Agent 的任何业务模块：MEME_HOME 必须在加载
// @memecrafters/meme-generator 之前设置，否则 Rust 侧会把资源目录固定到用户主目录。
// 所有同步原生生成和资源下载都留在 Worker 内，避免阻塞 Electron/QQ Agent 主线程。
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parentPort, workerData } from 'node:worker_threads';

if (!parentPort) throw new Error('meme-worker 必须由 worker_threads 启动');

const memeHome = path.resolve(String(workerData?.memeHome || ''));
if (!memeHome) throw new Error('缺少 memeHome');
process.env.MEME_HOME = memeHome;

const execFileAsync = promisify(execFile);
const cliPath = path.join(memeHome, 'bin', 'meme');

let library = null;
let libraryPromise = null;
let cliCatalog = null;
let cliInfoCache = new Map();
let cliVersion = '';
let resourceState = 'idle';
let resourceError = '';
let initializedAt = 0;

// QQ Agent 侧的热词别名。别名只改变命令解析，不复制模板或图片资源。
// 目标始终使用稳定的英文模板键，便于继续复用禁用、缓存和生成流程。
const MEME_ALIAS_ENTRIES = [
  ['爱你老己', 'love_you'],
  ['老己', 'love_you'],
  ['老己辛苦了', 'love_you'],
  ['别来沾边', 'dont_go_near'],
  ['搞抽象', 'confuse'],
  ['太抽象了', 'confuse'],
  ['抽象', 'confuse'],
  ['梁圣', 'deepseek_say'],
  ['deepseek锐评', 'deepseek_say'],
  ['让梁圣说', 'deepseek_say'],
  ['摆烂', 'slacking_off'],
  ['躺平', 'slacking_off'],
  ['不干了', 'slacking_off'],
  ['红温了', 'flush'],
  ['汗流浃背了', 'flush'],
  ['我勒个豆', 'peas'],
  ['家人谁懂啊', 'family_know'],
  ['被拿捏了', 'tease']
];

function normalizeQuery(value) {
  return String(value || '').trim().toLowerCase().replace(/[，。！？!?、]+$/g, '');
}

const MEME_ALIASES = new Map(MEME_ALIAS_ENTRIES.map(([alias, key]) => [normalizeQuery(alias), key]));
const ALIASES_BY_KEY = new Map();
for (const [alias, key] of MEME_ALIAS_ENTRIES) {
  if (!ALIASES_BY_KEY.has(key)) ALIASES_BY_KEY.set(key, []);
  ALIASES_BY_KEY.get(key).push(alias);
}

function decorateInfo(info) {
  if (!info) return info;
  return {
    ...info,
    keywords: [...new Set([...(info.keywords || []), ...(ALIASES_BY_KEY.get(info.key) || [])])]
  };
}

function infoMatchesQuery(info, query) {
  const q = normalizeQuery(query);
  if (!q) return true;
  if (normalizeQuery(info.key).includes(q)) return true;
  return (info.keywords || []).some((keyword) => normalizeQuery(keyword).includes(q));
}

function walkStats(dir) {
  const stats = { files: 0, bytes: 0 };
  const visit = (target) => {
    let entries = [];
    try { entries = fs.readdirSync(target, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(target, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) {
        stats.files += 1;
        try { stats.bytes += fs.statSync(full).size; } catch { /* ignore disappeared files */ }
      }
    }
  };
  visit(dir);
  return stats;
}

function resourceStats() {
  const fonts = walkStats(path.join(memeHome, 'resources', 'fonts'));
  const images = walkStats(path.join(memeHome, 'resources', 'images'));
  return {
    home: memeHome,
    fonts,
    images,
    ready: images.files > 0 && fonts.files > 0
  };
}

function plainInfo(meme) {
  const info = meme.info;
  const tags = info?.tags instanceof Set ? [...info.tags] : Array.from(info?.tags || []);
  return decorateInfo({
    key: String(info?.key || meme.key || ''),
    keywords: Array.isArray(info?.keywords) ? info.keywords.map(String) : [],
    shortcuts: Array.isArray(info?.shortcuts)
      ? info.shortcuts.map((s) => ({
        pattern: String(s?.pattern || ''),
        humanized: s?.humanized ? String(s.humanized) : '',
        names: Array.isArray(s?.names) ? s.names.map(String) : [],
        texts: Array.isArray(s?.texts) ? s.texts.map(String) : []
      }))
      : [],
    tags,
    params: {
      minImages: Number(info?.params?.minImages) || 0,
      maxImages: Number(info?.params?.maxImages) || 0,
      minTexts: Number(info?.params?.minTexts) || 0,
      maxTexts: Number(info?.params?.maxTexts) || 0,
      defaultTexts: Array.isArray(info?.params?.defaultTexts) ? info.params.defaultTexts.map(String) : []
    }
  });
}

function parseNumberRange(value) {
  const numbers = String(value || '').match(/\d+/g)?.map(Number) || [];
  if (!numbers.length) return { min: 0, max: 0 };
  return { min: numbers[0], max: numbers[1] ?? numbers[0] };
}

function parseCliList(output) {
  const catalog = new Map();
  for (const line of String(output || '').split(/\r?\n/)) {
    const match = /^\s*\d+\.\s+([^\s]+)\s+\((.*)\)(?:\s+\[标签：(.*)\])?\s*$/.exec(line);
    if (!match) continue;
    catalog.set(match[1], decorateInfo({
      key: match[1],
      keywords: match[2] ? match[2].split('/').map((item) => item.trim()).filter(Boolean) : [],
      shortcuts: [],
      tags: match[3] ? match[3].split('、').map((item) => item.trim()).filter(Boolean) : [],
      params: { minImages: 0, maxImages: 0, minTexts: 0, maxTexts: 0, defaultTexts: [] }
    }));
  }
  return catalog;
}

async function runCli(args, { cwd = memeHome, timeout = 120000 } = {}) {
  const result = await execFileAsync(cliPath, args, {
    cwd,
    env: { ...process.env, MEME_HOME: memeHome },
    timeout,
    maxBuffer: 32 * 1024 * 1024,
    encoding: 'utf8'
  });
  return { stdout: String(result.stdout || ''), stderr: String(result.stderr || '') };
}

async function refreshCliCatalog() {
  const [{ stdout: listOutput }, { stdout: versionOutput }] = await Promise.all([
    runCli(['list'], { timeout: 30000 }),
    runCli(['--version'], { timeout: 10000 })
  ]);
  cliCatalog = parseCliList(listOutput);
  cliInfoCache = new Map();
  cliVersion = versionOutput.trim().replace(/^meme\s+/i, '');
  if (!cliCatalog.size) throw new Error('外部表情生成器没有返回模板列表');
}

async function cliInfo(key) {
  if (cliInfoCache.has(key)) return cliInfoCache.get(key);
  const base = cliCatalog?.get(key);
  if (!base) return null;
  const { stdout } = await runCli(['info', key], { timeout: 10000 });
  const imageRange = parseNumberRange(/^需要图片数目：(.+)$/m.exec(stdout)?.[1]);
  const textRange = parseNumberRange(/^需要文字数目：(.+)$/m.exec(stdout)?.[1]);
  const defaultsRaw = /^默认文字：\[(.*)\]$/m.exec(stdout)?.[1] || '';
  const tagsRaw = /^标签：(.+)$/m.exec(stdout)?.[1] || '';
  const info = {
    ...base,
    tags: tagsRaw ? tagsRaw.split('、').map((item) => item.trim()).filter(Boolean) : base.tags,
    params: {
      minImages: imageRange.min,
      maxImages: imageRange.max,
      minTexts: textRange.min,
      maxTexts: textRange.max,
      defaultTexts: defaultsRaw ? defaultsRaw.split('、').map((item) => item.trim()) : []
    }
  };
  cliInfoCache.set(key, info);
  return info;
}

async function resolveCliMeme(query) {
  const q = normalizeQuery(query);
  if (!q || !cliCatalog) return null;
  const aliasedKey = MEME_ALIASES.get(q);
  if (aliasedKey && cliCatalog.has(aliasedKey)) return cliInfo(aliasedKey);
  for (const info of cliCatalog.values()) {
    if (normalizeQuery(info.key) === q || info.keywords.some((keyword) => normalizeQuery(keyword) === q)) {
      return cliInfo(info.key);
    }
  }
  const { stdout } = await runCli(['search', query], { timeout: 10000 });
  const matches = parseCliList(stdout);
  if (matches.size !== 1) return null;
  return cliInfo(matches.keys().next().value);
}

async function generateWithCli(payload) {
  const tempRoot = path.join(memeHome, 'tmp');
  fs.mkdirSync(tempRoot, { recursive: true });
  const jobDir = fs.mkdtempSync(path.join(tempRoot, 'job-'));
  try {
    const imagePaths = [];
    const imageNames = [];
    for (const [index, image] of (payload.images || []).entries()) {
      const suppliedName = path.basename(String(image?.name || `image-${index + 1}.png`));
      const safeName = suppliedName.replace(/[^\p{L}\p{N}._-]+/gu, '_') || `image-${index + 1}.png`;
      const imagePath = path.join(jobDir, `${index + 1}-${safeName}`);
      fs.writeFileSync(imagePath, Buffer.from(image?.data || []));
      imagePaths.push(imagePath);
      imageNames.push(suppliedName);
    }

    const args = ['generate', String(payload.key || '')];
    if (imagePaths.length) args.push('--images', ...imagePaths, '--names', ...imageNames);
    const texts = Array.isArray(payload.texts) ? payload.texts.map(String) : [];
    if (texts.length) args.push('--texts', ...texts);
    const { stdout, stderr } = await runCli(args, { cwd: jobDir, timeout: 120000 });
    const resultName = fs.readdirSync(jobDir).find((name) => /^result\.(?:png|jpe?g|gif|webp)$/i.test(name));
    if (!resultName) throw new Error(stderr.trim() || stdout.trim() || '外部表情生成器没有生成结果');
    return { data: fs.readFileSync(path.join(jobDir, resultName)), info: await cliInfo(String(payload.key || '')) };
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}

async function ensureLibrary() {
  if (!libraryPromise) {
    libraryPromise = import('@memecrafters/meme-generator').then((mod) => {
      library = mod;
      initializedAt = Date.now();
      return mod;
    });
  }
  return libraryPromise;
}

function resolveMeme(query) {
  const q = normalizeQuery(query);
  if (!q) return null;
  const direct = library.getMeme(MEME_ALIASES.get(q) || q);
  if (direct) return direct;

  const memes = library.getMemes();
  for (const meme of memes) {
    const info = plainInfo(meme);
    if (normalizeQuery(info.key) === q) return meme;
    if (info.keywords.some((keyword) => normalizeQuery(keyword) === q)) return meme;
    if (info.shortcuts.some((shortcut) => shortcut.names.some((name) => normalizeQuery(name) === q))) return meme;
  }

  const matches = library.searchMemes(q, true) || [];
  if (matches.length === 1) return library.getMeme(String(matches[0]));
  return null;
}

function formatNativeError(error) {
  if (!error) return '表情生成失败';
  if (typeof error === 'string') return error;
  const type = String(error.type || 'Error');
  const detail = error.field0;
  if (typeof detail === 'string') return `${type}: ${detail}`;
  if (detail && typeof detail === 'object') {
    if (detail.error) return `${type}: ${detail.error}`;
    if (detail.feedback) return String(detail.feedback);
    if ('min' in detail && 'max' in detail && 'actual' in detail) {
      return `${type}: 需要 ${detail.min}-${detail.max} 个输入，实际 ${detail.actual} 个`;
    }
    if (detail.path) return `${type}: 缺少资源 ${detail.path}`;
  }
  try { return `${type}: ${JSON.stringify(detail)}`; } catch { return type; }
}

async function initialize(payload = {}) {
  fs.mkdirSync(memeHome, { recursive: true });
  if (fs.existsSync(cliPath)) {
    if (payload.checkResources !== false) {
      resourceState = 'checking';
      resourceError = '';
      try {
        await runCli(['download'], { timeout: 10 * 60 * 1000 });
      } catch (error) {
        resourceError = String(error?.stderr || error?.message || error);
      }
    }
    await refreshCliCatalog();
    initializedAt = Date.now();
    const stats = resourceStats();
    resourceState = stats.ready ? 'ready' : (resourceError ? 'error' : 'partial');
    return status();
  }
  const mod = await ensureLibrary();
  if (payload.checkResources !== false) {
    resourceState = 'checking';
    resourceError = '';
    try {
      // 同步调用会阻塞当前 Worker，但不会阻塞 QQ Agent 主线程。
      mod.Resources.checkResources();
    } catch (error) {
      resourceError = String(error?.message ?? error);
    }
  }
  const stats = resourceStats();
  resourceState = stats.ready ? 'ready' : (resourceError ? 'error' : 'partial');
  return status();
}

function status() {
  const stats = resourceStats();
  return {
    state: resourceState,
    error: resourceError,
    initializedAt,
    version: cliCatalog ? cliVersion : (library ? library.getVersion() : ''),
    templates: cliCatalog ? cliCatalog.size : (library ? library.getMemeKeys().length : 0),
    engine: cliCatalog ? 'cli-external' : 'node-native',
    resources: stats
  };
}

async function handle(type, payload = {}) {
  if (type === 'initialize') return initialize(payload);
  if (cliCatalog) {
    if (type === 'status') return status();
    if (type === 'resolve') return resolveCliMeme(payload.query);
    if (type === 'list') {
      const query = String(payload.query || '').trim();
      if (!query) return [...cliCatalog.values()];
      const localMatches = [...cliCatalog.values()].filter((item) => infoMatchesQuery(item, query));
      if (localMatches.length) return localMatches;
      const { stdout } = await runCli(['search', query], { timeout: 10000 });
      const keys = new Set(parseCliList(stdout).keys());
      return [...cliCatalog.values()].filter((item) => keys.has(item.key));
    }
    if (type === 'generate') return generateWithCli(payload);
  }
  await ensureLibrary();

  if (type === 'status') return status();

  if (type === 'resolve') {
    const meme = resolveMeme(payload.query);
    return meme ? plainInfo(meme) : null;
  }

  if (type === 'list') {
    const query = String(payload.query || '').trim();
    let memes = library.getMemes();
    if (query) {
      const localKeys = memes.map(plainInfo).filter((info) => infoMatchesQuery(info, query)).map((info) => info.key);
      const keys = new Set([...localKeys, ...(library.searchMemes(query, true) || []).map(String)]);
      memes = memes.filter((meme) => keys.has(String(meme.key)));
    }
    return memes.map(plainInfo);
  }

  if (type === 'generate') {
    const meme = library.getMeme(String(payload.key || ''));
    if (!meme) throw new Error(`找不到模板：${payload.key}`);
    const images = (payload.images || []).map((image, index) => ({
      name: String(image?.name || `image-${index + 1}`),
      data: Buffer.from(image?.data || [])
    }));
    const texts = Array.isArray(payload.texts) ? payload.texts.map(String) : [];
    const result = meme.generate(images, texts, payload.options || {});
    if (result?.type !== 'Ok') throw new Error(formatNativeError(result?.field0 || result));
    return { data: Buffer.from(result.field0), info: plainInfo(meme) };
  }

  throw new Error(`未知 Worker 操作：${type}`);
}

parentPort.on('message', async (message) => {
  const id = message?.id;
  try {
    const result = await handle(message?.type, message?.payload);
    parentPort.postMessage({ id, ok: true, result });
  } catch (error) {
    parentPort.postMessage({
      id,
      ok: false,
      error: String(error?.message ?? error),
      stack: String(error?.stack || '')
    });
  }
});
