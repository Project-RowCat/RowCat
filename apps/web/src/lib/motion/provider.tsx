import { domMax, LazyMotion, MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/**
 * Runtime for product motion, mounted once for the whole app.
 *
 * It holds three things only: the accessibility policy, the feature bundle, and strict mode that
 * enforces the bundle. Nothing else global (queries, chat scope) is added here. Once it becomes a
 * provider registry, this file no longer shows what is enabled.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
	return (
		/**
		 * The operating system decides reduced motion. Watching matchMedia directly would leave the
		 * server render without that value, so the first screen would mismatch, and it would duplicate
		 * what Motion already does.
		 *
		 * reducedMotion="user" does not turn animation off. It turns off movement only: transforms
		 * (scale, y) snap to their final values and opacity still flows. The state change itself happens
		 * at the same moment either way, since motion does not hold the state.
		 */
		<MotionConfig reducedMotion="user">
			{/*
			 * Upgraded from domAnimation to domMax, because surfaces now use layout features (layout and
			 * layoutId). Four surfaces need them:
			 * - the sidebar's active highlights move between siblings (layoutId)
			 * - conversation and draft lists reflow after sort, search or delete
			 * - the editor's child list shows where an add, delete or reorder happened
			 *
			 * The cost: domMax is domAnimation plus drag and layout projection (framer-motion's
			 * features-max), so the first screen gets heavier. Drag comes along unused because there is no
			 * public layout-only bundle. The four surfaces justify that cost. The size increase is
			 * documented in docs/motion/ARCHITECTURE.md.
			 *
			 * Lazy loading (features={() => import(...)}) was rejected. Until features arrive, an m element
			 * sits at its initial value (opacity 0), so the first screen would appear one bundle late. That
			 * is the same failure PageEnter avoids on hydration.
			 *
			 * Strict mode stays on so the decision cannot fail silently. If any feature imports the full
			 * motion.div API, the bundle decision becomes meaningless, and nothing shows that until it runs.
			 * Strict mode throws at that moment. Product code uses only import * as m from "motion/react-m".
			 */}
			<LazyMotion features={domMax} strict>
				{children}
			</LazyMotion>
		</MotionConfig>
	);
}
