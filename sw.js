const CACHE = 'hl-applicator-v2';
const ASSETS = [
  './',
  './index.html',
  './qr.html',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.44.0/tabler-icons.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'
];

// Install — cache all assets
self.addEventListener('install', e=>{
  e.waitUntil(
    caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())
  );
});

// Activate — clear old caches
self.addEventListener('activate', e=>{
  e.waitUntil(
    caches.keys().then(keys=>
      Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))
    ).then(()=>self.clients.claim())
  );
});

// Fetch — network first for HTML/API, cache fallback for everything else
self.addEventListener('fetch', e=>{
  const url = new URL(e.request.url);

  // Always go to network for GitHub API (gist sync)
  if(url.hostname === 'api.github.com'){
    e.respondWith(fetch(e.request).catch(()=>new Response('{"error":"offline"}',{headers:{'Content-Type':'application/json'}})));
    return;
  }

  // Network first for index.html so updates come through
  if(url.pathname.endsWith('.html') || url.pathname === '/'){
    e.respondWith(
      fetch(e.request)
        .then(r=>{ const c=r.clone(); caches.open(CACHE).then(cache=>cache.put(e.request,c)); return r; })
        .catch(()=>caches.match(e.request))
    );
    return;
  }

  // Cache first for everything else (icons, fonts, CSS, JS)
  e.respondWith(
    caches.match(e.request).then(cached=>{
      if(cached) return cached;
      return fetch(e.request).then(r=>{
        const c=r.clone();
        caches.open(CACHE).then(cache=>cache.put(e.request,c));
        return r;
      });
    })
  );
});
