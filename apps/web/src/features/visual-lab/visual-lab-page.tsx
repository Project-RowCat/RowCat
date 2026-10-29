import {
	VISUAL_LAB_BADGES,
	VISUAL_LAB_TEXT,
	VISUAL_LAB_TYPE_ROWS,
	type VisualLabTypeRow,
} from "@rowcat/design/visual-lab";
import { Badge } from "@rowcat/ui-web/components/badge";
import { Button } from "@rowcat/ui-web/components/button";
import { Card, CardContent } from "@rowcat/ui-web/components/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@rowcat/ui-web/components/dropdown-menu";
import { Input } from "@rowcat/ui-web/components/input";
import { Label } from "@rowcat/ui-web/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@rowcat/ui-web/components/select";
import { Separator } from "@rowcat/ui-web/components/separator";
import { Switch } from "@rowcat/ui-web/components/switch";
import { Textarea } from "@rowcat/ui-web/components/textarea";
import { CheckIcon, MoreHorizontalIcon, SettingsIcon } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Measured, MeasurementReadout, MeasureProvider } from "./measure.tsx";
import { MotionLab } from "./motion-lab.tsx";
import { OverlayLab } from "./overlay-lab.tsx";

/**
 * Visual QA lab, meant to sit side by side with the same lab on native. Section order and names
 * match native, so two screenshots line up row by row.
 *
 * All controls are product primitives from @rowcat/ui-web. Lab-only CSS copied from native values
 * would make the page prove the copy, not the product.
 *
 * It lives outside the (app) group on purpose. The app shell adds sidebar, header, footer, and
 * viewer lookups that need the API and a session.
 *
 * The page is capped at 390px (max-w-[390px]) because phone width is the comparison target. Some
 * web primitives change only below 768px (Input's text-base md:text-sm gives 16px there).
 */
export function VisualLabPage() {
	return (
		<MeasureProvider>
			<div className="mx-auto flex w-full max-w-[390px] flex-col gap-6 bg-background pb-16 text-foreground">
				<Measured id="app-bar" stretch>
					<header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-1 border-b bg-background/85 px-3 backdrop-blur">
						<span className="flex-1 truncate text-base font-semibold">
							Visual Lab
						</span>
						<Button variant="ghost" size="icon" aria-label="Sample button">
							<SettingsIcon />
						</Button>
					</header>
				</Measured>

				<div className="flex flex-col gap-6 px-4">
					<Section title="Measured">
						<MeasurementReadout />
					</Section>

					<Section title="Typography">
						{VISUAL_LAB_TYPE_ROWS.map((row) => (
							<p key={row} className={TYPE_ROW[row]}>
								{row} · {VISUAL_LAB_TEXT.mixed}
							</p>
						))}
						<p className="text-sm">{VISUAL_LAB_TEXT.latin}</p>
						<p className="text-sm">{VISUAL_LAB_TEXT.hangul}</p>
						<p className="text-sm">{VISUAL_LAB_TEXT.paragraph}</p>
						<p className="text-sm leading-7">{VISUAL_LAB_TEXT.paragraph}</p>
						<div className="flex flex-wrap items-center gap-2">
							<span className="text-sm font-normal">Regular 400</span>
							<span className="text-sm font-medium">Medium 500</span>
							<span className="text-sm font-semibold">Semibold 600</span>
							<span className="text-sm font-bold">Bold 700</span>
						</div>
					</Section>

					{/**
					 * This is the most important line in this lab, for the same reason as on native.
					 * With three controls side by side, a height difference shows as a misaligned row
					 * rather than as an absolute value.
					 */}
					<Section title="Adjacency (input · select · button)">
						<div className="flex items-center gap-2">
							<Measured id="input" stretch>
								<Input
									aria-label={VISUAL_LAB_TEXT.fieldLabel}
									defaultValue={VISUAL_LAB_TEXT.fieldValue}
								/>
							</Measured>
							<Measured id="select-trigger">
								<Select defaultValue="save">
									<SelectTrigger aria-label={VISUAL_LAB_TEXT.selectLabel}>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="save">
											{VISUAL_LAB_TEXT.actionLatin}
										</SelectItem>
									</SelectContent>
								</Select>
							</Measured>
							<Measured id="button-md">
								<Button>{VISUAL_LAB_TEXT.action}</Button>
							</Measured>
						</div>
					</Section>

					<Section title="Buttons">
						<div className="flex flex-wrap items-center gap-2">
							<Button>{VISUAL_LAB_TEXT.action}</Button>
							<Button variant="secondary">
								{VISUAL_LAB_TEXT.secondaryAction}
							</Button>
							<Button variant="outline">{VISUAL_LAB_TEXT.actionLatin}</Button>
						</div>
						<div className="flex flex-wrap items-center gap-2">
							<Button variant="ghost">{VISUAL_LAB_TEXT.actionLatin}</Button>
							<Button variant="destructive">
								{VISUAL_LAB_TEXT.destructiveAction}
							</Button>
						</div>
						<div className="flex flex-wrap items-center gap-2">
							<Measured id="button-sm">
								<Button size="sm">{VISUAL_LAB_TEXT.action}</Button>
							</Measured>
							<Measured id="button-lg">
								<Button size="lg">{VISUAL_LAB_TEXT.action}</Button>
							</Measured>
						</div>
						<div className="flex flex-wrap items-center gap-2">
							<Button>
								<CheckIcon />
								{VISUAL_LAB_TEXT.action}
							</Button>
							<Button disabled>{VISUAL_LAB_TEXT.action}</Button>
						</div>
						<div className="flex flex-wrap items-center gap-2">
							<Measured id="icon-button">
								<Button variant="ghost" size="icon" aria-label="Sample button">
									<MoreHorizontalIcon />
								</Button>
							</Measured>
							<Button variant="link">{VISUAL_LAB_TEXT.actionLatin}</Button>
						</div>
					</Section>

					<Section title="Inputs">
						<LabelledInput placeholder={VISUAL_LAB_TEXT.fieldPlaceholder} />
						<LabelledInput defaultValue={VISUAL_LAB_TEXT.fieldValue} />
						<LabelledInput defaultValue={VISUAL_LAB_TEXT.fieldValue} invalid />
						<LabelledInput defaultValue={VISUAL_LAB_TEXT.fieldValue} disabled />
						<Measured id="textarea" stretch>
							<Textarea
								aria-label={VISUAL_LAB_TEXT.fieldLabel}
								defaultValue={VISUAL_LAB_TEXT.multilineValue}
							/>
						</Measured>
					</Section>

					<Section title="Badges">
						<div className="flex flex-wrap items-center gap-2">
							<Measured id="badge">
								<Badge>{VISUAL_LAB_BADGES[0]}</Badge>
							</Measured>
							<Badge variant="secondary">{VISUAL_LAB_BADGES[1]}</Badge>
							<Badge variant="ghost">{VISUAL_LAB_BADGES[2]}</Badge>
							<Badge variant="outline">{VISUAL_LAB_BADGES[3]}</Badge>
							<Badge variant="destructive">{VISUAL_LAB_BADGES[4]}</Badge>
						</div>
					</Section>

					<Section title="Surfaces">
						{/**
						 * Measurement boxes contain no text, for the same reason as on native. The two
						 * platforms deliberately use different glyph heights, so the total height of a box
						 * holding text would measure the font rather than the container.
						 */}
						<Measured id="card" stretch>
							<Card size="sm">
								<CardContent>
									<div className="h-10" />
								</CardContent>
							</Card>
						</Measured>
						<Measured id="panel" stretch>
							<div className="rounded-lg border bg-card p-3">
								<div className="h-10" />
							</div>
						</Measured>
						<Card size="sm">
							<CardContent className="gap-1">
								<span className="text-base font-medium">
									{VISUAL_LAB_TEXT.cardTitle}
								</span>
								<span className="text-sm text-muted-foreground">
									{VISUAL_LAB_TEXT.cardBody}
								</span>
							</CardContent>
						</Card>
						<div className="flex flex-col gap-1 rounded-lg border bg-card p-3">
							<span className="text-base font-medium">
								{VISUAL_LAB_TEXT.cardTitle}
							</span>
							<span className="text-sm text-muted-foreground">
								{VISUAL_LAB_TEXT.cardBody}
							</span>
						</div>
						<Measured id="separator" stretch>
							<Separator />
						</Measured>
					</Section>

					<Section title="Controls">
						<ControlsLab />
					</Section>

					<Section title="Motion">
						<MotionLab />
					</Section>

					<Section title="Overlays">
						<OverlayLab />
					</Section>
				</div>
			</div>
		</MeasureProvider>
	);
}

/**
 * `body` and `label` share one value (`text-sm`, 14px). That is the fact this table exposes. Native
 * splits that slot into 15 and 13, and the parity ledger must answer the question on that row.
 */
const TYPE_ROW: Record<VisualLabTypeRow, string> = {
	display: "text-2xl font-bold tracking-tight",
	heading: "text-xl font-bold tracking-tight",
	title: "text-base font-semibold",
	body: "text-sm",
	label: "text-sm font-medium",
	caption: "text-xs text-muted-foreground",
};

function ControlsLab() {
	const [on, setOn] = useState(true);
	return (
		<>
			<div className="flex items-center justify-between">
				<span className="text-sm">{VISUAL_LAB_TEXT.switchLabel}</span>
				<Measured id="switch">
					<Switch
						aria-label={VISUAL_LAB_TEXT.switchLabel}
						checked={on}
						onCheckedChange={setOn}
					/>
				</Measured>
			</div>
			<div className="flex items-center justify-between">
				<span className="text-sm">{VISUAL_LAB_TEXT.switchLabel}</span>
				<Switch
					aria-label={VISUAL_LAB_TEXT.switchLabel}
					checked={!on}
					onCheckedChange={() => setOn((value) => !value)}
				/>
			</div>
			<div className="flex items-center justify-between">
				<span className="text-sm text-muted-foreground">
					{VISUAL_LAB_TEXT.switchLabel} (disabled)
				</span>
				<Switch aria-label={VISUAL_LAB_TEXT.switchLabel} disabled />
			</div>
			<Select defaultValue="sonnet">
				<SelectTrigger
					className="w-full"
					aria-label={VISUAL_LAB_TEXT.selectLabel}
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="sonnet">{VISUAL_LAB_TEXT.selectValue}</SelectItem>
					<SelectItem value="save">{VISUAL_LAB_TEXT.actionLatin}</SelectItem>
				</SelectContent>
			</Select>
			<Select defaultValue="sonnet" disabled>
				<SelectTrigger
					className="w-full"
					aria-label={VISUAL_LAB_TEXT.selectLabel}
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="sonnet">{VISUAL_LAB_TEXT.selectValue}</SelectItem>
				</SelectContent>
			</Select>
			<div className="flex flex-wrap items-center gap-2">
				<DropdownMenu>
					<DropdownMenuTrigger
						render={<Button variant="outline">{VISUAL_LAB_TEXT.action}</Button>}
					/>
					<DropdownMenuContent>
						<DropdownMenuItem>{VISUAL_LAB_TEXT.action}</DropdownMenuItem>
						<DropdownMenuItem variant="destructive">
							{VISUAL_LAB_TEXT.destructiveAction}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button
								variant="ghost"
								size="icon"
								aria-label="Sample overflow menu"
							>
								<MoreHorizontalIcon />
							</Button>
						}
					/>
					<DropdownMenuContent>
						<DropdownMenuItem>{VISUAL_LAB_TEXT.action}</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</>
	);
}

/**
 * The label is bound to the field. Native `Input` does the same wiring with `@rn-primitives/label`,
 * and the app's form check (`lib/form-semantics.test.ts`) requires this shape.
 */
function LabelledInput({
	invalid,
	...props
}: {
	invalid?: boolean;
	placeholder?: string;
	defaultValue?: string;
	disabled?: boolean;
}) {
	const id = useId();
	return (
		<div className="flex flex-col gap-1">
			<Label htmlFor={id} className="text-xs text-muted-foreground">
				{VISUAL_LAB_TEXT.fieldLabel}
			</Label>
			<Input id={id} aria-invalid={invalid} {...props} />
		</div>
	);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-2">
			<h2 className="text-xs text-muted-foreground">{title}</h2>
			{children}
		</section>
	);
}
