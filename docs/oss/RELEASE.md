# 공개 소스 릴리스 — 점검표와 태그

> 첫 공개 소스 릴리스(공개 베타)를 내기 전에 확인할 것과, 내는 절차다. 소스 릴리스는 **커밋 하나에 날짜 태그
> 하나를 붙이는 일**이다. 이미지·데스크톱·npm은 각자의 워크플로가 이미 따로 내고, 이 문서는 그것들을 같은
> 커밋에서 맞춰 보게 한다. 막는 항목이 하나라도 남아 있으면 태그를 붙이지 않는다.

## 무엇을 내는가

```text
소스      git 태그 YYYY-MM-DD(접두어 없음)   이 문서의 절차 — GitHub Release는 만들지 않는다
이미지    ghcr.io/<owner>/rowcat/{api,web,admin}:sha-<커밋 12자>   images.yml — CI가 통과한 main 커밋마다 이미 있다
데스크톱  태그 desktop-YYYY-MM-DD           desktop-release.yml — GitHub Release를 내는 유일한 워크플로
MCP       태그 mcp-v<semver>               mcp-publish.yml — npm 패키지
```

- **이름은 날짜다**(AGENTS.md §Versioning). KST 달력 날짜, `v`도 접미어도 없다. 같은 날 두 번이 필요하면 앞의 것이
  아직 낼 때가 아니었다는 뜻이다.
- **소스 릴리스는 GitHub Release를 만들지 않는다.** 설치된 데스크톱은 `/releases/latest`를 따라 자기를 갈아 끼운다
  (AGENTS.md §Desktop). 소스 릴리스가 "최신 릴리스"가 되면 모든 설치본이 그 릴리스에서 `latest.yml`을 찾다가
  업데이트를 잃는다. 그래서 릴리스 노트는 주석 태그(`git tag -a`)의 본문과 아래 §릴리스 노트에 둔다.
- **이미지는 새로 굽지 않는다.** 그 커밋의 `sha-<커밋 앞 12자>`가 곧 그 릴리스의 이미지다. 배포는 `ROWCAT_IMAGE_TAG`에 그 값을
  적는다(`docs/ops/BACKUP.md` §업그레이드). `latest`는 main을 따라가므로 릴리스를 가리키지 않는다.
- **데스크톱과 MCP는 같은 날 낼 필요가 없다.** 내면 같은 커밋에서 낸다 — 그래야 노트가 하나의 코드를 말한다.

## 막는 항목

태그 전에 각 항목의 증거를 다시 읽고, 남은 결정을 닫거나 노트의 「알려진 한계」로 옮긴다. 「권리자만 답할 수 있는
것」은 옮길 수 없다 — 그것이 남아 있으면 내지 않는다.

| 항목 | 증거 | 태그 전에 닫을 것 |
| --- | --- | --- |
| 재배포 권리 | `docs/oss/RIGHTS-AUDIT.md` | §권리자가 답한 것 — 지난 태그 뒤에 다른 사람의 코드나 새 자산이 들어왔으면 권리자가 다시 답한다. **옮길 수 없다** |
| 비밀 · 노출 | `docs/oss/DISCLOSURE-AUDIT.md` | §저장소 밖에서 할 일 — 옛 `@rowcat/mcp` 판 `npm deprecate`, 비공개 취약점 신고 켜기, 로컬 빌드 설치본의 `.env` 확인 |
| 인증 · 첫 설정 · 오리진 | `docs/oss/SECURITY-REVIEW.md` §인증 | §남은 결정 — 노트의 한계로 옮긴다(아래) |
| 동기화 · 페어링 · MCP 기기 | 같은 문서 §암호화 동기화 | §남은 것 — 한계로 옮긴다 |
| 런타임 샌드박스 · 발행 | 같은 문서 §크리에이터 런타임 | §남은 것 — 한계로 옮긴다. 실기기 측정은 노트에 「재지 않았다」로 적는다 |
| 원격 이미지 · 미디어 | 같은 문서 §원격 이미지 | §남은 것 — 한계로 옮긴다 |
| 깨끗한 설치 · 첫 관리자 | `docs/ops/CLEAN-INSTALL.md` | 태그할 커밋에서 한 번 더 돌린다(`pnpm test:compose`는 CI가, 사람의 절차는 그 문서가) |
| CI 관문 | `.github/workflows/ci.yml`, `scripts/ci-passed.sh` | 태그할 커밋의 `push` 실행이 초록이다 |

## 지원하는 것

| 표면 | 지원 | 비고 |
| --- | --- | --- |
| 서버(API · 웹 · 콘솔) | Docker 이미지, `linux/amd64` · `linux/arm64` | Node 26(alpine) 위. Postgres 필수, Redis 선택 |
| 소스에서 실행 | pnpm 10(`packageManager`), Node 22(CI가 쓰는 판) | 개발용. 배포는 이미지를 쓴다 |
| 데스크톱 설치본 | Windows x64, **서명 없음** | 한 컴퓨터용. 스스로 업데이트한다. macOS는 서명이 없어 자동 업데이트가 안 되므로 내지 않는다 |
| 모바일 앱 | **배포하는 바이너리 없음** | 포크가 자기 이름으로 EAS 빌드를 한다(`docs/oss/FORKING.md`). OTA는 자체 호스팅 |
| MCP | npm `@rowcat/mcp`, Node 22.12 이상 | 별도 태그로 낸다 |

**지원하는 판은 기본 브랜치의 마지막 커밋뿐이다**(SECURITY.md). 날짜 태그는 「이 커밋을 이렇게 확인했다」는 기록이지,
고침을 따로 받는 판이 아니다.

## 기본으로 꺼진 것

빈 설정으로 띄운 배포는 아래가 꺼진 채 돈다. 무엇이 켜졌는지는 `pnpm env:doctor --mode production`과 콘솔의 배포
준비 상태가 말한다.

```text
관리형 생성        OPENROUTER_API_KEY 없음 → 꺼짐. 켜도 MANAGED_GENERATION_ACCESS=allowlist(운영자 + 목록의 회원)
메일              MAIL_TRANSPORT 없음 → 이메일 인증 · 이메일 변경 · 비밀번호 재설정이 함께 없다
비밀번호 재설정    메일 + PASSWORD_RESET_ENABLED=on 둘 다
소셜 로그인        Google · Apple · Kakao 각자의 값이 있어야 선다
본인확인           IDENTITY_VERIFICATION_PROVIDER 없음 → 성인 확인 · 보호자 동의 없음. 성인 보기는 관리자의 수동 인정뿐
연령 게이트        MEMBERSHIP_AGE_GATE 꺼짐. 나이는 MEMBERSHIP_GUARDIAN_CONSENT_AGE · MEMBERSHIP_ADULT_AGE(기본 14 · 19)
성인 1년 재확인    ADULT_REVERIFICATION_ENABLED 꺼짐
백그라운드 작업    BACKGROUND_JOBS_ENABLED 꺼짐 → 푸시 발송 · 보존 기한 파기 · 고아 미디어 정리가 돌지 않는다
네이티브 푸시      PUSH_TRANSPORT + 위의 작업
OTA 콘솔 발행      OTA_CI_* 없음 → 콘솔은 읽기 · 롤아웃 · 정지만, 발행은 CLI
로컬 소유자        LOCAL_OWNER_ENABLED — 데스크톱 설치본만 켠다
내레이션 팩        본문이 실리지 않는다(docs/chat/NARRATION.md §공개본). 축만 있다
업데이트 안내      실린 릴리스가 없다 — 탭은 비어 있다
```

## 알려진 한계

노트에 그대로 옮긴다. 감사 문서의 「남은 것」이 바뀌면 이 목록도 같은 커밋에서 바꾼다.

- **웹의 CSP는 report-only다.** 웹의 XSS 하나는 그 오리진의 동기화 키와 개인 API 키에 닿는다.
- **관리 미디어는 id로 공개되고**, 주체 단위 바이트 예산이 없다(프로세스 게이트만 있다).
- **동기화 밀어 넣기에 회원 단위 속도 제한이 없다.** 저장 공간은 행 상한과 할당량이 막는다.
- **MCP Node 호스트에는 생존 확인이 없다** — 돌아오지 않는 창작자 코드가 그 프로세스를 붙잡는다.
- **로컬 소유자는 첫날이 지나면 비밀번호를 설정하지 못한다** — 비밀번호 설정이 최근 로그인을 요구하는데 로컬 소유자에게는
  로그아웃이 없다. 계정 화면이 그 칸을 아직 그린다.
- **실기기에서 재지 않았다** — 저사양 안드로이드의 32ms 관문, 하네스 CSP의 iOS 동작, 생존 확인의 한도.
- **인기순 페이지는 오프셋 기반이다** — 점수가 움직이면 경계의 행이 두 번 보이거나 빠질 수 있다.
- **운영 중에 나이 기준을 바꾸면** 그 뒤에 나이를 밝히는 회원부터 적용된다(이미 판정된 회원은 다시 판정하지 않는다).
- **호스팅 서비스는 없다.** 이 릴리스와 호환되는 공식 인스턴스도, 옛 서비스의 계정이나 데이터를 옮기는 길도 없다.

## 마이그레이션과 호환

- **DB 마이그레이션은 API 부팅 때 앞으로만 적용된다.** 되돌리는 스크립트는 없고, 업그레이드 전 백업이 유일한 롤백이다
  (`docs/ops/BACKUP.md` §업그레이드 · §롤백의 경계). 노트에는 이전 날짜 태그 이후 `apps/api/drizzle/`의 차이를 적는다.
- **기기 데이터는 정수 판으로 묻는다**(`SYNC_PROTOCOL_VERSION`, `AUTHORING_SCHEMA_VERSION` …). 판이 오른 릴리스는 노트에
  「옛 기기는 새 기록을 무시하고 자기 판을 지킨다」를 적는다.
- **런타임 작품은 호환 창 안에서 연다**(`RUNTIME_API_MIN_COMPATIBLE_VERSION`). 창의 바닥이 오른 릴리스는 「이미 발행한
  런타임 작품은 다시 발행해야 열린다」를 노트 맨 위에 적는다 — 서버에 원본이 없어 서버가 대신 다시 컴파일할 수 없다.
- **모바일 네이티브 세대**(`RUNTIME_VERSION`)가 오른 릴리스는 새 바이너리가 있어야 그 OTA를 받는다.

## 문서 대조

태그할 커밋에서 아래가 그 커밋을 말하는지 본다.

- [ ] `README.md` · `README.ko.md` — 기능 설명이 위 「기본으로 꺼진 것」과 맞고, 호스팅 서비스가 있다고 읽히지 않는다
- [ ] `docs/oss/SELF-HOSTING.md` · `.ko.md` — 명령이 그 커밋의 `docker-compose.yml`과 `.env.example`로 돈다
- [ ] `docs/oss/FORKING.md` — 바꿀 자리 목록이 `operator-domain.test.ts`가 지키는 것과 같다
- [ ] `CONTRIBUTING.md` · `SECURITY.md` · `CODE_OF_CONDUCT.md` — 연락 경로가 살아 있다
- [ ] `NOTICE` · 각 패키지의 `LICENSE` — `license-split.test.ts`가 초록이고, RIGHTS-AUDIT의 표와 같다
- [ ] `.github/FUNDING.yml` — README의 후원 배지와 같은 계정이다

## 저장소 설정

GitHub에서 사람이 확인한다(코드로 지킬 수 없다).

- [ ] 비공개 취약점 신고(Private vulnerability reporting)가 켜져 있다 — SECURITY.md가 그 경로를 약속한다
- [ ] `main` 보호 — 강제 푸시와 삭제가 막혀 있고, CI가 필수 검사다
- [ ] 태그 보호 — `desktop-*` · `mcp-v*` · 날짜 태그를 쓸 수 있는 사람이 정해져 있다
- [ ] GHCR 패키지 세 개가 공개다 — 아니면 `docker compose up`이 익명으로 받지 못한다
- [ ] Actions 비밀은 쓰는 워크플로의 환경에만 있다
- [ ] 공개 원격에는 `main`과 태그만 있다(`--all` · `--mirror`를 쓴 적이 없다)

## 절차

```bash
sha=$(git rev-parse origin/main)
date=$(TZ=Asia/Seoul date +%F)

# 1. 그 커밋에서 CI가 통과했다
GITHUB_REPOSITORY=<owner>/<repo> scripts/ci-passed.sh "$sha" 0

# 2. 그 커밋의 이미지가 있다(세 개 모두)
for app in api web admin; do
  docker manifest inspect "ghcr.io/<owner>/rowcat/$app:sha-${sha::12}" >/dev/null
done

# 3. 깨끗한 설치를 그 이미지로 한 번 더(docs/ops/CLEAN-INSTALL.md)

# 4. 태그 — 주석 태그, 본문이 릴리스 노트다
git tag -a "$date" "$sha" -F release-notes.md
git push origin "$date"
```

- **태그는 옮기지 않는다.** 날짜 태그를 본 사람이 같은 코드를 받는다는 것이 그 태그의 전부다. 고침은 다음 날짜로 낸다.
- **GitHub Release를 만들지 않는다**(§무엇을 내는가). 웹에서 태그를 릴리스로 승격하는 버튼도 누르지 않는다.
- `git push --tags`는 쓰지 않는다 — 공개하지 않을 로컬 태그가 함께 나간다.

## 릴리스 노트

영어 다음 한국어(데스크톱 노트와 같은 순서). 사용자가 읽는 말로 쓰고, 패키지 이름과 커밋 메시지를 옮겨 적지 않는다.

```markdown
# RowCat YYYY-MM-DD

Source release of commit <sha>. Images: `sha-<first 12 of sha>` (linux/amd64, linux/arm64).
There is no hosted RowCat service; this is code you run under your own name.

## What's in it
## Off by default
## Upgrading        — new migrations since the last tag, and whether a backup-only rollback applies
## Known limitations
## Security         — report privately: <SECURITY.md>

---

# RowCat YYYY-MM-DD (한국어)

…같은 순서
```

## 다시 하기

릴리스마다 이 문서를 위에서부터 한 번 걷는다. 막는 항목의 증거 문서가 새로 생기거나 「남은 것」이 바뀌면 표와
「알려진 한계」를 같은 커밋에서 고친다.
