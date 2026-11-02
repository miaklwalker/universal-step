/** Flattens an intersection into a single, readable object type. */
export type Prettify<T> = { [K in keyof T]: T[K] } & {};

/**
 * "No data": what to pass for `TRequired` or `TInput` when a step needs none.
 * It is also the default for `TInput`. (`{}` would also compile, but means "any
 * non-nullish value", and lint rightly objects to it.)
 */
export type NoData = Record<never, never>;

// When TOutput is void, a rollback's data shouldn't try to merge void in. This
// is the same trick step-queue's standalone steps use for the same reason.
export type VoidSafe<T> = T extends void ? Record<never, never> : T;

/**
 * The four type parameters of a step, bundled so an adapter's target type can
 * be computed from them without the core knowing what that target looks like.
 */
export interface StepTypes {
	readonly required: unknown;
	readonly input: unknown;
	readonly output: unknown;
	readonly rollbackKeys: readonly PropertyKey[];
}

type Known<S extends StepTypes> = S["required"] &
	S["input"] &
	VoidSafe<S["output"]>;

/** What a step's handler receives: the required and input data, merged. */
export type StepData<S extends StepTypes> = Prettify<
	S["required"] & S["input"]
>;

/** What a step's rollback receives: only the keys it declared in `rollbackKeys`. */
export type RollbackData<S extends StepTypes> = Prettify<
	Pick<Known<S>, Extract<S["rollbackKeys"][number], keyof Known<S>>>
>;

/**
 * A step defined once against the part every step-oriented framework agrees
 * on: the data it needs, what it hands back to be merged into that data
 * (`TOutput`), and — using the "only these keys, and they're reserved
 * elsewhere" contract both frameworks share — how to undo itself.
 *
 * The data comes in two flavours, because the frameworks disagree about
 * whether the distinction exists. `TRequired` is data some earlier step is
 * expected to have produced. `TInput` is data the run is expected to have
 * started with. step-queue's `job.data` is both from the start, so it never
 * notices; stagehand keeps `ctx` and `input` apart, so its adapter maps them
 * onto each. The handler and rollback always see them merged into one `data`.
 *
 * `THelpers` is whatever `defineHelpers` registered on the app.
 */
export interface StepConfig<
	TRequired,
	TInput,
	TOutput,
	TRollbackKeys extends readonly PropertyKey[],
	THelpers,
> {
	name: string;
	description?: string;
	/** The work. Whatever it resolves to is merged into the accumulated data. */
	handler: (
		data: Prettify<TRequired & TInput>,
		helpers: THelpers,
	) => TOutput | Promise<TOutput>;
	/**
	 * The keys of the merged data (required, input, and this step's own
	 * output) that `rollback` needs. It receives only these — none by default
	 * — and declaring them reserves them, so neither host framework will let
	 * an earlier `clean` drop them out from under a rollback that might still
	 * need them.
	 */
	rollbackKeys?: TRollbackKeys &
		readonly (keyof (TRequired & TInput & VoidSafe<TOutput>))[];
	/** Compensation. Runs when a later step fails, after this one has succeeded. */
	rollback?: (
		data: Prettify<
			Pick<
				TRequired & TInput & VoidSafe<TOutput>,
				Extract<
					TRollbackKeys[number],
					keyof (TRequired & TInput & VoidSafe<TOutput>)
				>
			>
		>,
		helpers: THelpers,
	) => void | Promise<void>;
}
