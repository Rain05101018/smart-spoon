/**
 * sw.js — 智味勺 Service Worker
 * 策略：
 *  - 静态资源（页面/JS/CSS/图标）：Cache First，后台更新
 *  - /api/*：Network First，失败返回友好 JSON
 * 注意：SW 只在 HTTPS 或 localhost 下生效（与 Web Bluetooth 要求一致）。
 */

const CACHE = 'spoon-v8';
const PRECACHE = [
  '/spoon',
  '/static/spoon.css?v=8',
  '/static/spoon.js?v=8',
  '/static/manifest.webmanifest',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;   // POST（识别/同步）直接走网络

  // API：网络优先
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ ok: false, message: '当前离线，无法访问服务器' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    return;
  }

  // 静态：缓存优先，未命中回源并写缓存
  e.respondWith(
    caches.match(e.request, { ignoreSearch: false }).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((resp) => {
        if (resp.ok && url.origin === location.origin) {
          const clone = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return resp;
      });
    })
  );
});
