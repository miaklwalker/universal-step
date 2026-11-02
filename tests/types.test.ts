import assert from "node:assert";
import test, { describe } from "node:test";
import type { StepDef } from "@michaelrwalker/stagehand";
import type { StandaloneStep } from "@michaelrwalker/step-queue";
import { UniversalSteps } from "../modules/index.ts";
import { stagehandAdapter } from "../stagehand.ts";
import { stepQueueAdapter } from "../step-queue.ts";
import { type Empty, type Equal, type Expect, fakeAdapter } from "./support.ts";

const withStatus = () =>
	new UniversalSteps().use("fake", fakeAdapter).defineHelpers({
		status: {
			fake: () => (message: string) => {
				void message;
			},
			function: () => (_message: string) => {},
		},
	});

describe("type-level: helpers", () => {
	test("a helper has the call signature its implementations agree on", () => {
		withStatus().defineStep<Empty>()({
			name: "s",
			handler: async (_data, helpers) => {
				type _Helpers = Expect<
					Equal<typeof helpers, { status: (message: string) => void }>
				>;
			},
		});
		assert.ok(true);
	});

	test("a no-op implementation with fewer parameters doesn't weaken it", () => {
		const steps = new UniversalSteps().use("fake", fakeAdapter).defineHelpers({
			status: {
				fake: () => (message: string) => {
					void message;
				},
				function: () => () => {},
			},
		});
		steps.defineStep<Empty>()({
			name: "s",
			handler: async (_data, { status }) => {
				type _Status = Expect<Equal<typeof status, (message: string) => void>>;
			},
		});
		assert.ok(true);
	});

	test("implementations that disagree on arguments are an error on that helper", () => {
		new UniversalSteps().use("fake", fakeAdapter).defineHelpers({
			// @ts-expect-error `fake` takes a string, `function` takes a number.
			status: {
				fake: () => (_message: string) => {},
				function: () => (_count: number) => {},
			},
		});
		assert.ok(true);
	});

	test("a call to a helper is checked against that signature", () => {
		withStatus().defineStep<Empty>()({
			name: "s",
			handler: async (_data, helpers) => {
				// @ts-expect-error status takes a string.
				helpers.status(42);
				// @ts-expect-error there is no such helper.
				helpers.missing("x");
			},
		});
		assert.ok(true);
	});
});

describe("type-level: steps", () => {
	test("the handler's data is the required and input data, merged", () => {
		withStatus().defineStep<{ userId: string }, { amount: number }>()({
			name: "s",
			handler: async (data) => {
				type _Data = Expect<
					Equal<typeof data, { userId: string; amount: number }>
				>;
			},
		});
		assert.ok(true);
	});

	test("rollbackKeys only accepts keys of the data or the step's own output", () => {
		withStatus().defineStep<{ userId: string }>()({
			name: "s",
			handler: async () => ({ chargeId: "c" }),
			rollbackKeys: ["userId", "chargeId"],
		});
		withStatus().defineStep<{ userId: string }>()({
			name: "s",
			handler: async () => ({ chargeId: "c" }),
			// @ts-expect-error "nope" is neither data nor output.
			rollbackKeys: ["nope"],
		});
		assert.ok(true);
	});

	test("a rollback is typed with exactly the keys it declared", () => {
		withStatus().defineStep<{ userId: string }, { amount: number }>()({
			name: "s",
			handler: async () => ({ chargeId: "c" }),
			rollbackKeys: ["chargeId", "userId"],
			rollback: async (data) => {
				type _Data = Expect<
					Equal<typeof data, { chargeId: string; userId: string }>
				>;
			},
		});
		assert.ok(true);
	});

	test("the function environment is typed from the step", () => {
		const step = withStatus().defineStep<{ userId: string }>()({
			name: "s",
			handler: async ({ userId }) => ({ user: { id: userId } }),
			rollbackKeys: ["user"],
		});
		type _Call = Expect<
			Equal<Parameters<typeof step.function>[0], { userId: string }>
		>;
		type _Output = Expect<
			Equal<ReturnType<typeof step.function>, Promise<{ user: { id: string } }>>
		>;
		type _Rollback = Expect<
			Equal<
				Parameters<typeof step.function.rollback>[0],
				{ user: { id: string } }
			>
		>;
		assert.ok(true);
	});

	test("a step only has a property for the adapters that were registered", () => {
		const step = withStatus().defineStep<Empty>()({
			name: "s",
			handler: async () => {},
		});
		assert.ok(step.fake);
		// @ts-expect-error "stepQueue" was never registered.
		assert.strictEqual(step.stepQueue, undefined);
	});

	test("once helpers are defined, no more adapters can be registered", () => {
		const factory = withStatus();
		// @ts-expect-error `use` is only available before `defineHelpers`.
		assert.strictEqual(factory.use, undefined);
	});
});

describe("type-level: the real adapters", () => {
	const app = new UniversalSteps()
		.use("stageHand", stagehandAdapter)
		.use("stepQueue", stepQueueAdapter)
		.defineHelpers({
			log: {
				stageHand: (ctx) => (message: string) => ctx.log(message),
				stepQueue: (job) => (message: string) => {
					void job.log(message);
				},
				function: () => (_message: string) => {},
			},
		});

	const charge = app.defineStep<{ user: { id: string } }, { amount: number }>()(
		{
			name: "charge",
			handler: async ({ user, amount }) => ({
				chargeId: `${user.id}${amount}`,
			}),
			rollbackKeys: ["chargeId"],
		},
	);

	test("the stagehand property is a StepDef with input and ctx kept apart", () => {
		type _StageHand = Expect<
			Equal<
				typeof charge.stageHand,
				StepDef<
					{ amount: number },
					{ user: { id: string } },
					{ chargeId: string },
					readonly ["chargeId"]
				>
			>
		>;
		assert.strictEqual(charge.stageHand.name, "charge");
	});

	test("the step-queue property is a StandaloneStep over the merged data", () => {
		type _StepQueue = Expect<
			Equal<
				typeof charge.stepQueue,
				StandaloneStep<
					{ user: { id: string }; amount: number },
					{ chargeId: string },
					readonly ["chargeId"]
				>
			>
		>;
		assert.strictEqual(charge.stepQueue.name, "charge");
	});

	test("helper implementations are typed with each framework's own context", () => {
		new UniversalSteps()
			.use("stageHand", stagehandAdapter)
			.use("stepQueue", stepQueueAdapter)
			.defineHelpers({
				note: {
					stageHand: (ctx) => (message: string) => {
						// @ts-expect-error stagehand's context has no `updateStepProgress`.
						ctx.updateStepProgress(message);
					},
					stepQueue: (job) => (message: string) => {
						void job.log(message);
					},
					function: () => (_message: string) => {},
				},
			});
		assert.ok(true);
	});
});
