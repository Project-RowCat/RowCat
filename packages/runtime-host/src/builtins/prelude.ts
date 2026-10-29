/**
 * The sandbox's trusted prelude: the first code that runs inside the VM.
 *
 * It is a string because it runs in the VM realm. Host function objects cannot be passed in (they
 * belong to another realm), and passing them would make a host object the first thing to cross the
 * boundary. This file therefore holds JavaScript that TypeScript does not check. Tests run it in a
 * real VM.
 *
 * It does four things:
 * 1. Captures the original built-ins (`JSON.parse`, `Reflect.apply`, `Promise.prototype.then`)
 *    before creator code runs, so the bridge keeps working if creator code modifies prototypes.
 * 2. Serializes values going to the host, walking them with the wire rules from `wire.ts`.
 *    Values that fail throw `runtime_wire_value_invalid`. It does not rely on `JSON.stringify`
 *    leniency.
 * 3. Bridge: `hostCall(capability, payload)` calls the native function and turns its promise
 *    into the creator's promise. Rejections become coded errors with no host stack. `emit(channel,
 *    json)` is the synchronous path the other way: runtime infrastructure sends commit batches,
 *    work requests, and diagnostics, and receives only an acknowledgment
 *    (`rowcat:internal/host-port`).
 * 4. Hardening: removes `eval` and `Function`, and replaces the four function constructors with
 *    functions that throw. This is one layer of defense, not isolation; the VM itself is the
 *    isolation. The engine option that disables the `Eval` intrinsic cannot be used, because module
 *    loading itself goes through it (see the header of `vm/quickjs.ts`).
 *
 * The completion value of this script is the trusted function set the host captures. It does not
 * stay on the global object: after the built-in module captures the bridge, `__rowcatBridge` is
 * deleted too.
 */

export const PRELUDE_MODULE_ID = "<rowcat:prelude>";

export const RUNTIME_PRELUDE_SOURCE = `(function (native) {
	"use strict";
	var parse = JSON.parse;
	var stringify = JSON.stringify;
	var isArray = Array.isArray;
	var keys = Object.keys;
	var getPrototypeOf = Object.getPrototypeOf;
	var defineProperty = Object.defineProperty;
	var freeze = Object.freeze;
	var isFinite = Number.isFinite;
	var apply = Reflect.apply;
	var promiseThen = Promise.prototype.then;
	var ObjectPrototype = Object.prototype;
	var ErrorClass = Error;
	var StringClass = String;
	var limits = parse(native.limits);
	delete globalThis.__rowcatNative;

	function HostError(code, message) {
		var error = new ErrorClass(message);
		error.name = "RowCatHostError";
		defineProperty(error, "rowcatHostCode", { value: code, enumerable: false, writable: false, configurable: false });
		return error;
	}

	function invalid(reason, path) {
		return HostError("runtime_wire_value_invalid", reason + " at " + path);
	}

	function serialize(value) {
		var stack = [];
		var entries = 0;
		function visit(node, depth, path) {
			if (depth > limits.maxDepth) throw invalid("depth exceeded", path);
			if (node === null) return null;
			var type = typeof node;
			if (type === "boolean") return node;
			if (type === "number") {
				if (!isFinite(node)) throw invalid("non-finite number", path);
				return node;
			}
			if (type === "string") {
				if (node.length > limits.maxStringLength) throw invalid("string too long", path);
				return node;
			}
			if (type !== "object") throw invalid("unsupported type " + type, path);
			for (var s = 0; s < stack.length; s += 1) if (stack[s] === node) throw invalid("cycle", path);
			stack.push(node);
			try {
				if (isArray(node)) {
					var out = [];
					for (var i = 0; i < node.length; i += 1) {
						entries += 1;
						if (entries > limits.maxEntries) throw invalid("too many entries", path);
						out.push(visit(node[i], depth + 1, path + "[" + i + "]"));
					}
					return out;
				}
				var prototype = getPrototypeOf(node);
				if (prototype !== ObjectPrototype && prototype !== null) throw invalid("not a plain object", path);
				var names = keys(node);
				var result = {};
				for (var k = 0; k < names.length; k += 1) {
					entries += 1;
					if (entries > limits.maxEntries) throw invalid("too many entries", path);
					var key = names[k];
					// The same decision as the host's wire validation: if they diverged, the same value would pass on one side only.
					if (key === "__proto__" || key === "constructor" || key === "prototype")
						throw invalid("forbidden key", path + "." + key);
					result[key] = visit(node[key], depth + 1, path + "." + key);
				}
				return result;
			} finally {
				stack.pop();
			}
		}
		var json = stringify(visit(value, 1, "$"));
		if (json.length > limits.maxSerializedLength) throw invalid("serialized value too large", "$");
		return json;
	}

	function deserialize(json) {
		return parse(json);
	}

	function onFailure(failure) {
		var info = deserialize(failure);
		throw HostError(info.code, info.message);
	}

	function hostCall(capability, payload) {
		if (typeof capability !== "string") throw HostError("runtime_wire_value_invalid", "capability name must be a string");
		var json = serialize(payload);
		var pending = native.hostCall(capability, json);
		return apply(promiseThen, pending, [deserialize, onFailure]);
	}

	function emit(channel, json) {
		if (typeof channel !== "string" || typeof json !== "string") throw HostError("runtime_wire_value_invalid", "emit takes a channel name and a json string");
		return deserialize(native.emit(channel, json));
	}

	function logger(level) {
		return function () {
			var args = [];
			for (var i = 0; i < arguments.length; i += 1) args.push(arguments[i]);
			var json;
			try {
				json = serialize(args);
			} catch (error) {
				json = stringify([StringClass(error && error.message)]);
			}
			native.log(level, json);
		};
	}
	defineProperty(globalThis, "console", {
		value: freeze({ log: logger("log"), warn: logger("warn"), error: logger("error") }),
		writable: false,
		configurable: false,
		enumerable: false,
	});

	delete globalThis.eval;
	delete globalThis.Function;
	var thrower = function () {
		throw new ErrorClass("dynamic code is not available in the RowCat runtime");
	};
	var samples = [function () {}, async function () {}, function* () {}, async function* () {}];
	for (var f = 0; f < samples.length; f += 1)
		defineProperty(getPrototypeOf(samples[f]), "constructor", { value: thrower, writable: false, configurable: false });

	defineProperty(globalThis, "__rowcatBridge", {
		value: freeze({ hostCall: hostCall, emit: emit, serialize: serialize, deserialize: deserialize }),
		writable: false,
		configurable: true,
		enumerable: false,
	});

	return freeze({
		serialize: serialize,
		deserialize: deserialize,
		invoke: function (fn, argsJson) {
			return apply(fn, undefined, deserialize(argsJson));
		},
		invokeWith: function (fn, leading, argsJson) {
			return apply(fn, undefined, leading.concat(deserialize(argsJson)));
		},
	});
})(globalThis.__rowcatNative)`;
