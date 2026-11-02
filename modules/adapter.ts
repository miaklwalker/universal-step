import type { StepFunction } from "./functionAdapter.ts";
import type { StepTypes } from "./types.ts";

/**
 * What an adapter is handed for one step. The core owns *running* the step —
 * merging the data, binding the helpers for this environment, narrowing what
 * a rollback may see — so every environment behaves identically, including
 * the one tests use. An adapter only decides where the native context and
 * the data come from, and what shape the framework wants the result in.
 */
export interface RunnableStep<TNative = unknown> {
	readonly name: string;
	readonly description: string | undefined;
	readonly rollbackKeys: readonly PropertyKey[] | undefined;
	readonly hasRollback: boolean;
	/** Run the handler with `data`, binding this environment's helpers to `native`. */
	invoke(native: TNative, data: object): Promise<unknown>;
	/**
	 * Run the rollback. `data` may be everything the framework has to hand;
	 * it is narrowed to the step's `rollbackKeys` here, not by the adapter.
	 */
	invokeRollback(native: TNative, data: object): Promise<void>;
}

/**
 * Type-level encoding of "the step type this adapter produces", which depends
 * on the step's own type parameters. TypeScript has no higher-kinded types, so
 * each adapter declares an interface extending this one and writes `target` in
 * terms of `this["step"]` — which the core fills in per step.
 *
 * ```ts
 * interface MyKind extends TargetKind {
 *   readonly target: MyStep<AsStep<this["step"]>["required"]>;
 * }
 * ```
 */
export interface TargetKind {
	/**
	 * Placeholder, filled in per step. Declared `unknown` rather than
	 * `StepTypes` because it is intersected with the real types, and only
	 * `unknown` leaves them untouched.
	 */
	readonly step: unknown;
	readonly target: unknown;
}

/**
 * Narrows `this["step"]` inside a kind's `target` to the step's types, so they
 * can be indexed. It is the identity for every real step.
 */
export type AsStep<S> = S extends StepTypes ? S : never;

/** The target type an adapter of kind `TKind` produces for steps of type `S`. */
export type Target<TKind extends TargetKind, S extends StepTypes> = (TKind & {
	readonly step: S;
})["target"];

/**
 * A framework, as the core sees it. `TNative` is whatever the framework hands
 * a step while it runs (a BullMQ job, a stagehand context) and what helper
 * implementations for this adapter receive. `TKind` says what `build`
 * returns, for the types.
 */
export interface Adapter<
	TNative = unknown,
	TKind extends TargetKind = TargetKind,
> {
	/**
	 * Turn one step into this framework's own shape. The return type is
	 * erased here — `TKind` is what consumers see — so a `build` is
	 * responsible for actually matching it.
	 */
	readonly build: (step: RunnableStep<TNative>) => unknown;
	/** Phantom: carries `TKind` for inference. Never set. */
	readonly kind?: TKind;
}

// biome-ignore lint/suspicious/noExplicitAny: the registry holds adapters with different native and target types, which only a wildcard accepts
export type AnyAdapter = Adapter<any, any>;

/** Registered adapters, keyed by the name the app gave each. */
export type AdapterMap = Record<string, AnyAdapter>;

/** The native context type an adapter's helper implementations receive. */
export type NativeOf<A> = A extends {
	readonly build: (step: RunnableStep<infer N>) => unknown;
}
	? N
	: never;

/** The target-kind of a registered adapter. */
export type KindOf<A> = A extends { readonly kind?: infer K }
	? Exclude<K, undefined> extends infer E extends TargetKind
		? E
		: never
	: never;

/** Names that would collide with what a step exposes itself. */
export type ReservedName = "function" | "name";

/**
 * What a defined step looks like: its name, a plain callable (the built-in
 * `function` environment, for tests), and one property per registered
 * adapter holding that framework's own step.
 */
export type Step<TAdapters extends AdapterMap, S extends StepTypes> = {
	readonly name: string;
	readonly function: StepFunction<S>;
} & {
	readonly [N in keyof TAdapters]: Target<KindOf<TAdapters[N]>, S>;
};

/**
 * Declare an adapter. Both type arguments are required — they can't be
 * inferred from `build`, which is erased — and write themselves once per
 * adapter:
 *
 * ```ts
 * export const myAdapter = defineAdapter<MyNative, MyKind>({
 *   build: (step) => ({ run: (native: MyNative) => step.invoke(native, readData(native)) }),
 * });
 * ```
 */
export function defineAdapter<TNative, TKind extends TargetKind>(adapter: {
	build: (step: RunnableStep<TNative>) => unknown;
}): Adapter<TNative, TKind> {
	return adapter;
}
