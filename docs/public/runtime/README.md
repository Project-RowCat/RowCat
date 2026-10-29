# 크리에이터 런타임 공개 문서

**제작자가 읽는 문서다.** RowCat 관리자가 읽는 구현 기록은 `docs/creator-runtime/`에 따로
있고, 두 폴더는 독자가 다르다 — 그쪽은 *런타임이 어떻게 구현되어 있는가*에 답하고 여기는
*런타임 작품을 어떻게 만드는가*에 답한다. 그쪽 문서를 여기로 옮겨 적지 않는다.

## 이 폴더가 화면이 되는 길

```text
docs/public/runtime/**/*.md
      ↓  pnpm --filter web gen:runtime-docs      (apps/web/scripts/gen-runtime-docs.ts)
apps/web/src/generated/runtime-docs.ts           생성물 — 손으로 고치지 않는다
      ↓
/docs/runtime/*                                  apps/web/src/features/docs
```

생성물이 원본과 어긋나면 `runtime-docs-source.test.ts`가 깨진다. 재생성을 기억하는 것에
기대지 않는다.

## 파일 하나가 페이지 하나다

- 경로가 곧 주소다: `quick-start.md` → `/docs/runtime/quick-start`,
  `concepts/state.md` → `/docs/runtime/concepts/state`, `index.md` → `/docs/runtime`.
- 프론트매터는 `키: 값` 한 줄들뿐이다.

  ```text
  title        페이지 제목(필수)
  description  한 줄 설명(필수) — 목록과 메타 태그가 쓴다
  group        getting-started · concepts · guides · reference · runtime-model (필수)
  order        그룹 안의 차례(필수, 정수)
  symbols      이 페이지가 **소유하는** 공개 API 이름들(쉼표 구분, 레퍼런스 페이지만)
  ```

- 문서 사이의 링크는 **절대 경로**로 적는다(`/docs/runtime/concepts/state`). 생성기가
  그 링크가 실제 페이지를 가리키는지 확인한다.
- `README.md`와 `_`로 시작하는 파일은 페이지가 아니다.

## 코드 예제는 컴파일된다

```text
```tsx example=quick-start file=src/main.tsx
```

정보 문자열에 `example=<이름> file=<경로>`가 있는 코드 블록은 그 이름의 **예제 프로젝트**의
파일 하나가 된다. 같은 이름의 블록들이 한 프로젝트를 이루고 진입 파일은 `src/main.tsx`다.
`runtime-docs-examples.test.ts`가 그 프로젝트를 **진짜 런타임 컴파일러**로 컴파일하고 VM에서
마운트한다 — 문서가 "된다"고 적은 코드는 실제로 되어야 한다. `file=` 없는 블록은 설명용이고
검증되지 않는다.

## 공개 API의 소유권

`@rowcat/runtime`의 모든 공개 내보내기는 레퍼런스 페이지 **하나**의 `symbols`에 속해야 한다.
`apps/web/src/features/docs/runtime-api-inventory.ts`가 그 목록을 분류해 갖고,
`runtime-api-inventory.test.ts`가 셋을 견준다 — 패키지의 실제 내보내기, 인벤토리, 페이지의
`symbols`. 내보내기가 하나 늘면 그 테스트가 **이름을 적어** 깨진다.

그 세기가 완전한 근거는 `packages/runtime/src/index.ts`가 **이름 있는 재수출만 담은
배럴**이라는 사실이다 — `export interface`·`export type`·`export const` 같은 직접 선언은
`runtime-public-barrel.test.ts`가 이름을 적어 거절한다. 형 전용 직접 선언은 실행 중의 모듈
객체에 나타나지 않아 그 문이 없으면 문서 없이 나갈 수 있다.

## 한도의 수는 테스트가 감시한다

생성의 실행 중 한도(동시 실행 수·실행당 생성 횟수)는 코드가 읽는 값이 아니라 문장이고, 그 수는
`runtime-docs-generation-limits.test.ts`가 런타임 호스트의 정책과 견준다. 문장의 규약이
있다 — 실행당 횟수는 `실행 … N번`, 동시 실행은 `동시 … N개`로 적는다. 정책이 바뀌면 그
테스트가 어느 페이지의 어느 수인지 적어 깨진다.

원격 이미지 주소의 상한(`8,192자`)도 같은 방식이다 — `runtime-docs-asset-limits.test.ts`가
`@rowcat/runtime`의 `RUNTIME_REMOTE_ASSET_MAX_URL_LENGTH`와 견준다. 지원 형식 목록은 서버의
테스트가 잠그고 문서의 문장은 사람이 맞춘다(문서 화면이 `apps/api`를 들이지 않는다).

## 여기 오지 않는 낱말

QuickJS · WASM · Dexie · SQLite · IndexedDB · HLC · 패치 · 리컨사일러 · 워커 · Phase 번호.
전부 구현의 어휘이고, `runtime-docs-source.test.ts`가 본문에서 그 낱말을 막는다. 제작자에게
필요한 것은 *무엇이 되고 무엇이 안 되는가*이지 그것이 어떻게 만들어졌는가가 아니다.
