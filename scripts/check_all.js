const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

// 검사 한 벌을 한 곳에 모은다. 예전에는 CLAUDE.md의 안내와 CI의 목록이 따로 적혀 있어
// 새 검사를 넣을 때 한쪽만 고치는 일이 반복됐다(`validate_single_scroll.js`가 그렇게 CI에서 빠져 있었다).
// 이제 사람도 CI도 이 파일 하나를 부른다.
//
//   node scripts/check_all.js              모든 검사
//   node scripts/check_all.js --runtime-scripts   브라우저 런타임 모듈 목록만 출력

const root = path.resolve(__dirname, '..');

// 배포에 실어야 하는 런타임 모듈은 app.js의 import를 따라가 구한다. 손으로 적은 목록을 두면
// 모듈을 추가할 때 구문 검사·복사·산출물 확인 세 곳 중 하나가 빠져 CSS 링크가 치환되지 않은 채
// 배포되거나 파일이 누락된다. 진짜 근거는 import 문 자체다.
const runtimeScripts = () => {
  const found = [];
  const queue = ['app.js'];
  const seen = new Set(queue);
  while (queue.length) {
    const file = queue.shift();
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const [, target] of source.matchAll(/from\s+'\.\/(scripts\/[^'?]+\.js)[^']*'/g)) {
      if (seen.has(target)) continue;
      seen.add(target);
      found.push(target);
      queue.push(target);
    }
  }
  return found;
};

// 브라우저에서만 도는 파일들의 구문 검사. 한 줄로 묶어 둔다 — 예전에는 파일마다
// 항목이 하나씩 늘어 통과 문구가 열 줄을 넘었고, 목록에서 정작 무엇을 검사하는지가 묻혔다.
const syntaxTargets = () => ['app.js', 'easter.js', ...runtimeScripts()];

const checks = () => {
  const list = [
    // 아래에서 실제로 돌리는 스크립트는 구문이 깨지면 그 자리에서 터진다. 브라우저에서만
    // 도는 파일은 페이지가 뜨기도 전에 죽어 원인을 짚기 어려우므로 여기서 먼저 잡는다.
    ['syntax', syntaxTargets()],
    ['node', ['scripts/check_css_ownership.js']],
    // 작품 제목이 문서 제목·인트로 제목·구간별 제목 세 곳에서 어긋나는 것을 잡는다.
    ['node', ['scripts/validate_single_scroll.js', '.']],
    ['node', ['scripts/validate_characters.js', '.']],
    // 셸로 파일을 고치다 `\x00` 같은 이스케이프가 진짜 제어문자로 박힌 일이 두 번 있었다.
    // 동작은 같아 보이지만 git이 파일을 바이너리로 보아 diff가 사라진다.
    ['node', ['scripts/check_no_control_chars.js']],
  ];
  return list;
};

if (process.argv.includes('--runtime-scripts')) {
  console.log(runtimeScripts().join(' '));
  process.exit(0);
}

const shell = process.platform === 'win32';
const verbose = process.argv.includes('--verbose');

// 파일 여러 개를 한 항목으로 검사한다. 실패한 파일만 본문에 남긴다.
//
// **`node --check`는 `.js` 확장자의 ESM 구문 오류를 잡지 못한다.** 첫 `import`를 만나면
// 그 뒤 오류를 그냥 넘기고 0으로 끝낸다(Node 24에서 확인). 이 저장소의 브라우저 모듈은
// 전부 ESM이라 검사 열 개가 오랫동안 아무것도 하지 않고 있었다.
// `.mjs`로 복사해서 검사하면 ESM으로 파싱해 제대로 잡는다.
const runSyntax = (files) => {
  const broken = [];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ism-syntax-'));
  try {
    for (const file of files) {
      const probe = path.join(tmpDir, path.basename(file).replace(/\.js$/, '') + '.mjs');
      fs.copyFileSync(path.join(root, file), probe);
      const run = spawnSync('node', ['--check', probe], { cwd: root, encoding: 'utf8', shell });
      if (run.status !== 0) {
        const detail = `${run.stdout || ''}${run.stderr || ''}`.trim().split(probe).join(file);
        broken.push(`${file}\n${detail}`);
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  return { status: broken.length ? 1 : 0, output: broken.join('\n\n') };
};

const failures = [];
const started = Date.now();
let passed = 0;

for (const [command, args] of checks()) {
  if (command === 'syntax') {
    const label = `구문 검사 (${args.length}개 파일)`;
    const result = runSyntax(args);
    if (result.status === 0) {
      passed++;
      if (verbose) console.log(`  ok   ${label}`);
      continue;
    }
    failures.push({ label, output: result.output });
    continue;
  }

  const label = `${command} ${args.join(' ')}`;
  const run = spawnSync(command, args, { cwd: root, encoding: 'utf8', shell });
  const output = `${run.stdout || ''}${run.stderr || ''}`.trim();
  if (run.status === 0) {
    passed++;
    if (verbose) console.log(`  ok   ${label}`);
    continue;
  }
  failures.push({ label, output: output || `종료 코드 ${run.status}` });
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);

// 통과한 것은 세기만 한다. 항목마다 한 줄씩 찍으면 매번 스무 줄이 넘어가고,
// 정작 봐야 하는 실패가 그 사이에 묻힌다. 목록이 필요하면 `--verbose`.
if (!failures.length) {
  console.log(`검사 ${passed}종 통과 (${seconds}s)`);
  process.exit(0);
}

console.error(`검사 ${failures.length}건 실패 · ${passed}종 통과 (${seconds}s)`);
for (const failure of failures) {
  console.error(`\n=== ${failure.label}\n${failure.output}`);
}
process.exit(1);
