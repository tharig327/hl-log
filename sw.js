const CACHE = 'hl-applicator-v5';

const ASSETS = [
  './',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.44.0/tabler-icons.min.css'
];

// Install
self.addEventListener('install', e=>{
  e.waitUntil(
    caches.open(CACHE)
      .then(c=>c.addAll(ASSETS))
      .then(()=>self.skipWaiting())
  );
});

// Activate
self.addEventListener('activate', e=>{
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(k => k !== CACHE)
        .map(k => caches.delete(k))
      )
    ).then(()=>self.clients.claim())
  );
});

// Fetch
self.addEventListener('fetch', e=>{
  const url = new URL(e.request.url);

  if(url.hostname==='api.github.com'){
    e.respondWith(fetch(e.request).catch(()=>
      new Response('{"error":"offline"}',{headers:{'Content-Type':'application/json'}})
    ));
    return;
  }

  // HTML → ALWAYS NETWORK FIRST
  if(url.pathname.endsWith('.html') || url.pathname==='/' || url.pathname.endsWith('/')){
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

  // Everything else → cache first
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
