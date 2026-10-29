import type { Messages } from "../../types.ts";

export const profile: Messages["profile"] = {
	blocked: {
		title: "차단한 제작자입니다",
		body: "이 제작자의 작품과 댓글은 회원님 화면에 표시되지 않습니다. 위 메뉴에서 차단을 해제할 수 있습니다.",
	},
	loading: "프로필을 불러오는 중입니다",
	error: {
		notFound: "프로필을 찾을 수 없습니다",
		loadFailed: "프로필을 불러오지 못했습니다",
		notFoundBody: "존재하지 않거나 현재 볼 수 없는 프로필입니다.",
		retryLater: "잠시 후 다시 시도해 주세요.",
		backToDiscover: "발견으로 돌아가기",
		requestId: "요청 ID: {{id}}",
	},
	empty: {
		title: "아직 공개한 작품이 없습니다",
		body: "발행한 작품이 공개되면 여기에 표시됩니다.",
		goCreate: "만들기로 가기",
	},
	pinned: "대표작",
	publicWorks: "공개 작품",
	followers: "팔로워",
	edit: "프로필 편집",
};
