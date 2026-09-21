// macOS + Clash Fake-IP 兼容。
//
// 部分本机代理会把域名解析为 198.18.0.0/15 的保留地址，再由 TUN 接管连接。
// 当某个域名的 TUN 路由异常时，Node/undici 会在 TLS 建立前收到 ECONNRESET。
// 这里只对明确列入白名单的模型域名、且系统确实返回 Fake-IP 时，通过 DoH
// 获取真实地址；SNI 与证书校验仍使用原域名，不降低 HTTPS 安全性。
import dns from 'node:dns';
import https from 'node:https';

const DEFAULT_DOH_URL = 'https://doh.pub/dns-query';
const cache = new Map();

export function isFakeIpv4(address) {
  const parts = String(address || '').split('.').map(Number);
  return parts.length === 4
    && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    && parts[0] === 198
    && (parts[1] === 18 || parts[1] === 19);
}

function requestJson(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { accept: 'application/dns-json', 'user-agent': 'qq-agent-macos/0.3' }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        if ((res.statusCode || 0) >= 400) return reject(new Error(`DoH HTTP ${res.statusCode}`));
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('DoH timeout')));
    req.once('error', reject);
  });
}

export async function resolveRealAddresses(hostname, { family = 0, dohUrl = DEFAULT_DOH_URL } = {}) {
  const queryType = family === 6 ? 'AAAA' : 'A';
  const key = `${hostname}|${queryType}|${dohUrl}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.addresses;

  const url = new URL(dohUrl);
  url.searchParams.set('name', hostname);
  url.searchParams.set('type', queryType);
  const data = await requestJson(url);
  const expectedType = queryType === 'AAAA' ? 28 : 1;
  const answers = (Array.isArray(data?.Answer) ? data.Answer : [])
    .filter((item) => Number(item?.type) === expectedType)
    .map((item) => ({
      address: String(item.data || ''),
      family: queryType === 'AAAA' ? 6 : 4,
      ttl: Number(item.TTL) || 60
    }))
    .filter((item) => item.address && !isFakeIpv4(item.address));
  if (!answers.length) throw new Error(`DoH 未返回 ${queryType} 地址`);

  const ttlSeconds = Math.min(600, Math.max(30, Math.min(...answers.map((item) => item.ttl))));
  const addresses = answers.map(({ address, family: itemFamily }) => ({ address, family: itemFamily }));
  cache.set(key, { addresses, expiresAt: Date.now() + ttlSeconds * 1000 });
  return addresses;
}

export function createAdaptiveLookup({ hosts = [], dohUrl = DEFAULT_DOH_URL, log = () => {} } = {}) {
  const fallbackHosts = new Set(hosts.map((host) => String(host || '').trim().toLowerCase()).filter(Boolean));

  return function adaptiveLookup(hostname, options, callback) {
    const normalizedHost = String(hostname || '').toLowerCase();
    const opts = typeof options === 'object' && options ? options : { family: Number(options) || 0 };
    const familyPreference = Number(opts.family) || 0;
    const wantsAll = opts.all === true;

    dns.lookup(hostname, options, (error, address, family) => {
      const nativeAddresses = Array.isArray(address)
        ? address
        : (address ? [{ address, family: Number(family) || 4 }] : []);
      const fakeIpDetected = nativeAddresses.some((item) => isFakeIpv4(item.address));
      if (!fallbackHosts.has(normalizedHost) || (!error && !fakeIpDetected)) {
        callback(error, address, family);
        return;
      }

      resolveRealAddresses(hostname, { family: familyPreference, dohUrl }).then((addresses) => {
        log(`[net] ${hostname} 命中 Fake-IP，已使用真实 DNS 地址建立 TLS 连接`);
        if (wantsAll) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      }).catch((fallbackError) => {
        log(`[net] ${hostname} 的真实 DNS 回退失败：${fallbackError?.message ?? fallbackError}`);
        callback(error, address, family);
      });
    });
  };
}
