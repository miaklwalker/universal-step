import assert from "node:assert";
import test, { describe } from "node:test";
import type { ProcessorBuilder, TypedJob } from "@michaelrwalker/step-queue";
import { UniversalSteps } from "../../modules/index.ts";
import { stepQueueAdapter } from "../../step-queue.ts";
import type { Empty, Equal, Expect } from "../support.ts";

/** A `TypedJob`-shaped stub: only `.data` and `.log` are exercised by the adapter. */
function fakeJob<TData extends object>(
	data: TData,
	lines: string[] = [],
): TypedJob<TData> {
	return {
		data,
		log: async (row: string) => {
			lines.push(row);
			return lines.length;
		},
	} as unknown as TypedJob<TData>;
}

const steps = new UniversalSteps()
	.use("stepQueue", stepQueueAdapter)
	.defineHelpers({
		log: {
			stepQueue: (job) => (message: string) => {
				void job.log(message);
			},
			function: () => (_message: string) => {},
		},
	});

describe("stepQueueAdapter", () => {
	test("the handler runs against job.data and its helpers write to job.log", async () => {
		const loadUser = steps.defineStep<Empty, { userId: string }>()({
			name: "loadUser",
			handler: async ({ userId }, { log }) => {
				log(`loading ${userId}`);
				return { user: { id: userId, name: "Ada" } };
			},
		});

		const lines: string[] = [];
		const result = await loadUser.stepQueue.handler(
			fakeJob({ userId: "u1" }, lines),
			undefined,
		);

		assert.strictEqual(loadUser.stepQueue.name, "loadUser");
		assert.deepStrictEqual(result, { user: { id: "u1", name: "Ada" } });
		assert.deepStrictEqual(lines, ["loading u1"]);
	});

	test("required and input data are both just job.data, merged", async () => {
		const charge = steps.defineStep<{ user: string }, { amount: number }>()({
			name: "charge",
			handler: async ({ user, amount }) => ({ summary: `${user}:${amount}` }),
		});

		const result = await charge.stepQueue.handler(
			fakeJob({ user: "ada", amount: 3 }),
			undefined,
		);
		assert.deepStrictEqual(result, { summary: "ada:3" });
	});

	test("the rollback sees only the keys it declared, and gets helpers", async () => {
		const seen: unknown[] = [];
		const charge = steps.defineStep<
			Empty,
			{ amount: number; secret: string }
		>()({
			name: "charge",
			handler: async ({ amount }) => ({ chargeId: `ch_${amount}` }),
			rollbackKeys: ["chargeId"],
			rollback: async (data, { log }) => {
				seen.push(data);
				log(`refund ${data.chargeId}`);
			},
		});

		const lines: string[] = [];
		await charge.stepQueue.rollback?.(
			fakeJob({ amount: 7, secret: "hunter2", chargeId: "ch_7" }, lines),
			undefined,
		);

		assert.deepStrictEqual(seen, [{ chargeId: "ch_7" }]);
		assert.deepStrictEqual(lines, ["refund ch_7"]);
	});

	test("a step with no rollback has no rollback to register", () => {
		const step = steps.defineStep<Empty>()({
			name: "s",
			handler: async () => {},
		});
		assert.strictEqual(step.stepQueue.rollback, undefined);
	});

	test("carries rollbackKeys through so step-queue can protect them from `clean`", () => {
		const charge = steps.defineStep<Empty>()({
			name: "charge",
			handler: async () => ({ chargeId: "c" }),
			rollbackKeys: ["chargeId"],
		});
		assert.deepStrictEqual(charge.stepQueue.rollbackKeys, ["chargeId"]);
	});
});

describe("stepQueueAdapter: fits a real ProcessorBuilder chain", () => {
	// Type-level only, and never called: step-queue ships raw `.ts`, which Node
	// won't load from node_modules, so `ProcessorBuilder` can't be imported as a
	// value here. `tsc` is what checks this; the real queue is exercised by
	// `npm run test:queue`.
	type Start = ReturnType<
		typeof ProcessorBuilder.init<{ userId: string; amount: number }>
	>;
	type DataAfter<B> =
		B extends ProcessorBuilder<
			// biome-ignore lint/suspicious/noExplicitAny: extracting the accumulated data type only
			any,
			// biome-ignore lint/suspicious/noExplicitAny: extracting the accumulated data type only
			any,
			infer D,
			// biome-ignore lint/suspicious/noExplicitAny: extracting the accumulated data type only
			any,
			// biome-ignore lint/suspicious/noExplicitAny: extracting the accumulated data type only
			any
		>
			? D
			: never;

	const loadUser = steps.defineStep<Empty, { userId: string }>()({
		name: "loadUser",
		handler: async ({ userId }) => ({ user: { id: userId, name: "Ada" } }),
	});
	const charge = steps.defineStep<
		{ user: { id: string } },
		{ amount: number }
	>()({
		name: "charge",
		handler: async ({ user, amount }) => ({ chargeId: `${user.id}${amount}` }),
		rollbackKeys: ["chargeId"],
	});

	test("steps accumulate job data the way native step-queue steps do", () => {
		const chain = (builder: Start) =>
			builder.addStep(loadUser.stepQueue).addStep(charge.stepQueue);

		type _Data = Expect<
			Equal<
				DataAfter<ReturnType<typeof chain>>,
				{
					userId: string;
					amount: number;
					user: { id: string; name: string };
					chargeId: string;
				}
			>
		>;
		assert.strictEqual(typeof chain, "function");
	});

	test("step-queue's own options go on by spreading, and `clean` still narrows the type", () => {
		const chain = (builder: Start) =>
			builder.addStep({ ...loadUser.stepQueue, clean: ["userId"] });

		type _Data = Expect<
			Equal<
				DataAfter<ReturnType<typeof chain>>,
				{ amount: number; user: { id: string; name: string } }
			>
		>;
		assert.strictEqual(typeof chain, "function");
	});

	test("a step whose required data isn't there yet doesn't fit", () => {
		const chain = (builder: Start) =>
			// @ts-expect-error `charge` needs `user`, which no earlier step produced.
			builder.addStep(charge.stepQueue);
		assert.strictEqual(typeof chain, "function");
	});
});
