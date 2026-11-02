# @rowcat/mcp 를 이 저장소에서 개발할 때

**이 문서는 배포되지 않는다.** `package.json`의 `files`는 `dist` · `README.md` ·
`LICENSE` 셋뿐이고, 이 파일은 거기 없다 — 그것이 이 파일이 README에서 갈라져 나온 이유다.

```text
README.md        npm에 올라간다   설치한 사람이 읽는다. 저장소를 갖고 있지 않다
DEVELOPMENT.md   여기 남는다      저장소를 체크아웃한 사람이 읽는다
```

한동안 아래 내용은 README의 마지막 두 절이었다. 그 배치의 값은 "한 파일에 다 있다"였고,
치른 값은 **공개 레지스트리에 올라가는 문서가 저장소 안의 절차를 설명하는 것**이었다 —
`pnpm --filter`로 시작하는 명령, `.github/workflows`의 이름, 그리고 무엇보다 잘못 올라간
판을 어떻게 회수하는지가 npm 페이지에 그대로 섰다. 설치한 사람은 그 어느 것도 할 수 없고,
마지막 것은 애초에 밖에서 읽을 글이 아니다.

## 이 저장소에서 개발할 때

여기부터는 **RowCat 저장소를 체크아웃한 사람**의 이야기입니다. 위의 설치 절차와는 다른
경로이고, 설치본 사용자가 알아야 할 것은 없습니다.

```bash
pnpm --filter @rowcat/mcp start setup    # 소스에서 그대로 돈다(tsx)
pnpm --filter @rowcat/mcp build          # dist/index.mjs — 배포되는 그 산출물
pnpm --filter @rowcat/mcp test
pnpm --filter @rowcat/mcp pack:verify    # 팩 → OS 임시 디렉터리에 설치 → 설치본으로 검사
```

`pack:verify`가 이 패키지의 핵심 검사입니다. 워크스페이스 안에서 `node dist/index.mjs`를
돌리는 것은 **거짓 초록**입니다 — 그 자리에서는 `node_modules`가 위로 이어져 있어 선언하지
않은 의존도 전부 찾아집니다. 그래서 그 스크립트는 OS의 임시 디렉터리에 tarball을 설치하고,
거기서 `--help`·`--version`·`doctor`를 돌리며, **`doctor`의 런타임 줄로 컴파일러와 QuickJS가
설치본에서 서는지** 확인합니다.

살아 있는 API가 있으면 저작 한 바퀴 전체를 설치본으로 돌릴 수 있습니다(계정을 만듭니다 —
`pnpm test`가 부르지 않는 이유입니다).

```bash
ROWCAT_API_BASE_URL=http://localhost:3001/v2 \
  pnpm exec tsx apps/mcp/scripts/verify-installed-loop.ts "$(which rowcat-mcp)"
```

그 스크립트는 키를 `ROWCAT_SYNC_KEY`로 넣으므로 **페어링은 지나지 않습니다.** 포크의 사용자가
실제로 지나는 길(`rowcat-mcp pair`가 코드를 띄우고 이미 연결된 기기가 승인하는 것)은 따로
돌립니다 — 이 스크립트가 신뢰 기기 쪽을 웹과 같은 `sealPairingDek`으로 맡고, 설치본이 받아 적은
키가 봉인한 키와 같은지까지 봅니다. `HOME`을 임시 디렉터리로 바꿔 돌리므로 내 `~/.rowcat`은
건드리지 않습니다. 가입 메일 인증이 꺼진 깨끗한 인스턴스를 가리킵니다.

```bash
ROWCAT_API_BASE_URL=http://localhost:3001/v2 \
  pnpm exec tsx apps/mcp/scripts/verify-installed-pairing.ts "$(which rowcat-mcp)"
```

### 배포

배포는 **명령 하나로 일어나지 않습니다.** 판정은 `scripts/release-policy.mjs` 하나가 갖고,
`prepublishOnly`의 문과 워크플로의 사전 검사가 **같은 함수**를 지납니다 — GitHub Actions
안이어야 하고, 그 저장소여야 하고, `.github/workflows/mcp-publish.yml`이어야 하고,
`mcp-v<판>` 태그에서 시작해야 하며, 그 판은 `package.json`과 같아야 합니다. 사람의 셸에서는
`pack:verify`까지가 끝입니다.

```bash
# 판을 올린 커밋이 main에 있고 나서
git tag mcp-v0.1.0-alpha.4 && git push origin mcp-v0.1.0-alpha.4
```

첫 외부 판은 **`next` dist-tag의 프리릴리스**입니다. 안정판은 `distTagFor`가 아직
거절합니다 — `latest`로 올리는 것은 카나리아가 저장소 밖에서 검증된 뒤의 별도 결정이고,
그날 그 함수에 가지가 하나 늘면서 같은 커밋이 `publishConfig.tag`도 고칩니다.

판을 올리는 순서는 이것이 전부입니다.

```text
① apps/mcp/package.json 의 version 과 src/index.ts 의 VERSION 을 함께 올린다
② pnpm --filter @rowcat/mcp test && build && pack:verify      ← 로컬에서 끝나는 지점
③ 커밋하고 main 에 올린다
④ git tag mcp-v<판> && git push origin mcp-v<판>
⑤ GitHub Actions 가 같은 검사를 처음부터 다시 돌리고 pnpm publish 한다
⑥ 깨끗한 기계에서 설치해 실제로 한 바퀴 돌려 본다(아래)
```

⑤ 앞의 어디에도 사람이 `publish`를 치는 자리가 없습니다. **코딩 에이전트도 같습니다** —
빌드·테스트·팩 검증·판 올리기·태그 준비까지가 에이전트의 일이고, 레지스트리에 닿는 조작은
아닙니다. `prepublishOnly`의 문이 그것을 선언이 아니라 사실로 막습니다(로컬 셸에서 거절).

⑥은 CI의 일이 아닙니다. 진짜 계정과 페어링이 필요해서 CI가 할 수 없고, 무엇보다 npm에
올라간 것이 도는지는 **npm에서 받아 봐야** 알 수 있습니다.

```bash
npm install -g @rowcat/mcp@next
rowcat-mcp setup && rowcat-mcp pair && rowcat-mcp doctor
```

잘못 올라간 판은 **덮지 않습니다.** npm의 판은 불변이라 되돌릴 수 없고, 답은 언제나
다음 판(`alpha.N+1`)입니다.

`0.1.0-alpha.1`은 회수됐습니다(2026-11-02 레지스트리에 없음을 확인). 그 판은 이 워크플로가 서기 전에
손으로 올라갔고, 소스맵에 `packages/*`의 TypeScript 원본이 `sourcesContent`로 실려 있었습니다 —
`tsdown.config.ts`의 `sourcemapExcludeSources`가 그 재발을 막습니다.

⚠️ **`0.1.0-alpha.2`·`alpha.3`은 운영 서비스 시절의 빌드입니다.** `homepage`가 문을 닫은 서비스의
도메인이고 `license`가 `SEE LICENSE IN LICENSE`이며, 그 뒤 소스에서 기본 API 주소가 사라졌습니다.
게다가 npm은 첫 게시 때 `latest`를 스스로 붙이므로 지금 `latest`와 `next`가 둘 다 alpha.3을
가리킵니다 — `npx @rowcat/mcp@next`가 공개 소스가 아닌 그 판을 받습니다. 이 저장소의 첫 공개 판
(`alpha.4`)이 올라간 **뒤에** 레지스트리를 정리합니다. 레지스트리에 닿는 조작이라 사람이 합니다.

```bash
npm dist-tag add @rowcat/mcp@0.1.0-alpha.4 latest
npm deprecate @rowcat/mcp@"0.1.0-alpha.2 || 0.1.0-alpha.3" \
  "Built for the RowCat hosted service, which has shut down. Use 0.1.0-alpha.4 or later with your own instance."
```

`latest`는 지울 수 없어(npm이 거절합니다) 옮기는 것이 답입니다. `distTagFor`가 `latest`로 게시하는
것을 여전히 거절하는 것과는 다른 일입니다 — 저것은 워크플로의 게시이고 이것은 이미 남은 꼬리표를
최신 프리릴리스로 맞추는 일입니다.
