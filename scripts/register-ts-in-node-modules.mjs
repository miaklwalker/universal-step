// step-queue publishes raw TypeScript, and Node refuses to strip types from
// anything under node_modules. That is a safety rule for production code; for
// the queue test, which has to load the real step-queue, this hook does the
// stripping itself. Used only by `npm run test:queue` (see scripts/test-queue.mjs).
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
	load(url, context, nextLoad) {
		if (url.endsWith(".ts") && url.includes("/node_modules/")) {
			const source = readFileSync(fileURLToPath(url), "utf8");
			return {
				format: "module",
				source: stripTypeScriptTypes(source, { mode: "transform" }),
				shortCircuit: true,
			};
		}
		return nextLoad(url, context);
	},
});
