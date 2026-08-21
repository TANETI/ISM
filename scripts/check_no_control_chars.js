#!/usr/bin/env node
/* 소스에 제어문자가 박히는 것을 잡는다.
 *
 * 셸 heredoc으로 파일을 고칠 때 백슬래시가 한 겹 먹혀 `/[^\x00-\x7F]/`의
 * 이스케이프가 진짜 NUL·DEL 바이트로 들어간 일이 두 번 있었다. 정규식으로는
 * 같은 범위라 화면이 멀쩡히 나오고, git이 파일을 바이너리로 보아 diff가
 * 사라진 뒤에야 알아차렸다.
 *
 *   node scripts/check_no_control_chars.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXTS = new Set(['.js', '.mjs', '.cjs', '.json', '.md', '.txt', '.css', '.html', '.py', '.yml', '.toml']);
const SKIP = new Set(['.git', 'node_modules', '__pycache__', 'backups', 'characters', 'site', 'avatar_src', '.wrangler', 'dist', 'build']);

// 탭(9)·개행(10)·복귀(13)만 허용한다
const isBad = (b) => b < 9 || (b > 13 && b < 32) || b === 127;

const bad = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!EXTS.has(path.extname(entry.name))) continue;
    const buf = fs.readFileSync(full);
    const hits = [];
    for (let i = 0; i < buf.length; i++) {
      if (isBad(buf[i])) {
        hits.push({ offset: i, byte: buf[i] });
        if (hits.length >= 3) break;
      }
    }
    if (hits.length) bad.push({ file: path.relative(ROOT, full), hits });
  }
}

walk(ROOT);

if (bad.length) {
  for (const b of bad) {
    const where = b.hits.map(h => `0x${h.byte.toString(16).padStart(2, '0')}@${h.offset}`).join(', ');
    console.error(`${b.file}: 제어문자 ${where}`);
  }
  console.error('\n이스케이프가 진짜 제어문자로 들어갔을 수 있다. `\\x00` 같은 문자열로 되돌려라.');
  process.exit(1);
}

console.log('제어문자 없음');
