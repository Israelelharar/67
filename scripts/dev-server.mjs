// שרת פיתוח מקומי: מגיש את public/ ומריץ את ה-API עם שמירה לקבצים ב-.data/
// שימוש: MDS_CODES="STAFF:1111111111;A1:11111111" npm run dev
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';

process.env.MDS_FILE_STORE ||= path.resolve('.data');
const { default: api } = await import('../netlify/functions/api.mjs');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png' };
const port = Number(process.env.PORT || 8888);

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname === '/api') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const r = await api(new Request(url, { method: req.method, headers: req.headers, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined }));
    res.writeHead(r.status, Object.fromEntries(r.headers));
    return res.end(await r.text());
  }
  const file = path.join('public', url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log(`http://localhost:${port}`));
