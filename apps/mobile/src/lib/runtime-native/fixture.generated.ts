/**
 * Generated — do not edit by hand. `pnpm --filter @rowcat/mobile runtime-vm:harness`.
 *
 * The **compiled artifacts** of the development and acceptance fixtures. The creator source
 * lives in `scripts/build-runtime-vm-harness.ts`, and nothing is compiled on the device —
 * mobile is the playback side, so the TypeScript compiler never comes into this app's bundle.
 */

export const RUNTIME_COUNTER_FIXTURE = {
	"formatVersion": 1,
	"apiVersion": 7,
	"compilerVersion": 1,
	"entry": "src/main.tsx",
	"modules": [
		{
			"id": "src/main.tsx",
			"code": "import { jsxs as _jsxs, jsx as _jsx } from \"@rowcat/runtime/jsx-runtime\";\nimport { Button, Screen, Stack, Text, useState } from \"@rowcat/runtime\";\nexport default function App() {\n    const [count, setCount] = useState(0);\n    return (_jsx(Screen, { children: _jsxs(Stack, { gap: 12, style: { padding: 24 }, children: [_jsxs(Text, { style: { fontSize: 20, fontWeight: \"bold\" }, children: [\"Count: \", count] }), _jsx(Button, { onPress: () => setCount((value) => value + 1), children: \"Increment\" })] }) }));\n}\n",
			"dependencies": [
				{
					"specifier": "@rowcat/runtime",
					"kind": "builtin",
					"resolved": "rowcat:runtime"
				}
			],
			"map": "{\"version\":3,\"file\":\"src/main.tsx\",\"sources\":[\"src/main.tsx\"],\"names\":[],\"mappings\":\";AAAA,OAAO,EAAE,MAAM,EAAE,MAAM,EAAE,KAAK,EAAE,IAAI,EAAE,QAAQ,EAAE,MAAM,iBAAiB,CAAC;AAExE,MAAM,CAAC,OAAO,UAAU,GAAG;IAC1B,MAAM,CAAC,KAAK,EAAE,QAAQ,CAAC,GAAG,QAAQ,CAAC,CAAC,CAAC,CAAC;IAEtC,OAAO,CACN,KAAC,MAAM,cACN,MAAC,KAAK,IAAC,GAAG,EAAE,EAAE,EAAE,KAAK,EAAE,EAAE,OAAO,EAAE,EAAE,EAAE,aACrC,MAAC,IAAI,IAAC,KAAK,EAAE,EAAE,QAAQ,EAAE,EAAE,EAAE,UAAU,EAAE,MAAM,EAAE,wBAAU,KAAK,IAAQ,EAExE,KAAC,MAAM,IAAC,OAAO,EAAE,GAAG,EAAE,CAAC,QAAQ,CAAC,CAAC,KAAK,EAAE,EAAE,CAAC,KAAK,GAAG,CAAC,CAAC,0BAAoB,IAClE,GACA,CACT,CAAC;AACH,CAAC\"}"
		}
	],
	"sourceHash": "f0a0d6e3c363c01d2693d7091b19ec80",
	"remoteAssets": []
} as const;
