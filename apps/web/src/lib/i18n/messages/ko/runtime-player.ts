import type { Messages } from "../../types.ts";

export const runtimePlayer: Messages["runtimePlayer"] = {
	player: {
		loading: "작품을 불러오는 중…",
		syncing: "저장된 진행을 확인하는 중…",
		starting: "작품을 시작하는 중…",
		creatorError:
			"이 작품을 실행하는 중 문제가 발생했습니다. 다시 시작하거나 나중에 다시 시도해 주세요.",
		failed: "작품을 실행하지 못했습니다. 다시 시작해 주세요.",
		transitionBlocked:
			"진행 상황을 저장하지 못해 이어서 시작할 수 없습니다. 저장을 다시 시도해 주세요.",
		incompatible: "이 작품을 플레이하려면 앱을 업데이트해 주세요.",
		unavailable: "이 작품을 지금 플레이할 수 없습니다.",
		retry: "다시 시작",
		storyDetail: "작품 정보",
		storyDetailLink: "작품 정보 보기",
		viewportTitle: "플레이",
		saveFailed: "진행 상황을 저장하지 못했습니다.",
		saveFailedBody:
			"플레이는 계속할 수 있습니다. 지금까지의 진행은 아직 이 기기에 저장되지 않았습니다.",
		saveRetry: "다시 저장",
		resetPlaythrough: "플레이 초기화",
		resetTitle: "플레이를 처음부터 시작할까요?",
		resetDescription:
			"이번 플레이의 진행만 지워집니다. 여러 회차에 걸쳐 쌓인 기록은 그대로 남습니다.",
		resetConfirm: "처음부터 시작",
		cancel: "취소",
		generationSettings: "생성 설정",
	},
	ai: {
		title: "이 작품은 AI 생성을 사용합니다.",
		body: "작품 안에서 상호작용할 때 지금의 AI 설정으로 생성 요청이 실행됩니다. 이 서버의 기본 AI를 쓰고 있다면 이 서버로, 직접 연결한 제공자를 쓰고 있다면 그쪽으로 요청이 나가며 그 계정에 비용이 청구될 수 있습니다.",
		allow: "AI 사용 허용하고 플레이",
		deny: "AI 없이 플레이",
		note: "이 선택은 지금 플레이에만 적용됩니다.",
	},
	audio: {
		activate: "소리 재생",
	},
};
