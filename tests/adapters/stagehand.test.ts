import assert from "node:assert";
import test, { beforeEach, describe } from "node:test";
import { memoryStore, Script } from "@michaelrwalker/stagehand";
import { UniversalSteps } from "../../modules/index.ts";
import { stagehandAdapter } from "../../stagehand.ts";
import type { Empty } from "../support.ts";

const quiet = { plain: true, silent: true } as const;

/** What the `log` helper was called with, recorded alongside the real call. */
const logged: string[] = [];
beforeEach(() => {
	logged.length = 0;
});

const steps = new UniversalSteps()
	.use("stageHand", stagehandAdapter)
	.defineHelpers({
		log: {
			stageHand: (ctx) => (message: string) => {
				logged.push(message);
				ctx.log(message);
			},
			function: () => (_message: string) => {},
		},
	});

const boom = {
	name: "boom",
	handler: async (): Promise<void> => {
		throw new Error("boom");
	},
};

describe("stagehandAdapter", () => {
	test("a TInput-only step reads the script's real input, with no seed step", async () => {
		const loadUser = steps.defineStep<Empty, { userId: string }>()({
			name: "loadUser",
			handler: async ({ userId }) => ({ user: { id: userId, name: "Ada" } }),
		});

		const result = await new Script<{ userId: string }>({ name: "t", ...quiet })
			.addPhase("Load")
			.addStep(loadUser.stageHand)
			.run({ userId: "u1" });

		assert.deepStrictEqual(result.ok && result.ctx, {
			user: { id: "u1", name: "Ada" },
		});
	});

	test("TRequired comes from an earlier step's ctx and TInput from the input", async () => {
		const loadUser = steps.defineStep<Empty, { userId: string }>()({
			name: "loadUser",
			handler: async ({ userId }) => ({ user: { id: userId } }),
		});
		const charge = steps.defineStep<
			{ user: { id: string } },
			{ amount: number }
		>()({
			name: "charge",
			handler: async ({ user, amount }) => ({
				chargeId: `${user.id}:${amount}`,
			}),
		});

		const result = await new Script<{ userId: string; amount: number }>({
			name: "t",
			...quiet,
		})
			.addPhase("Charge")
			.addStep(loadUser.stageHand)
			.addStep(charge.stageHand)
			.run({ userId: "u1", amount: 5 });

		assert.deepStrictEqual(result.ok && result.ctx, {
			user: { id: "u1" },
			chargeId: "u1:5",
		});
	});

	test("on a key present in both, the accumulated ctx wins over the input", async () => {
		const read = steps.defineStep<Empty, { value: string }>()({
			name: "read",
			handler: async ({ value }) => ({ seen: value }),
		});

		const result = await new Script<{ value: string }>({ name: "t", ...quiet })
			.addPhase("P")
			.addStep({ name: "override", handler: () => ({ value: "from ctx" }) })
			.addStep(read.stageHand)
			.run({ value: "from input" });

		assert.strictEqual(result.ok && result.ctx.seen, "from ctx");
	});

	test("helpers are bound to the running step's own stagehand context", async () => {
		const noisy = steps.defineStep<Empty>()({
			name: "noisy",
			handler: async (_data, { log }) => {
				log("from the handler");
			},
			rollbackKeys: [],
			rollback: async (_data, { log }) => {
				log("from the rollback");
			},
		});

		await new Script<Empty>({ name: "t", ...quiet })
			.addPhase("P")
			.addStep(noisy.stageHand)
			.addStep(boom)
			.run({});

		assert.deepStrictEqual(logged, ["from the handler", "from the rollback"]);
	});

	test("mounts in a script that declares flags, and still runs", async () => {
		const loadUser = steps.defineStep<Empty, { userId: string }>()({
			name: "loadUser",
			handler: async ({ userId }) => ({ user: { id: userId } }),
		});

		const result = await new Script<{ userId: string }>({ name: "t", ...quiet })
			.defineFlag({ name: "force", boolean: true })
			.addPhase("Load")
			.addStep(loadUser.stageHand)
			.run({ userId: "u1" }, { argv: ["--force"] });

		assert.deepStrictEqual(result.ok && result.ctx, { user: { id: "u1" } });
	});
});

describe("stagehandAdapter: rollback", () => {
	test("a rollbackKey naming a TInput field arrives alongside an output field", async () => {
		const seen: unknown[] = [];
		const charge = steps.defineStep<Empty, { amount: number }>()({
			name: "charge",
			handler: async ({ amount }) => ({ chargeId: `ch_${amount}` }),
			// `amount` lives in the script's input, `chargeId` in ctx — stagehand
			// only types the second kind, and only ever reserves ctx keys.
			rollbackKeys: ["amount", "chargeId"],
			rollback: async (data) => {
				seen.push(data);
			},
		});

		const result = await new Script<{ amount: number }>({ name: "t", ...quiet })
			.addPhase("Charge")
			.addStep(charge.stageHand)
			.addStep(boom)
			.run({ amount: 7 });

		assert.strictEqual(result.ok, false);
		assert.deepStrictEqual(seen, [{ amount: 7, chargeId: "ch_7" }]);
	});

	test("a rollbackKey naming a ctx field an earlier step produced (inherited key)", async () => {
		const seen: unknown[] = [];
		const audit = steps.defineStep<{ user: { id: string } }>()({
			name: "audit",
			handler: async () => {},
			rollbackKeys: ["user"],
			rollback: async (data) => {
				seen.push(data);
			},
		});

		const result = await new Script<Empty>({ name: "t", ...quiet })
			.addPhase("Audit")
			.addStep({ name: "seed", handler: () => ({ user: { id: "u1" } }) })
			.addStep(audit.stageHand)
			.addStep(boom)
			.run({});

		assert.strictEqual(result.ok, false);
		assert.deepStrictEqual(seen, [{ user: { id: "u1" } }]);
	});

	test("a rollback only sees the keys it declared, even from the script's input", async () => {
		const seen: unknown[] = [];
		const charge = steps.defineStep<
			Empty,
			{ amount: number; secret: string }
		>()({
			name: "charge",
			handler: async ({ amount }) => ({ chargeId: `ch_${amount}` }),
			rollbackKeys: ["chargeId"],
			rollback: async (data) => {
				seen.push(data);
			},
		});

		await new Script<{ amount: number; secret: string }>({
			name: "t",
			...quiet,
		})
			.addPhase("Charge")
			.addStep(charge.stageHand)
			.addStep(boom)
			.run({ amount: 7, secret: "hunter2" });

		// stagehand hands every rollback the full `input`; the universal
		// contract promises only the declared keys, and the core narrows it.
		assert.deepStrictEqual(seen, [{ chargeId: "ch_7" }]);
	});
});

describe("stagehandAdapter: stagehand's own options, by spreading", () => {
	test("a cache with a `key` works on a spread step", async () => {
		let runs = 0;
		const lookup = steps.defineStep<Empty, { userId: string }>()({
			name: "lookup",
			handler: async ({ userId }) => {
				runs += 1;
				return { user: { id: userId } };
			},
		});

		const store = memoryStore();
		const run = (userId: string) =>
			new Script<{ userId: string }>({ name: "t", ...quiet })
				.addPhase("Lookup")
				.addStep({
					...lookup.stageHand,
					cache: { store, key: ({ input }) => input.userId },
				})
				.run({ userId });

		await run("u1");
		await run("u1"); // same key: served from the entry
		assert.strictEqual(runs, 1);
		await run("u2"); // different key: a miss
		assert.strictEqual(runs, 2);
	});

	test("timeoutMs and when are honoured on a spread step", async () => {
		let ran = false;
		const step = steps.defineStep<Empty>()({
			name: "skipped",
			handler: async () => {
				ran = true;
			},
		});

		const result = await new Script<Empty>({ name: "t", ...quiet })
			.addPhase("P")
			.addStep({ ...step.stageHand, timeoutMs: 5_000, when: () => false })
			.run({});

		assert.strictEqual(result.ok, true);
		assert.strictEqual(ran, false);
	});
});
