import assert from "node:assert";
import test, { describe } from "node:test";
import { UniversalStepError, UniversalSteps } from "../modules/index.ts";
import { type Empty, fakeAdapter, fakeNative } from "./support.ts";

/** An app with the fake framework registered and a `log` helper in each environment. */
function appWithLog() {
	return new UniversalSteps().use("fake", fakeAdapter).defineHelpers({
		log: {
			fake: (native) => (message: string) => {
				native.logs.push(`fake:${message}`);
			},
			function: () => (_message: string) => {},
		},
	});
}

describe("UniversalSteps.use", () => {
	test("registers an adapter under the name given", () => {
		const steps = new UniversalSteps().use("fake", fakeAdapter);
		const step = steps.defineStep<Empty>()({
			name: "s",
			handler: async () => {},
		});
		assert.strictEqual(typeof step.fake.run, "function");
	});

	test("rejects the reserved names a step already uses itself", () => {
		const steps = new UniversalSteps();
		assert.throws(() => {
			// @ts-expect-error "function" is reserved.
			steps.use("function", fakeAdapter);
		}, UniversalStepError);
		assert.throws(() => {
			// @ts-expect-error "name" is reserved.
			steps.use("name", fakeAdapter);
		}, UniversalStepError);
	});

	test("rejects a name that is already registered", () => {
		const steps = new UniversalSteps().use("fake", fakeAdapter);
		assert.throws(() => {
			// @ts-expect-error "fake" is already registered.
			steps.use("fake", fakeAdapter);
		}, UniversalStepError);
	});

	test("rejects an empty name and something that is not an adapter", () => {
		assert.throws(
			() => new UniversalSteps().use("", fakeAdapter),
			UniversalStepError,
		);
		assert.throws(() => {
			// @ts-expect-error not an adapter.
			new UniversalSteps().use("broken", {});
		}, UniversalStepError);
	});
});

describe("UniversalSteps.defineHelpers", () => {
	test("requires an implementation for every registered adapter", () => {
		assert.throws(
			() =>
				new UniversalSteps().use("fake", fakeAdapter).defineHelpers({
					// @ts-expect-error no implementation for "fake".
					log: { function: () => (_message: string) => {} },
				}),
			(error: Error) =>
				error instanceof UniversalStepError &&
				/"log".*"fake"/.test(error.message),
		);
	});

	test("requires an implementation for `function`, always", () => {
		assert.throws(
			() =>
				new UniversalSteps().use("fake", fakeAdapter).defineHelpers({
					// @ts-expect-error no implementation for "function".
					log: { fake: () => (_message: string) => {} },
				}),
			(error: Error) =>
				error instanceof UniversalStepError &&
				/"log".*"function"/.test(error.message),
		);
	});

	test("rejects an implementation for an adapter that was never registered", () => {
		assert.throws(
			() =>
				new UniversalSteps().use("fake", fakeAdapter).defineHelpers({
					// @ts-expect-error "ghost" is not registered.
					log: {
						fake: () => (_message: string) => {},
						function: () => (_message: string) => {},
						ghost: () => (_message: string) => {},
					},
				}),
			(error: Error) =>
				error instanceof UniversalStepError && /"ghost"/.test(error.message),
		);
	});

	test("an app may define no helpers at all", async () => {
		const step = new UniversalSteps()
			.use("fake", fakeAdapter)
			.defineStep<Empty>()({
			name: "s",
			handler: async (_data, helpers) => Object.keys(helpers),
		});
		assert.deepStrictEqual(await step.function({}), []);
	});
});

describe("defineStep", () => {
	test("needs a name and a handler", () => {
		const steps = appWithLog();
		assert.throws(() => {
			// @ts-expect-error no name.
			steps.defineStep<Empty>()({ handler: async () => {} });
		}, UniversalStepError);
		assert.throws(() => {
			// @ts-expect-error no handler.
			steps.defineStep<Empty>()({ name: "s" });
		}, UniversalStepError);
	});

	test("exposes its name, `function`, and one property per adapter", () => {
		const step = appWithLog().defineStep<Empty>()({
			name: "loadUser",
			handler: async () => {},
		});
		assert.strictEqual(step.name, "loadUser");
		assert.strictEqual(typeof step.function, "function");
		assert.strictEqual(typeof step.fake.run, "function");
		assert.ok(Object.isFrozen(step));
	});

	test("the handler sees required and input data merged, input first", async () => {
		const step = appWithLog().defineStep<
			{ user: string },
			{ amount: number }
		>()({
			name: "charge",
			handler: async (data) => ({ summary: `${data.user}:${data.amount}` }),
		});
		assert.deepStrictEqual(await step.function({ user: "ada", amount: 3 }), {
			summary: "ada:3",
		});
	});

	test("a handler error propagates out of every environment", async () => {
		const step = appWithLog().defineStep<Empty>()({
			name: "s",
			handler: async () => {
				throw new Error("nope");
			},
		});
		await assert.rejects(step.function({}), /nope/);
		await assert.rejects(step.fake.run(fakeNative()), /nope/);
	});
});

describe("helpers", () => {
	test("each environment binds its own implementation to its own native context", async () => {
		const step = appWithLog().defineStep<Empty>()({
			name: "s",
			handler: async (_data, { log }) => {
				log("hello");
			},
		});

		const native = fakeNative();
		await step.fake.run(native);
		assert.deepStrictEqual(native.logs, ["fake:hello"]);

		// `function` runs the helper's own `function` implementation: a no-op here.
		await step.function({});
		assert.deepStrictEqual(native.logs, ["fake:hello"]);
	});

	test("rollback gets the helpers too", async () => {
		const step = appWithLog().defineStep<Empty>()({
			name: "s",
			handler: async () => ({ chargeId: "c1" }),
			rollbackKeys: ["chargeId"],
			rollback: async ({ chargeId }, { log }) => {
				log(`refund ${chargeId}`);
			},
		});

		const native = fakeNative({ chargeId: "c1" });
		await step.fake.undo(native);
		assert.deepStrictEqual(native.logs, ["fake:refund c1"]);
	});

	test("a helper takes whatever arguments its signature says", async () => {
		const seen: unknown[][] = [];
		const steps = new UniversalSteps().use("fake", fakeAdapter).defineHelpers({
			progress: {
				fake: () => (done: number, total: number) => {
					seen.push(["fake", done, total]);
				},
				function: () => (done: number, total: number) => {
					seen.push(["function", done, total]);
				},
			},
		});
		const step = steps.defineStep<Empty>()({
			name: "s",
			handler: async (_data, { progress }) => {
				progress(1, 4);
			},
		});

		await step.function({});
		await step.fake.run(fakeNative());
		assert.deepStrictEqual(seen, [
			["function", 1, 4],
			["fake", 1, 4],
		]);
	});
});

describe("rollback", () => {
	const stepWithRollback = () => {
		const seen: object[] = [];
		const step = appWithLog().defineStep<
			{ user: string },
			{ amount: number; secret: string }
		>()({
			name: "charge",
			handler: async ({ amount }) => ({ chargeId: `ch_${amount}` }),
			rollbackKeys: ["chargeId", "user"],
			rollback: async (data) => {
				seen.push(data);
			},
		});
		return { step, seen };
	};

	test("sees only the keys it declared, in every environment", async () => {
		const { step, seen } = stepWithRollback();
		const everything = {
			user: "ada",
			amount: 7,
			secret: "hunter2",
			chargeId: "ch_7",
			unrelated: true,
		};

		await step.function.rollback(everything);
		await step.fake.undo(fakeNative(everything));

		const expected = { user: "ada", chargeId: "ch_7" };
		assert.deepStrictEqual(seen, [expected, expected]);
	});

	test("a step without a rollback has nothing to run", async () => {
		const step = appWithLog().defineStep<Empty>()({
			name: "s",
			handler: async () => {},
		});
		await step.function.rollback({});
		await step.fake.undo(fakeNative());
	});

	test("with no rollbackKeys declared it receives an empty object", async () => {
		const seen: object[] = [];
		const step = appWithLog().defineStep<{ secret: string }>()({
			name: "s",
			handler: async () => {},
			rollback: async (data) => {
				seen.push(data);
			},
		});
		await step.function.rollback({});
		assert.deepStrictEqual(seen, [{}]);
	});
});
