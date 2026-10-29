---
title: 오류와 한도
description: 런타임이 던지는 RuntimeError, 제작자가 만날 수 있는 코드, 코드를 고쳐 풀 수 있는 한도.
group: reference
order: 8
symbols: RuntimeError, RUNTIME_ERROR_CODE, RuntimeErrorCode
---

# 오류와 한도

## `RuntimeError`

```ts
class RuntimeError extends Error {
	readonly code: RuntimeErrorCode;
}
```

런타임이 던지는 모든 오류의 형. `code`로 분기하고 `message`는 사람이 읽는 문장입니다. 잡을 일이
있는 자리는 사실상 `generate()` 하나입니다 — 나머지는 코드의 결함이라 잡지 않고 고칩니다.

```ts
try {
	await generation.generate(request);
} catch (error) {
	if (error instanceof RuntimeError && error.code === "runtime_generation_unavailable") {
		// 이 세션에서는 AI를 쓸 수 없다는 안내
	}
}
```

## `RUNTIME_ERROR_CODE` · `RuntimeErrorCode`

`RUNTIME_ERROR_CODE`는 이름 → 코드 문자열의 상수 객체이고, `RuntimeErrorCode`는 그 값들의
유니온입니다. 아래는 제작자가 실제로 만나는 코드입니다.

### 훅과 렌더

| 코드 | 뜻 |
| --- | --- |
| `runtime_hook_outside_render` | 훅을 컴포넌트 밖에서 불렀다 |
| `runtime_hook_order_changed` | 같은 컴포넌트가 렌더마다 다른 훅을 부른다(조건문 안의 훅) |
| `runtime_state_update_during_render` | 렌더 중에 `setState`를 불렀다 |
| `runtime_async_component_unsupported` | 컴포넌트가 프로미스를 돌려줬다 |
| `runtime_invalid_runtime_node` | 그릴 수 없는 값을 돌려줬다(함수·객체 등) |
| `runtime_duplicate_key` | 같은 부모 아래 `key`가 겹친다 — 경고 |
| `runtime_update_after_unmount` | 사라진 컴포넌트의 상태를 갱신했다 — 경고 |
| `runtime_effect_returned_promise` | `async` 효과 — 경고 |
| `runtime_effect_failed` | 효과가 던졌다. 그 효과만 잃는다 |
| `runtime_invalid_host_prop` | 부품이 모르는 프롭이나 잘못된 값 |
| `runtime_host_component_called` | 부품을 함수처럼 불렀다 |

### 상태

플레이스루 상태의 코드는 `runtime_story_state_*`, 영구 상태는 `runtime_persistent_state_*`로
짝이 같습니다.

| 코드(`story_state` 쪽) | 뜻 |
| --- | --- |
| `runtime_invalid_story_state` | `key`·`version`·`initial`이 규칙에 맞지 않는다 |
| `runtime_story_state_definition_late` | 모듈 최상단이 아닌 곳에서 정의했다 |
| `runtime_story_state_duplicate_key` | 같은 `key`를 두 번 정의했다 |
| `runtime_story_state_hook_changed` | 같은 훅 자리에 다른 정의를 넘겼다 |
| `runtime_story_state_value_invalid` | 직렬화할 수 없는 값을 저장하려 했다 |
| `runtime_story_state_limit_exceeded` | 값이나 저장 전체가 한도를 넘었다 |
| `runtime_story_state_migration_failed` | `migrate`가 던졌다 |
| `runtime_story_state_migration_invalid` | `migrate`가 직렬화할 수 없는 값을 돌려줬다 |
| `runtime_story_state_version_newer` | 저장된 판이 코드의 판보다 높다 |

### 생성

| 코드 | 뜻 |
| --- | --- |
| `runtime_generation_during_render` | 렌더 중에 `generate()`를 불렀다 |
| `runtime_generation_invalid_request` | 요청의 모양·길이가 잘못됐다 |
| `runtime_generation_unavailable` | 이 세션에 AI가 없다 |
| `runtime_generation_not_authorized` | 플레이어의 조작 밖에서 불렀거나, 이 실행에서 허용된 생성 횟수를 모두 썼다 — 뒤의 경우는 다시 시도해도 같고 플레이어가 다시 시작해야 풀린다 |
| `runtime_generation_insufficient_balance` | 예약된 코드 — 지금 어떤 호스트도 이 사유를 내지 않는다. `runtime_generation_failed`처럼 다뤄도 된다 |
| `runtime_generation_busy` | 앞 요청이 아직 돌고 있다 |
| `runtime_generation_cancelled` | 세션이 끝나며 취소됐다 |
| `runtime_generation_failed` | 그 밖의 실패 |

### 값

| 코드 | 뜻 |
| --- | --- |
| `runtime_invalid_color` | `color()`에 색이 아닌 문자열 |
| `runtime_invalid_asset_ref` | `asset()`에 규칙 밖의 값 — `http:`·`data:`·IP 주소·자격증명·다른 포트·너무 긴 주소, 또는 규칙 밖의 논리 경로 |

### 화면의 크기

| 코드 | 뜻 |
| --- | --- |
| `runtime_tree_depth_exceeded` | 부품이 너무 깊게 중첩됐다 |
| `runtime_host_node_limit_exceeded` | 한 화면의 부품이 너무 많다 |

이 둘은 **그 렌더만** 실패하고 이전 화면이 남습니다. 긴 목록은 최근 것만 그리거나 페이지를
나누세요.

## 한도 모음

코드를 고쳐서 풀 수 있는 한도만 적습니다.

| 축 | 한도 | 어디에 |
| --- | --- | --- |
| 프로젝트 | 파일 200개 · 파일당 200,000자 · 경로 200자 · 깊이 7단계 | [프로젝트 구조](/docs/runtime/project-structure#한도) |
| 상태 | 수명마다 정의 128개 · 정의당 64 KiB · 저장 전체 256 KiB | [상태 정의](/docs/runtime/reference/state#한도) |
| 생성 — 요청 하나 | 메시지 100개 · 요청 262,144자 · 답 16,000자 | [생성](/docs/runtime/reference/generation#runtime-generation-limits) |
| 생성 — 실행 중 | 동시 1개 · 실행당 200번 (다시 시작해야 처음부터) | [생성](/docs/runtime/reference/generation#실행-중의-한도) |
| 자산 — HTTPS 이미지 | 주소 8,192자 · JPEG·PNG·WebP·GIF | [자산](/docs/runtime/reference/assets) |
| 자산 — 논리 경로 | 200자 · 8단계 | [자산](/docs/runtime/reference/assets) |
