import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(projectRoot, 'extensions', 'napcat-avatar-bridge');
const container = path.join(os.homedir(), 'Library', 'Containers', 'com.tencent.qq', 'Data');

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? path.resolve(process.argv[index + 1].replace(/^~(?=\/)/, os.homedir())) : fallback;
}

const napcatRoot = argValue('--napcat-root', path.join(container, 'Documents', 'napcat'));
const napcatDataDir = argValue('--napcat-data-dir', path.join(container, 'Library', 'Application Support', 'QQ', 'NapCat'));
const pluginId = 'qq-avatar-bridge';
const targetDir = path.join(napcatDataDir, 'plugins', pluginId);
const pluginConfigDir = path.join(napcatDataDir, 'config', 'plugins', pluginId);
const pluginConfigFile = path.join(pluginConfigDir, 'config.json');
const pluginsStateFile = path.join(napcatDataDir, 'config', 'plugins.json');
const napcatBundle = path.join(napcatRoot, 'napcat.mjs');

if (!fs.existsSync(sourceDir)) throw new Error(`Plugin source is missing: ${sourceDir}`);
if (!fs.existsSync(napcatBundle)) throw new Error(`NapCat bundle is missing: ${napcatBundle}`);

fs.mkdirSync(targetDir, { recursive: true });
for (const name of ['package.json', 'index.mjs', 'README.md']) {
  fs.copyFileSync(path.join(sourceDir, name), path.join(targetDir, name));
}

fs.mkdirSync(pluginConfigDir, { recursive: true });
let pluginConfig = {};
try { pluginConfig = JSON.parse(fs.readFileSync(pluginConfigFile, 'utf8')); } catch { /* first install */ }
if (!pluginConfig.token) pluginConfig.token = randomBytes(32).toString('base64url');
pluginConfig.maxBytes = Math.min(20 * 1024 * 1024, Math.max(256 * 1024, Number(pluginConfig.maxBytes) || 5 * 1024 * 1024));
fs.writeFileSync(pluginConfigFile, `${JSON.stringify(pluginConfig, null, 2)}\n`, { mode: 0o600 });
fs.chmodSync(pluginConfigFile, 0o600);

let pluginStates = {};
try { pluginStates = JSON.parse(fs.readFileSync(pluginsStateFile, 'utf8')); } catch { /* first plugin */ }
pluginStates[pluginId] = true;
fs.mkdirSync(path.dirname(pluginsStateFile), { recursive: true });
fs.writeFileSync(pluginsStateFile, `${JSON.stringify(pluginStates, null, 2)}\n`, 'utf8');

let bundle = fs.readFileSync(napcatBundle, 'utf8');
let patched = false;
if (!bundle.includes(`"${pluginId}"`)) {
  const anchors = ['"napcat-plugin-qce"', '"napcat-plugin-builtin"'];
  const anchor = anchors.find((item) => bundle.includes(item));
  if (!anchor) throw new Error('Unsupported NapCat plugin allowlist layout; refusing to patch');
  const anchorIndex = bundle.indexOf(anchor);
  const setStart = bundle.lastIndexOf('new Set([', anchorIndex);
  const setEnd = bundle.indexOf('])', anchorIndex);
  if (setStart < 0 || setEnd < 0 || anchorIndex - setStart > 2000 || setEnd - anchorIndex > 2000) {
    throw new Error('Could not safely locate the NapCat plugin allowlist');
  }
  const backup = `${napcatBundle}.before-avatar-bridge`;
  if (!fs.existsSync(backup)) fs.copyFileSync(napcatBundle, backup);
  const insertAt = anchorIndex + anchor.length;
  bundle = `${bundle.slice(0, insertAt)},\n  "${pluginId}"${bundle.slice(insertAt)}`;
  fs.writeFileSync(napcatBundle, bundle, 'utf8');
  patched = true;
}

console.log(`Installed ${pluginId} in ${targetDir}`);
console.log(`Enabled plugin in ${pluginsStateFile}`);
console.log(`${patched ? 'Updated' : 'Kept'} NapCat plugin allowlist in ${napcatBundle}`);
console.log('Restart QQ/NapCat and QQ Agent to activate the authenticated avatar bridge.');
