/**
 * sw.js — 오프라인 동작
 *
 * 지하나 비행기 모드에서도 떠야 한다. 앱 파일은 설치할 때 통째로 캐시해 둔다.
 *
 * 앱 파일(HTML·CSS·JS)은 네트워크를 먼저 본다. 캐시를 먼저 주면 앱을 고쳐도 사용자가
 * 한 번은 낡은 화면을 보게 되는데, 그 사이에 계산 규칙이 바뀌었다면 금액이 달라진다.
 * 파일이 다 합쳐 수십 KB라 왕복 비용보다 최신인 게 낫고, 네트워크가 없으면 즉시 캐시로 떨어진다.
 * 글꼴은 반대로 캐시를 먼저 본다 — 바뀌지 않고, 늦게 오면 글자가 늦게 뜬다.
 */
const VERSION = "pandon-settle-v1";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.json",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-180.png",
  "./icon-maskable.png",
  "./src/ui.js",
  "./src/store.js",
  "./src/rules.js",
  "./src/settle.js",
  "./src/chart.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION)
      // 한 파일이 실패해도 나머지는 캐시되게 개별로 넣는다
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === location.origin;
  // 글꼴은 다른 출처라 응답이 opaque 다. 그래도 캐시해 두면 오프라인에서 글꼴이 산다.
  const isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (!sameOrigin && !isFont) return;

  const keep = (res) => {
    if (res.ok || res.type === "opaque") {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(request, copy));
    }
    return res;
  };

  if (isFont) {
    e.respondWith(caches.match(request).then((hit) => hit ?? fetch(request).then(keep)));
    return;
  }

  e.respondWith(
    fetch(request)
      .then(keep)
      // 오프라인. 캐시에 없는 주소면 앱 껍데기를 준다 (화면 전환이 페이지 안에서 일어난다)
      .catch(() => caches.match(request).then((hit) => hit ?? caches.match("./index.html")))
  );
});
