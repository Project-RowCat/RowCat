import type { Messages } from "../../types.ts";

export const chatLibrary: Messages["chatLibrary"] = {
	title: "대화",
	sort: { recent: "최근 활동순", oldest: "오래된 활동순", title: "이름순" },
	unavailableTitle: "대화를 열 수 없습니다",
	unavailableBody:
		"대화는 계정별로 이 기기에 저장됩니다. 다시 로그인하면 그대로 있습니다.",
	signIn: "로그인",
	noResultsTitle: "검색 결과가 없습니다",
	noResultsBody: "대화 이름으로만 검색합니다. 메시지 내용은 찾지 않습니다.",
	clearSearch: "검색어 지우기",
	showMore: "더 보기",
	emptyTitle: "아직 대화가 없습니다",
	emptyBody:
		"작품을 발견하고 대화를 시작해 보세요. 시작한 대화는 이 기기에 저장됩니다.",
	discover: "작품 발견하기",
	searchLabel: "대화 검색",
	searchPlaceholder: "대화 이름 검색",
	sortLabel: "정렬 기준",
	count_one: "{{formatted}}개의 대화",
	count_other: "{{formatted}}개의 대화",
	loading: "대화 목록을 불러오는 중입니다",
	runtime: {
		remove: "목록에서 제거",
		manage: "{{title}} 목록 관리",
		untitled: "제목 없는 작품",
		kind: "런타임 작품",
		removeFailed: "목록에서 제거하지 못했습니다. 다시 시도해 주세요.",
	},
};
