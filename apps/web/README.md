# apps/web — RowCat 소비자 웹

TanStack Start(SSR) + React 19 + Router/Query + Tailwind 4. 아키텍처와 경계 규칙은
저장소 루트의 `AGENTS.md`가 갖는다 — 여기엔 이 앱을 **돌리는 방법**만 둔다.

```bash
pnpm dev                       # :3000
pnpm --filter web build        # vite build → .output
pnpm --filter web typecheck
pnpm --filter web test         # vitest — React 렌더 없이 도는 순수 로직·로컬 저장소 테스트
```

API가 같이 떠 있어야 한다(`pnpm dev:api`, :3001). API의 `WEB_ORIGIN`에 이 앱의 오리진이
없으면 모든 조회가 CORS로 막히는데, 프리플라이트는 204로 통과해서 화면에서는 "네트워크
실패"로만 보인다.

## 생성물 — 손으로 고치지 않는다

| 파일 | 다시 만드는 법 |
| --- | --- |
| `src/routeTree.gen.ts` | `pnpm --filter web generate-routes` (tsr) |

## 라우팅

`src/routes/` 파일 기반이고, 앱 껍데기 안의 화면은 전부 `(app)/` 아래에 있다. 로그인과
보호자 동의(`/guardian/$token`)만 껍데기 밖이다 — 세션도 열람자도 없는 브라우저에서
열려야 하기 때문이다. 라우트를 더하면 `shell-route.ts`가 그 경로를 어떤 구획으로 볼지
정한다(사이드바 강조·머리말 맥락·뷰포트 고정이 전부 거기서 나온다).

## 배포

Nitro 프리셋 없이 도는 Node 서버 하나다(`node .output/server/index.mjs`). 도커 이미지는
저장소 루트의 `docker-bake.hcl`이 만든다.
