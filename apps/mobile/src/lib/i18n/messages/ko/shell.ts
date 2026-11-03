import type { Messages } from "../../types.ts";

export const shell: Messages["shell"] = {
	section: {
		discover: "발견",
		chat: "대화",
		create: "만들기",
	},
	sidebar: {
		title: "주요 탐색",
		trigger: "주요 탐색 열기",
		brandHint: "발견으로 이동합니다",
		recentHeading: "최근 대화",
		allChats: "모든 대화",
		recentEmpty: "아직 대화가 없습니다",
		recentError: "대화를 불러오지 못했습니다",
	},
	header: {
		checkSession: "세션 확인",
		checking: "확인 중",
		localDataFailed:
			"이 기기의 데이터를 열지 못했습니다. 작품 보기에는 영향이 없습니다.",
	},
};
