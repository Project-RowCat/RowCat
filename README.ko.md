<div align="center">

<img src="apps/mobile/assets/icon.png" width="96" height="96" alt="RowCat 앱 아이콘">

# RowCat

**인터랙티브 스토리를 위한 오픈소스 플랫폼.**<br>
이야기를 갤러리에 발행하고 AI와의 대화로 플레이하거나,<br>
웹과 모바일의 샌드박스에서 도는 작은 TSX 프로그램으로 직접 만든다.

[![CI](https://github.com/Project-RowCat/RowCat/actions/workflows/ci.yml/badge.svg)](https://github.com/Project-RowCat/RowCat/actions/workflows/ci.yml)
[![License: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-blue)](LICENSE)
[![Runtime packages: Apache-2.0](https://img.shields.io/badge/runtime_packages-Apache--2.0-green)](#라이선스)
[![Sponsor](https://img.shields.io/badge/sponsor-astra--void-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/astra-void)

[빠른 시작](#빠른-시작) · [직접 배포 안내](docs/oss/SELF-HOSTING.ko.md) · [크리에이터 런타임 문서](docs/public/runtime/index.md) · [포크하기](docs/oss/FORKING.md) · [English](README.md)

</div>

> [!NOTE]
> RowCat은 호스팅 서비스로 운영되었고, 그 서비스는 종료되었다. 이 저장소는 그 코드 전체이며, 누구나 읽고
> 배우거나 다른 이름으로 직접 배포할 수 있도록 공개한 것이다. 지금 이 코드를 돌리는 호스팅 인스턴스는 없다.

## 특징

- **대화는 내 기기에 남는다.** 대화, 메모리, 이야기 초안은 기기 자신의 데이터베이스(웹은 IndexedDB,
  모바일은 SQLite)에 살고, 내 기기들 사이에서 종단간 암호화로 동기화된다. 서버는 자신이 열 수 없는 암호문만
  저장하며, 새 기기는 짧은 코드로 페어링한다.
- **내 AI 키 또는 운영자의 키.** 회원은 자신의 Anthropic이나 Gemini 키를 연결해 브라우저나 앱에서 공급자를
  직접 호출할 수 있다. 운영자는 허용 목록과 요청 한도를 걸어 OpenRouter를 통한 관리형 모델을 제공할 수도 있다.
- **이야기가 곧 프로그램이 된다.** 크리에이터 런타임에서 작가는 `@rowcat/runtime`에 맞춰 TSX를 쓴다. 서버가
  발행 시점에 컴파일하고, 플레이어는 격리된 QuickJS/WASM 가상 머신 안에서 실행한다. 웹에서는 DOM으로,
  모바일에서는 네이티브 뷰로 그려진다.
- **발견을 위한 갤러리.** 검색, 태그, 관련 작품, 인기순, 즐겨찾기, 답글이 달리는 댓글, 팔로우, 공개
  크리에이터 프로필.
- **필요한 클라이언트가 다 있다.** SSR 웹 앱, 서명된 자체 OTA 업데이트를 갖춘 Expo 모바일 앱, 운영 콘솔,
  컴퓨터 한 대용 데스크톱 설치 파일, 그리고 코딩 에이전트가 런타임 이야기를 쓸 수 있게 하는 MCP 서버.
- **티 나지 않는 부분까지.** 패스키, 2단계 인증, Google·Apple·카카오 로그인, 이의 제기가 있는 모더레이션,
  푸시 알림, 법정대리인 동의와 연령 확인.

## 몇 줄의 TSX로 쓰는 이야기

```tsx
import { Button, Screen, Stack, Text, color, defineStoryState, useStoryState } from "@rowcat/runtime";

const game = defineStoryState({ key: "game", version: 1, initial: { chapter: 1 } });

export default function App() {
	const [state, setState] = useStoryState(game);

	return (
		<Screen background={color("#0b0d12")}>
			<Stack gap={12} style={{ padding: 24 }}>
				<Text style={{ color: color("#f5f7fa"), fontSize: 22 }}>{state.chapter}장</Text>
				<Button onPress={() => setState((s) => ({ chapter: s.chapter + 1 }))}>계속</Button>
			</Stack>
		</Screen>
	);
}
```

`useStoryState`로 만든 상태는 세션이 끝나도 남고 기기 사이에서 동기화되며, 웹과 모바일에서 똑같이 돈다.
컴포넌트, 상태, AI 생성, 발행은 [크리에이터 런타임 문서](docs/public/runtime/index.md)에 있다.

## 빠른 시작

Node.js 22 이상, pnpm(`corepack enable`), Docker가 필요하다.

```bash
pnpm install
pnpm dev:setup   # env 파일, 생성된 시크릿, Docker의 Postgres, 스키마, 개발 계정
pnpm dev:all     # 웹 :3000, API :3001, 운영 콘솔 :3002
```

<http://localhost:3000>을 열고 `dev@rowcat.test` / `rowcat-dev`로 로그인한다. AI 응답에는 키가 필요하다.
`apps/api/.env`에 `OPENROUTER_API_KEY`를 넣거나, AI 설정에서 자신의 Anthropic 또는 Gemini 키를 연결한다.

## 직접 배포하기

공개된 이미지에는 배포별 값이 들어 있지 않다. 기본 배포에는 Postgres와 시크릿 하나만 있으면 된다.

```bash
cp .env.example .env   # BETTER_AUTH_SECRET과 POSTGRES_PASSWORD를 생성하고, 오리진을 설정한다
docker compose up -d   # api, web, admin과 함께 Postgres, Redis
```

첫 관리자, Caddy로 붙이는 HTTPS, 백업과 업그레이드, 데스크톱 설치 파일, 선택 연동 전부는
[직접 배포 안내](docs/oss/SELF-HOSTING.ko.md)에 있다. 내 이름으로 배포하기 전에는
[FORKING.md](docs/oss/FORKING.md)를 읽는다 — RowCat의 이름과 정체성이 들어 있는 자리를 모두 나열한다.

## 어떻게 만들었나

strict TypeScript로 쓴 pnpm 모노레포.

| | |
| --- | --- |
| **API** | Hono, Better Auth, Postgres 위의 Drizzle — 공개 API는 `/v2` 하나 |
| **웹** | TanStack Start(SSR), React 19, TanStack Router/Query, Tailwind 4 |
| **모바일** | Expo, SQLite, SecureStore, 직접 호스팅하는 서명된 OTA 서버 |
| **콘솔** | 모더레이션과 배포 설정을 위한 Vite SPA |
| **런타임** | TypeScript 컴파일러 → 아티팩트, QuickJS/WASM 호스트, DOM·React Native 렌더러 |
| **동기화** | AES-256-GCM 봉투, 복구 코드가 있는 키링, 하이브리드 논리 시계 |

설계 근거는 대부분 글로 남아 있다. [AGENTS.md](AGENTS.md)가 색인이자 어느 패키지가 어느 패키지를 가져올 수
있는지의 규칙이고, `docs/`에 결정 기록이 있으며, 각 파일의 머리 주석이 그 파일이 지키는 경계를 설명한다.

## 기여하기

기여를 환영한다. 먼저 [CONTRIBUTING.md](CONTRIBUTING.md)를 읽는다 — 커밋에는 DCO 서명이 필요하다. 취약점은
공개 이슈가 아니라 [SECURITY.md](SECURITY.md)에 적힌 대로 비공개로 제보한다. 이 프로젝트는
[행동 강령](CODE_OF_CONDUCT.md)을 따른다.

```bash
pnpm check && pnpm typecheck && pnpm test
```

## 라이선스

RowCat은 **GNU Affero General Public License v3.0 only**([LICENSE](LICENSE))로 배포된다. 재사용 가능한 여덟
패키지는 대신 **Apache License 2.0**이며 각자 `LICENSE` 파일을 가진다: `packages/runtime`, `runtime-compiler`,
`runtime-host`, `runtime-renderer-web`, `runtime-renderer-native`, `runtime-persistence`, `runtime-ai-docs`,
`contracts`. 서드파티 자산은 [NOTICE](NOTICE)에 있다.

라이선스가 다루는 것은 코드이지 이름이나 앱 아이콘이 아니다. "RowCat"은 이 프로젝트에 남으므로, 포크는 자기
이름과 정체성으로 내놓는다([NOTICE](NOTICE), "Trademarks").

## 후원

RowCat이 도움이 되었다면 [GitHub Sponsors](https://github.com/sponsors/astra-void)에서 메인테이너를 후원할 수
있다.
