import assert from "node:assert";
import test, { beforeEach, describe } from "node:test";
import { calls, charge, failing, loadUser, rollbackSeen } from "./app.ts";

/** What the spec needs of a step: it has been built for every environment. */
export interface SpecStep {
	readonly name: string;
	readonly function: ((data: never) => Promise<unknown>) & {
		rollback(data: never): Promise<void>;
	};
	readonly stageHand: unknown;
	readonly stepQueue: unknown;
}

/**
 * How to run a step inside one environment. The spec only ever talks to this,
 * so the same assertions run against a plain function call, a real stagehand
 * `Script`, and a real step-queue worker.
 */
export interface Harness {
	/** The registered name, which the helper implementations tag their calls with. */
	readonly environment: "function" | "stageHand" | "stepQueue";
	/**
	 * Run `step` as the only step of a run started with `data`. Resolves to the
	 * data after it — the input plus whatever the step added — and rejects with
	 * the step's error if it fails.
	 */
	run(step: SpecStep, data: object): Promise<Record<string, unknown>>;
	/** Run `step`, then a step that fails, so `step`'s rollback runs. Resolves once it has. */
	runThenFail(step: SpecStep, data: object): Promise<void>;
}

/**
 * The behaviour every environment must share. A step that passes here means
 * the same thing wherever it is mounted; an environment that fails it is not
 * running steps the way the others do.
 */
export function defineStepSpec(harness: Harness): void {
	describe(`step spec: ${harness.environment}`, () => {
		beforeEach(() => {
			calls.length = 0;
			rollbackSeen.length = 0;
		});

		test("runs the handler on the run's data and adds its output", async () => {
			const after = await harness.run(loadUser, { userId: "u1" });
			assert.deepStrictEqual(after.user, { id: "u1", name: "Ada" });
			assert.strictEqual(after.userId, "u1");
		});

		test("a step can use data an earlier step would have produced", async () => {
			const after = await harness.run(charge, {
				user: { id: "u1" },
				amount: 5,
				secret: "s",
			});
			assert.strictEqual(after.chargeId, "ch_u1_5");
		});

		test("its helpers are this environment's implementations, in call order", async () => {
			await harness.run(loadUser, { userId: "u1" });
			const environment = harness.environment;
			assert.deepStrictEqual(calls, [
				{ environment, helper: "status", message: "loading" },
				{ environment, helper: "log", message: "user u1" },
			]);
		});

		test("a failing handler fails the run with its own error", async () => {
			await assert.rejects(harness.run(failing, {}), /nope/);
		});

		test("its rollback sees only the keys it declared", async () => {
			await harness.runThenFail(charge, {
				user: { id: "u1" },
				amount: 5,
				secret: "hunter2",
			});
			assert.deepStrictEqual(rollbackSeen, [
				{ chargeId: "ch_u1_5", user: { id: "u1" } },
			]);
		});

		test("its rollback gets this environment's helpers too", async () => {
			await harness.runThenFail(charge, {
				user: { id: "u1" },
				amount: 5,
				secret: "s",
			});
			assert.ok(
				calls.some(
					(call) =>
						call.environment === harness.environment &&
						call.helper === "log" &&
						call.message === "refunding ch_u1_5",
				),
				`no rollback log from "${harness.environment}" in ${JSON.stringify(calls)}`,
			);
		});
	});
}
