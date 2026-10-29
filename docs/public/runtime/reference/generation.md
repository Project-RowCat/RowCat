---
title: 생성
description: useGeneration()이 돌려주는 객체와 요청·결과의 형, 한도 상수.
group: reference
order: 5
symbols: RUNTIME_GENERATION_LIMITS, RuntimeGeneration, RuntimeGenerationMessage, RuntimeGenerationRequest, RuntimeGenerationResult
---

# 생성

개념과 예제는 [AI 생성](/docs/runtime/concepts/generation)에 있습니다. 이 페이지는 형과 값만
적습니다.

## `RuntimeGeneration`

```ts
interface RuntimeGeneration {
	generate(request: RuntimeGenerationRequest): Promise<RuntimeGenerationResult>;
}
```

`useGeneration()`이 돌려주는 객체. 조작은 `generate` 하나이고, 이벤트 핸들러에서만 부릅니다.
실패는 `RuntimeError`로 던지며 `code`가 사유를 말합니다([오류](/docs/runtime/reference/errors-and-limits#생성)).

## `RuntimeGenerationRequest`

```ts
interface RuntimeGenerationRequest {
	messages: readonly RuntimeGenerationMessage[];
	instructions?: string;
	maxOutputCharacters?: number;
}
```

- `messages` — 비어 있으면 안 됩니다. 최근 것부터 뒤에 둡니다(시간순).
- `instructions` — 이 인물·장면의 역할. RowCat의 안전 지시 사이에 들어갑니다.
- `maxOutputCharacters` — 답 길이의 상한 **힌트**(글자 수). 기본 4,000, 최대 16,000. 소수는
  내림, 1 미만은 1.

## `RuntimeGenerationMessage`

```ts
interface RuntimeGenerationMessage {
	role: "user" | "assistant";
	content: string;
}
```

`"system"` 역할은 없습니다. 그 자리는 `instructions`입니다.

## `RuntimeGenerationResult`

```ts
interface RuntimeGenerationResult {
	text: string;
}
```

글 하나. 토큰 수·비용·모델·종료 사유는 없습니다.

## `RUNTIME_GENERATION_LIMITS`

```ts
const RUNTIME_GENERATION_LIMITS: {
	maxMessages: 100;
	maxMessageCharacters: 32_768;
	maxInstructionsCharacters: 32_768;
	maxTotalCharacters: 262_144;
	maxOutputCharacters: 16_000;
	defaultOutputCharacters: 4_000;
};
```

요청이 이 값을 넘으면 `runtime_generation_invalid_request`로 그 자리에서 던집니다 — 요청은
나가지 않습니다. 길이는 UTF-16 코드 단위(JavaScript의 `string.length`)로 셉니다.

## 실행 중의 한도

`RUNTIME_GENERATION_LIMITS`가 담는 것은 **요청 하나**의 한도입니다. 런타임이 실행 중에
지키는 한도 둘은 그 객체에 **없고**, 코드가 읽을 값으로 내보내지 않습니다 — 규칙이지 설정이
아닙니다.

| 한도 | 값 | 넘으면 |
| --- | --- | --- |
| 동시에 도는 요청 | 1개 | `runtime_generation_busy` |
| 한 번의 실행에서 시작할 수 있는 생성 | 200번 | `runtime_generation_not_authorized` |

앞의 것은 앞 요청이 끝나면 풀리고, 뒤의 것은 그 실행 안에서는 풀리지 않습니다 — 플레이어가
다시 시작하면 새 실행이고 횟수도 처음부터입니다. 요청이 나간 뒤 실패한 것도 한 번으로 세고,
모양이 잘못돼 나가지 않은 요청(`runtime_generation_invalid_request`)은 세지 않습니다.
설명은 [AI 생성 › 실행 중의 한도](/docs/runtime/concepts/generation#실행-중의-한도)에 있습니다.
