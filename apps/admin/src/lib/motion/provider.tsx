import { domMax, LazyMotion, MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/**
 * The motion runtime, once for the app: accessibility policy, feature bundle and strict mode. Other
 * global providers do not go here, or this file stops saying what was turned on.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
	return (
		/**
		 * The OS decides reduced motion; watching matchMedia ourselves would duplicate Motion. `user`
		 * removes movement only: transforms land at their final value, opacity still flows, and state
		 * changes happen at the same moment either way.
		 */
		<MotionConfig reducedMotion="user">
			{/*
			 * `domMax` because the sidebar indicator needs layout projection (`layoutId`), which
			 * `domAnimation` lacks. It also carries drag, which this app does not use; there is no
			 * public layout-only bundle, and for an internal tool the bytes are acceptable.
			 *
			 * Not lazy-loaded: until features arrive, `m` elements sit at `initial` (opacity 0), so the
			 * first screen would appear one bundle late.
			 *
			 * `strict` throws the moment a screen imports `motion.div` (the full API), which would
			 * silently void this bundle decision. Product code uses `import * as m from
			 * "motion/react-m"`, and `lib/boundaries.test.ts` scans for it too.
			 */}
			<LazyMotion features={domMax} strict>
				{children}
			</LazyMotion>
		</MotionConfig>
	);
}
