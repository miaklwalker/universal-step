import { NameFactory, QueueSystem } from "@michaelrwalker/step-queue";
import {
	defineStepSpec,
	type Harness,
	type SpecStep,
} from "../spec/stepSpec.ts";

// Not a `.test.ts`, so `npm test` leaves it alone: this one needs Redis, and
// step-queue's raw `.ts` needs a loader Node doesn't ship. `npm run test:queue`
// supplies both.

const connection = {
	host: process.env.REDIS_HOST ?? "127.0.0.1",
	port: Number(process.env.REDIS_PORT ?? 60866),
};

/** Accepts anything: the spec is about steps, not about input validation. */
const passthrough = {
	"~standard": {
		version: 1 as const,
		vendor: "spec",
		validate: (value: unknown) => ({ value: value as Record<string, unknown> }),
	},
};

const boom = {
	name: "boom",
	handler: async (): Promise<void> => {
		throw new Error("boom");
	},
};

let counter = 0;

async function runJob(
	step: SpecStep,
	data: object,
	thenFail: boolean,
): Promise<Record<string, unknown>> {
	counter += 1;
	const queue = new QueueSystem(
		NameFactory({ name: `spec-${process.pid}-${counter}` }),
	)
		.defineInputSchema(passthrough)
		.defineConnection(connection)
		.defineProcessor((builder) => {
			// The step is typed for its own data, which the spec's erased view
			// can't express; the cast is the harness's, not the adapter's.
			// biome-ignore lint/suspicious/noExplicitAny: erased on purpose, see above
			const added = (builder as any).addStep(step.stepQueue);
			return thenFail ? added.addStep(boom) : added;
		});
	try {
		const job = await queue.addJob(data as Record<string, unknown>);
		return (await job.waitUntilFinished(queue.QueueEvents, 15_000)) as Record<
			string,
			unknown
		>;
	} finally {
		await queue.close();
	}
}

/** The step mounted in a real step-queue processor and run by a real BullMQ worker. */
const stepQueueHarness: Harness = {
	environment: "stepQueue",
	run: (step, data) => runJob(step, data, false),
	runThenFail: async (step, data) => {
		try {
			await runJob(step, data, true);
		} catch {
			return;
		}
		throw new Error("expected the job to fail");
	},
};

defineStepSpec(stepQueueHarness);
