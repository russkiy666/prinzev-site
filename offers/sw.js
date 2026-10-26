/* Финансовый каталог: офлайн-кэш. Страница — сначала сеть (свежие ставки), при плохой связи — из кэша; шрифты и логотипы — из кэша. */
const V='fc-82c59458ed';const ASSETS=["./", "fonts/unbounded.woff2?v=46455667", "fonts/manrope.woff2?v=a7b25b9d", "logos/adengi.webp?v=caeb168b", "logos/alfa.webp?v=16b1a897", "logos/beregny.webp?v=49ce97ae", "logos/bistrodengi.webp?v=dfa938ec", "logos/boostra.webp?v=d4ebc257", "logos/credit7.webp?v=75b4023c", "logos/denginadom.webp?v=24eeb67a", "logos/dengisrazu.webp?v=87f6e732", "logos/fin5.webp?v=6c027a00", "logos/finmoll.webp?v=264640d4", "logos/likezaim.webp?v=fb8d4445", "logos/maxcredit.webp?v=9aed8687", "logos/megadengi.webp?v=aa43eb61", "logos/moneyman.webp?v=305d4356", "logos/otp.webp?v=9e5f87c5", "logos/ozon.webp?v=3c45db30", "logos/prostoy.webp?v=7e3d13ae", "logos/psb.webp?v=487c8d65", "logos/rocketman.webp?v=4852e361", "logos/rublion.webp?v=3e01abe8", "logos/smartcash.webp?v=bb13591b", "logos/sovcom.webp?v=0c12f8b2", "logos/svoiludi.webp?v=bc427c0f", "logos/tbank.webp?v=05cd5f35", "logos/vtb.webp?v=496f1ce8", "logos/yandex.webp?v=d3ece832"];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('fc-')&&k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const r=e.request; if(r.method!=='GET')return; const u=new URL(r.url); if(u.origin!==location.origin)return;
  if(r.mode==='navigate'){
    e.respondWith(new Promise(res=>{let done=false;
      const t=setTimeout(()=>{caches.match('./').then(m=>{if(m&&!done){done=true;res(m)}})},2500);
      fetch(r).then(n=>{clearTimeout(t);if(n.ok){const cp=n.clone();caches.open(V).then(c=>c.put('./',cp))}if(!done){done=true;res(n)}})
        .catch(()=>caches.match('./').then(m=>{if(!done){done=true;res(m||Response.error())}}));
    }));return;
  }
  e.respondWith(caches.match(r).then(m=>m||fetch(r).then(n=>{if(n.ok){const cp=n.clone();caches.open(V).then(c=>c.put(r,cp))}return n})));
});
