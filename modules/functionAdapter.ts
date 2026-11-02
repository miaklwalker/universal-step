import { type AsStep, defineAdapter, type TargetKind } from "./adapter.ts";
import type { RollbackData, StepData, StepTypes } from "./types.ts";

/**
 * Helper implementations for the `function` environment receive nothing: a
 * plain call has no job and no script around it.
 */
export type FunctionNative = undefined;

/**
 * A step called like any other function — the environment tests use, so a
 * step can be exercised without a queue or a script. It runs through the same
 * core as every other environment: the same data merging, the same helper
 * binding, the same narrowing of what a rollback sees. Only the `function`
 * implementation of each helper differs.
 */
export interface StepFunction<S extends StepTypes> {
	(data: StepData<S>): Promise<S["output"]>;
	/** Run the step's rollback. `data` is narrowed to `rollbackKeys`, as in production. */
	rollback(data: RollbackData<S>): Promise<void>;
}

export interface FunctionKind extends TargetKind {
	readonly target: StepFunction<AsStep<this["step"]>>;
}

/** The environment every app has, whether it registers any others or not. */
export const functionAdapter = defineAdapter<FunctionNative, FunctionKind>({
	build: (step) =>
		Object.assign((data: object) => step.invoke(undefined, data), {
			rollback: (data: object) => step.invokeRollback(undefined, data),
		}),
});
