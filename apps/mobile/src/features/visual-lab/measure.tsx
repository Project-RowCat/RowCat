import { space } from "@rowcat/design";
import {
	formatLabMeasurement,
	VISUAL_LAB_MEASURED,
	VISUAL_LAB_MEASURED_LABEL,
	type VisualLabMeasuredCase,
} from "@rowcat/design/visual-lab";
import { Text } from "@rowcat/ui-native";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import { type LayoutChangeEvent, StyleSheet, View } from "react-native";

/**
 * Measurement: the layer that answers questions screenshots cannot answer.
 *
 * Side by side, two apps show large misalignments but not 2pt ones. The misalignment this repo
 * actually hit was that size (an input was 8pt taller than its sibling controls), and that kind
 * accumulates down the screen, by which point no single component can be named as the cause.
 *
 * ## `onLayout` is the only authority
 *
 * Arithmetic on the source is not the answer. A component declared `minHeight: 36` really renders
 * at 44 (line spacing, padding and border exceed that value), and that only shows up when measured
 * on a device. So this file computes nothing: it keeps the values the platform reports after
 * layout.
 *
 * ## Values are drawn on screen, not logged
 *
 * The product path has no `console` calls (`lib/boundaries.test.ts`), and the lab has no reason to
 * be an exception. Values drawn on screen also stay in the screenshot: measurement and drawing are
 * facts of the same frame, so there is no place where they can diverge later.
 *
 * ## The wrapping View is what gets measured
 *
 * Most primitives do not accept `onLayout` (`Button` takes only a `style`), so one wrapper View is
 * added. The wrapper adds no geometry: no padding, no border, and by default `alignSelf:
 * flex-start`, so it inherits the child's intrinsic size. Only controls that fill the line (the
 * input) open up with `stretch`; then the width comes from the parent and what is read is height.
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
	 * Skip the update when the value is unchanged. `onLayout` runs again on rotation, font scale and
	 * parent relayout; inserting a new object each time would re-render this tree, and that re-render
	 * calls `onLayout` again.
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
	return (
		<MeasureContext.Provider value={value}>{children}</MeasureContext.Provider>
	);
}

export function Measured({
	id,
	stretch,
	children,
}: {
	id: VisualLabMeasuredCase;
	/** Controls that fill the line. Width comes from the parent; the value read is height. */
	stretch?: boolean;
	children: ReactNode;
}) {
	const context = useContext(MeasureContext);
	const onLayout = useCallback(
		(event: LayoutChangeEvent) => {
			const { width, height } = event.nativeEvent.layout;
			context?.report(id, width, height);
		},
		[context, id],
	);
	return (
		<View onLayout={onLayout} style={stretch ? null : measure.hug}>
			{children}
		</View>
	);
}

/**
 * Table of measured values: evidence that stays in the screenshot.
 *
 * Cases not yet measured stay as `—`. Removing them would make "the row is absent" and "the lab
 * does not draw this case" look identical, and the latter is a coverage hole.
 */
export function MeasurementReadout() {
	const context = useContext(MeasureContext);
	return (
		<View style={measure.table}>
			{VISUAL_LAB_MEASURED.map((id) => {
				const size = context?.sizes[id];
				return (
					<View key={id} style={measure.row}>
						<Text
							variant="caption"
							tone="muted-foreground"
							style={measure.name}
						>
							{VISUAL_LAB_MEASURED_LABEL[id]}
						</Text>
						<Text variant="caption" style={measure.value}>
							{size ? formatLabMeasurement(size.width, size.height) : "—"}
						</Text>
					</View>
				);
			})}
		</View>
	);
}

const measure = StyleSheet.create({
	hug: { alignSelf: "flex-start" },
	table: { gap: space.xs },
	row: { flexDirection: "row", gap: space.sm },
	name: { width: 96 },
	value: { flexShrink: 1 },
});
