import { APP_NAME } from "@rowcat/domain";
import { Text } from "@rowcat/ui-native";

/**
 * The brand — **same word, same treatment as web.**
 *
 * Like the brand in web's sidebar, this is a single word with no picture. The reason there is no
 * mobile-only logo: two apps with different marks do not read as one product, and drawing a picture
 * here would mean putting it on web too, which is a web redesign.
 *
 * A component because there are three places (the discover header, the login screen, the
 * placeholder for a work without a cover). If each wrote `<Text>RowCat</Text>`, size and weight
 * would diverge; they did, with 28pt 700 and 13pt 700 drawing the same brand.
 */
export function Wordmark({ size = "title" }: { size?: "title" | "display" }) {
	return (
		<Text
			variant={size}
			weight="bold"
			/**
			 * If the user enlarges text and the brand wraps to two lines, the header's height shifts. Keep
			 * one line; the brand is what shrinks.
			 */
			numberOfLines={1}
			/**
			 * Screen readers hear one app name. `AppHeader` already has the title role, so `header` is not
			 * set again here.
			 */
			accessibilityLabel={APP_NAME}
		>
			{APP_NAME}
		</Text>
	);
}
