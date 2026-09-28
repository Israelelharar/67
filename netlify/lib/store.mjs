// גישה למסד הנתונים: Netlify Blobs בפרודקשן, קבצים מקומיים בפיתוח (MDS_FILE_STORE)
import { getStore } from '@netlify/blobs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function openStore() {
  if (process.env.MDS_FILE_STORE) return fileStore(process.env.MDS_FILE_STORE);
  return getStore({ name: 'mds', consistency: 'strong' });
}

// עדכון בטוח במקביל: קורא, משנה ושומר רק אם אף אחד לא כתב בינתיים
export async function update(store, key, empty, fn) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const cur = await store.getWithMetadata(key, { type: 'json' });
    const data = cur ? cur.data : structuredClone(empty);
    const result = await fn(data);
    const opts = cur ? { onlyIfMatch: cur.etag } : { onlyIfNew: true };
    const { modified } = await store.setJSON(key, data, opts);
    if (modified) return { data, result };
    await new Promise(r => setTimeout(r, 40 + Math.random() * 120));
  }
  throw new Error('השרת עמוס, נסו שוב');
}

export async function read(store, key, empty) {
  const v = await store.get(key, { type: 'json' });
  return v ?? structuredClone(empty);
}

function fileStore(dir) {
  const file = key => path.join(dir, encodeURIComponent(key) + '.json');
  const etagOf = s => crypto.createHash('md5').update(s).digest('hex');
  return {
    async get(key) {
      try { return JSON.parse(await fs.readFile(file(key), 'utf8')); } catch { return null; }
    },
    async getWithMetadata(key) {
      try {
        const s = await fs.readFile(file(key), 'utf8');
        return { data: JSON.parse(s), etag: etagOf(s), metadata: {} };
      } catch { return null; }
    },
    async setJSON(key, value, opts = {}) {
      await fs.mkdir(dir, { recursive: true });
      let cur = null;
      try { cur = await fs.readFile(file(key), 'utf8'); } catch {}
      if (opts.onlyIfNew && cur != null) return { modified: false };
      if (opts.onlyIfMatch && (cur == null || etagOf(cur) !== opts.onlyIfMatch)) return { modified: false };
      const s = JSON.stringify(value);
      await fs.writeFile(file(key), s);
      return { modified: true, etag: etagOf(s) };
    }
  };
}
