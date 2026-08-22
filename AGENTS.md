# 저장소 작업 규칙

- 이 저장소 `C:\dev\ISM-public`(`TANETI/ISM`)은 GitHub Pages 배포 전용 복제본이다. 제작 원본은 `C:\dev\ISM`(`TANETI/ISM-private`)이다.
- 사이트와 공개 데이터는 비공개 원본에서 먼저 수정·검증·커밋한 뒤, 공개 가능한 변경 파일만 파일 단위로 이 저장소에 동기화한다.
- 이 저장소에서 내용을 독립적으로 먼저 고치지 않는다. 두 저장소는 별도 이력이므로 비공개 커밋을 `cherry-pick`하거나 저장소끼리 `fetch`하지 않는다.
- `프롬프트/`, `tools/`, `CLAUDE.md`, `.claude/`, `backups/`, `prompt-viewer/`, `docs/세계관/내부자료/`를 추가하지 않는다.
- `.github/workflows/static.yml`은 공개 Pages 전용이다. 비공개 저장소의 `validate.yml`로 덮어쓰지 않는다.
- 모든 커밋과 푸시는 항상 `main` 브랜치에서 진행한다.
- 다른 작업 브랜치의 변경은 모두 `main`에 병합한 뒤 푸시한다.
- 사용자가 저장소 파일 변경을 요청한 작업은 완료·검증 후 별도 요청을 기다리지 않고 `main`에서 커밋하고 푸시한다. 사용자가 커밋·푸시 제외를 명시한 경우에만 생략한다.
