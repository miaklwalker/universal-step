/**
 * The one file a project writes to set up universal steps: register the
 * frameworks you use, by name, then the helpers every step may call.
 *
 * Register the adapters first. Helpers are checked against them, so each one
 * must say what it does in every registered framework — and in `function`,
 * the plain-call environment tests use.
 */
import { UniversalSteps } from "../modules/index.ts";
import { stagehandAdapter } from "../stagehand.ts";
import { stepQueueAdapter } from "../step-queue.ts";

export const steps = new UniversalSteps()
	.use("stageHand", stagehandAdapter)
	.use("stepQueue", stepQueueAdapter)
	.defineHelpers({
		log: {
			stageHand: (ctx) => (message: string) => ctx.log(message),
			stepQueue: (job) => (message: string) => {
				void job.log(message);
			},
			function: () => (message: string) => console.log(`[log] ${message}`),
		},
		// stagehand has a live status line; a headless queue worker doesn't, so
		// the closest thing there is a log row. The step just calls status().
		status: {
			stageHand: (ctx) => (message: string) => ctx.status(message),
			stepQueue: (job) => (message: string) => {
				void job.log(`[status] ${message}`);
			},
			function: () => (message: string) => console.log(`[status] ${message}`),
		},
	});
