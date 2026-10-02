/* 순장반 얼굴인식 출석 — 오프라인 대응 서비스 워커.
 *
 * 원형: FED-Shell(github.com/git-fed/Build-Web-and-Mobile-Apps)의 sw.js
 *        (오프라인 우선 PWA 셸 전략)를 출석 앱에 맞게 다듬은 것.
 *
 * 전략:
 *   - 앱 셸(index, manifest, 아이콘, offline 페이지): 설치 시 선캐시, cache-first.
 *   - face-api.js 라이브러리 + 모델 파일(CDN, 버전 고정 URL): cache-first.
 *     교회 와이파이가 불안정해도 첫 로드 이후에는 오프라인으로 동작.
 *   - 그 외 same-origin GET: stale-while-revalidate.
 *   - 내비게이션: network-first → 캐시 → offline.html.
 *
 * APP_VERSION은 index.html의 APP_V와 함께 올릴 것. 버전을 바꾸면
 * activate 단계에서 이전 캐시가 자동 정리됨.
 */

const APP_VERSION = '2026-10-01-6';
const SHELL_CACHE = `attendance-shell-${APP_VERSION}`;
const RUNTIME_CACHE = `attendance-runtime-${APP_VERSION}`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './offline.html',
  './icons/icon.svg',
  './icons/icon-maskable.svg',
];
const SHELL_ASSET_PATHS = new Set(
  SHELL_ASSETS.map((asset) => new URL(asset, self.registration.scope).pathname),
);

// 버전이 고정된 CDN 자산 (불변 → cache-first가 안전)
const CDN_PREFIXES = [
  'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/',
  'https://unpkg.com/face-api.js@0.22.2/',
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model/',
  'https://justadudewhohacks.github.io/face-api.js/models/',
];
const isCdnAsset = (url) => CDN_PREFIXES.some((prefix) => url.startsWith(prefix));

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('attendance-') && k !== SHELL_CACHE && k !== RUNTIME_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 내비게이션 → network-first, 실패 시 캐시, 최후 offline.html
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          event.waitUntil(
            caches
              .open(RUNTIME_CACHE)
              .then((cache) => cache.put(request, response.clone()))
              .catch(() => {}),
          );
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || (await caches.match('./offline.html'));
        }),
    );
    return;
  }

  // 셸 자산 → cache-first
  if (url.origin === self.location.origin && SHELL_ASSET_PATHS.has(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
    return;
  }

  // CDN 라이브러리/모델 → cache-first (버전 고정 URL이라 안전)
  if (isCdnAsset(request.url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            // 불투명 응답(opaque)은 캐시하지 않음
            if (response && response.status === 200 && response.type !== 'opaque') {
              event.waitUntil(
                caches
                  .open(RUNTIME_CACHE)
                  .then((cache) => cache.put(request, response.clone()))
                  .catch(() => {}),
              );
            }
            return response;
          }),
      ),
    );
    return;
  }

  // 그 외 same-origin → stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request)
          .then((response) => {
            event.waitUntil(
              caches
                .open(RUNTIME_CACHE)
                .then((cache) => cache.put(request, response.clone()))
                .catch(() => {}),
            );
            return response;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      }),
    );
  }
  // 나머지 cross-origin은 그대로 통과 (SW가 가로채지 않음)
});

// 페이지에서 navigator.serviceWorker.controller.postMessage('skipWaiting')로 즉시 업데이트 가능
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
