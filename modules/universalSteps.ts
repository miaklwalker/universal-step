import type {
	AdapterMap,
	AnyAdapter,
	ReservedName,
	RunnableStep,
	Step,
} from "./adapter.ts";
import { UniversalStepError } from "./errors.ts";
import { functionAdapter } from "./functionAdapter.ts";
import type {
	CheckHelpers,
	HelperImplementations,
	HelpersOf,
} from "./helpers.ts";
import type { NoData, Prettify, StepConfig } from "./types.ts";

const RESERVED_NAMES: readonly string[] = ["function", "name"];

type HelperImplementation = (native: never) => (...args: never[]) => unknown;
type HelperRegistry = Readonly<
	Record<string, Readonly<Record<string, HelperImplementation>>>
>;

/** A step config with its generics erased, which is all the runtime needs. */
interface ErasedConfig {
	name: string;
	description?: string;
	handler: (data: object, helpers: object) => unknown;
	rollbackKeys?: readonly PropertyKey[];
	rollback?: (data: object, helpers: object) => unknown;
}

type StepOf<
	TAdapters extends AdapterMap,
	TRequired,
	TInput,
	TOutput,
	TRollbackKeys extends readonly PropertyKey[],
> = Step<
	TAdapters,
	{
		readonly required: TRequired;
		readonly input: TInput;
		readonly output: TOutput;
		readonly rollbackKeys: TRollbackKeys;
	}
>;

/** Rejects a name that is reserved or already registered. */
type ValidName<N, TAdapters> = N extends keyof TAdapters | ReservedName
	? never
	: unknown;

function pick(source: object, keys: readonly PropertyKey[]): object {
	const picked: Record<PropertyKey, unknown> = {};
	for (const key of keys) {
		if (key in source) {
			picked[key] = (source as Record<PropertyKey, unknown>)[key];
		}
	}
	return picked;
}

/** Calls each helper's implementation for `environment` with the native context. */
function bindHelpers(
	environment: string,
	registry: HelperRegistry,
	native: unknown,
): Record<string, unknown> {
	const bound: Record<string, unknown> = {};
	for (const [helper, implementations] of Object.entries(registry)) {
		const implementation = implementations[environment] as (
			native: unknown,
		) => unknown;
		bound[helper] = implementation(native);
	}
	return bound;
}

/**
 * The one place a step is actually run. Every environment — the frameworks'
 * and the plain-function one alike — goes through here, so what a test sees
 * is what production does: the same merged data, the same helpers, the same
 * narrowing of what a rollback may read.
 */
function createRunnable(
	environment: string,
	config: ErasedConfig,
	registry: HelperRegistry,
): RunnableStep {
	return {
		name: config.name,
		description: config.description,
		rollbackKeys: config.rollbackKeys,
		hasRollback: config.rollback !== undefined,
		invoke: async (native, data) =>
			config.handler(data, bindHelpers(environment, registry, native)),
		invokeRollback: async (native, data) => {
			if (!config.rollback) return;
			await config.rollback(
				pick(data, config.rollbackKeys ?? []),
				bindHelpers(environment, registry, native),
			);
		},
	};
}

function validateConfig(config: unknown): ErasedConfig {
	const candidate = config as Partial<ErasedConfig> | null;
	if (typeof candidate?.name !== "string" || candidate.name === "") {
		throw new UniversalStepError(
			"A step needs a non-empty `name`. Pass one to defineStep()({ name, handler }).",
		);
	}
	if (typeof candidate.handler !== "function") {
		throw new UniversalStepError(
			`Step "${candidate.name}" has no \`handler\` function.`,
		);
	}
	if (
		candidate.rollback !== undefined &&
		typeof candidate.rollback !== "function"
	) {
		throw new UniversalStepError(
			`Step "${candidate.name}" has a \`rollback\` that is not a function.`,
		);
	}
	if (
		candidate.rollbackKeys !== undefined &&
		!Array.isArray(candidate.rollbackKeys)
	) {
		throw new UniversalStepError(
			`Step "${candidate.name}" has \`rollbackKeys\` that is not an array.`,
		);
	}
	return candidate as ErasedConfig;
}

function validateHelpers(
	adapters: ReadonlyMap<string, AnyAdapter>,
	helpers: unknown,
): HelperRegistry {
	const environments = [...adapters.keys(), "function"];
	for (const [helper, implementations] of Object.entries(
		helpers as Record<string, unknown>,
	)) {
		if (typeof implementations !== "object" || implementations === null) {
			throw new UniversalStepError(
				`Helper "${helper}" must be an object with one implementation per adapter (${environments.join(", ")}).`,
			);
		}
		const given = implementations as Record<string, unknown>;
		for (const environment of environments) {
			if (typeof given[environment] !== "function") {
				throw new UniversalStepError(
					`Helper "${helper}" has no implementation for "${environment}". Every helper needs one for each registered adapter (${environments.join(", ")}), including "function".`,
				);
			}
		}
		const unknown = Object.keys(given).filter(
			(key) => !environments.includes(key),
		);
		if (unknown.length > 0) {
			throw new UniversalStepError(
				`Helper "${helper}" has implementations for ${unknown.map((key) => `"${key}"`).join(", ")}, which ${unknown.length === 1 ? "is" : "are"} not registered. Registered: ${environments.join(", ")}.`,
			);
		}
	}
	return helpers as HelperRegistry;
}

/**
 * What `defineHelpers` hands back: the same app, with its adapters locked in
 * and its helpers known, ready to define steps. Not constructed directly.
 */
export class StepFactory<TAdapters extends AdapterMap, THelpers> {
	readonly #adapters: ReadonlyMap<string, AnyAdapter>;
	readonly #registry: HelperRegistry;

	constructor(
		adapters: ReadonlyMap<string, AnyAdapter>,
		registry: HelperRegistry,
	) {
		this.#adapters = adapters;
		this.#registry = registry;
	}

	/**
	 * Define a step. `TRequired` is data some earlier step is expected to have
	 * produced; `TInput` (usually left at its default) is data the run is
	 * expected to have started with. The handler sees them merged into one
	 * `data` object, with the helpers as its second argument.
	 *
	 * What comes back has the step's `name`, a plain-function version
	 * (`.function`), and one property per registered adapter holding that
	 * framework's own step, ready to hand to its `addStep()`.
	 *
	 * The two-step call is deliberate: TypeScript can't infer part of a type
	 * argument list, so `TRequired` and `TInput` are fixed first and everything
	 * else is inferred from the object.
	 */
	defineStep<TRequired, TInput = NoData>() {
		return <
			TOutput = void,
			const TRollbackKeys extends readonly PropertyKey[] = readonly [],
		>(
			config: StepConfig<TRequired, TInput, TOutput, TRollbackKeys, THelpers>,
		): StepOf<TAdapters, TRequired, TInput, TOutput, TRollbackKeys> => {
			const erased = validateConfig(config);
			const step: Record<string, unknown> = { name: erased.name };
			for (const [name, adapter] of this.#adapters) {
				step[name] = adapter.build(
					createRunnable(name, erased, this.#registry),
				);
			}
			step.function = functionAdapter.build(
				createRunnable("function", erased, this.#registry),
			);
			return Object.freeze(step) as unknown as StepOf<
				TAdapters,
				TRequired,
				TInput,
				TOutput,
				TRollbackKeys
			>;
		};
	}
}

/**
 * The app-level entry point, created once per project. Register the
 * frameworks you use by name, then the helpers every step may call, then
 * define steps — each of which comes out as a ready-made step for every
 * framework you registered, plus a plain function for tests.
 *
 * Order matters and is enforced: helpers are checked against the adapters
 * registered before them, so `.use()` is no longer available once
 * `.defineHelpers()` has run.
 *
 * ```ts
 * const steps = new UniversalSteps()
 *   .use("stageHand", stagehandAdapter)
 *   .use("stepQueue", stepQueueAdapter)
 *   .defineHelpers({
 *     status: {
 *       stageHand: (ctx) => (message: string) => ctx.status(message),
 *       stepQueue: (job) => (message: string) => void job.log(message),
 *       function: () => (_message: string) => {},
 *     },
 *   });
 *
 * const loadUser = steps.defineStep<NoData, { userId: string }>()({
 *   name: "loadUser",
 *   handler: async ({ userId }, { status }) => {
 *     status("loading");
 *     return { user: await db.users.find(userId) };
 *   },
 * });
 *
 * script.addStep(loadUser.stageHand);          // in a stagehand script
 * processor.addStep(loadUser.stepQueue);       // in a step-queue processor
 * const { user } = await loadUser.function({ userId: "u1" }); // in a test
 * ```
 */
export class UniversalSteps<
	TAdapters extends AdapterMap = Record<never, never>,
> {
	readonly #adapters = new Map<string, AnyAdapter>();

	/**
	 * Register a framework under a name of your choosing. The name becomes the
	 * property it appears under on every step (`loadUser.stageHand`) and the
	 * key its helper implementations are written under.
	 *
	 * @throws {UniversalStepError} if the name is empty, reserved (`function`,
	 * `name`) or already registered.
	 */
	use<const N extends string, A extends AnyAdapter>(
		name: N & ValidName<N, TAdapters>,
		adapter: A,
	): UniversalSteps<TAdapters & Record<N, A>> {
		if (typeof name !== "string" || name === "") {
			throw new UniversalStepError("An adapter needs a non-empty name.");
		}
		if (RESERVED_NAMES.includes(name)) {
			throw new UniversalStepError(
				`"${name}" is reserved — every step already has a \`${name}\` property. Pick another name for this adapter.`,
			);
		}
		if (this.#adapters.has(name)) {
			throw new UniversalStepError(
				`An adapter named "${name}" is already registered.`,
			);
		}
		if (typeof adapter?.build !== "function") {
			throw new UniversalStepError(
				`The adapter registered as "${name}" has no \`build\` function. Create one with defineAdapter().`,
			);
		}
		this.#adapters.set(name, adapter);
		return this as unknown as UniversalSteps<TAdapters & Record<N, A>>;
	}

	/**
	 * Register the helpers steps may call — small utilities like `log`, `note`
	 * or `status` that mean something different in each framework, so a step
	 * never has to branch on where it is running.
	 *
	 * Each helper needs one implementation per registered adapter, and one for
	 * `function`. An implementation is curried: it receives the framework's
	 * native context, typed from the adapter, and returns the function the step
	 * calls. A framework with no real equivalent just does the closest thing —
	 * `status` can call `log`. The implementations of one helper must agree on
	 * a call signature, or the offending helper is a type error.
	 *
	 * @throws {UniversalStepError} if a helper is missing an implementation for
	 * a registered adapter, or has one for an adapter that isn't registered.
	 */
	defineHelpers<H extends HelperImplementations<TAdapters>>(
		helpers: H & NoInfer<CheckHelpers<TAdapters, H>>,
	): StepFactory<TAdapters, Prettify<HelpersOf<H>>> {
		const registry = validateHelpers(this.#adapters, helpers);
		return new StepFactory<TAdapters, Prettify<HelpersOf<H>>>(
			new Map(this.#adapters),
			registry,
		);
	}

	/** Define a step with no helpers. See {@link StepFactory.defineStep}. */
	defineStep<TRequired, TInput = NoData>() {
		return new StepFactory<TAdapters, Record<never, never>>(
			new Map(this.#adapters),
			{},
		).defineStep<TRequired, TInput>();
	}
}
