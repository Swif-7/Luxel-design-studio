import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('./', import.meta.url);
const allowed = new Set(['index.html', 'rheo.html', 'rubric.html', 'recast.html', 'relief.html', 'rise.html', 'tokens.css', 'style.css', 'home.css', 'rubric.css', 'recast.css', 'relief.css', 'rise.css',
  'src/media.js', 'src/export.js', 'src/rubric.js', 'src/spec.js', 'src/recast.js', 'src/relief.js', 'src/relief-core.js', 'src/relief-render.js', 'src/rise.js', 'src/rise-data.js', 'src/rise-core.js', 'src/rise-draw.js', 'src/rise-render.js', 'src/recast-core.js', 'src/recast-encode.js', 'src/recast-worker.js', 'src/recast-inspect.js', 'LICENSE', 'src/app.js', 'src/home.js', 'src/model.js', 'src/color.js', 'src/shader.js', 'src/glyphs.js',
  'favicon.svg', 'png/rheo-card.png',
  'fonts/IBMPlexSans-Regular.woff2', 'fonts/IBMPlexSans-SemiBold.woff2', 'fonts/IBMPlexMono-Regular.woff2',
  'tests/media.html', 'tests/render.html']);
const types = { html: 'text/html', css: 'text/css', js: 'text/javascript', svg: 'image/svg+xml', png: 'image/png', woff2: 'font/woff2' };
http.createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    if (!allowed.has(path)) { res.writeHead(404); res.end('Not found'); return; }
    const data = await readFile(fileURLToPath(new URL(path, root)));
    const ext = path.split('.').pop(), type = types[ext] || 'text/plain';
    const binary = ext === 'png' || ext === 'woff2';
    res.writeHead(200, {'Content-Type': binary ? type : `${type}; charset=utf-8`, 'Cache-Control': 'no-store'}); res.end(data);
  } catch { res.writeHead(500); res.end('Unable to read asset'); }
}).listen(Number(process.env.PORT) || 4173, '127.0.0.1', () => console.log('Luxel → http://localhost:' + (process.env.PORT || 4173)));
