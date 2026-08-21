const fs = require('fs');
const path = require('path');

// 종족 공통 형질(귀·날개·뿔·꼬리 등)이 캐릭터 메인 로어북의 외형 줄에 실제로 적혀 있는지 검사한다.
// 형질은 인물 자료가 맡고 종족 문서는 그것을 일반적으로 서술한다는 분담을 지키기 위한 검사다.
// 근거 정본: docs/세계관/이종족_계통분류학.md 진단 형질, docs/세계관/종족별_생리와_생활.md
//
// 정본이 형질을 명시한 종족만 등록한다. 산양 수인·황소 수인처럼 계통분류학에 진단 형질이
// 없는 통칭 종족은 넣지 않는다. 그쪽의 빈 외형은 오류가 아니라 미정 영역이다.

// 2026-08-10에 대상이 바뀌었다. 캐릭터 프롬프트는 이름과 코드만 남기고 외형을 비롯한 인물
// 자료가 전부 캐릭터 메인 로어북(`프롬프트/로어북/캐릭터/캐릭터 - {이름}.txt`)으로 옮겨 갔다.
const root = path.resolve(process.argv[2] || '.');
const dataPath = path.join(root, 'characters.json');
const loreDir = path.join(root, '프롬프트', '로어북', '캐릭터');

// 값은 `필수 형질 목록`이며, 각 형질은 허용되는 표기의 배열이다. 하나만 맞으면 통과한다.
const traitsByFormalSpecies = {
  흡혈귀종: [['뾰족한 귀'], ['흡혈귀 날개', '박쥐 날개'], ['꼬리'], ['송곳니']],
  고양이수인종: [['고양이귀', '고양이 귀'], ['꼬리']],
  늑대수인종: [['늑대 귀', '늑대귀'], ['꼬리']],
  토끼수인종: [['토끼 귀', '토끼귀'], ['꼬리']],
  곰수인종: [['곰 귀', '곰귀'], ['꼬리']],
  흑표범수인아종: [['흑표범 귀', '표범 귀'], ['꼬리']],
  요호아종: [['여우 귀', '여우귀'], ['꼬리']],
  하피종: [['날개팔', '날개'], ['새 다리', '맹금류 다리']],
  라미아종: [['뱀 하반신', '뱀형 하체', '하반신']],
  백룡종: [['뿔'], ['꼬리']],
  화룡종: [['뿔'], ['꼬리']],
  오니종: [['뿔']],
  카라스텐구종: [['검은 날개', '깃털날개', '날개']],
  천사종: [['헤일로'], ['날개']],
  임프종: [['뿔'], ['꼬리']],
  몽마종: [['뿔'], ['날개'], ['꼬리']],
  // 설녀종·듀라한종·리치종·슬라임종은 부속 기관이 없다. 체온과 신체 특성만 종족 문서가 관리한다.
};

const traitsBySpecies = {
  엘프: [['엘프 귀', '뾰족한 귀']],
  '흰 쥐 수인': [['쥐 귀'], ['꼬리']],
};

// 외형은 `## 요약`의 `- 외모:`·`- 체형:` 줄에 있다. 절 이름이 아니라 그 줄들을 본다.
function appearanceSection(text) {
  return text.split('\n')
    .filter(line => /^-\s*(외모|체형|일상복장)\s*:/.test(line.trim()))
    .join('\n');
}

// 형질은 공백을 무시하고 맞춘다. 캐릭터 프롬프트가 값 안의 띄어쓰기를 지우는 양식이라
// `엘프 귀`가 `엘프귀`, `새 다리`가 `새다리`로 적히기 때문이다. 표기 목록에 압축형을
// 따로 등록하면 같은 형질이 두 벌로 늘어나므로 비교하는 쪽에서 공백을 지운다.
const compact = text => text.replace(/\s+/g, '');

function requiredTraits(character) {
  return traitsByFormalSpecies[character.formalSpecies] || traitsBySpecies[character.species] || null;
}

const characters = JSON.parse(fs.readFileSync(dataPath, 'utf8')).filter(character => character.spoilerOnly !== true);
const failures = [];
let checked = 0;

for (const character of characters) {
  const traits = requiredTraits(character);
  if (!traits || !traits.length) continue;

  const lorePath = path.join(loreDir, `캐릭터 - ${character.name}.txt`);
  if (!fs.existsSync(lorePath)) {
    failures.push(`${character.code} ${character.name}: 캐릭터 메인 로어북이 없다`);
    continue;
  }

  checked += 1;
  const appearance = compact(appearanceSection(fs.readFileSync(lorePath, 'utf8')));
  const missing = traits
    .filter(spellings => !spellings.some(spelling => appearance.includes(compact(spelling))))
    .map(spellings => spellings[0]);

  if (missing.length) {
    const species = character.formalSpecies || character.species;
    failures.push(`${character.code} ${character.name} (${species}): 외형에 ${missing.join(', ')} 없음`);
  }
}

if (failures.length) {
  console.error(`종족 형질이 캐릭터 메인 로어북에서 누락되었다 (${failures.length}/${checked}).`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log(`Species traits are recorded in every character lorebook (${checked} characters).`);
