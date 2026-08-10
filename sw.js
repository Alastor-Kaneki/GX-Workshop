const C='gx-workshop-v10';
const CORE=[
  './','./index.html','./app.css?v=10','./enhancements.css?v=10','./mobile.css?v=10',
  './js/app.js?v=10','./js/archive-ui.js?v=10','./js/theme-assets.js?v=10','./js/bridge-ui.js?v=10',
  './js/db.js','./js/archive.js','./js/zip.js','./js/themes.js','./js/gx.js',
  './data/catalog.json','./manifest.webmanifest','./icons/icon.svg','./gx-workshop-bridge.user.js'
];
self.addEventListener('install',event=>event.waitUntil(
  caches.open(C).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting())
));
self.addEventListener('activate',event=>event.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==C).map(key=>caches.delete(key)))).then(()=>self.clients.claim())
));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==location.origin)return;
  event.respondWith(
    fetch(event.request).then(response=>{
      const copy=response.clone();
      caches.open(C).then(cache=>cache.put(event.request,copy));
      return response;
    }).catch(()=>caches.match(event.request))
  );
});
