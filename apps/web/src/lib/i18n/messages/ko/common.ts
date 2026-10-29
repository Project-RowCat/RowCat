import type { Messages } from "../../types.ts";

export const common: Messages["common"] = {
	actions: {
		cancel: "취소",
		close: "닫기",
		confirm: "확인",
		copy: "복사",
		copied: "복사됨",
		retry: "다시 시도",
		save: "저장",
		delete: "삭제",
	},
	time: {
		justNow: "방금",
	},
	state: {
		loading: "불러오는 중…",
		checking: "확인 중…",
	},
};
