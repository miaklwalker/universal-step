// Type-only on purpose. step-queue publishes raw `.ts`, which Node refuses to
// load from `node_modules`, so a runtime import here would break this adapter
// for anyone running plain Node. Nothing here needs it at runtime.
import type { StandaloneStep, TypedJob } from "@michaelrwalker/step-queue";
import { type AsStep, defineAdapter, type TargetKind } from "../adapter.ts";
import type { StepTypes } from "../types.ts";
import type { Prettify } from "../types.ts";

/** What a step-queue helper implementation receives: the running job. */
export type StepQueueNative = TypedJob<unknown>;

type StepQueueTarget<S extends StepTypes> = StandaloneStep<
	Prettify<S["required"] & S["input"]>,
	S["output"],
	S["rollbackKeys"]
>;

export interface StepQueueKind extends TargetKind {
	readonly target: StepQueueTarget<AsStep<this["step"]>>;
}

/**
 * Registers step-queue. The step it produces is a `StandaloneStep` for a
 * processor's `.addStep()`. step-queue has no separate notion of "input" —
 * `job.data` starts out as the input and grows from there — so a step's
 * `TRequired` and `TInput` both just mean "already in `job.data`" here.
 *
 * ```ts
 * new UniversalSteps().use("stepQueue", stepQueueAdapter)
 * ```
 *
 * step-queue features a universal step can't express (`progressReport`,
 * `clean`, child queues) are added by spreading at the mount site:
 * `processor.addStep({ ...loadUser.stepQueue, clean: ["password"] })`.
 */
export const stepQueueAdapter = defineAdapter<StepQueueNative, StepQueueKind>({
	build: (step) => ({
		name: step.name,
		rollbackKeys: step.rollbackKeys,
		handler: async (job: StepQueueNative) =>
			step.invoke(job, (job.data ?? {}) as object),
		rollback: step.hasRollback
			? async (job: StepQueueNative) =>
					step.invokeRollback(job, (job.data ?? {}) as object)
			: undefined,
	}),
});
