import fs from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function loadConfig(configPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return {
      token: String(parsed?.token || ''),
      maxBytes: Math.min(20 * 1024 * 1024, Math.max(256 * 1024, Number(parsed?.maxBytes) || DEFAULT_MAX_BYTES))
    };
  } catch {
    return { token: '', maxBytes: DEFAULT_MAX_BYTES };
  }
}

function requestAddress(req) {
  const raw = req?.raw;
  return String(raw?.socket?.remoteAddress || raw?.connection?.remoteAddress || '');
}

function requestToken(req) {
  const authorization = String(req?.headers?.authorization || '');
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization)?.[1];
  return String(bearer || req?.headers?.['x-avatar-bridge-token'] || '');
}

function tokensEqual(actual, expected) {
  const left = Buffer.from(String(actual || ''), 'utf8');
  const right = Buffer.from(String(expected || ''), 'utf8');
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

function detectImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    if (buffer.length >= 24 && buffer.readUInt32BE(16) === 40 && buffer.readUInt32BE(20) === 40) return null;
    return 'image/png';
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 3).toString('ascii') === 'GIF') return 'image/gif';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

function collectCandidates(value, paths, buffers, seen = new Set()) {
  if (value == null || seen.has(value)) return;
  if (Buffer.isBuffer(value)) {
    buffers.push(value);
    return;
  }
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return;
    if (raw.startsWith('file://')) {
      try { paths.push(fileURLToPath(raw)); } catch { /* ignore malformed file URL */ }
    } else {
      paths.push(raw);
    }
    return;
  }
  if (typeof value !== 'object') return;
  seen.add(value);
  if (ArrayBuffer.isView(value)) {
    buffers.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    return;
  }
  if (value instanceof ArrayBuffer) {
    buffers.push(Buffer.from(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectCandidates(item, paths, buffers, seen);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (/path|file|avatar|result|data/i.test(key)) collectCandidates(item, paths, buffers, seen);
  }
}

function readCandidate(paths, buffers, maxBytes) {
  for (const buffer of buffers) {
    if (buffer.length > 0 && buffer.length <= maxBytes) {
      const contentType = detectImage(buffer);
      if (contentType) return { buffer, contentType };
    }
  }
  for (const candidate of paths) {
    try {
      const file = path.resolve(String(candidate));
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) continue;
      const buffer = fs.readFileSync(file);
      const contentType = detectImage(buffer);
      if (contentType) return { buffer, contentType };
    } catch { /* native service may return a path before the file is materialized */ }
  }
  return null;
}

async function callNative(service, method, args, paths, buffers) {
  if (typeof service?.[method] !== 'function') return;
  const result = await Promise.resolve(service[method](...args));
  collectCandidates(result, paths, buffers);
}

async function resolveAvatar(ctx, uin, maxBytes) {
  const service = ctx.core?.context?.session?.getAvatarService?.();
  if (!service || service.isNull?.()) throw new Error('QQ avatar service is unavailable');

  const paths = [];
  const buffers = [];
  let uid = '';
  try { uid = String(await ctx.core.apis.UserApi.getUidByUinV2(uin) || ''); } catch { /* UIN API fallback remains available */ }

  // NapCat 4.18.x exposes the two-argument form. Calling the UIN variant first avoids
  // depending on the public qlogo endpoints and lets the logged-in QQ session fetch it.
  try { await callNative(service, 'getAvatarPathByUin', [uin, 0], paths, buffers); } catch { /* continue */ }
  try { await callNative(service, 'forceDownloadAvatarByUin', [uin, 0], paths, buffers); } catch { /* try UID variant */ }
  try { await callNative(service, 'getAvatarPathByUin', [uin, 0], paths, buffers); } catch { /* continue */ }

  if (uid) {
    try { await callNative(service, 'getAvatarPath', [uid, 0], paths, buffers); } catch { /* continue */ }
    try { await callNative(service, 'forceDownloadAvatar', [uid, 0], paths, buffers); } catch { /* continue */ }
    try { await callNative(service, 'getAvatarPath', [uid, 0], paths, buffers); } catch { /* continue */ }
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const image = readCandidate(paths, buffers, maxBytes);
    if (image) return image;
    await new Promise((resolve) => setTimeout(resolve, 100));
    try { await callNative(service, 'getAvatarPathByUin', [uin, 0], paths, buffers); } catch { /* continue */ }
    if (uid) {
      try { await callNative(service, 'getAvatarPath', [uid, 0], paths, buffers); } catch { /* continue */ }
    }
  }
  return null;
}

export const plugin_init = async (ctx) => {
  const config = loadConfig(ctx.configPath);
  if (!config.token) throw new Error('Missing token in plugin config');

  ctx.router.postNoAuth('/avatar', async (req, res) => {
    if (!LOOPBACK_ADDRESSES.has(requestAddress(req))) {
      res.status(403).json({ code: -1, message: 'Loopback requests only' });
      return;
    }
    if (!tokensEqual(requestToken(req), config.token)) {
      res.status(401).json({ code: -1, message: 'Unauthorized' });
      return;
    }
    const uin = String(req?.body?.uin || '').trim();
    if (!/^\d{5,12}$/.test(uin)) {
      res.status(400).json({ code: -1, message: 'Invalid QQ number' });
      return;
    }
    try {
      const image = await resolveAvatar(ctx, uin, config.maxBytes);
      if (!image) {
        res.status(404).json({ code: -1, message: 'Avatar unavailable' });
        return;
      }
      res.setHeader('content-type', image.contentType);
      res.setHeader('content-length', String(image.buffer.length));
      res.setHeader('cache-control', 'no-store');
      res.send(image.buffer);
    } catch (error) {
      ctx.logger.warn('Avatar request failed:', error?.message || error);
      res.status(502).json({ code: -1, message: 'QQ avatar service failed' });
    }
  });

  ctx.router.getNoAuth('/health', (req, res) => {
    if (!LOOPBACK_ADDRESSES.has(requestAddress(req)) || !tokensEqual(requestToken(req), config.token)) {
      res.status(401).json({ code: -1, message: 'Unauthorized' });
      return;
    }
    const service = ctx.core?.context?.session?.getAvatarService?.();
    res.json({ code: 0, data: { ready: !!service && !service.isNull?.() } });
  });

  ctx.logger.info('QQ avatar bridge initialized (loopback only)');
};
