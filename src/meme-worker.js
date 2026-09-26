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
const tudouEngineDir = path.join(memeHome, 'engines', 'tudou-meme');

let library = null;
let libraryPromise = null;
let cliCatalog = null;
let combinedCatalog = new Map();
let engineRoutes = new Map();
let engineCounts = { native: 0, tudou: 0 };
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

// tudou-meme 的内部键大多是拼音。运行时仍保留内部键以兼容禁用配置，
// 但命令列表和日常输入统一暴露中文名称。少数上游没有纯中文名称的模板
// 在这里补一个稳定名称；其余模板直接沿用上游的第一条中文关键词。
const TUDOU_CHINESE_NAMES = new Map([
  ['3p', '三人同框'],
  ['dorochoumei', '多萝臭美'],
  ['llq', '群啪'],
  ['qushi', '去拉屎'],
  ['huanyingchuo', '被戳欢迎新人']
]);

function tudouChineseName(item) {
  const publicKey = String(item?.publicKey || item?.key || '');
  const explicit = TUDOU_CHINESE_NAMES.get(publicKey);
  if (explicit) return explicit;
  const keywords = Array.isArray(item?.keywords) ? item.keywords.map(String) : [];
  return keywords.find((keyword) => /\p{Script=Han}/u.test(keyword))
    || String(item?.moduleDir || '').match(/\p{Script=Han}/u)?.input
    || publicKey;
}

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
    keywords: [...new Set([
      ...(info.keywords || []),
      ...(ALIASES_BY_KEY.get(info.key) || [])
    ])]
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
  const engines = walkStats(path.join(memeHome, 'engines'));
  return {
    home: memeHome,
    fonts,
    images,
    engines,
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

function addCatalogEntry(info, route) {
  if (!info?.key || combinedCatalog.has(info.key)) return;
  combinedCatalog.set(info.key, decorateInfo(info));
  engineRoutes.set(info.key, route);
}

async function refreshCombinedCatalog() {
  combinedCatalog = new Map();
  engineRoutes = new Map();
  engineCounts = { native: cliCatalog?.size || 0, tudou: 0 };
  for (const info of cliCatalog?.values() || []) {
    addCatalogEntry(info, { engine: 'native', internalKey: info.key });
  }

  const tudouManifest = await fs.promises.readFile(path.join(tudouEngineDir, 'manifest.json'), 'utf8')
    .then(JSON.parse).catch(() => null);
  for (const item of tudouManifest?.templates || []) {
    const publicKey = `tudou_${String(item.publicKey || item.key || '')}`;
    const chineseName = tudouChineseName(item);
    const displayName = `土豆${chineseName}`;
    addCatalogEntry({
      ...item,
      key: publicKey,
      displayName,
      keywords: [...new Set([
        displayName,
        chineseName,
        ...(item.keywords || []).map(String),
        String(item.key || '')
      ])],
      tags: [...new Set([...(item.tags || []).map(String), 'tudou-meme'])]
    }, {
      engine: 'tudou',
      internalKey: String(item.key || ''),
      moduleDir: String(item.moduleDir || '')
    });
    engineCounts.tudou += 1;
  }

}

async function resolveCombinedMeme(query, { preferImages = false, imageCount = 0 } = {}) {
  const resolved = async (info) => {
    if (!info) return null;
    const route = engineRoutes.get(info.key);
    if (route?.engine !== 'native') return info;
    const detailed = await cliInfo(route.internalKey);
    if (detailed) combinedCatalog.set(info.key, detailed);
    return detailed || info;
  };
  const choose = async (candidates, { explicitKey = false, requireUnique = false } = {}) => {
    const unique = [...new Map(candidates.filter(Boolean).map((info) => [info.key, info])).values()];
    if (!unique.length) return null;
    if (explicitKey || !preferImages) {
      if (requireUnique && unique.length !== 1) return null;
      return resolved(unique[0]);
    }
    const detailed = [];
    for (const info of unique) detailed.push(await resolved(info));
    const requested = Math.max(1, Number(imageCount) || 1);
    const exactFit = detailed.filter((info) => info?.params?.maxImages >= requested
      && info?.params?.minImages <= requested);
    if (exactFit.length) return requireUnique && exactFit.length !== 1 ? null : exactFit[0];
    const acceptsImages = detailed.filter((info) => info?.params?.maxImages > 0);
    if (acceptsImages.length) return requireUnique && acceptsImages.length !== 1 ? null : acceptsImages[0];
    return requireUnique && detailed.length !== 1 ? null : (detailed[0] || null);
  };
  const q = normalizeQuery(query);
  if (!q) return null;
  const exactKey = [...combinedCatalog.values()].find((info) => normalizeQuery(info.key) === q);
  if (exactKey) return choose([exactKey], { explicitKey: true });

  const exactCandidates = [];
  const alias = MEME_ALIASES.get(q);
  if (alias && combinedCatalog.has(alias)) exactCandidates.push(combinedCatalog.get(alias));
  for (const info of combinedCatalog.values()) {
    if (info.keywords.some((keyword) => normalizeQuery(keyword) === q)) exactCandidates.push(info);
    else if (info.shortcuts.some((shortcut) => shortcut.names.some((name) => normalizeQuery(name) === q))) {
      exactCandidates.push(info);
    }
  }
  if (exactCandidates.length) return choose(exactCandidates);

  const localMatches = [...combinedCatalog.values()].filter((info) => infoMatchesQuery(info, q));
  if (localMatches.length === 1) return choose(localMatches);
  if (preferImages && localMatches.length > 1) {
    const selected = await choose(localMatches, { requireUnique: true });
    if (selected?.params?.maxImages > 0) return selected;
  }
  if (cliCatalog) {
    const { stdout } = await runCli(['search', query], { timeout: 10000 });
    const matches = parseCliList(stdout);
    if (matches.size === 1) return resolved(combinedCatalog.get(matches.keys().next().value));
  }
  return null;
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

async function generateWithTudou(payload, route, info) {
  const python = path.join(tudouEngineDir, 'venv', 'bin', 'python');
  const runner = path.join(tudouEngineDir, 'runner.py');
  const source = path.join(tudouEngineDir, 'source');
  if (!fs.existsSync(python) || !fs.existsSync(runner)) throw new Error('tudou-meme 引擎尚未安装完整');
  const tempRoot = path.join(memeHome, 'tmp');
  fs.mkdirSync(tempRoot, { recursive: true });
  const jobDir = fs.mkdtempSync(path.join(tempRoot, 'tudou-'));
  try {
    const imagePaths = [];
    const imageNames = [];
    for (const [index, image] of (payload.images || []).entries()) {
      const suppliedName = path.basename(String(image?.name || `image-${index + 1}.png`));
      const safeName = suppliedName.replace(/[^\p{L}\p{N}._-]+/gu, '_') || `image-${index + 1}.png`;
      const imagePath = path.join(jobDir, `${index + 1}-${safeName}`);
      fs.writeFileSync(imagePath, Buffer.from(image?.data || []));
      imagePaths.push(imagePath);
      imageNames.push(suppliedName.replace(/\.[^.]+$/, ''));
    }
    const textsFile = path.join(jobDir, 'texts.json');
    const namesFile = path.join(jobDir, 'names.json');
    const output = path.join(jobDir, 'result.bin');
    fs.writeFileSync(textsFile, JSON.stringify((payload.texts || []).map(String)));
    fs.writeFileSync(namesFile, JSON.stringify(imageNames));
    const args = [
      runner, 'generate', '--source', source, '--module', route.moduleDir,
      '--key', route.internalKey, '--texts-json', textsFile, '--names-json', namesFile,
      '--output', output
    ];
    for (const imagePath of imagePaths) args.push('--image', imagePath);
    await execFileAsync(python, args, {
      cwd: tudouEngineDir,
      env: {
        ...process.env,
        QQ_AGENT_MEME_PY_HOME: path.join(tudouEngineDir, 'home'),
        PYTHONUTF8: '1'
      },
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
      encoding: 'utf8'
    });
    if (!fs.existsSync(output)) throw new Error('tudou-meme 没有生成结果');
    return { data: fs.readFileSync(output), info };
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}

async function generateCombined(payload) {
  const publicKey = String(payload.key || '');
  const route = engineRoutes.get(publicKey);
  const info = combinedCatalog.get(publicKey);
  if (!route || !info) throw new Error(`找不到模板：${publicKey}`);
  if (route.engine === 'native') {
    return generateWithCli({ ...payload, key: route.internalKey });
  }
  if (route.engine === 'tudou') return generateWithTudou(payload, route, info);
  throw new Error(`未知模板引擎：${route.engine}`);
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
    await refreshCombinedCatalog();
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
    templates: cliCatalog ? combinedCatalog.size : (library ? library.getMemeKeys().length : 0),
    engine: cliCatalog ? 'multi-local' : 'node-native',
    engines: cliCatalog ? { ...engineCounts } : { native: library ? library.getMemeKeys().length : 0 },
    resources: stats
  };
}

async function handle(type, payload = {}) {
  if (type === 'initialize') return initialize(payload);
  if (cliCatalog) {
    if (type === 'status') return status();
    if (type === 'resolve') return resolveCombinedMeme(payload.query, {
      preferImages: Boolean(payload.preferImages),
      imageCount: Number(payload.imageCount) || 0
    });
    if (type === 'list') {
      const query = String(payload.query || '').trim();
      if (!query) return [...combinedCatalog.values()];
      const localMatches = [...combinedCatalog.values()].filter((item) => infoMatchesQuery(item, query));
      if (localMatches.length) return localMatches;
      const { stdout } = await runCli(['search', query], { timeout: 10000 });
      const keys = new Set(parseCliList(stdout).keys());
      return [...combinedCatalog.values()].filter((item) => keys.has(item.key));
    }
    if (type === 'generate') return generateCombined(payload);
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
