/**
 * 离线壳（D-0195）。只缓存三样东西：应用壳、构建产物、看过的图片。
 * 同步接口永远走网络 —— 缓存一份旧数据比报错更糟。
 */
const V = 'sn-web-v4'
/** 和 `src/platform/web/db.ts` 的 VERSION 保持一致 —— SW 可能先开库。 */
const DB_VERSION = 2
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/fonts/fonts.css',
]

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const c = await caches.open(V)
      for (const u of SHELL) await c.add(u).catch(() => {})
      // 光缓存 index.html 不够：它引的那几个 hash 资源也得进去，否则断网第一次重载是白屏。
      try {
        const res = await fetch('/index.html', { cache: 'no-store' })
        const html = await res.clone().text()
        await c.put('/index.html', res)
        const urls = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1])
        await Promise.all(urls.map((u) => c.add(u).catch(() => {})))
      } catch {
        /* 离线安装 / 首装失败：运行时缓存会补 */
      }
      // 懒加载的插件 / 编辑器 chunk 不在 index.html 里，靠构建产物清单补齐离线包。
      try {
        const res = await fetch('/asset-list.json', { cache: 'no-store' })
        const list = res.ok ? await res.json() : null
        if (Array.isArray(list)) {
          const c = await caches.open(V)
          for (let i = 0; i < list.length; i += 6) {
            await Promise.all(list.slice(i, i + 6).map((u) => c.add(u).catch(() => {})))
          }
        }
      } catch {
        /* 没有清单（旧构建）也不影响壳 */
      }
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== V).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

/** 手机本地库（`src/platform/web/db.ts` 的同一个库）—— 只读 blobs 一张表。 */
function readBlob(id) {
  return new Promise((resolve) => {
    const req = indexedDB.open('self-notion-web', DB_VERSION)
    req.onerror = () => resolve(null)
    // ★ 必须和 `src/platform/web/db.ts` 建一样的表：Service Worker 可能比页面先打开库，
    //   只建一个空库会让页面那边看到「版本已经是最新」而跳过 onupgradeneeded，整库失效。
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('contents'))
        db.createObjectStore('contents', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' })
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('syncsrc'))
        db.createObjectStore('syncsrc', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('tombstones'))
        db.createObjectStore('tombstones', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('comments'))
        db.createObjectStore('comments', { keyPath: 'id' })
    }
    req.onsuccess = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('blobs')) {
        db.close()
        resolve(null)
        return
      }
      const get = db.transaction('blobs', 'readonly').objectStore('blobs').get(id)
      get.onerror = () => {
        db.close()
        resolve(null)
      }
      get.onsuccess = () => {
        const row = get.result
        db.close()
        if (!row) resolve(null)
        else
          resolve(
            new Response(row.bytes, {
              headers: {
                'content-type': row.mime || 'application/octet-stream',
                'cache-control': 'public, max-age=31536000, immutable',
              },
            }),
          )
      }
    }
  })
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return

  if (
    url.pathname.startsWith('/sync/') ||
    url.pathname.startsWith('/pair') ||
    url.pathname.startsWith('/log/') ||
    url.pathname.startsWith('/bug') ||
    url.pathname.startsWith('/health')
  ) {
    return
  }

  // 图片 / 附件：先看手机本地库（自己粘的图还没推上去时也能显示），再看缓存，最后才联网。
  if (url.pathname.startsWith('/blob/')) {
    e.respondWith(
      (async () => {
        const id = url.pathname.slice('/blob/'.length)
        let local = null
        try {
          local = await readBlob(id)
        } catch {
          local = null
        }
        if (local) return local
        const c = await caches.open(V)
        const hit = await c.match(req)
        if (hit) return hit
        const res = await fetch(req)
        if (res.ok) c.put(req, res.clone())
        return res
      })(),
    )
    return
  }

  // 页面导航：网络优先，失败回壳。
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(V).then((c) => c.put('/index.html', copy))
          return res
        })
        .catch(() => caches.match('/index.html').then((hit) => hit ?? caches.match('/'))),
    )
    return
  }

  // 静态资源：缓存优先（文件名带 hash，内容不会变）。
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) caches.open(V).then((c) => c.put(req, res.clone()))
          return res
        }),
    ),
  )
})
