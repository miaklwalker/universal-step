import { Script } from "@michaelrwalker/stagehand";
import type { Harness, SpecStep } from "./stepSpec.ts";

type Callable = ((data: object) => Promise<unknown>) & {
	rollback(data: object): Promise<void>;
};

const callable = (step: SpecStep): Callable =>
	step.function as unknown as Callable;

/** The step called like any other function: no framework, nothing to start. */
export const functionHarness: Harness = {
	environment: "function",
	run: async (step, data) => ({
		...data,
		...((await callable(step)(data)) as object | undefined),
	}),
	runThenFail: async (step, data) => {
		const output = (await callable(step)(data)) as object | undefined;
		// A function has no later step to fail, so rolling back is the failure.
		await callable(step).rollback({ ...data, ...output });
	},
};

const boom = {
	name: "boom",
	handler: async (): Promise<void> => {
		throw new Error("boom");
	},
};

async function runInScript(step: SpecStep, data: object, thenFail: boolean) {
	const script = new Script<Record<string, unknown>>({
		name: "spec",
		plain: true,
		silent: true,
	}).addPhase("Spec");
	// The step is typed for its own data, which the spec's erased view can't
	// express; the cast is the harness's, not the adapter's.
	const withStep = script.addStep(step.stageHand as never);
	return (thenFail ? withStep.addStep(boom as never) : withStep).run(
		data as Record<string, unknown>,
	);
}

/** The step mounted in a real stagehand `Script` and run to completion. */
export const stagehandHarness: Harness = {
	environment: "stageHand",
	run: async (step, data) => {
		const result = await runInScript(step, data, false);
		if (!result.ok) throw result.error;
		return { ...data, ...(result.ctx as object) };
	},
	runThenFail: async (step, data) => {
		const result = await runInScript(step, data, true);
		if (result.ok) throw new Error("expected the script to fail");
	},
};
