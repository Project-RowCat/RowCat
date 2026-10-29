import { Input } from "@rowcat/ui-web/components/input";
import { Label } from "@rowcat/ui-web/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@rowcat/ui-web/components/select";
import { Search } from "lucide-react";
import {
	type FormEvent,
	type ReactNode,
	useEffect,
	useId,
	useState,
} from "react";

/**
 * The filter row shared by list screens. A component for consistency, not reuse: hand-placed
 * filters drift in position and order, and operators would have to re-find them on every screen.
 */
export function FilterBar({ children }: { children: ReactNode }) {
	return (
		<div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/20 p-3">
			{children}
		</div>
	);
}

export function FilterSelect({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: string;
	options: { value: string; label: string }[];
	onChange: (value: string) => void;
}) {
	const id = useId();
	return (
		<div className="space-y-1">
			<Label htmlFor={id} className="text-muted-foreground text-xs">
				{label}
			</Label>
			<Select
				/** Passing `items` makes the trigger draw the label, not the value. */
				items={options}
				value={value}
				onValueChange={(next) => {
					// Re-selecting the same item yields null; that must do nothing.
					if (next === null || next === value) return;
					onChange(String(next));
				}}
			>
				<SelectTrigger id={id} size="sm" className="w-40">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{options.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

/**
 * Search runs on submit, not per keystroke. Mid-typing strings never match an exact email, so
 * "none" would flicker, and each lookup runs `ILIKE '%…%'` on the server, so per-character queries
 * load our DB. Submit also beats debounce because debounce hides when a request went out and leaves
 * the operator unsure whether to wait.
 */
export function FilterSearch({
	label,
	value,
	placeholder,
	onSubmit,
}: {
	label: string;
	value: string;
	placeholder?: string;
	onSubmit: (value: string) => void;
}) {
	const id = useId();
	const [draft, setDraft] = useState(value);

	/**
	 * Follows the address when it changes outside (back button, link); otherwise the input and the
	 * results disagree after going back.
	 */
	useEffect(() => {
		setDraft(value);
	}, [value]);

	const submit = (event: FormEvent) => {
		event.preventDefault();
		onSubmit(draft.trim());
	};

	return (
		<form onSubmit={submit} className="space-y-1">
			<Label htmlFor={id} className="text-muted-foreground text-xs">
				{label}
			</Label>
			<div className="relative">
				<Search
					className="pointer-events-none absolute top-2 left-2 size-4 text-muted-foreground"
					aria-hidden
				/>
				<Input
					id={id}
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					placeholder={placeholder}
					className="h-8 w-64 pl-8"
				/>
			</div>
		</form>
	);
}
