// Static file serving from STATIC_DIR (the repo's html/ folder). Traversal-safe: the path is decoded once, checked segment by segment and
// must resolve inside the root; dotfiles are never served; only regular files; GET and HEAD only (the caller enforces the method).
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json', '.webmanifest': 'application/manifest+json', '.pbf': 'application/x-protobuf',
};

/** Resolve a request path to a file inside root, or null. Pure apart from the path arithmetic: unit-tested with traversal attempts. */
export function safeResolve(root: string, rawPath: string): string | null {
  if (rawPath.length > 1024 || !rawPath.startsWith('/') || rawPath.includes('\0') || rawPath.includes('\\')) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(rawPath); } catch { return null; }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const parts = decoded.split('/').filter((p) => p !== '');
  for (const p of parts) if (p === '.' || p === '..' || p.startsWith('.')) return null;      // no dot-segments, no dotfiles
  const full = path.resolve(root, ...parts);
  const rel = path.relative(root, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return full;
}

export function serveStatic(root: string, req: http.IncomingMessage, res: http.ServerResponse, pathname: string): boolean {
  let file = safeResolve(root, pathname);
  if (!file) return false;
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
    if (st.isDirectory()) { file = path.join(file, 'index.html'); st = fs.statSync(file); }
    if (!st.isFile()) return false;
    // resolve symlinks: the real path must still be inside the root
    const real = fs.realpathSync(file), rr = fs.realpathSync(root);
    if (path.relative(rr, real).startsWith('..')) return false;
  } catch { return false; }
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const ext = path.extname(file).toLowerCase();
  const headers: Record<string, string | number> = {
    'content-type': MIME[ext] || 'application/octet-stream', 'last-modified': st.mtime.toUTCString(), etag,
    'cache-control': ext === '.html' || ext === '.js' || ext === '.css' ? 'no-cache' : 'public, max-age=3600',
  };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return true; }
  headers['content-length'] = st.size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') { res.end(); return true; }
  const s = fs.createReadStream(file);
  s.on('error', () => res.destroy());
  s.pipe(res);
  return true;
}
