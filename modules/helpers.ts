import type { AdapterMap, NativeOf } from "./adapter.ts";
import type { FunctionNative } from "./functionAdapter.ts";

/** The widest function type; every helper implementation returns one. */
type AnyHelper = (...args: never[]) => unknown;

/**
 * What `defineHelpers` takes: for each helper, one implementation per
 * registered adapter — plus `function`, always. An implementation is curried:
 * it receives the framework's native context (typed from the adapter) and
 * returns the function the step actually calls.
 *
 * ```ts
 * status: {
 *   stageHand: (ctx) => (message: string) => ctx.status(message),
 *   stepQueue: (job) => (message: string) => void job.log(message),
 *   function:  () => (_message: string) => {},
 * }
 * ```
 */
export type HelperImplementations<TAdapters extends AdapterMap> = {
	readonly [helper: string]: {
		readonly [N in keyof TAdapters]: (
			native: NativeOf<TAdapters[N]>,
		) => AnyHelper;
	} & { readonly function: (native: FunctionNative) => AnyHelper };
};

/** What each implementation of a helper returns, as a union. */
type Returns<E> = {
	[N in keyof E]: E[N] extends (native: never) => infer R ? R : never;
}[keyof E];

/**
 * The one signature a helper has, given that its implementations may differ in
 * detail: the member of the union that every other member is assignable to. A
 * no-op `() => () => {}` and a `(m: string) => void` agree on `(m: string) =>
 * void`; two helpers that take unrelated arguments agree on nothing, and this
 * is `never`.
 */
type Greatest<All, Each = All> = Each extends unknown
	? [All] extends [Each]
		? Each
		: never
	: never;

type UnionToIntersection<U> = (
	U extends unknown
		? (arg: U) => void
		: never
) extends (arg: infer I) => void
	? I
	: never;

/**
 * One member of a union. Used because two implementations with the same
 * signature but different parameter names are different type objects, so
 * their union doesn't collapse on its own; every member is equivalent by the
 * time this runs, so which one is picked doesn't matter.
 */
type One<U> =
	UnionToIntersection<U extends unknown ? () => U : never> extends () => infer L
		? L
		: never;

/** The helpers a step's handler receives, keyed by the names they were registered under. */
export type HelpersOf<H> = { [K in keyof H]: One<Greatest<Returns<H[K]>>> };

/** Shown, as the offending property's type, when a helper's implementations don't agree. */
export interface InconsistentHelper<K> {
	readonly error: "The implementations of this helper do not share a call signature";
	readonly helper: K;
}

/** Shown when a helper names an adapter that was never registered. */
export interface UnknownAdapter<Names> {
	readonly error: "This helper has implementations for adapters that are not registered";
	readonly names: Names;
}

/**
 * Intersected with `defineHelpers`' argument to turn the two rules the
 * implementation map alone can't express into errors on the offending helper.
 */
export type CheckHelpers<TAdapters extends AdapterMap, H> = {
	readonly [K in keyof H]: [Greatest<Returns<H[K]>>] extends [never]
		? InconsistentHelper<K>
		: [Exclude<keyof H[K], keyof TAdapters | "function">] extends [never]
			? unknown
			: UnknownAdapter<Exclude<keyof H[K], keyof TAdapters | "function">>;
};
