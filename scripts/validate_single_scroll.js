const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || '.');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const navigation = fs.readFileSync(path.join(root, 'scripts/navigation.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

// 갤러리는 gallery.html로 나갔고 입구는 명부 안에 있다. 구간은 다섯이다.
const expected = ['main', 'factions', 'world', 'schedule', 'characters'];
const sectionIds = [...html.matchAll(/<section\b[^>]*class="[^"]*\bsection\b[^"]*"[^>]*id="section-([^"]+)"/g)]
  .map(match => match[1]);
const indexIds = [...html.matchAll(/data-section-index="([^"]+)"/g)].map(match => match[1]);
const failures = [];

const worldTabTargets = [...html.matchAll(/data-world-panel-target="([^"]+)"/g)].map(match => match[1]);
const worldPanelIds = [...html.matchAll(/<section[^>]*class="[^"]*world-panel[^"]*"[^>]*id="([^"]+)"/g)].map(match => match[1]);
const collapsedRosterGroups = [...html.matchAll(/<section[^>]*class="[^"]*roster-group[^"]*is-collapsed[^"]*"[^>]*data-roster-group="([^"]+)"/g)].map(match => match[1]);

const epilogueIndex = html.indexOf('id="world-you"');
const charactersEndIndex = html.indexOf('</section>', html.indexOf('id="section-characters"'));
if (epilogueIndex === -1 || charactersEndIndex === -1 || epilogueIndex <= charactersEndIndex) {
  failures.push('final invitation is not after the Characters section');
}
if (!/id="world-you"[^>]*aria-labelledby="world-you-heading"/.test(html)) {
  failures.push('final invitation landmark or heading relationship is missing');
}
if (!html.includes('ISM 최초의 인간 교수가 되는 것도, ISM 아카데미생이 되는 것도,') ||
    !html.includes('혹은 또 다른 누군가가 되어 이 세상에 뛰어드는 것도, 당신의 자유!') ||
    !html.includes('ISM의 문은 열려 있습니다')) {
  failures.push('final invitation wording does not match the requested copy');
}

if (JSON.stringify(sectionIds) !== JSON.stringify(expected)) {
  failures.push(`top-level section order mismatch: ${JSON.stringify(sectionIds)}`);
}
if (JSON.stringify(indexIds) !== JSON.stringify(expected)) {
  failures.push(`scroll-index order mismatch: ${JSON.stringify(indexIds)}`);
}

if (worldTabTargets.length !== 8 || JSON.stringify(worldTabTargets) !== JSON.stringify(worldPanelIds)) {
  failures.push(`World & Lore tab/panel mismatch: tabs=${JSON.stringify(worldTabTargets)} panels=${JSON.stringify(worldPanelIds)}`);
}
// 세계관은 한 번에 한 장만 편다. 이어 읽는 본문으로 두었더니 구간 하나가
// 8000px가 되어 어디가 어디인지 알 수 없었다. 한 장만 보이는 구성의 올바른
// 의미론은 목차가 아니라 탭이므로 tablist/tab/tabpanel을 요구한다.
// 패널마다 자기 탭을 aria-labelledby로 가리켜야 보조기술이 이름을 읽는다.
const tabRoleCount = (html.match(/role="tab"/g) || []).length;
const tabPanelCount = (html.match(/role="tabpanel"/g) || []).length;
const labelledPanels = worldPanelIds.filter(id =>
  new RegExp(`id="${id}"[^>]*aria-labelledby="world-tab-`).test(html)
  || new RegExp(`aria-labelledby="world-tab-[^"]*"[^>]*id="${id}"`).test(html)
).length;

if (!html.includes('<div class="world-index" role="tablist"') || tabRoleCount !== 8 || tabPanelCount !== 8) {
  failures.push(`World & Lore tab semantics are missing (expected div.world-index[role=tablist] with 8 tabs and 8 tabpanels, got tabs=${tabRoleCount} panels=${tabPanelCount})`);
}
if (labelledPanels !== 8) {
  failures.push(`World & Lore panels must point at their tab with aria-labelledby (labelled=${labelledPanels}/8)`);
}
// 아카데미와 외부 인물 명부를 모두 펼친 상태로 연다.
if (collapsedRosterGroups.length) {
  failures.push(`character roster default-collapse mismatch: ${JSON.stringify(collapsedRosterGroups)}`);
}
const rosterGroupsExpanded = ['students', 'staff', 'pbs', 'hprf', 'wf', 'rtn', 'nf'].every(group => new RegExp(
  `data-roster-group="${group}"[\\s\\S]{0,200}?aria-expanded="true"`
).test(html));
if (!rosterGroupsExpanded) {
  failures.push('character roster groups must open expanded (aria-expanded="true")');
}
if (/World Records|Personnel Registry|Visual Archive|Academic Calendar|Archive Ledger|Registry \/ 2030|Official Registry Mark/.test(html)) {
  failures.push('excessive archive/registry metadata copy remains in index.html');
}

if (/<nav id="top-nav"|mobile-nav-drawer|mobile-menu-btn|class="nav-tab/.test(html)) {
  failures.push('legacy button/menu navigation remains in index.html');
}
// 제목은 아직 임시지만 확정으로 다룬다. 문서 제목·인트로 제목·구간별 제목이
// 따로 놀지 않도록 세 곳을 함께 확인한다.
if (!html.includes('<title>이종족은 좋아하세요?</title>')) failures.push('document title does not match the work title');
if (!html.includes('이종족은 <span class="intro-title-ask">좋아하세요')) failures.push('intro heading does not match the work title');
if (!navigation.includes('이종족은 좋아하세요?')) failures.push('section document titles do not match the work title');
if (!navigation.includes("['main', 'factions', 'world', 'schedule', 'characters']")) {
  failures.push('navigation SECTION_IDS do not match the document');
}
if (!navigation.includes('createSectionScrollController')) failures.push('scroll controller missing');
if (!app.includes('createSectionScrollController')) failures.push('app does not initialize scroll controller');
if (!app.includes('window.scrollTo') && !app.includes('target?.scrollIntoView')) failures.push('section navigation does not scroll');

// 인트로의 명부 인원수는 손으로 적혀 있어 인물이 늘면 조용히 낡는다.
// 실제로 외부가 14명으로 남은 채 배포된 적이 있다.
const roster = JSON.parse(fs.readFileSync(path.join(root, 'characters.json'), 'utf8'))
  .filter(character => !character.spoilerOnly);
const academyCount = roster.filter(c => c.category === 'student' || c.category === 'staff').length;
const outsideCount = roster.filter(c => c.category === 'external').length;
const rosterLabel = `아카데미 ${academyCount}명 · 외부 ${outsideCount}명`;
if (!html.includes(rosterLabel)) {
  const shown = (html.match(/아카데미 \d+명 · 외부 \d+명/) || ['(없음)'])[0];
  failures.push(`intro roster count is stale: ${shown} but data says ${rosterLabel}`);
}

if (failures.length) {
  throw new Error(`Single-scroll validation failed:\n${failures.join('\n')}`);
}
console.log('Single-scroll structure is consistent.');
