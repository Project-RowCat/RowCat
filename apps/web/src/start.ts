import { isRowCatApiError, RowCatApiError } from "@rowcat/sdk";
import { createSerializationAdapter } from "@tanstack/react-router";
import { createStart } from "@tanstack/react-start";

/**
 * RowCatApiError must cross the SSR boundary through serialization. An error thrown in a loader on
 * the server reaches the client serialized. If this adapter is not registered, the error is
 * downgraded to a plain Error and status, code and requestId are lost. The adult-gate notice drawn
 * on the server would then change to an unknown-error message right after hydration, with no error
 * in between.
 *
 * The adapter lives in the web app, not in @rowcat/sdk. The SDK must not know TanStack Start (Expo
 * uses the same code), and how errors travel depends on how this app renders.
 */
const rowCatApiErrorAdapter = createSerializationAdapter({
	key: "RowCatApiError",
	test: isRowCatApiError,
	toSerializable: ({ status, code, message, requestId }) => ({
		status,
		code,
		message,
		requestId,
	}),
	fromSerializable: (value) => new RowCatApiError(value),
});

export const startInstance = createStart(() => ({
	serializationAdapters: [rowCatApiErrorAdapter],
}));
