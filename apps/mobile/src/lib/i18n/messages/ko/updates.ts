import type { Messages } from "../../types.ts";

export const updates: Messages["updates"] = {
	empty: "아직 업데이트 안내가 없습니다.",
	title: "{{date}} 업데이트 안내",
	hint: "이 릴리스의 업데이트 안내를 엽니다",
	ok: "확인",
	section: {
		additions: "새로운 기능",
		improvements: "개선 사항",
		fixes: "수정 사항",
		notices: "참고 사항",
	},
	unseen: ", 새로운 업데이트 있음",
};
