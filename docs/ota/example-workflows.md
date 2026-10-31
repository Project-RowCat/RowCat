# 모바일 OTA — 예시 워크플로

**이 저장소는 워크플로를 싣지 않는다.** 호스팅 서비스가 쓰던 두 워크플로(OTA 발행 · iOS 스토어 제출)는
그 서비스의 계정·환경·비밀에 묶여 있었고, 공개본에서는 지웠다. 아래는 그 둘의 본문이다 — 포크가 자기
저장소에 옮겨 고쳐 쓰는 **본보기**이지, 이 트리에서 도는 코드가 아니다.

워크플로가 없어도 아무것도 깨지지 않는다. API의 CI 연결(`OTA_CI_GITHUB_REPOSITORY` · `OTA_CI_GITHUB_TOKEN` ·
`OTA_CI_CHANNELS`)이 비어 있으면 운영 콘솔의 `새 OTA 릴리스`·`되돌리기`는 서지 않고, 콘솔은 읽기와
비율 · 중지 · 재개만 한다. 발행과 되돌림은 키가 있는 자리에서 `pnpm mobile:update`로 한다
([`OPERATIONS.md`](./OPERATIONS.md)의 「콘솔·CI가 없을 때」).

## OTA 발행 — `.github/workflows/mobile-ota.yml`

운영 콘솔의 `새 OTA 릴리스`와 `되돌리기`의 **CI 절반**이다. 콘솔은 작업 행을 적고, API가 이 워크플로를
`workflow_dispatch`로 시작하며, 이 워크플로는 저장소에 이미 있는 발행 도구(`pnpm mobile:update publish|rollback`)를
그대로 돌린다 — YAML로 쓴 두 번째 발행 구현이 없다.

```text
운영 콘솔 ─▶ API(작업을 적고, 닫힌 입력으로 이 워크플로를 시작한다)
               ▲                        │
               └── OIDC 보고 ◀──────────┘  이 실행: 체크아웃 → 소스 확인 → started 보고 → 설치
                                                    → 발행 도구 → 결과 보고
```

### 이름과 브랜치를 바꾸지 않는다

API는 이 파일의 **경로와 브랜치를 상수로** 갖는다(`apps/api/src/services/mobile-updates/ci-trigger.ts`의
`MOBILE_UPDATE_WORKFLOW_FILE` = `mobile-ota.yml`, `MOBILE_UPDATE_WORKFLOW_BRANCH` = `main`). 디스패치가 그
이름으로 가고, CI의 보고를 믿는 근거가 OIDC 토큰의 `workflow_ref`
(`<owner>/<repo>/.github/workflows/mobile-ota.yml@refs/heads/main`)다(`apps/api/src/lib/github-actions-oidc.ts`).
다른 이름으로 두면 디스패치가 404이고, 다른 브랜치에서 돌면 보고가 거절된다. 둘을 설정으로 열지 않은 이유는
그 순간 다른 워크플로를 시작하고 그 토큰을 받아들이는 배포가 표현 가능해지기 때문이다.

### 입력이 말할 수 있는 것

모든 입력이 닫힌 값이다 — 작업 id, 채널, 플랫폼, 브랜치 이름 또는 40자 커밋, draft/5/10/100, 노트 날짜 또는
`none`, 릴리스 id. 자유 문자열이 없다: 운영자가 적은 사유는 작업 행과 감사 기록에 있다(입력은 실행 화면에 남고
셸 단계로 흘러간다). 런타임 세대 · API 오리진 · manifest의 어느 칸도 **입력이 아니다** — 런타임은 체크아웃한
`app.config.ts`(와 지문 잠금)에서, API 오리진은 그 채널의 환경에서 온다.

### 소스는 이미 `main`에 있어야 한다

발행 도구는 서명 키를 쥔 단계 안에서 저장소의 검사와 스크립트를 돌린다. 병합되지 않은 커밋은 아무도 검토하지
않은 코드이므로, 커밋 소스는 `origin/main`의 조상이어야 하고 아니면 비밀이 범위에 들어오기 **전에** `source`로
보고하고 멈춘다.

### 비밀은 발행 단계에만 있다

채널마다 GitHub 환경이 하나다(`ota-preview` · `ota-testflight` · `ota-production`). 그 환경이 그 채널의 서명 키와
대상 배포의 자격을 갖고, `Publish`/`Rollback` 단계만 `env:`로 받는다 — 체크아웃 · 소스 확인 · 보고 · 설치는 보지
못한다. `ota-production`에는 배포 브랜치 규칙(`main`만)을 걸고, 원하면 필수 검토자를 더한다.

```text
환경 비밀   ROWCAT_OTA_SIGNING_KEY · ROWCAT_OTA_S3_ACCESS_KEY_ID · ROWCAT_OTA_S3_SECRET_ACCESS_KEY · DATABASE_URL
환경 변수   ROWCAT_OTA_STORAGE · ROWCAT_OTA_S3_ENDPOINT · ROWCAT_OTA_S3_BUCKET · ROWCAT_OTA_S3_REGION ·
            ROWCAT_OTA_ASSET_BASE_URL · API_ORIGIN · ROWCAT_OTA_REPORT_URL (= <API_ORIGIN>/v2/mobile/update-jobs)
```

### 보고

실행은 보고 주소를 `aud`로 한 GitHub OIDC 토큰으로 API에 보고한다. API는 저장소, `refs/heads/main`의 이 파일,
작업의 채널과 견준 환경 이름을 대조하고 실행 id를 작업에 묶는다. `started`는 진행 여부의 답이다 — 운영자가 취소한
작업은 `proceed: false`를 답하고 이 실행은 설치 전에 멈춘다. 결과는 릴리스 id만 싣고, API는 이미 검증한 등록
표에서 그것을 다시 읽는다.

```yaml
name: Mobile OTA

on:
  workflow_dispatch:
    inputs:
      job_id:
        description: RowCat job id (the API dispatches this — do not run by hand)
        type: string
        required: true
      kind:
        type: choice
        options: [publish, rollback]
        required: true
      channel:
        type: choice
        options: [preview, testflight, production]
        required: true
      platform:
        type: choice
        options: [ios, android]
        required: true
      source:
        description: main, or a 40-character commit already on main (publish only)
        type: string
        default: ""
      rollout:
        description: draft, 5, 10 or 100 (publish only; production is draft)
        type: string
        default: ""
      note:
        description: update note date (YYYY-MM-DD) or none (publish only)
        type: string
        default: ""
      target_release:
        description: release id to roll back (rollback only)
        type: string
        default: ""
      to_embedded:
        type: choice
        options: ["false", "true"]
        default: "false"

# One run per stream at a time — the API enforces the same with a partial unique
# index; this is the second wall. Runs queue, they do not cancel each other: a
# release cut off between signing and registration leaves a state to repair by hand.
concurrency:
  group: mobile-ota-${{ inputs.channel }}-${{ inputs.platform }}
  cancel-in-progress: false

permissions:
  contents: read
  id-token: write

jobs:
  release:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    environment: ota-${{ inputs.channel }}
    env:
      JOB_ID: ${{ inputs.job_id }}
      KIND: ${{ inputs.kind }}
      CHANNEL: ${{ inputs.channel }}
      PLATFORM: ${{ inputs.platform }}
      SOURCE: ${{ inputs.source }}
      ROLLOUT: ${{ inputs.rollout }}
      NOTE: ${{ inputs.note }}
      TARGET_RELEASE: ${{ inputs.target_release }}
      TO_EMBEDDED: ${{ inputs.to_embedded }}
      REPORT_URL: ${{ vars.ROWCAT_OTA_REPORT_URL }}
      RESULT_FILE: ${{ runner.temp }}/ota-result.json
    steps:
      # Inputs are read from env, never interpolated into the script body — a value
      # interpolated with ${{ }} is shell source, an env value is data.
      - name: Validate inputs
        run: |
          set -euo pipefail
          fail() { echo "::error::$1" >&2; exit 1; }
          [ "${GITHUB_REF}" = "refs/heads/main" ] || fail "this workflow runs from main only"
          [[ "$JOB_ID" =~ ^[0-9a-f]{32}$ ]] || fail "job_id"
          [ -n "$REPORT_URL" ] || fail "ROWCAT_OTA_REPORT_URL is not set for ota-${CHANNEL}"
          if [ "$KIND" = publish ]; then
            [[ "$SOURCE" = main || "$SOURCE" =~ ^[0-9a-f]{40}$ ]] || fail "source"
            [[ "$ROLLOUT" =~ ^(draft|5|10|100)$ ]] || fail "rollout"
            if [ "$CHANNEL" = production ] && [ "$ROLLOUT" != draft ]; then fail "production registers as draft"; fi
            [[ "$NOTE" = none || "$NOTE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || fail "note"
          else
            [[ "$TARGET_RELEASE" =~ ^[0-9a-fA-F-]{8,64}$ ]] || fail "target_release"
          fi

      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
        with:
          ref: main
          fetch-depth: 0
          # Nothing is pushed. A token left in .git/config is readable by every step.
          persist-credentials: false

      - name: Resolve source
        id: source
        run: |
          set -euo pipefail
          if [ "$KIND" = publish ] && [ "$SOURCE" != main ]; then
            git cat-file -e "${SOURCE}^{commit}" || { echo "::error::commit not found"; exit 1; }
            git merge-base --is-ancestor "$SOURCE" origin/main || { echo "::error::commit is not on main"; exit 1; }
            sha="$SOURCE"
          else
            sha="$(git rev-parse origin/main)"
          fi
          git checkout --detach "$sha"
          runtime="$(sed -nE 's/^const RUNTIME_VERSION = "(rowcat-native-[0-9]+)";$/\1/p' apps/mobile/app.config.ts)"
          [[ "$runtime" =~ ^rowcat-native-[1-9][0-9]*$ ]] || { echo "::error::runtime version not readable"; exit 1; }
          echo "sha=$sha" >> "$GITHUB_OUTPUT"
          echo "runtime=$runtime" >> "$GITHUB_OUTPUT"

      # The go/no-go. A cancelled or already-failed job answers proceed=false.
      - name: Report started
        id: started
        env:
          SHA: ${{ steps.source.outputs.sha }}
          RUNTIME: ${{ steps.source.outputs.runtime }}
        run: |
          set -euo pipefail
          token="$(curl -sSf -H "Authorization: bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}" \
            "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${REPORT_URL}" | jq -r .value)"
          body="$(jq -nc --arg c "$SHA" --arg r "$RUNTIME" '{event:"started",sourceCommit:$c,runtimeVersion:$r}')"
          response="$(curl -sS --fail-with-body -X POST "${REPORT_URL}/${JOB_ID}/reports" \
            -H "Authorization: Bearer ${token}" -H 'Content-Type: application/json' --data "$body")"
          if [ "$(jq -r .proceed <<<"$response")" != "true" ]; then
            echo "proceed=false" >> "$GITHUB_OUTPUT"
            echo "::error::the API declined this job ($(jq -r .status <<<"$response")) — stopping before any secret is used"
            exit 1
          fi
          echo "proceed=true" >> "$GITHUB_OUTPUT"

      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: "22"

      - uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4.3.0

      - name: Install
        id: install
        run: pnpm install --frozen-lockfile

      # ── The only steps with secrets ───────────────────────────────────────────
      - name: Publish
        id: publish
        if: inputs.kind == 'publish'
        env:
          ROWCAT_OTA_SIGNING_KEY: ${{ secrets.ROWCAT_OTA_SIGNING_KEY }}
          ROWCAT_OTA_STORAGE: ${{ vars.ROWCAT_OTA_STORAGE }}
          ROWCAT_OTA_S3_ENDPOINT: ${{ vars.ROWCAT_OTA_S3_ENDPOINT }}
          ROWCAT_OTA_S3_BUCKET: ${{ vars.ROWCAT_OTA_S3_BUCKET }}
          ROWCAT_OTA_S3_REGION: ${{ vars.ROWCAT_OTA_S3_REGION }}
          ROWCAT_OTA_S3_ACCESS_KEY_ID: ${{ secrets.ROWCAT_OTA_S3_ACCESS_KEY_ID }}
          ROWCAT_OTA_S3_SECRET_ACCESS_KEY: ${{ secrets.ROWCAT_OTA_S3_SECRET_ACCESS_KEY }}
          ROWCAT_OTA_ASSET_BASE_URL: ${{ vars.ROWCAT_OTA_ASSET_BASE_URL }}
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          API_ORIGIN: ${{ vars.API_ORIGIN }}
          ROWCAT_RELEASE_ACTOR: ci:github-actions run ${{ github.run_id }} · job ${{ inputs.job_id }}
        run: |
          set -euo pipefail
          args=(publish "$CHANNEL" --platform "$PLATFORM" --reason "admin job $JOB_ID" --result-file "$RESULT_FILE")
          if [ "$ROLLOUT" = draft ]; then args+=(--draft); else args+=(--rollout "$ROLLOUT"); fi
          if [ "$NOTE" = none ]; then args+=(--no-note); else args+=(--note "$NOTE"); fi
          # preview binaries name their API at build time; the environment states it.
          if [ "$CHANNEL" = preview ]; then args+=(--api-origin "$API_ORIGIN"); fi
          pnpm mobile:update "${args[@]}"

      - name: Rollback
        id: rollback
        if: inputs.kind == 'rollback'
        env:
          ROWCAT_OTA_SIGNING_KEY: ${{ secrets.ROWCAT_OTA_SIGNING_KEY }}
          ROWCAT_OTA_STORAGE: ${{ vars.ROWCAT_OTA_STORAGE }}
          ROWCAT_OTA_S3_ENDPOINT: ${{ vars.ROWCAT_OTA_S3_ENDPOINT }}
          ROWCAT_OTA_S3_BUCKET: ${{ vars.ROWCAT_OTA_S3_BUCKET }}
          ROWCAT_OTA_S3_REGION: ${{ vars.ROWCAT_OTA_S3_REGION }}
          ROWCAT_OTA_S3_ACCESS_KEY_ID: ${{ secrets.ROWCAT_OTA_S3_ACCESS_KEY_ID }}
          ROWCAT_OTA_S3_SECRET_ACCESS_KEY: ${{ secrets.ROWCAT_OTA_S3_SECRET_ACCESS_KEY }}
          ROWCAT_OTA_ASSET_BASE_URL: ${{ vars.ROWCAT_OTA_ASSET_BASE_URL }}
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          API_ORIGIN: ${{ vars.API_ORIGIN }}
          ROWCAT_RELEASE_ACTOR: ci:github-actions run ${{ github.run_id }} · job ${{ inputs.job_id }}
        run: |
          set -euo pipefail
          args=(rollback "$TARGET_RELEASE" --reason "admin job $JOB_ID" --result-file "$RESULT_FILE")
          if [ "$TO_EMBEDDED" = true ]; then args+=(--to-embedded); fi
          pnpm mobile:update "${args[@]}"

      # ── Reports ───────────────────────────────────────────────────────────────
      # After `started` succeeded: the result of the release tool. Before it: only the
      # source check can have failed (a declined `started` reports nothing — the job is
      # already terminal on the API side).
      - name: Report result
        if: always() && (steps.started.outputs.proceed == 'true' || steps.source.outcome == 'failure')
        env:
          SOURCE_OUTCOME: ${{ steps.source.outcome }}
          INSTALL_OUTCOME: ${{ steps.install.outcome }}
          RELEASE_OUTCOME: ${{ inputs.kind == 'publish' && steps.publish.outcome || steps.rollback.outcome }}
        run: |
          set -uo pipefail
          if [ "$SOURCE_OUTCOME" = failure ]; then
            body='{"event":"failed","stage":"source"}'
          elif [ "$INSTALL_OUTCOME" != success ]; then
            body='{"event":"failed","stage":"install"}'
          elif [ "$RELEASE_OUTCOME" = success ] && [ -f "$RESULT_FILE" ] && [ "$(jq -r .ok "$RESULT_FILE")" = true ]; then
            body="$(jq -c '{event:"succeeded",releaseIds:[.releases[].id]}' "$RESULT_FILE")"
          else
            stage="unknown"
            if [ -f "$RESULT_FILE" ]; then stage="$(jq -r '.stage // "unknown"' "$RESULT_FILE")"; fi
            body="$(jq -nc --arg s "$stage" '{event:"failed",stage:$s}')"
          fi
          token="$(curl -sSf -H "Authorization: bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}" \
            "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${REPORT_URL}" | jq -r .value)"
          # Retried: a lost report leaves the job to the API's reconciliation (which never
          # invents a result), so it is worth a few attempts here.
          curl -sS --fail-with-body --retry 5 --retry-all-errors --retry-delay 5 \
            -X POST "${REPORT_URL}/${JOB_ID}/reports" \
            -H "Authorization: Bearer ${token}" -H 'Content-Type: application/json' --data "$body"
```

## iOS 스토어 제출 — 수동 워크플로

서명된 IPA를 App Store Connect(TestFlight)에 올리는 수동 워크플로였다. 올리는 일은
`apps/mobile/scripts/submit-ios.mjs`가 한다(Build Upload REST API, App Store Connect API 키 인증 — Xcode 없이
ubuntu에서 돈다). IPA의 출처는 둘이다: GitHub 릴리스 자산으로 올려 둔 IPA(`release-tag`, EAS 불필요)와 EAS 빌드
산출물(`build-id`, 비우면 마지막으로 끝난 iOS 스토어 빌드 — `EXPO_TOKEN` 필요).

⚠️ **전달용 릴리스는 초안(draft)으로 만든다**(`gh release create <태그> --draft RowCat.ipa`). 데스크톱 앱이 있는
저장소에서는 공개된 릴리스가 「최신」이 되는 순간 설치된 모든 데스크톱 앱의 업데이트 대상이 된다
(`apps/desktop/README.md`). 초안은 그 자리에 오르지 않고, 워크플로의 토큰으로는 그대로 받을 수 있다. 같은 이유로
지우는 단계는 업로드가 실패해도 돈다.

⚠️ 이 워크플로는 **기록이지 관문이 아니다.** 누가 올렸는지는 `workflow_dispatch`의 실행자가 남기지만, 그 IPA를
지은 커밋이 무엇을 통과했는지는 아무것도 확인하지 않는다. 그 스크립트는 `GITHUB_ACTIONS`가 아닌 곳에서의
업로드를 `--acknowledge-ungated "<사유>"` 없이 거절한다.

```text
저장소 비밀   ASC_KEY_ID · ASC_ISSUER_ID · ASC_API_KEY_BASE64(AuthKey_<KEY_ID>.p8의 base64) · EXPO_TOKEN(EAS 경로만)
```

```yaml
name: Mobile Submit iOS (manual)

on:
  workflow_dispatch:
    inputs:
      release-tag:
        description: Transfer release tag holding a prebuilt .ipa (overrides build-id)
        type: string
        required: false
        default: ""
      short-version:
        description: CFBundleShortVersionString of the IPA (required with release-tag)
        type: string
        required: false
        default: ""
      build-version:
        description: CFBundleVersion of the IPA (required with release-tag)
        type: string
        required: false
        default: ""
      build-id:
        description: EAS build ID to submit (blank = latest finished iOS store build)
        type: string
        required: false
        default: ""

concurrency:
  group: mobile-submit-ios
  cancel-in-progress: false

# contents:write so the transfer release (and its tag) can be deleted after upload.
permissions:
  contents: write

jobs:
  submit:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: apps/mobile
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0

      # Pinned here rather than read from a .node-version file: this repo has no
      # such file, and adding one to satisfy a workflow would make the workflow
      # the reason a version lives in the tree.
      - name: Install Node.js
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: "22"

      # Everything below is EAS-path only. The release-tag path downloads an
      # artifact with `gh` and uploads it with node builtins, so it needs neither
      # pnpm nor the eas CLI nor an install.
      - name: Install pnpm
        if: inputs.release-tag == ''
        uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4.3.0

      - name: Setup EAS
        if: inputs.release-tag == ''
        uses: expo/expo-github-action@c7b66a9c327a43a8fa7c0158e7f30d6040d2481e # v8.2.1
        with:
          eas-version: latest
          token: ${{ secrets.EXPO_TOKEN }}

      # The script shells out to `eas build:list`/`build:view`, which evaluate the
      # Expo app config (app.config.ts plugins → expo-router) and fail with
      # "Failed to resolve plugin for module expo-router" if node_modules is
      # absent. Only @rowcat/mobile and its workspace deps are needed; skip
      # web/admin/ui and their trees.
      - name: Install dependencies
        if: inputs.release-tag == ''
        run: pnpm install --frozen-lockfile --filter "@rowcat/mobile..."
        working-directory: ${{ github.workspace }}

      - name: Download IPA from transfer release
        if: inputs.release-tag != ''
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          if [ -z "${{ inputs.short-version }}" ] || [ -z "${{ inputs.build-version }}" ]; then
            echo "::error::release-tag also requires short-version and build-version" >&2
            exit 1
          fi
          gh release download "${{ inputs.release-tag }}" --pattern '*.ipa' --output RowCat-local.ipa

      - name: Upload to App Store Connect
        env:
          ASC_KEY_ID: ${{ secrets.ASC_KEY_ID }}
          ASC_ISSUER_ID: ${{ secrets.ASC_ISSUER_ID }}
          ASC_API_KEY_BASE64: ${{ secrets.ASC_API_KEY_BASE64 }}
        run: |
          if [ -n "${{ inputs.release-tag }}" ]; then
            node scripts/submit-ios.mjs --path RowCat-local.ipa \
              --short-version "${{ inputs.short-version }}" --build-version "${{ inputs.build-version }}"
          elif [ -n "${{ inputs.build-id }}" ]; then
            node scripts/submit-ios.mjs --build-id "${{ inputs.build-id }}"
          else
            node scripts/submit-ios.mjs
          fi

      - name: Delete transfer release
        if: always() && inputs.release-tag != ''
        env:
          GH_TOKEN: ${{ github.token }}
        run: gh release delete "${{ inputs.release-tag }}" --cleanup-tag --yes
```
