import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { safeResolve } from '../src/static.js';
import { close, rawGet, startApp, tmpdir } from './helpers.js';

const ROOT = '/srv/site';
test('safeResolve accepts normal paths and rejects every traversal form', () => {
  assert.equal(safeResolve(ROOT, '/index.html'), path.join(ROOT, 'index.html'));
  assert.equal(safeResolve(ROOT, '/ui/a%20b.js'), path.join(ROOT, 'ui', 'a b.js'));
  for (const p of ['/../etc/passwd', '/a/../../etc/passwd', '/%2e%2e/etc/passwd', '/%2E%2E%2Fetc%2Fpasswd', '/..%2f..%2fetc/passwd', '/a%5c..%5cb', '/a\\..\\b', '/.env', '/ui/.git/config', '/a%00.js', '/%', '/%zz',
    'index.html', '', '/./x', '/a/./b', '/' + 'a'.repeat(2000)]) assert.equal(safeResolve(ROOT, p), null, JSON.stringify(p));
});

test('the static server serves the site, hides dotfiles, refuses traversal and symlinks out of the root', async () => {
  const root = tmpdir(), outside = tmpdir();
  fs.writeFileSync(path.join(root, 'index.html'), '<title>x</title>'); fs.writeFileSync(path.join(root, '.hidden'), 'no'); fs.mkdirSync(path.join(root, 'sub'));
  fs.writeFileSync(path.join(root, 'sub', 'index.html'), 'sub'); fs.writeFileSync(path.join(outside, 'secret.txt'), 'SECRET');
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));
  const app = await startApp({ STATIC_DIR: root });
  try {
    assert.equal((await rawGet(app.base, '/')).status, 200);
    assert.equal((await rawGet(app.base, '/sub/')).body, 'sub');
    for (const p of ['/.hidden', '/../' + path.basename(outside) + '/secret.txt', '/%2e%2e/' + path.basename(outside) + '/secret.txt', '/link.txt', '/sub/../../x']) {
      const r = await rawGet(app.base, p); assert.notEqual(r.status, 200, p); assert.ok(!r.body.includes('SECRET'), p);
    }
    const h = await rawGet(app.base, '/index.html');
    assert.equal(h.headers['x-content-type-options'], 'nosniff'); assert.equal(h.headers['referrer-policy'], 'strict-origin-when-cross-origin');
    assert.equal(h.headers['content-security-policy'], undefined, 'no CSP is sent: it could break the app');
    const head = await rawGet(app.base, '/index.html', 'HEAD'); assert.equal(head.status, 200); assert.equal(head.body, '');
  } finally { await close(app.server); }
});
