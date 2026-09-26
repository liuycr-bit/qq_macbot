#!/usr/bin/env node

/**
 * 将 meme-generator-rs CLI、meme-emoji、meme-generator-contrib-rs 动态库
 * 及其资源安装到 QQ Agent 的应用数据目录。第三方二进制和图片不会写入
 * 源码仓库或 .app。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const CORE_VERSION = '0.2.3';
const COMMUNITY_VERSION = '0.0.6+build.59';
const CONTRIB_COMMIT = '56583210f830a533009d68d35e84a4567583f761';
const CONTRIB_RUST_TOOLCHAIN = '1.93.1';
const TRENDING_PACK_VERSION = '0.1.0';
const TRENDING_SOURCE_DIR = path.join(ROOT, 'extensions', 'qq-agent-trending-memes-rs');
const CRAZY_EMOJI_COMMIT = '51f6a2165ad410ab67674abbcf5f7ec614e0313c';
const CRAZY_EMOJI_ARCHIVE_SHA256 = '03a900d8ef7d7f6ab0a6d455467c2020cb386873614121f800198a477e17e6ad';
const TUDOU_MEME_COMMIT = '016f46b9e43fdde57bfecf23894b457a56537386';
const TUDOU_MEME_ARCHIVE_SHA256 = '239d98f6f071c1fb3203accb89ea22e519346c4ecc1c67d565fe959fef8990f4';
const PYTHON_MEME_GENERATOR_VERSION = '0.1.14';
const TUDOU_TEMPLATE_COUNT = 122;
const TUDOU_RUNNER = path.join(ROOT, 'extensions', 'tudou-meme-python', 'runner.py');
const GENGTU_COMMIT = 'cd17bfa02d9386c97a2bcf341f23a82fd1f8452c';
const GENGTU_ARCHIVE_SHA256 = 'c8eafcb49637e20574d18651b4081bd46fbf0f7d6eb27553f2849c8c6951ae03';
const CLASSIC_MEME_COMMIT = '0e8531e680951612f4bb1437ef767ea5f7ce8519';
const CLASSIC_MEME_ARCHIVE_SHA256 = '3f37b57d361e4efb993021d6d444eef77485d11e5bc2c84a59573ded5a8c5847';
const OPOSSUM_SPRITESHEET_URL = 'https://raw.githubusercontent.com/claw16/codex-pet-beishoufushu/main/pet/spritesheet.webp';
const OPOSSUM_SPRITESHEET_SHA256 = 'c4bddb584ac01ce9af5e8e8c85b5fb19ee6a602dd81e426a5566294aee70c622';
const CONTRIB_RESOURCE_KEYS = [
  'behead', 'bite', 'can_can_need', 'do', 'empathy',
  'fleshlight', 'jerk_off', 'lash', 'little_do', 'shoot'
];

const PLATFORM_ASSETS = {
  arm64: {
    coreName: 'meme-generator-cli-macos-aarch64.zip',
    coreSha256: '20b7da03da4fed206b0b0e3ef34094dfac433e380f444891f2e586318bf186a3',
    extensionName: 'meme-emoji-macos-aarch64-1.93.1.dylib',
    extensionSha256: 'b7a6efb15a11ef299c457919464500ad82424df0e440f6afb98cc1198d6cf649'
  },
  x64: {
    coreName: 'meme-generator-cli-macos-x86_64.zip',
    coreSha256: '494c5191019b93b39aa82ec3bb49baab30c32e76bd39c7b626fe20a4e5ea9136',
    extensionName: 'meme-emoji-macos-x86_64-1.93.1.dylib',
    extensionSha256: '056f68d04a4b3b252b0c770e0a6b16b4367e8b3776f421527e8be1ecca8863bc'
  }
};

function printHelp() {
  console.log(`用法：node scripts/install-meme-extension.mjs [选项]

选项：
  --data-dir <目录>   QQ Agent 数据目录；默认 runtime/data
  --builtin-only      只安装官方内置模板，不安装任何外部模板库
  --skip-contrib      安装 meme-emoji，但跳过 meme-generator-contrib-rs
  --skip-trending     跳过 QQ Agent 近期热梗模板包
  --trending-only     仅更新近期热梗模板包，复用现有生成器和资源
  --skip-expanded     跳过 B1/B2/B3/C1 扩展模板包
  --expanded-only     仅更新 B1/B2/B3/C1，复用现有生成器和资源
  --help              显示帮助

也可用 QQ_AGENT_DATA_DIR 环境变量指定数据目录。`);
}

function parseArgs(argv) {
  const options = {
    dataDir: '', builtinOnly: false, skipContrib: false, skipTrending: false,
    trendingOnly: false, skipExpanded: false, expandedOnly: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--builtin-only') {
      options.builtinOnly = true;
      continue;
    }
    if (arg === '--skip-contrib') {
      options.skipContrib = true;
      continue;
    }
    if (arg === '--skip-trending') {
      options.skipTrending = true;
      continue;
    }
    if (arg === '--trending-only') {
      options.trendingOnly = true;
      continue;
    }
    if (arg === '--skip-expanded') {
      options.skipExpanded = true;
      continue;
    }
    if (arg === '--expanded-only') {
      options.expandedOnly = true;
      continue;
    }
    if (arg === '--data-dir') {
      options.dataDir = String(argv[index + 1] || '');
      index += 1;
      if (!options.dataDir) throw new Error('--data-dir 后必须提供目录');
      continue;
    }
    throw new Error(`未知参数：${arg}`);
  }
  return options;
}

function run(command, args, { cwd = ROOT, env = process.env, capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
    });
    let stdout = '';
    let stderr = '';
    if (capture) {
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
    }
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} 执行失败（code=${code ?? '-'}${signal ? `, signal=${signal}` : ''}）${stderr ? `\n${stderr.trim()}` : ''}`));
    });
  });
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

async function download(url, destination, expectedSha256) {
  console.log(`下载：${url}`);
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'qq-agent-macos-meme-installer' }
  });
  if (!response.ok || !response.body) throw new Error(`下载失败：HTTP ${response.status} ${url}`);
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination));
  const actual = await sha256(destination);
  if (actual !== expectedSha256) {
    throw new Error(`SHA-256 校验失败：${path.basename(destination)}\n期望 ${expectedSha256}\n实际 ${actual}`);
  }
}

async function extractTarball(archive, destination) {
  await fsp.mkdir(destination, { recursive: true });
  await run('/usr/bin/tar', ['-xzf', archive, '-C', destination]);
  const entries = await fsp.readdir(destination, { withFileTypes: true });
  const root = entries.find((entry) => entry.isDirectory());
  if (!root) throw new Error(`压缩包中没有找到源码目录：${path.basename(archive)}`);
  return path.join(destination, root.name);
}

async function downloadArchive({ tempDir, name, repository, commit, sha256: expectedSha256 }) {
  const archive = path.join(tempDir, `${name}.tar.gz`);
  await download(`https://codeload.github.com/${repository}/tar.gz/${commit}`, archive, expectedSha256);
  return extractTarball(archive, path.join(tempDir, `${name}-source`));
}

async function prepareRustToolchain(label) {
  const rustup = await resolveExecutable('rustup');
  if (!rustup) throw new Error(`安装 ${label} 需要 rustup，请先执行：brew install rustup`);
  console.log(`准备 Rust ${CONTRIB_RUST_TOOLCHAIN}（${label}）…`);
  await run(rustup, ['toolchain', 'install', CONTRIB_RUST_TOOLCHAIN, '--profile', 'minimal']);
  const cargo = (await run(rustup, ['which', 'cargo', '--toolchain', CONTRIB_RUST_TOOLCHAIN], { capture: true })).stdout.trim();
  const rustc = (await run(rustup, ['which', 'rustc', '--toolchain', CONTRIB_RUST_TOOLCHAIN], { capture: true })).stdout.trim();
  if (!cargo || !rustc) throw new Error(`Rust ${CONTRIB_RUST_TOOLCHAIN} 中缺少 cargo 或 rustc`);
  return {
    cargo,
    env: {
      ...process.env,
      PATH: `${path.dirname(cargo)}${path.delimiter}${process.env.PATH || ''}`,
      RUSTC: rustc
    }
  };
}

async function findFile(root, name) {
  const entries = await fsp.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isFile() && entry.name === name) return full;
    if (entry.isDirectory()) {
      const found = await findFile(full, name);
      if (found) return found;
    }
  }
  return '';
}

async function resolveExecutable(name) {
  const candidates = [
    ...(process.env.PATH || '').split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, name)),
    path.join(os.homedir(), '.cargo', 'bin', name),
    `/opt/homebrew/opt/rustup/bin/${name}`,
    `/usr/local/opt/rustup/bin/${name}`
  ];
  for (const candidate of [...new Set(candidates)]) {
    try {
      await fsp.access(candidate, fs.constants.X_OK);
      return candidate;
    } catch { /* try next candidate */ }
  }
  return '';
}

async function installContrib({ tempDir, memeHome, librariesDir }) {
  const target = process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  const destination = path.join(librariesDir, `meme-generator-contrib-macos-${process.arch}.dylib`);
  const manifestFile = path.join(librariesDir, 'meme-generator-contrib.json');
  const resourcesReady = (await Promise.all(CONTRIB_RESOURCE_KEYS.map(async (key) => {
    try { return (await fsp.stat(path.join(memeHome, 'resources', 'images', key))).isDirectory(); }
    catch { return false; }
  }))).every(Boolean);
  const manifest = await fsp.readFile(manifestFile, 'utf8').then(JSON.parse).catch(() => null);
  const binaryReady = fs.existsSync(destination)
    && Boolean(manifest?.sha256)
    && await sha256(destination).then((actual) => actual === manifest.sha256).catch(() => false);
  if (manifest?.commit === CONTRIB_COMMIT && manifest?.rustToolchain === CONTRIB_RUST_TOOLCHAIN
      && manifest?.arch === process.arch && binaryReady && resourcesReady) {
    console.log('meme-generator-contrib-rs 已是固定版本，跳过重复编译。');
    return;
  }

  const rustup = await resolveExecutable('rustup');
  if (!rustup) {
    throw new Error([
      '安装 meme-generator-contrib-rs 需要 rustup。',
      '请先执行：brew install rustup',
      '或使用 --skip-contrib 跳过该扩展。'
    ].join('\n'));
  }

  console.log(`准备 Rust ${CONTRIB_RUST_TOOLCHAIN}（与 meme-generator-rs v${CORE_VERSION} ABI 一致）…`);
  await run(rustup, ['toolchain', 'install', CONTRIB_RUST_TOOLCHAIN, '--profile', 'minimal']);
  const cargo = (await run(rustup, ['which', 'cargo', '--toolchain', CONTRIB_RUST_TOOLCHAIN], { capture: true })).stdout.trim();
  const rustc = (await run(rustup, ['which', 'rustc', '--toolchain', CONTRIB_RUST_TOOLCHAIN], { capture: true })).stdout.trim();
  if (!cargo || !rustc) throw new Error(`Rust ${CONTRIB_RUST_TOOLCHAIN} 中缺少 cargo 或 rustc`);
  const rustBinDir = path.dirname(cargo);

  const sourceDir = path.join(tempDir, 'meme-generator-contrib-rs');
  await fsp.mkdir(sourceDir, { recursive: true });
  await run('git', ['-C', sourceDir, 'init', '-q']);
  await run('git', ['-C', sourceDir, 'remote', 'add', 'origin', 'https://github.com/MemeCrafters/meme-generator-contrib-rs.git']);
  await run('git', ['-C', sourceDir, 'fetch', '--depth', '1', 'origin', CONTRIB_COMMIT]);
  await run('git', ['-C', sourceDir, 'checkout', '--detach', 'FETCH_HEAD']);

  console.log('从固定提交编译 meme-generator-contrib-rs…');
  const buildEnv = {
    ...process.env,
    PATH: `${rustBinDir}${path.delimiter}${process.env.PATH || ''}`,
    RUSTC: rustc
  };
  await run(cargo, ['build', '--release', '--target', target], {
    cwd: sourceDir,
    env: buildEnv
  });
  const builtLibrary = path.join(sourceDir, 'target', target, 'release', 'libmeme_generator_contrib.dylib');
  if (!fs.existsSync(builtLibrary)) throw new Error('contrib 编译完成，但没有找到动态库');
  await fsp.copyFile(builtLibrary, destination);
  await fsp.chmod(destination, 0o755);
  await fsp.mkdir(path.join(memeHome, 'resources'), { recursive: true });
  await fsp.cp(path.join(sourceDir, 'resources', 'images'), path.join(memeHome, 'resources', 'images'), {
    recursive: true,
    force: true
  });
  await fsp.writeFile(manifestFile, `${JSON.stringify({
    upstream: 'https://github.com/MemeCrafters/meme-generator-contrib-rs',
    commit: CONTRIB_COMMIT,
    rustToolchain: CONTRIB_RUST_TOOLCHAIN,
    arch: process.arch,
    sha256: await sha256(destination)
  }, null, 2)}\n`, 'utf8');
}

async function installTrendingPack({ tempDir, memeHome, librariesDir }) {
  const target = process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  const destination = path.join(librariesDir, `qq-agent-trending-memes-macos-${process.arch}.dylib`);
  const manifestFile = path.join(librariesDir, 'qq-agent-trending-memes.json');
  const resourceDir = path.join(memeHome, 'resources', 'images', 'back_hand_opossum');
  const resourceFile = path.join(resourceDir, 'spritesheet.webp');
  const manifest = await fsp.readFile(manifestFile, 'utf8').then(JSON.parse).catch(() => null);
  const binaryReady = fs.existsSync(destination)
    && Boolean(manifest?.sha256)
    && await sha256(destination).then((actual) => actual === manifest.sha256).catch(() => false);
  const resourceReady = fs.existsSync(resourceFile)
    && await sha256(resourceFile).then((actual) => actual === OPOSSUM_SPRITESHEET_SHA256).catch(() => false);
  if (manifest?.version === TRENDING_PACK_VERSION
      && manifest?.rustToolchain === CONTRIB_RUST_TOOLCHAIN
      && manifest?.arch === process.arch && binaryReady && resourceReady) {
    console.log('QQ Agent 近期热梗模板包已是当前版本，跳过重复编译。');
    return;
  }

  if (!fs.existsSync(path.join(TRENDING_SOURCE_DIR, 'Cargo.toml'))) {
    throw new Error(`缺少近期热梗模板源码：${TRENDING_SOURCE_DIR}`);
  }
  const rustup = await resolveExecutable('rustup');
  if (!rustup) throw new Error('安装近期热梗模板包需要 rustup，请先执行：brew install rustup');

  console.log(`准备 Rust ${CONTRIB_RUST_TOOLCHAIN}（近期热梗模板包）…`);
  await run(rustup, ['toolchain', 'install', CONTRIB_RUST_TOOLCHAIN, '--profile', 'minimal']);
  const cargo = (await run(rustup, ['which', 'cargo', '--toolchain', CONTRIB_RUST_TOOLCHAIN], { capture: true })).stdout.trim();
  const rustc = (await run(rustup, ['which', 'rustc', '--toolchain', CONTRIB_RUST_TOOLCHAIN], { capture: true })).stdout.trim();
  if (!cargo || !rustc) throw new Error(`Rust ${CONTRIB_RUST_TOOLCHAIN} 中缺少 cargo 或 rustc`);
  const rustBinDir = path.dirname(cargo);
  const sourceDir = path.join(tempDir, 'qq-agent-trending-memes-rs');
  await fsp.cp(TRENDING_SOURCE_DIR, sourceDir, { recursive: true, force: true });
  const buildEnv = {
    ...process.env,
    PATH: `${rustBinDir}${path.delimiter}${process.env.PATH || ''}`,
    RUSTC: rustc
  };
  await run(cargo, ['build', '--release', '--target', target], {
    cwd: sourceDir,
    env: buildEnv
  });
  const builtLibrary = path.join(sourceDir, 'target', target, 'release', 'libqq_agent_trending_memes.dylib');
  if (!fs.existsSync(builtLibrary)) throw new Error('近期热梗模板编译完成，但没有找到动态库');
  await fsp.copyFile(builtLibrary, destination);
  await fsp.chmod(destination, 0o755);

  const downloadedSprite = path.join(tempDir, 'back-hand-opossum-spritesheet.webp');
  await download(OPOSSUM_SPRITESHEET_URL, downloadedSprite, OPOSSUM_SPRITESHEET_SHA256);
  await fsp.mkdir(resourceDir, { recursive: true });
  await fsp.copyFile(downloadedSprite, resourceFile);
  await fsp.writeFile(manifestFile, `${JSON.stringify({
    package: 'qq-agent-trending-memes-rs',
    version: TRENDING_PACK_VERSION,
    rustToolchain: CONTRIB_RUST_TOOLCHAIN,
    arch: process.arch,
    sha256: await sha256(destination),
    resourceSources: [{
      upstream: 'https://github.com/claw16/codex-pet-beishoufushu',
      path: 'pet/spritesheet.webp',
      sha256: OPOSSUM_SPRITESHEET_SHA256,
      license: 'MIT'
    }]
  }, null, 2)}\n`, 'utf8');
}

async function installCrazyEmoji({ tempDir, memeHome, librariesDir }) {
  const target = process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  const destination = path.join(librariesDir, `crazy-emoji-macos-${process.arch}.dylib`);
  const manifestFile = path.join(librariesDir, 'crazy-emoji.json');
  const manifest = await fsp.readFile(manifestFile, 'utf8').then(JSON.parse).catch(() => null);
  const binaryReady = fs.existsSync(destination)
    && Boolean(manifest?.sha256)
    && await sha256(destination).then((actual) => actual === manifest.sha256).catch(() => false);
  if (manifest?.commit === CRAZY_EMOJI_COMMIT
      && manifest?.rustToolchain === CONTRIB_RUST_TOOLCHAIN
      && manifest?.arch === process.arch && binaryReady) {
    console.log('crazy-emoji 已是固定版本，跳过重复编译。');
    return Number(manifest.templates) || 38;
  }

  const sourceDir = await downloadArchive({
    tempDir,
    name: 'crazy-emoji',
    repository: 'anyliew/crazy-emoji',
    commit: CRAZY_EMOJI_COMMIT,
    sha256: CRAZY_EMOJI_ARCHIVE_SHA256
  });
  const { cargo, env } = await prepareRustToolchain('crazy-emoji');
  console.log('从固定提交编译 crazy-emoji…');
  await run(cargo, ['build', '--release', '--target', target], { cwd: sourceDir, env });
  const builtLibrary = path.join(sourceDir, 'target', target, 'release', 'libcrazy_emoji.dylib');
  if (!fs.existsSync(builtLibrary)) throw new Error('crazy-emoji 编译完成，但没有找到动态库');
  await fsp.copyFile(builtLibrary, destination);
  await fsp.chmod(destination, 0o755);
  await fsp.mkdir(path.join(memeHome, 'resources'), { recursive: true });
  await fsp.cp(path.join(sourceDir, 'resources', 'images'), path.join(memeHome, 'resources', 'images'), {
    recursive: true,
    force: true
  });
  const templates = (await fsp.readdir(path.join(sourceDir, 'src', 'memes')))
    .filter((name) => name.endsWith('.rs')).length;
  await fsp.writeFile(manifestFile, `${JSON.stringify({
    upstream: 'https://github.com/anyliew/crazy-emoji',
    commit: CRAZY_EMOJI_COMMIT,
    license: 'MIT; template media rights follow the upstream notice',
    rustToolchain: CONTRIB_RUST_TOOLCHAIN,
    arch: process.arch,
    templates,
    sha256: await sha256(destination)
  }, null, 2)}\n`, 'utf8');
  return templates;
}

async function patchPythonDataDirectories(venvDir) {
  const libDir = path.join(venvDir, 'lib');
  const versions = await fsp.readdir(libDir, { withFileTypes: true });
  const pythonLib = versions.find((entry) => entry.isDirectory() && entry.name.startsWith('python'));
  if (!pythonLib) throw new Error('tudou-meme 虚拟环境中没有找到 Python 库目录');
  const dirsFile = path.join(libDir, pythonLib.name, 'site-packages', 'meme_generator', 'dirs.py');
  const source = await fsp.readFile(dirsFile, 'utf8');
  const original = `BASE_CACHE_DIR = user_cache_dir(APP_NAME).resolve()\nBASE_CONFIG_DIR = user_config_dir(APP_NAME).resolve()\nBASE_DATA_DIR = user_data_dir(APP_NAME).resolve()`;
  const replacement = `\n_base_override = os.getenv("QQ_AGENT_MEME_PY_HOME")\nif _base_override:\n    _base_root = Path(_base_override).resolve()\n    BASE_CACHE_DIR = _base_root / "cache"\n    BASE_CONFIG_DIR = _base_root / "config"\n    BASE_DATA_DIR = _base_root / "data"\nelse:\n    BASE_CACHE_DIR = user_cache_dir(APP_NAME).resolve()\n    BASE_CONFIG_DIR = user_config_dir(APP_NAME).resolve()\n    BASE_DATA_DIR = user_data_dir(APP_NAME).resolve()`;
  if (!source.includes(original)) throw new Error('无法为 Python meme-generator 设置独立应用数据目录');
  await fsp.writeFile(dirsFile, source.replace(original, replacement), 'utf8');
}

async function installTudouMeme({ tempDir, memeHome }) {
  const engineDir = path.join(memeHome, 'engines', 'tudou-meme');
  const manifestFile = path.join(engineDir, 'manifest.json');
  const python = path.join(engineDir, 'venv', 'bin', 'python');
  const installedRunner = path.join(engineDir, 'runner.py');
  const runnerSha256 = await sha256(TUDOU_RUNNER);
  const manifest = await fsp.readFile(manifestFile, 'utf8').then(JSON.parse).catch(() => null);
  if (manifest?.upstreamCommit === TUDOU_MEME_COMMIT
      && manifest?.pythonPackage === PYTHON_MEME_GENERATOR_VERSION
      && Array.isArray(manifest?.templates) && manifest.templates.length === TUDOU_TEMPLATE_COUNT
      && manifest?.runnerSha256 === runnerSha256
      && fs.existsSync(python) && fs.existsSync(installedRunner)
      && await sha256(installedRunner).then((actual) => actual === runnerSha256).catch(() => false)) {
    console.log('tudou-meme 已是固定版本，跳过重复安装。');
    return manifest.templates.length;
  }

  const systemPython = await resolveExecutable('python3');
  if (!systemPython) throw new Error('安装 tudou-meme 需要 Python 3.9 或更高版本');
  if (!fs.existsSync(TUDOU_RUNNER)) throw new Error(`缺少 tudou-meme Runner：${TUDOU_RUNNER}`);
  const sourceRoot = await downloadArchive({
    tempDir,
    name: 'tudou-meme',
    repository: 'LRZ9712/tudou-meme',
    commit: TUDOU_MEME_COMMIT,
    sha256: TUDOU_MEME_ARCHIVE_SHA256
  });
  await fsp.rm(engineDir, { recursive: true, force: true });
  await fsp.mkdir(engineDir, { recursive: true });
  await fsp.cp(path.join(sourceRoot, 'meme'), path.join(engineDir, 'source'), { recursive: true, force: true });
  await fsp.copyFile(TUDOU_RUNNER, installedRunner);
  const venvDir = path.join(engineDir, 'venv');
  console.log(`创建 tudou-meme Python ${PYTHON_MEME_GENERATOR_VERSION} 隔离环境…`);
  await run(systemPython, ['-m', 'venv', venvDir]);
  await run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--upgrade', 'pip']);
  await run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', `meme-generator==${PYTHON_MEME_GENERATOR_VERSION}`]);
  await patchPythonDataDirectories(venvDir);

  const env = {
    ...process.env,
    QQ_AGENT_MEME_PY_HOME: path.join(engineDir, 'home'),
    PYTHONUTF8: '1'
  };
  const { stdout } = await run(python, [
    path.join(engineDir, 'runner.py'), 'catalog', '--source', path.join(engineDir, 'source')
  ], { cwd: engineDir, env, capture: true });
  const catalog = JSON.parse(stdout);
  if (!Array.isArray(catalog.templates) || catalog.templates.length !== TUDOU_TEMPLATE_COUNT || catalog.errors?.length) {
    const detail = (catalog.errors || []).slice(0, 5).map((item) => `${item.moduleDir}: ${item.error}`).join('\n');
    throw new Error(`tudou-meme 目录加载不完整（${catalog.templates?.length || 0}/${TUDOU_TEMPLATE_COUNT}）${detail ? `\n${detail}` : ''}`);
  }
  await fsp.writeFile(manifestFile, `${JSON.stringify({
    upstream: 'https://github.com/LRZ9712/tudou-meme',
    upstreamCommit: TUDOU_MEME_COMMIT,
    license: 'MIT; template media rights follow the upstream notice',
    pythonPackage: PYTHON_MEME_GENERATOR_VERSION,
    runnerSha256,
    templates: catalog.templates
  }, null, 2)}\n`, 'utf8');
  return catalog.templates.length;
}

async function addGengtuPack(classicSource, gengtuSource) {
  const packDir = path.join(classicSource, 'assets', 'templates', 'packs', 'gengtu');
  const imagesDir = path.join(packDir, 'images');
  await fsp.mkdir(imagesDir, { recursive: true });
  await fsp.writeFile(path.join(packDir, 'pack.json'), `${JSON.stringify({
    id: 'gengtu', name: 'Gengtu', tags: ['gengtu', '中文梗图']
  }, null, 2)}\n`, 'utf8');

  const sourceDir = path.join(gengtuSource, 'public', 'memes');
  const configs = (await fsp.readdir(sourceDir)).filter((name) => name.endsWith('.json')).sort();
  for (const configName of configs) {
    const config = JSON.parse(await fsp.readFile(path.join(sourceDir, configName), 'utf8'));
    const mediaName = path.basename(String(config.url || ''));
    if (!mediaName || !fs.existsSync(path.join(sourceDir, mediaName))) {
      throw new Error(`gengtu 模板缺少图片：${configName}`);
    }
    const base = path.basename(mediaName, path.extname(mediaName));
    await fsp.copyFile(path.join(sourceDir, mediaName), path.join(imagesDir, mediaName));
    const slots = (config.textFields || []).map((field, index) => {
      const style = {
        size: Number(field.fontSize) || 42,
        color: String(field.color || '#000000'),
        bold: Boolean(field.bold)
      };
      if (field.effect === 'outline' || field.effect === 'glow') {
        style.stroke = String(field.outlineColor || '#ffffff');
        style.strokeWidth = Math.max(1, Number(field.outlineWidth) || 2);
      }
      return {
        name: `text${index + 1}`,
        rect: [Number(field.x) || 0, Number(field.y) || 0, Number(field.width) || 1, Number(field.height) || 1],
        hint: String(field.placeholder || `文字 ${index + 1}`),
        align: ['left', 'right'].includes(field.align) ? field.align : 'center',
        style
      };
    });
    await fsp.writeFile(path.join(imagesDir, `${base}.meta.json`), `${JSON.stringify({
      name: String(config.name || config.id || base),
      tags: [String(config.id || base), ...(config.tags || []).map(String)],
      category: 'gengtu',
      slots,
      source: {
        url: `https://github.com/cholf5/gengtu/blob/${GENGTU_COMMIT}/public/memes/${encodeURIComponent(mediaName)}`,
        license: 'MIT repository; template media rights follow upstream'
      }
    }, null, 2)}\n`, 'utf8');
  }
  return configs.length;
}

async function installClassicMemes({ tempDir, memeHome }) {
  const engineDir = path.join(memeHome, 'engines', 'classic-memes');
  const provenanceFile = path.join(engineDir, 'qq-agent-manifest.json');
  const provenance = await fsp.readFile(provenanceFile, 'utf8').then(JSON.parse).catch(() => null);
  if (provenance?.classicCommit === CLASSIC_MEME_COMMIT
      && provenance?.gengtuCommit === GENGTU_COMMIT
      && provenance?.templates === 642
      && fs.existsSync(path.join(engineDir, 'dist', 'cli.js'))
      && fs.existsSync(path.join(engineDir, 'assets', 'templates', 'manifest.json'))) {
    console.log('C1 经典模板与 B3 gengtu 模板包已是固定版本，跳过重复构建。');
    return provenance.templates;
  }

  const classicSource = await downloadArchive({
    tempDir,
    name: 'agent-meme-maker',
    repository: 'kartikkabadi/meme-maker',
    commit: CLASSIC_MEME_COMMIT,
    sha256: CLASSIC_MEME_ARCHIVE_SHA256
  });
  const gengtuSource = await downloadArchive({
    tempDir,
    name: 'gengtu',
    repository: 'cholf5/gengtu',
    commit: GENGTU_COMMIT,
    sha256: GENGTU_ARCHIVE_SHA256
  });
  const gengtuCount = await addGengtuPack(classicSource, gengtuSource);
  console.log('构建 C1 本地渲染器并合并 B3 模板…');
  await run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: classicSource });
  await run('npm', ['run', 'build:manifest'], { cwd: classicSource });
  await run('npm', ['exec', 'tsc', '--', '-p', 'tsconfig.json'], { cwd: classicSource });
  const catalog = JSON.parse(await fsp.readFile(path.join(classicSource, 'assets', 'templates', 'manifest.json'), 'utf8'));
  const classicCount = catalog.templates.filter((item) => item.pack !== 'gengtu').length;
  if (classicCount !== 610 || gengtuCount !== 32 || catalog.templates.length !== 642) {
    throw new Error(`C1/B3 模板数异常：C1=${classicCount}，B3=${gengtuCount}，总计=${catalog.templates.length}`);
  }
  await run('npm', ['prune', '--omit=dev', '--no-audit', '--no-fund'], { cwd: classicSource });
  await fsp.rm(engineDir, { recursive: true, force: true });
  await fsp.mkdir(engineDir, { recursive: true });
  for (const entry of ['dist', 'assets', 'node_modules']) {
    await fsp.cp(path.join(classicSource, entry), path.join(engineDir, entry), { recursive: true, force: true });
  }
  for (const entry of ['package.json', 'package-lock.json', 'LICENSE', 'NOTICE', 'README.md']) {
    if (fs.existsSync(path.join(classicSource, entry))) await fsp.copyFile(path.join(classicSource, entry), path.join(engineDir, entry));
  }
  await fsp.writeFile(provenanceFile, `${JSON.stringify({
    upstream: 'https://github.com/kartikkabadi/meme-maker',
    classicCommit: CLASSIC_MEME_COMMIT,
    classicTemplates: classicCount,
    gengtuUpstream: 'https://github.com/cholf5/gengtu',
    gengtuCommit: GENGTU_COMMIT,
    gengtuTemplates: gengtuCount,
    templates: catalog.templates.length,
    licenses: ['MIT code', 'per-template source and media terms retained in manifest/CREDITS.md']
  }, null, 2)}\n`, 'utf8');
  return catalog.templates.length;
}

async function expandedTemplateCount(memeHome) {
  const tudou = await fsp.readFile(path.join(memeHome, 'engines', 'tudou-meme', 'manifest.json'), 'utf8')
    .then((text) => JSON.parse(text).templates?.length || 0).catch(() => 0);
  const classic = await fsp.readFile(path.join(memeHome, 'engines', 'classic-memes', 'qq-agent-manifest.json'), 'utf8')
    .then((text) => JSON.parse(text).templates || 0).catch(() => 0);
  return tudou + classic;
}

function ensureMemeConfig(content) {
  const source = String(content || '').trim();
  if (!source) {
    return `[meme]
load_builtin_memes = true
load_external_memes = true
meme_disabled_list = []

[resource]
resource_url = "https://cdn.jsdelivr.net/gh/MemeCrafters/meme-generator-rs@"
download_fonts = true

[font]
use_local_fonts = true
default_font_families = ["Noto Sans SC", "Noto Color Emoji"]

[encoder]
gif_max_frames = 200
`;
  }

  const lines = source.split(/\r?\n/);
  let sectionStart = lines.findIndex((line) => /^\s*\[meme\]\s*$/.test(line));
  if (sectionStart < 0) {
    lines.unshift('[meme]', 'load_builtin_memes = true', 'load_external_memes = true', '');
    return `${lines.join('\n').trim()}\n`;
  }
  let sectionEnd = lines.findIndex((line, index) => index > sectionStart && /^\s*\[[^\]]+\]\s*$/.test(line));
  if (sectionEnd < 0) sectionEnd = lines.length;
  for (const [key, value] of [['load_builtin_memes', 'true'], ['load_external_memes', 'true']]) {
    const existing = lines.findIndex((line, index) => index > sectionStart && index < sectionEnd && new RegExp(`^\\s*${key}\\s*=`).test(line));
    if (existing >= 0) lines[existing] = `${key} = ${value}`;
    else {
      lines.splice(sectionStart + 1, 0, `${key} = ${value}`);
      sectionEnd += 1;
    }
  }
  return `${lines.join('\n').trim()}\n`;
}

async function install() {
  if (process.platform !== 'darwin') throw new Error('当前安装脚本只支持 macOS');
  const options = parseArgs(process.argv.slice(2));
  const asset = PLATFORM_ASSETS[process.arch];
  if (!asset) throw new Error(`不支持的 CPU 架构：${process.arch}`);

  const dataDir = path.resolve(options.dataDir || process.env.QQ_AGENT_DATA_DIR || path.join(ROOT, 'runtime', 'data'));
  const memeHome = path.join(dataDir, 'meme-generator');
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'qq-agent-meme-'));
  const cliZip = path.join(tempDir, asset.coreName);
  const cliExtract = path.join(tempDir, 'cli');
  const extensionFile = path.join(tempDir, asset.extensionName);
  const cliDestination = path.join(memeHome, 'bin', 'meme');
  const librariesDir = path.join(memeHome, 'libraries');
  const configFile = path.join(memeHome, 'config.toml');

  if (options.trendingOnly && options.expandedOnly) {
    throw new Error('--trending-only 与 --expanded-only 不能同时使用');
  }

  console.log(`应用数据目录：${dataDir}`);
  console.log(`表情数据目录：${memeHome}`);

  try {
    await fsp.mkdir(cliExtract, { recursive: true });
    await fsp.mkdir(path.dirname(cliDestination), { recursive: true });
    await fsp.mkdir(librariesDir, { recursive: true });

    if (options.trendingOnly) {
      if (!fs.existsSync(cliDestination)) throw new Error('尚未安装基础生成器，不能使用 --trending-only');
      await installTrendingPack({ tempDir, memeHome, librariesDir });
      const env = { ...process.env, MEME_HOME: memeHome };
      const { stdout } = await run(cliDestination, ['list'], { cwd: memeHome, env, capture: true });
      const count = stdout.split(/\r?\n/).filter((line) => /^\s*\d+\.\s+/.test(line)).length;
      console.log(`近期热梗模板安装完成：当前共加载 ${count} 个模板。请重启 QQ Agent。`);
      return;
    }

    if (options.expandedOnly) {
      if (!fs.existsSync(cliDestination)) throw new Error('尚未安装基础生成器，不能使用 --expanded-only');
      await installCrazyEmoji({ tempDir, memeHome, librariesDir });
      await installTudouMeme({ tempDir, memeHome });
      await installClassicMemes({ tempDir, memeHome });
      const env = { ...process.env, MEME_HOME: memeHome };
      const { stdout } = await run(cliDestination, ['list'], { cwd: memeHome, env, capture: true });
      const nativeCount = stdout.split(/\r?\n/).filter((line) => /^\s*\d+\.\s+/.test(line)).length;
      const externalCount = await expandedTemplateCount(memeHome);
      console.log(`B1/B2/B3/C1 安装完成：原生 ${nativeCount} 个，独立引擎 ${externalCount} 个，总计 ${nativeCount + externalCount} 个模板。请重启 QQ Agent。`);
      return;
    }

    const memeEmojiDestination = path.join(librariesDir, `meme-emoji-macos-${process.arch}.dylib`);
    const contribDestination = path.join(librariesDir, `meme-generator-contrib-macos-${process.arch}.dylib`);
    const contribManifest = path.join(librariesDir, 'meme-generator-contrib.json');
    const trendingDestination = path.join(librariesDir, `qq-agent-trending-memes-macos-${process.arch}.dylib`);
    const trendingManifest = path.join(librariesDir, 'qq-agent-trending-memes.json');
    const trendingResources = path.join(memeHome, 'resources', 'images', 'back_hand_opossum');
    const crazyDestination = path.join(librariesDir, `crazy-emoji-macos-${process.arch}.dylib`);
    const crazyManifest = path.join(librariesDir, 'crazy-emoji.json');
    const enginesDir = path.join(memeHome, 'engines');
    if (options.builtinOnly) {
      await Promise.all([
        fsp.unlink(memeEmojiDestination).catch(() => {}),
        fsp.unlink(contribDestination).catch(() => {}),
        fsp.unlink(contribManifest).catch(() => {}),
        fsp.unlink(trendingDestination).catch(() => {}),
        fsp.unlink(trendingManifest).catch(() => {}),
        fsp.unlink(crazyDestination).catch(() => {}),
        fsp.unlink(crazyManifest).catch(() => {}),
        fsp.rm(enginesDir, { recursive: true, force: true }).catch(() => {}),
        fsp.rm(trendingResources, { recursive: true, force: true }).catch(() => {})
      ]);
    } else if (options.skipContrib) {
      await Promise.all([
        fsp.unlink(contribDestination).catch(() => {}),
        fsp.unlink(contribManifest).catch(() => {})
      ]);
    }
    if (!options.builtinOnly && options.skipTrending) {
      await Promise.all([
        fsp.unlink(trendingDestination).catch(() => {}),
        fsp.unlink(trendingManifest).catch(() => {}),
        fsp.rm(trendingResources, { recursive: true, force: true }).catch(() => {})
      ]);
    }
    if (!options.builtinOnly && options.skipExpanded) {
      await Promise.all([
        fsp.unlink(crazyDestination).catch(() => {}),
        fsp.unlink(crazyManifest).catch(() => {}),
        fsp.rm(enginesDir, { recursive: true, force: true }).catch(() => {})
      ]);
    }

    const coreUrl = `https://github.com/MemeCrafters/meme-generator-rs/releases/download/v${CORE_VERSION}/${asset.coreName}`;
    await download(coreUrl, cliZip, asset.coreSha256);
    await run('/usr/bin/unzip', ['-q', cliZip, '-d', cliExtract]);
    const extractedCli = await findFile(cliExtract, 'meme');
    if (!extractedCli) throw new Error('官方 CLI 压缩包中没有找到 meme 可执行文件');
    await fsp.copyFile(extractedCli, cliDestination);
    await fsp.chmod(cliDestination, 0o755);

    const oldConfig = await fsp.readFile(configFile, 'utf8').catch(() => '');
    await fsp.writeFile(configFile, ensureMemeConfig(oldConfig), 'utf8');

    if (!options.builtinOnly) {
      const encodedTag = encodeURIComponent(`v${COMMUNITY_VERSION}`);
      const extensionUrl = `https://github.com/anyliew/meme-emoji/releases/download/${encodedTag}/${asset.extensionName}`;
      await download(extensionUrl, extensionFile, asset.extensionSha256);
      await fsp.copyFile(extensionFile, memeEmojiDestination);

      console.log('下载 meme-emoji 模板资源（体积较大，请耐心等待）…');
      const sourceDir = path.join(tempDir, 'meme-emoji');
      await run('git', [
        'clone', '--depth', '1', '--single-branch', '--branch', `v${COMMUNITY_VERSION}`,
        '--filter=blob:none', '--sparse', 'https://github.com/anyliew/meme-emoji.git', sourceDir
      ]);
      await run('git', ['-C', sourceDir, 'sparse-checkout', 'set', 'resources/images']);
      await fsp.mkdir(path.join(memeHome, 'resources'), { recursive: true });
      await fsp.cp(path.join(sourceDir, 'resources', 'images'), path.join(memeHome, 'resources', 'images'), {
        recursive: true,
        force: true
      });

      if (!options.skipContrib) {
        await installContrib({ tempDir, memeHome, librariesDir });
      }
      if (!options.skipTrending) {
        await installTrendingPack({ tempDir, memeHome, librariesDir });
      }
      if (!options.skipExpanded) {
        await installCrazyEmoji({ tempDir, memeHome, librariesDir });
        await installTudouMeme({ tempDir, memeHome });
        await installClassicMemes({ tempDir, memeHome });
      }
    }

    const env = { ...process.env, MEME_HOME: memeHome };
    console.log('检查并补全官方模板与字体资源…');
    await run(cliDestination, ['download'], { cwd: memeHome, env });
    const { stdout } = await run(cliDestination, ['list'], { cwd: memeHome, env, capture: true });
    const nativeCount = stdout.split(/\r?\n/).filter((line) => /^\s*\d+\.\s+/.test(line)).length;
    const externalCount = await expandedTemplateCount(memeHome);
    console.log(`安装完成：原生 ${nativeCount} 个，独立引擎 ${externalCount} 个，总计 ${nativeCount + externalCount} 个模板。请重启 QQ Agent。`);
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

install().catch((error) => {
  console.error(`表情扩展安装失败：${error?.message || error}`);
  process.exitCode = 1;
});
