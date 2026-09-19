import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('./', import.meta.url);
const allowed = new Set(['index.html', 'style.css', 'src/app.js', 'src/model.js', 'src/color.js', 'src/shader.js', 'src/glyphs.js', 'favicon.svg', 'tests/render.html']);
const types = { html: 'text/html', css: 'text/css', js: 'text/javascript', svg: 'image/svg+xml' };
http.createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    if (!allowed.has(path)) { res.writeHead(404); res.end('Not found'); return; }
    const data = await readFile(fileURLToPath(new URL(path, root)));
    res.writeHead(200, {'Content-Type': `${types[path.split('.').pop()]}; charset=utf-8`, 'Cache-Control': 'no-store'}); res.end(data);
  } catch { res.writeHead(500); res.end('Unable to read asset'); }
}).listen(Number(process.env.PORT) || 4173, '127.0.0.1', () => console.log('Flux Studio → http://localhost:' + (process.env.PORT || 4173)));
