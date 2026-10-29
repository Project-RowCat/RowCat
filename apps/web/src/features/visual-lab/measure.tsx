import {
	formatLabMeasurement,
	VISUAL_LAB_MEASURED,
	VISUAL_LAB_MEASURED_LABEL,
	type VisualLabMeasuredCase,
} from "@rowcat/design/visual-lab";
import {
	createContext,
	type ReactNode,
	use,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

/**
 * Measures at runtime, doing the same job as the native lab's layer. Both labs use the same case
 * names and report the same shape of number, so the two ledger columns can be compared
 * (`@rowcat/design/visual-lab` holds the names and notation). This side reads
 * `getBoundingClientRect`; native reads `onLayout`. Both report values the platform produces after
 * layout, so they answer the same question.
 *
 * It does not answer from the source's class names. `h-9` in source does not mean the element
 * renders at 36px: parent flex, `min-h`, text size, and browser form-control defaults all layer on
 * top. Native `minHeight: 36` rendering at 44 is the same trap, so both sides ask the runtime
 * instead of the source.
 *
 * Dev-only. This layer uses a `ResizeObserver` and holds state. In a product screen every row would
 * get its own observer, so the lab owns the one instance.
 */

type Sizes = Partial<
	Record<VisualLabMeasuredCase, { width: number; height: number }>
>;

const MeasureContext = createContext<{
	sizes: Sizes;
	report: (id: VisualLabMeasuredCase, width: number, height: number) => void;
} | null>(null);

export function MeasureProvider({ children }: { children: ReactNode }) {
	const [sizes, setSizes] = useState<Sizes>({});

	/**
	 * Same value means no state change. This stops the observer's own update from triggering another
	 * update.
	 */
	const report = useCallback(
		(id: VisualLabMeasuredCase, width: number, height: number) => {
			setSizes((current) => {
				const previous = current[id];
				if (previous?.width === width && previous.height === height)
					return current;
				return { ...current, [id]: { width, height } };
			});
		},
		[],
	);

	const value = useMemo(() => ({ sizes, report }), [sizes, report]);
	return <MeasureContext value={value}>{children}</MeasureContext>;
}

export function Measured({
	id,
	stretch,
	children,
}: {
	id: VisualLabMeasuredCase;
	/** A control that fills its row. Width comes from the parent, so the measured value is height. */
	stretch?: boolean;
	children: ReactNode;
}) {
	const context = use(MeasureContext);
	const report = context?.report;
	const node = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const element = node.current;
		if (!element || !report) return;
		/**
		 * Measures the child, not a wrapper. The wrapper is a plain box (not `display: contents`) with
		 * its own geometry; under `stretch` its width comes from the parent, so it cannot say the
		 * control's real width. The child's box is the value being asked for.
		 */
		const target = element.firstElementChild ?? element;
		const observer = new ResizeObserver(() => {
			const box = target.getBoundingClientRect();
			report(id, box.width, box.height);
		});
		observer.observe(target);
		const box = target.getBoundingClientRect();
		report(id, box.width, box.height);
		return () => observer.disconnect();
	}, [id, report]);

	return (
		<div ref={node} className={stretch ? "block w-full" : "w-fit"}>
			{children}
		</div>
	);
}

/**
 * The table of measured values stays with the screenshot as evidence. Cases not yet measured show
 * `—`. Removing them would make 'the row is absent' and 'the lab does not draw this case' look the
 * same.
 */
export function MeasurementReadout() {
	const context = use(MeasureContext);
	return (
		<div className="flex flex-col gap-1">
			{VISUAL_LAB_MEASURED.map((id) => {
				const size = context?.sizes[id];
				return (
					<div key={id} className="flex gap-2 text-xs">
						<span className="w-24 shrink-0 text-muted-foreground">
							{VISUAL_LAB_MEASURED_LABEL[id]}
						</span>
						<span>
							{size ? formatLabMeasurement(size.width, size.height) : "—"}
						</span>
					</div>
				);
			})}
		</div>
	);
}
