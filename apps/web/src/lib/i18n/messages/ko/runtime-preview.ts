import type { Messages } from "../../types.ts";

export const runtimePreview: Messages["runtimePreview"] = {
	preview: {
		run: "미리보기 실행",
		restart: "다시 시작",
		stop: "중지",
		resetPlaythrough: "플레이 초기화",
		resetPlaythroughHint:
			"저장된 진행을 비우고 처음부터 시작합니다. 긴 진행(definePersistentState)은 그대로 남고, 다시 시작은 둘 다 이어받습니다.",
		resetPersistent: "긴 진행 초기화",
		resetPersistentHint:
			"definePersistentState로 선언한 값을 비웁니다. 미리보기 메모리만 지우고, 플레이 초기화와는 다른 조작입니다.",
		restartAfterFailure: "미리보기 다시 시작",
		idleTitle: "아직 실행하지 않았습니다",
		idleBody:
			"실행을 누르면 코드가 컴파일되어 격리된 VM에서 돌고, 그 화면이 여기 그려집니다.",
		notEligible: "문제를 먼저 고쳐야 실행할 수 있습니다.",
		compiling: "컴파일하는 중…",
		starting: "런타임을 시작하는 중…",
		stopping: "정리하는 중…",
		stale: "변경사항 있음",
		staleBody:
			"지금 화면은 이전 코드로 돌고 있습니다. 다시 시작하면 새 코드로 돌되 저장된 진행은 그대로 이어집니다.",
		renderError: "렌더링 중 오류가 발생했습니다.",
		effectError: "효과를 실행하는 중 오류가 발생했습니다.",
		eventError: "이벤트를 처리하는 중 오류가 발생했습니다.",
		previousKept: "마지막으로 그린 화면이 그대로 남아 있습니다.",
		failedCompile: "컴파일에 실패했습니다.",
		failedStart: "런타임을 시작하지 못했습니다.",
		failedRuntime: "런타임이 멈췄습니다.",
		failedRenderer: "미리보기를 그리지 못했습니다.",
		failedWorker: "미리보기 워커가 응답하지 않습니다.",
		failedRuntimeBody:
			"VM이 더 이어 갈 수 없는 상태입니다. 다시 시작하면 처음부터 돕니다.",
		failedRendererBody:
			"호스트와 화면이 같은 트리를 말하지 않습니다. 다시 시작하면 빈 화면에서 돕니다.",
		consoleEmpty: "실행 중의 console 출력과 런타임 진단이 여기 모입니다.",
		consoleClear: "콘솔 비우기",
		diagnosticLabel: "진단",
		stateEmpty:
			"defineStoryState·definePersistentState로 선언한 값이 여기 모입니다. 아직 선언된 저장 상태가 없습니다.",
		statePlaythroughHint: "플레이 초기화가 비우는 값입니다.",
		statePersistentHint: "플레이 초기화를 넘어 남는 값입니다.",
		stateScope:
			"이 진행은 스튜디오가 열려 있는 동안만 남습니다. 새로고침하면 처음부터입니다.",
		generationToggle: "AI 사용",
		generationHint:
			"켜면 다음 실행부터 useGeneration()이 실제 모델을 부릅니다. 실제 대화와 같은 요금이 청구됩니다.",
		generationPending: "다시 시작하면 AI가 켜집니다.",
		generationActive: "AI 켜짐",
		consoleDropped_one: "오래된 {{count}}줄을 지웠습니다.",
		consoleDropped_other: "오래된 {{count}}줄을 지웠습니다.",
	},
	debug: {
		runWithReset: "플레이 초기화와 함께 실행했다",
		runWithPersistentReset: "긴 진행 초기화와 함께 실행했다",
		runStarted: "실행을 시작했다",
		sessionStarted: "세션이 섰다",
		commit_one: "커밋 #{{revision}} (패치 {{count}}개)",
		commit_other: "커밋 #{{revision}} (패치 {{count}}개)",
		commands_one: "조종 명령 {{count}}개",
		commands_other: "조종 명령 {{count}}개",
		saveStory_one: "플레이스루 저장 ({{count}}개 변경)",
		saveStory_other: "플레이스루 저장 ({{count}}개 변경)",
		savePersistent_one: "긴 진행 저장 ({{count}}개 변경)",
		savePersistent_other: "긴 진행 저장 ({{count}}개 변경)",
		migration: "마이그레이션: {{key}} v{{from}} → v{{to}}",
		exception: "{{work}}에서 예외: {{name}}",
		generationRequested: "창작 코드가 생성을 요청했다",
		sessionFailed: "세션이 서지 못했다 ({{stage}})",
		compileFailed: "컴파일이 통과하지 못했다",
		sessionStopped_one: "세션이 멈췄다 (정리 {{count}}개)",
		sessionStopped_other: "세션이 멈췄다 (정리 {{count}}개)",
		generationReturned: "생성 결과가 돌아갔다",
		generationRefused: "생성이 거절됐다 ({{reason}})",
	},
	format: {
		more: "… {{count}}개 더",
		moreShort: "… {{count}}개",
		truncated: "(잘림)",
	},
};
