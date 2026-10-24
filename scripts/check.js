// Safety check before every commit: `npm run check`. Needs no database.
// 1. every .js file parses
// 2. browser scripts load together without clashing names (they share one global scope)
// 3. API routes and their guards match scripts/routes.snapshot.txt
// 4. the server boots and serves health, the page, and its assets
// After an intended route or guard change: `npm run check -- --update`, then commit the snapshot.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = path.join(ROOT, 'scripts', 'routes.snapshot.txt');
const update = process.argv.includes('--update');
let failed = 0;

function ok(label) { console.log(`ok   ${label}`); }
function bad(label, detail = '') { failed += 1; console.log(`FAIL ${label}${detail ? `\n${detail}` : ''}`); }

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : jsFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

// 1. syntax
const files = [path.join(ROOT, 'server.js'), ...jsFiles(path.join(ROOT, 'server')), ...jsFiles(path.join(ROOT, 'public')), ...jsFiles(path.join(ROOT, 'scripts'))];
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    bad(`syntax ${path.relative(ROOT, file)}`, String(err.stderr || err.message));
  }
}
if (!failed) ok(`syntax (${files.length} files)`);

// 2. browser scripts, in index.html order
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="\/([^"]+)"><\/script>/g)].map((m) => m[1]);
const assets = [...scripts, ...[...html.matchAll(/<link rel="stylesheet" href="\/([^"]+)"/g)].map((m) => m[1])];
const missing = assets.filter((asset) => !fs.existsSync(path.join(ROOT, 'public', asset)));
if (missing.length) bad('index.html assets exist', missing.join('\n'));
else ok(`index.html assets exist (${assets.length})`);
const sources = scripts.filter((s) => s.endsWith('.js')).map((s) => fs.readFileSync(path.join(ROOT, 'public', s), 'utf8'));
try {
  new vm.Script(sources.join('\n;\n'), { filename: 'browser-bundle.js' });
  const names = new Map();
  sources.forEach((src, i) => {
    for (const m of src.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) {
      if (names.has(m[1])) throw new Error(`function ${m[1]} declared in ${names.get(m[1])} and ${scripts[i]}`);
      names.set(m[1], scripts[i]);
    }
  });
  ok('browser scripts share one scope without clashes');
} catch (err) {
  bad('browser scripts share one scope without clashes', err.message);
}

// 3. routes and guards
const { createApp } = await import('../server/app.js');
const app = createApp();
const routes = app._router.stack
  .filter((layer) => layer.route && layer.route.path !== '*')
  .flatMap((layer) => Object.keys(layer.route.methods).map((method) => {
    const needs = layer.route.stack.map((s) => s.handle.need).filter(Boolean);
    return [method.toUpperCase(), layer.route.path, ...needs].join(' ');
  }))
  .sort();
const current = `${routes.join('\n')}\n`;
if (update) {
  fs.writeFileSync(SNAPSHOT, current);
  ok(`routes snapshot updated (${routes.length})`);
} else {
  const expected = fs.readFileSync(SNAPSHOT, 'utf8').replace(/\r/g, '');
  if (expected === current) ok(`routes and guards match snapshot (${routes.length})`);
  else {
    const want = new Set(expected.trim().split('\n'));
    const have = new Set(routes);
    const diff = [...want].filter((r) => !have.has(r)).map((r) => `  - ${r}`)
      .concat([...have].filter((r) => !want.has(r)).map((r) => `  + ${r}`));
    bad('routes and guards match snapshot (if intended: npm run check -- --update)', diff.join('\n'));
  }
}

// 4. boot
const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
async function expect(label, url, test) {
  try {
    const res = await fetch(base + url);
    const body = await res.text();
    if (test(res, body)) ok(label);
    else bad(label, `  got ${res.status}: ${body.slice(0, 120)}`);
  } catch (err) {
    bad(label, err.message);
  }
}
await expect('GET /api/health', '/api/health', (res, body) => res.status === 200 && JSON.parse(body).ok === true);
await expect('GET / serves the page', '/', (res, body) => res.status === 200 && body.includes('id="app-view"'));
await expect('GET /api/me refuses without session', '/api/me', (res) => [401, 503].includes(res.status));
await expect('GET /api/unknown is 404 json', '/api/unknown', (res, body) => res.status === 404 && body.includes('error'));
for (const asset of assets) await expect(`GET /${asset}`, `/${asset}`, (res) => res.status === 200);
server.close();

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
