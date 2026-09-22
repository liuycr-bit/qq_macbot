#!/usr/bin/env node

/**
 * 将 meme-generator-rs CLI、meme-emoji 动态库和两者所需资源安装到
 * QQ Agent 的应用数据目录。第三方二进制和图片不会写入源码仓库或 .app。
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
  --builtin-only      只安装官方内置模板，不安装 meme-emoji 扩展
  --help              显示帮助

也可用 QQ_AGENT_DATA_DIR 环境变量指定数据目录。`);
}

function parseArgs(argv) {
  const options = { dataDir: '', builtinOnly: false };
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

  console.log(`应用数据目录：${dataDir}`);
  console.log(`表情数据目录：${memeHome}`);

  try {
    await fsp.mkdir(cliExtract, { recursive: true });
    await fsp.mkdir(path.dirname(cliDestination), { recursive: true });
    await fsp.mkdir(librariesDir, { recursive: true });

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
      await fsp.copyFile(extensionFile, path.join(librariesDir, `meme-emoji-macos-${process.arch}.dylib`));

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
    }

    const env = { ...process.env, MEME_HOME: memeHome };
    console.log('检查并补全官方模板与字体资源…');
    await run(cliDestination, ['download'], { cwd: memeHome, env });
    const { stdout } = await run(cliDestination, ['list'], { cwd: memeHome, env, capture: true });
    const count = stdout.split(/\r?\n/).filter((line) => /^\s*\d+\.\s+/.test(line)).length;
    console.log(`安装完成：已加载 ${count} 个模板。请重启 QQ Agent。`);
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

install().catch((error) => {
  console.error(`表情扩展安装失败：${error?.message || error}`);
  process.exitCode = 1;
});
