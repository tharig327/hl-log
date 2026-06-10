const CACHE = 'hl-applicator-v4';
const ASSETS = [
  './',
  './index.html',
  './qr.html',
  './ticket.html',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.44.0/tabler-icons.min.css'
];

// Install — cache assets
self.addEventListener('install', e=>{
  e.waitUntil(
    caches.open(CACHE)
      .then(c=>c.addAll(ASSETS))
      .then(()=>self.skipWaiting())
  );
});

// Activate — delete ALL old caches immediately
self.addEventListener('activate', e=>{
  e.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

// Fetch strategy:
// - HTML files: network first, fall back to cache (so updates come through)
// - Everything else: cache first, fall back to network
self.addEventListener('fetch', e=>{
  const url = new URL(e.request.url);

  // Never cache GitHub API calls
  if(url.hostname==='api.github.com'){
    e.respondWith(fetch(e.request).catch(()=>new Response('{"error":"offline"}',{headers:{'Content-Type':'application/json'}})));
    return;
  }

  // HTML pages — network first so you always get the latest
  if(url.pathname.endsWith('.html')||url.pathname.endsWith('/')||url.pathname==='/'){
    e.respondWith(
      fetch(e.request)
        .then(r=>{
          const clone=r.clone();
          caches.open(CACHE).then(c=>c.put(e.request,clone));
          return r;
        })
        .catch(()=>caches.match(e.request))
    );
    return;
  }

  // CSS/fonts/icons — cache first
  e.respondWith(
    caches.match(e.request).then(cached=>{
      if(cached) return cached;
      return fetch(e.request).then(r=>{
        const clone=r.clone();
        caches.open(CACHE).then(c=>c.put(e.request,clone));
        return r;
      });
    })
  );
});
