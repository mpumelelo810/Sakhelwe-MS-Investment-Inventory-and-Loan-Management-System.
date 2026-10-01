from pathlib import Path
import re,base64,json,hashlib
root=Path(__file__).resolve().parents[1];dist=root/'dist'
html=(dist/'index.html').read_text();js=next((dist/'assets').glob('*.js')).read_text();css=next((dist/'assets').glob('*.css')).read_text();logo='data:image/webp;base64,'+base64.b64encode((root/'public/logo.webp').read_bytes()).decode()
icon='data:image/webp;base64,'+base64.b64encode((root/'public/icon-192.webp').read_bytes()).decode()
html=html.replace('/icon-192.webp',icon).replace('/icon-512.webp',icon)
js=js.replace('/logo.webp',logo).replace('</script','<\\/script')
html=re.sub(r'<script[^>]*src="[^"]+"[^>]*></script>','',html);html=re.sub(r'<link[^>]*href="[^"]+\.css"[^>]*>','',html)
html=re.sub(r'<link[^>]*rel="manifest"[^>]*>','',html)
html=html.replace('</head>','<style>'+css+'</style></head>').replace('</body>','<script type="module">'+js+'</script></body>');(dist/'Sakhelwe-Offline.html').write_text(html)
assets=['/','/index.html','/logo.webp','/manifest.webmanifest','/icon-192.webp','/icon-512.webp']+['/'+str(p.relative_to(dist)) for p in (dist/'assets').iterdir()]
version=hashlib.sha256(js.encode()).hexdigest()[:12]
(dist/'sw.js').write_text('const CACHE="sakhelwe-shell-'+version+'",FILES='+json.dumps(assets)+''';self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES))));self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('sakhelwe-shell-')&&k!==CACHE).map(k=>caches.delete(k))))));self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request).catch(()=>e.request.mode==='navigate'?caches.match('/index.html'):Response.error())))});''')
print(dist/'Sakhelwe-Offline.html')
