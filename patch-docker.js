#!/usr/bin/env node
// Run from project root (/aero_post): node patch-docker.js
const fs = require('fs');
const FILE = 'server.js';
if (!fs.existsSync(FILE)) { console.error(`ERROR: ${FILE} not found. Run from the project root.`); process.exit(1); }
let src = fs.readFileSync(FILE, 'utf8');
const changes = [
  { name: 'HOST from env + ALLOWED_HOSTS',
    find: "const HOST = '127.0.0.1';",
    done: "process.env.HOST",
    replace: "const HOST = process.env.HOST || '127.0.0.1';\nconst ALLOWED = new Set((process.env.ALLOWED_HOSTS || 'localhost,127.0.0.1').split(',').map(s => s.trim()).filter(Boolean));" },
  { name: 'DATA_DIR from env',
    find: "path.join(__dirname, 'data.json')",
    done: "process.env.DATA_DIR",
    replace: "path.join(process.env.DATA_DIR || __dirname, 'data.json')" },
  { name: 'Host header check uses ALLOWED',
    find: "if (!/^(localhost|127\\.0\\.0\\.1)(:\\d+)?$/.test(req.headers.host || '')) {",
    done: "ALLOWED.has(",
    replace: "if (!ALLOWED.has((req.headers.host || '').replace(/:\\d+$/, ''))) {" },
];
let n = 0;
for (const c of changes) {
  if (src.includes(c.replace)) { console.log(`skip (already applied): ${c.name}`); continue; }
  if (!src.includes(c.find)) { console.error(`ERROR: target not found for "${c.name}". Nothing written.`); process.exit(1); }
  src = src.replace(c.find, () => c.replace); n++; console.log(`patched: ${c.name}`);
}
if (n) { fs.writeFileSync(FILE, src); console.log(`Done: ${n} change(s) written to ${FILE}`); } else console.log('Nothing to do.');
