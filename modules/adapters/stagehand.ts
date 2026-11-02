// Type-only on purpose: stagehand is an optional peer, and nothing here needs
// it at runtime.
import type {
	RollbackContext,
	StepContext,
	StepDef,
} from "@michaelrwalker/stagehand";
import { type AsStep, defineAdapter, type TargetKind } from "../adapter.ts";
import type { StepTypes } from "../types.ts";

/**
 * What a stagehand helper implementation receives: the slice of stagehand's
 * context that exists in a step's handler and in its rollback alike, since the
 * same helpers are bound for both. (A handler-only member such as `warn` or
 * `prompt` isn't here; reach for it by writing the step against stagehand.)
 */
export type StagehandNative = Pick<
	RollbackContext<unknown, unknown, unknown>,
	| "input"
	| "signal"
	| "phase"
	| "step"
	| "log"
	| "status"
	| "note"
	| "progress"
	| "cache"
	| "flags"
>;

type StagehandTarget<S extends StepTypes> = [
	S["required"],
	S["input"],
	S["output"],
] extends [
	infer R extends object,
	infer I extends object,
	// biome-ignore lint/suspicious/noConfusingVoidType: matching stagehand's own `Out extends object | void` constraint on StepDef
	infer O extends object | void,
]
	? StepDef<I, R, O, S["rollbackKeys"]>
	: never;

export interface StagehandKind extends TargetKind {
	readonly target: StagehandTarget<AsStep<this["step"]>>;
}

type HandlerContext = StagehandNative & { readonly ctx: unknown };

/**
 * stagehand keeps a script's `input` and its accumulated `ctx` apart, on
 * purpose. A universal step declares which of its data it expects from each
 * (`TInput`, `TRequired`) and sees them merged — `ctx` winning, as the more
 * recent write.
 */
const dataOf = (context: HandlerContext): object => ({
	...((context.input ?? {}) as object),
	...((context.ctx ?? {}) as object),
});

/**
 * Registers stagehand. The step it produces is a `StepDef` mounted with
 * `Ctx = TRequired` and `In = TInput`, so `.addStep()` checks the script's
 * accumulated context and its input separately, as stagehand always has.
 *
 * ```ts
 * new UniversalSteps().use("stageHand", stagehandAdapter)
 * ```
 *
 * stagehand features a universal step can't express (`when`, `cache`,
 * `retry`, `timeoutMs`, `clean`) are added by spreading at the mount site:
 * `script.addStep({ ...loadUser.stageHand, timeoutMs: 5_000 })`.
 */
export const stagehandAdapter = defineAdapter<StagehandNative, StagehandKind>({
	build: (step) => ({
		name: step.name,
		description: step.description,
		rollbackKeys: step.rollbackKeys,
		handler: (context: StepContext<unknown, unknown>) =>
			step.invoke(context, dataOf(context)),
		rollback: step.hasRollback
			? (context: RollbackContext<unknown, unknown, unknown>) =>
					step.invokeRollback(context, dataOf(context))
			: undefined,
	}),
});
