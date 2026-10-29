# 크리에이터 런타임 — WASM JavaScript VM PoC (Phase 3) 결정 기록

> 상태: **PoC 완료.** 2026-09-02. §9의 세 조건은 Phase 4A가 닫았다 — 네이티브 실행 환경은
> `native-vm-host.md`, 생성된 런타임과 스케줄러는 `AGENTS.md`의 `### Runtime execution` 절. 아래 본문은 Phase 3 시점의 기록 그대로다.
>
> 이 문서는 마케팅 문서가 아니다. 무엇을 시험했고 무엇이 나왔고 무엇이 막혔는가를 적는다.

## 1. 결론

```text
엔진        quickjs-ng 0.12.1 · quickjs-emscripten(-core) 0.32.0 · 변형 @jitl/quickjs-ng-wasmfile-release-sync
Web         PASS   (워커 안의 WASM VM · 19/19)
iOS         PASS   (iPhone 17 Pro Max 시뮬레이터 · iOS 26.5 · WKWebView 안의 WASM VM · 19/19)
Android     PASS   (Phase 4A · 에뮬레이터 · Android 17 · WebView 149 — `native-vm-host.md` §2)
Node        PASS   (같은 스위트가 `pnpm --filter @rowcat/runtime-host test`로 돈다)
권고        **조건부로 진행** — 아래 §9의 셋을 Phase 4 첫 슬라이스로 끌어올린다
```

## 2. 무엇을 만들었는가

```text
packages/runtime-host            신뢰된 호스트(플랫폼 중립). 세션·와이어·능력·한도·수명주기·오류
  src/vm/quickjs.ts              엔진 어댑터 — quickjs-emscripten을 아는 유일한 파일
  src/builtins/*                 VM 안에 설치되는 프렐류드·rowcat:runtime 스텁·PoC 다리
  src/poc/suite.ts               세 플랫폼이 같이 돌리는 스위트(19단계 + 측정)
apps/web  /runtime-vm-lab        개발 빌드 · Vite 워커 안에서 스위트를 돌린다
apps/mobile  /dev-tools 구획     WKWebView 안의 호스트 · 능력은 Hermes가 답한다
```

파이프라인은 스펙 §1 그대로다: 아티팩트 → 검증 → VM 생성 → 내장 설치 → ESM 그래프 평가 →
내보내기 호출 → VM→호스트 요청 → 호스트→VM 응답 → 약속 재개 → 한도 → 폐기. 제작자 코드가
호스트 realm에서 도는 자리는 없다(정적 스캔이 세 곳에서 지킨다).

## 3. 격리

- **realm**: 세션마다 **WASM 인스턴스**를 새로 만든다(컴파일된 `WebAssembly.Module`은 엔진이
  한 번 들고 있는다). 선형 메모리가 세션마다 따로 있다.
- **노출 전역**: `window`·`document`·`navigator`·`localStorage`·`indexedDB`·`process`·`require`·
  `module`·`Buffer`·`fetch`·`WebSocket`·`XMLHttpRequest`·`Worker`·`WebAssembly`·`setTimeout` —
  전부 `undefined`(실측, 세 플랫폼). `eval`·`Function`은 프렐류드가 지우고 함수 생성자 넷은
  던지는 함수로 바꿨다(`(function(){}).constructor("…")` → 거절). **격리가 아니라 한 겹이다.**
- **`Eval` 내장 옵션은 쓸 수 없다**: `newContext({ intrinsics: { Eval: false } })`는 `JS_Eval`
  자체를 막아 모듈 소스 평가가 `eval is not supported`로 실패한다.
- **호스트 객체 경계**: 두 방향 모두 JSON 문자열이다. 핸들·함수·약속·호스트 객체는 건너지
  않고, 호스트 실패의 문장·스택은 VM에 도착하지 않는다(`host capability failed` + 코드만).
- **호스트 심볼 ≠ VM 심볼**: `rowcat:runtime`은 VM 안의 스텁이고 그 `Symbol("rowcat.runtime.element")`은
  호스트의 것과 다른 값이다. 이 사실 때문에 첫 구현에서 두 내장이 각자 심볼을 만들어
  `isRuntimeElement`가 거짓이 됐고, 지금은 `rowcat:internal/symbols` 하나가 주인이다(§10).

## 4. 자원 통제

| 축 | 방법 | 실측 |
| --- | --- | --- |
| CPU | 엔진 인터럽트 핸들러(슬라이스 마감 + 취소 표식). `Promise.race`가 아니다 | `while(true){}`·1e10 루프가 100ms 예산에서 101ms에 끊긴다. 호출 간격 ≈ 50µs(100ms에 1,945회) |
| 메모리 | `WebAssembly.Memory({ maximum })` — **`setMemoryLimit`은 동작하지 않는다**(§7) | 24MiB 한도에서 25~40ms에 `out of memory`, 선형 메모리 24.2MB에서 멈춤 |
| 스택 | `setMaxStackSize` — 상한 **128KiB**(§7) | 재귀 폭주 → 잡히는 `RangeError`, 같은 세션이 계속 산다 |
| 호출 한도 | 대기 중 호출 수 + 실행당 총수 | 100,000회 폭주가 9번째에서 `runtime_host_call_limit_exceeded`, 호스트는 8건만 봤다 |
| 취소 | `dispose()` → 취소 표식 + `AbortSignal` 중단 + 진행 중 턴이 `runtime_cancelled`로 풀림 | 호스트를 기다리는 중의 폐기가 통과. 늦게 온 완료는 VM에 들어가지 않는다 |
| 폐기 | 멱등(같은 약속). 그 뒤 `runtime_disposed` | 통과. 손상된 인스턴스는 버린다(§7) |

## 5. 모듈 시스템

- **정적 ESM 그대로.** 번들로 접지 않는다. 로더는 아티팩트 모듈과 설치된 내장만 알고,
  정규화기는 제작자 모듈의 **의존 표**로 답한다. 표 밖·맨 이름·`rowcat:internal/*`은 결정적
  실패(`runtime_module_evaluation_failed`)이지 호스트 해석이 아니다.
- **순환 import**: quickjs-ng의 ESM 순환 의미 그대로 통과(a ↔ b, 진입점에서 `fromB()` = 42).
- **싱글턴**: 두 모듈이 import한 카운터가 같은 인스턴스다([1, 2, 3]).
- **최상위 await**: 그래프 평가가 약속을 돌려주면 세션의 같은 루프를 지난다 — 모듈 최상단에서
  호스트를 기다릴 수 있다(통과).
- **발견**: 컴파일러의 의존 표에 **JSX 변환이 심는 `@rowcat/runtime/jsx-runtime`이 없다.**
  제작자가 적은 import만 표에 오른다. 로더는 공개 내장 이름 셋을 이름으로 받는다(§10).

## 6. 비동기 다리

- 요청/응답만이다. 스트리밍·이벤트·타이머·호스트 → VM 푸시는 없다.
- **재진입 없음**: 호출은 VM 슬라이스 안에서 받아들여지기만 하고(동기), 핸들러는 마이크로태스크
  뒤에 시작하며, 결과는 완료 큐에 쌓였다 다음 VM 턴이 `deferred.resolve` → `executePendingJobs`로
  전달한다. 중첩 호출 셋(`chain`)이 큐로 이어진다.
- **작업 펌프**: 슬라이스당 최대 N개 잡을 돌리고 남으면 이벤트 루프에 양보한 뒤 반복한다
  (재귀 아님). 잡도 호스트 호출도 없는데 약속이 미확정이면 `runtime_execution_stalled`.
- 즉시 답·늦은 답·거절·거절 뒤 catch·await 뒤 throw — 다섯 다 통과. 제작자 오류에는
  모듈 id와 줄·칸이 남는다(`src/main.ts:4:86`).

## 7. 엔진의 한계 — **알고 받아들인 것과 막힌 것**

1. **`setMemoryLimit`이 사실상 무효다.** quickjs-emscripten 0.32.0의 두 변형(ng·bellard) 모두
   `malloc_usable_size unavailable`이고, QuickJS의 회계는 그 값으로 자란다. 결과: 한 번의
   할당이 한도 전체보다 클 때만 거절되어 8MiB 한도 아래에서 VM이 **2GiB**(Emscripten 최대)까지
   자랐다. 대체는 세션마다 `WebAssembly.Memory({ initial: 256, maximum })`을 주는 것이고
   (`newVariant(variant, { wasmModule, wasmMemory })`), 그러면 32MiB 한도가 34ms에 깨끗이
   `out of memory`가 된다. 하한은 Emscripten 초기 메모리 **16MiB**다.
2. **스택 상한은 호스트가 정한다.** QuickJS의 검사는 선형 메모리의 C 스택을 보고, WASM 호출
   프레임은 호스트 스레드의 네이티브 스택에 쌓인다. 얕은 호스트 스택(tsx)에서 256KiB까지
   안전·320KiB부터 호스트 `RangeError` + 런타임 손상(`JS_FreeRuntime` 단언). 깊은 호스트
   스택(vitest 워커)에서는 256KiB도 새었다. 128KiB(깊이 약 800)는 두 환경 모두 안전.
   **플랫폼마다 다시 재야 한다**(WKWebView·Android WebView의 JS 스레드 스택).
3. **손상 뒤 폐기는 던질 수 있다.** 위 상황의 런타임은 `JS_FreeRuntime`에서 Emscripten이
   `abort`한다. 인스턴스가 세션의 것이라 참조를 놓는 것으로 끝나고, `dispose`는 그 예외를
   삼킨다(다른 세션은 영향 없음 — 실측).
4. **`Eval` 내장을 끌 수 없다**(§3).
5. **quickjs-ng의 rope 문자열**: `"x".repeat(1e6)`는 즉시 1MB를 쓰지 않는다. 메모리 검사의
   픽스처는 `new Array(125000).fill(1)`이다.
6. **네이티브에는 WebAssembly 실행 환경이 Hermes에 없다.** PoC는 시스템 WebView를 WASM
   호스트로 썼다(§8). 이것은 "동작한다"이지 "이대로 간다"가 아니다.

## 8. 플랫폼별 결과와 측정

측정은 벤치마크가 아니다 — 재앙적인 비용이 있는가만 본다. 값은 실행마다 흔들린다.

### Web (Chrome 148 · Vite 워커 · `/runtime-vm-lab`)

```text
cold session(WASM 컴파일 포함)   109 ms
warm session                     6.3 ms   (create vm 2.6 · bootstrap 3.2 · evaluate graph 0.4)
call round trip(add)             64 µs
host round trip(sync echo)       232 µs
async host round trip(setTimeout 0)  4.1 ms   ← 워커의 타이머 최소 지연이 지배한다
dispose                          0.3 ms
baseline linear memory           16.0 MiB (Emscripten 초기 메모리 = 하한)
19/19 PASS
```

### Node 22 (`pnpm --filter @rowcat/runtime-host test`)

```text
cold session 26 ms · warm 5.0 ms (create 2.8 · bootstrap 1.9 · graph 0.3)
call 16 µs · host 72 µs · async host ≈1.2 ms · dispose 0.4 ms · 19/19 PASS
```

### iOS

iPhone 17 Pro Max 시뮬레이터(iOS 26.5, Xcode 26.6) · `expo run:ios` 개발 빌드 · `/dev-tools`의
구획. 호스트는 WKWebView 안(UA: AppleWebKit/605.1.15), 능력은 Hermes가 답한다.

```text
cold session(WASM 컴파일 포함)   141 ms
warm session                     12 ms    (create vm 4 · bootstrap 6 · evaluate graph 2)
call round trip(add)             30 µs
host round trip(sync echo)       4.5 ms   ← WebView → postMessage → Hermes → injectJavaScript → WebView
async host round trip            3.8 ms   ← 같은 왕복 + setTimeout(0)
dispose                          <1 ms    (화면의 ms 해상도 아래)
baseline linear memory           16.0 MiB
19/19 PASS  (Metro 개발 번들 · 시뮬레이터라 실기기의 수는 아니다)
```

**읽는 법.** VM 안의 호출(30µs)은 웹보다 빠르고(JavaScriptCore의 WASM), 호스트 왕복(4.5ms)은
웹의 20배다 — 그 차이 전부가 WebView ↔ Hermes 다리(`postMessage`/`injectJavaScript`)이고
VM의 것이 아니다. Phase 4에서 능력 호출이 프레임마다 여러 번 일어난다면 이 다리는 그대로
쓸 수 없다(§9-1). 시뮬레이터의 수라 실기기와 다르다(대체로 실기기가 더 빠르지 않다 — 다시 잰다).

**확인된 격리 성질**(스위트 단계 그대로): 숨은 전역 17개 전부 `undefined`, 동적 코드 차단,
재귀 잡힘·세션 생존, 100ms 예산 인터럽트, 24MiB 메모리 한도, 8건 호출 한도, 대기 중 폐기,
멱등 폐기. 스택 여유(§7-2)는 WKWebView에서 128KiB로 통과했고 **그 위는 재지 않았다.**

### Android

Phase 4A에서 실행했다 — 결과·측정·스택 프로브는 `native-vm-host.md` §2에 있다. 두 질문(WASM
가용성·스택 여유)의 답은 "있다"와 "128KiB"다.

## 9. 권고 — **조건부로 진행**

QuickJS(quickjs-ng)를 Phase 4의 엔진으로 **잠정 채택**한다. 근거: 정적 ESM·순환·TLA를 그대로
지원하고, 인터럽트가 50µs 단위로 서며, 세션당 인스턴스로 메모리가 실제로 묶이고, 호출
왕복이 수십~수백 µs라 렌더 루프에 얹을 수 있다. 다만 Phase 4의 **첫 슬라이스**가 아래 셋을
먼저 답해야 한다:

1. **네이티브 실행 환경의 확정.** WebView 안의 호스트는 PoC로 충분했지만, 1MiB 생성물이
   릴리스 번들에 실리고(dev-tools 구획), 능력 왕복이 postMessage/injectJavaScript를 지나며,
   화면과 무관한 WebView가 살아 있어야 한다. 대안은 Expo 네이티브 모듈(JSI)로 QuickJS를
   **네이티브로** 묶는 것(WASM이 아니다)이거나, WebView를 실행 프로세스로 **명시적으로**
   설계하는 것이다. 어느 쪽이든 §7-2의 스택 여유를 그 환경에서 재야 한다.
2. **런타임 스텁을 생성물로.** `rowcat:runtime`은 지금 손으로 적은 스텁이고 이름만 진짜와
   같다. `@rowcat/runtime` 소스에서 VM용 JS를 **생성**해 설치해야 한다(선언 생성물과 같은
   방식). 디스패처·훅 의미는 그 위에서 온다.
3. **스케줄러.** 세션의 VM 턴은 지금 직렬이다(호스트를 기다리는 호출이 다음 호출을 막는다).
   렌더·이벤트·호스트 응답이 섞이는 Phase 4는 턴 단위 인터리빙과 우선순위를 정해야 하고,
   그때 작업 펌프의 상한(`maxJobsPerSlice`)과 예산의 단위(호출당 → 프레임당)가 함께 바뀐다.

**거절하지 않는 이유**: 발견된 한계 셋(메모리 회계·스택 상한·폐기 시 abort)은 전부
어댑터 안에서 우회됐고 세션 밖으로 새지 않는다. 엔진을 바꾸는 비용은 `vm/quickjs.ts` 한
파일이다.

## 10. 이 슬라이스에서 발견해 고친 것

- 컴파일러의 의존 표에 JSX 변환 import가 없다 → 로더가 공개 내장 셋을 이름으로 받는다.
- 두 내장이 각자 만든 심볼 → `rowcat:internal/symbols` 하나가 주인(아티팩트는 가리킬 수 없다).
- `settle()`이 확정된 약속의 값 핸들을 놓지 않았다 → `JS_FreeRuntime` 단언. 핸들의 소유를
  어댑터 안에서 `try/finally`로 닫았다.
- 그래프 평가의 결과(이름공간 객체)를 직렬화하려 했다 → 값이 필요 없는 자리는
  `promiseState(ref, slice, wantValue=false)`.

## 11. 하지 않은 것(스펙 §2 그대로)

JSX 리컨사일·컴포넌트 인스턴스·렌더링(웹·RN)·훅 디스패처·`useState`/`useEffect`·저장 상태·
이동·자산·생성·오디오·타이머·과금·발행·재생 화면·스튜디오 미리보기 실행·모더레이션·운영
샌드박스 정책. 스튜디오는 `@rowcat/runtime-host`를 import하지 않는다(경계 검사).
