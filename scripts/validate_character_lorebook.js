const fs = require('fs');
const path = require('path');

// 캐릭터별 세부설정 로어북(`프롬프트/로어북/캐릭터/캐릭터 - {이름}[ · {절}].txt`)의 양식과 경계를 검사한다.
// 두 파일이 같은 문장을 갖기 시작하면 그 분담이 무너지므로 중복을 실패로 처리한다.
//
// 한 인물이 파일 여럿을 가질 수 있다. `캐릭터 - 김성훈.txt`가 중심 파일이고
// `캐릭터 - 김성훈 · 비밀.txt`처럼 ` · `로 절 이름을 붙인 것이 딸림 파일이다.
// 일반 상한은 4,500바이트, 과거사 상한은 1,800바이트다. 로어북은 글자 수가 아니라 파일 크기로 잘리기 때문이다.

const root = path.resolve(process.argv[2] || '.');
const dataPath = path.join(root, 'characters.json');
const loreDir = path.join(root, '프롬프트', '로어북', '캐릭터');
const promptDir = path.join(root, '프롬프트', '캐릭터 프롬프트');

const LORE_PREFIX = '캐릭터 - ';
const PAST_PREFIX = '과거사 - ';
const SPLIT = ' · ';
const MAX_BYTES = 4500;
const PAST_MAX_BYTES = 1800;
const DUPLICATE_MIN = 25;

// 1,800B 기준을 정하기 전에 이미 넘었던 과거사. 과거사 상한 검사만 면제하며 일반 4,500B 상한은 지킨다.
// 축약해 이내로 내려온 것은 목록에서 뺀다. 남겨 두면 다시 늘어나도 검사가 잡지 못한다.
const GRANDFATHERED_OVERSIZE_PAST = new Set([
  '라미 · 과거', '루나 · 공동 과거 (루나·로지)',
  '루디 · 공동 과거 (루디·루비)',
  '루이 바토리 · 공동 과거 (루이 바토리·스칼렛 바토리)',
  '머플 · 공동 과거 (머플·미피·타우로스)', '서은설 · 공동 과거 (서은설·서이든)',
  '아르브 드 알드헤임 · 공동 과거 (아르브·플뢰르·에르베스)',
  '아자키엘 · 과거', '엘리나리제 블러드로드 · 공동 과거 (엘리나리제·루이즈)',
  '유리 체페쉬 · 과거',
  '정 실바노 · 사리엘 과거사',
  '쿠로하네 미즈키 · 과거 묶음 (쿠로하네 미즈키·유스티나 설리번)',
  '클라라 · 과거', '피아 · 과거', '한서윤 · 과거',
]);

const characters = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const byName = new Map(characters.map(character => [character.name, character]));

const sentences = text => text
  .split(/\n|(?<=다\.)\s/)
  .map(line => line.replace(/^[-*>#\s]+/, '').trim())
  .filter(line => line.length >= DUPLICATE_MIN);

const failures = [];
const oversize = [];
const files = fs.readdirSync(loreDir).filter(file => file.startsWith(LORE_PREFIX) && file.endsWith('.txt'));
const seenSections = new Map();
// 한 번이라도 나눈 인물의 이름. 그 인물은 중심 파일도 상한을 지켜야 한다.
const splitOwners = new Set(files.filter(file => file.includes(SPLIT))
  .map(file => file.slice(LORE_PREFIX.length).split(SPLIT)[0]));

for (const file of files) {
  const stem = file.slice(LORE_PREFIX.length, -'.txt'.length);
  const [name, section] = stem.includes(SPLIT) ? stem.split(SPLIT) : [stem, ''];
  const report = message => failures.push(`${file}: ${message}`);
  const character = byName.get(name);

  if (!character) {
    report(`characters.json에 없는 이름이다`);
    continue;
  }

  const text = fs.readFileSync(path.join(loreDir, file), 'utf8');
  const lines = text.split(/\r?\n/);
  const bytes = Buffer.byteLength(text, 'utf8');
  const isPast = section.includes('과거');

  const expectedHeading = section
    ? `# 캐릭터: ${name} (${character.code}) — ${section}`
    : `# 캐릭터: ${name} (${character.code})`;
  if (lines[0] !== expectedHeading) report(`첫 줄은 \`${expectedHeading}\`여야 한다`);
  // 이행 중이다. 아직 나누지 않은 인물은 정보로만 알리고, 한 번이라도 나눈 인물은 상한을 지킨다.
  if (bytes > MAX_BYTES) {
    if (section || splitOwners.has(name)) report(`${bytes}B로 상한 ${MAX_BYTES}B를 넘는다`);
    else oversize.push(`${file} (${bytes}B)`);
  }
  if (isPast && !GRANDFATHERED_OVERSIZE_PAST.has(stem) && bytes > PAST_MAX_BYTES) {
    report(`${bytes}B로 과거사 상한 ${PAST_MAX_BYTES}B를 넘는다`);
  }
  // 중심 파일만 요약을 갖는다. 딸림 파일에 또 두면 같은 말이 두 번 들어온다.
  if (!section && !/^## 요약\s*$/m.test(text)) report('`## 요약` 절이 없다');
  if (section && /^## 요약\s*$/m.test(text)) report('딸림 파일에는 `## 요약`을 두지 않는다');
  if (section && /^> 호출어:/m.test(text)) report('호출어는 프롬뷰어가 계산한다. 로어북에 적지 않는다');

  // 같은 절 이름을 두 번 쓰면 어느 파일을 열어야 할지 알 수 없다.
  const key = `${name}${SPLIT}${section}`;
  if (section && seenSections.has(key)) report(`절 이름이 겹친다 — ${seenSections.get(key)}`);
  if (section) seenSections.set(key, file);

  if (fs.existsSync(path.join(loreDir, `${PAST_PREFIX}${name}.txt`))) {
    report(`\`${PAST_PREFIX}${name}.txt\`가 남아 있다. 이행했으면 지운다`);
  }

  const promptPath = path.join(promptDir, `${name}.txt`);
  if (!fs.existsSync(promptPath)) {
    if (character.spoilerOnly !== true) report('캐릭터 프롬프트가 없다');
    continue;
  }

  const promptSentences = new Set(sentences(fs.readFileSync(promptPath, 'utf8')));
  const duplicated = sentences(text).filter(line => promptSentences.has(line));
  for (const line of duplicated) report(`캐릭터 프롬프트와 같은 문장이 있다 — ${line.slice(0, 40)}…`);
}

// 딸림 파일만 있고 중심 파일이 없으면 그 인물은 요약을 잃는다.
const cores = new Set(files.filter(file => !file.includes(SPLIT)));
for (const file of files) {
  if (!file.includes(SPLIT)) continue;
  const name = file.slice(LORE_PREFIX.length).split(SPLIT)[0];
  if (!cores.has(`${LORE_PREFIX}${name}.txt`)) failures.push(`${file}: 중심 파일 \`${LORE_PREFIX}${name}.txt\`이 없다`);
}

if (failures.length) {
  console.error(`캐릭터 로어북 검사 실패 (${failures.length}건).`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

const pending = characters.filter(character => character.spoilerOnly !== true && !cores.has(`${LORE_PREFIX}${character.name}.txt`)).length;
const extra = files.length - cores.size;
if (oversize.length) {
  console.log(`아직 4500B로 나누지 않은 인물 ${oversize.length}명: ${oversize.slice(0, 3).join(', ')}${oversize.length > 3 ? ' 외' : ''}`);
}
console.log(`Character lorebooks are well-formed (${cores.size} characters, ${extra} split files, ${pending} not migrated yet).`);
