import { defineAdapter, type TargetKind } from "../modules/index.ts";

// ---- compile-time assertion helpers (checked by `npm run typecheck`) ----
export type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;
export type Expect<T extends true> = T;

/** Shorthand for "nothing required", spelled the way biome allows. */
export type Empty = Record<never, never>;

// ---- a fake framework, so the core can be tested without a real one ----

/** What the fake framework hands a step while it runs. */
export interface FakeNative {
	readonly data: object;
	readonly logs: string[];
}

/** What the fake framework wants a step turned into. */
export interface FakeTarget {
	run(native: FakeNative): Promise<unknown>;
	undo(native: FakeNative): Promise<void>;
}

export interface FakeKind extends TargetKind {
	readonly target: FakeTarget;
}

export const fakeAdapter = defineAdapter<FakeNative, FakeKind>({
	build: (step) => ({
		run: (native: FakeNative) => step.invoke(native, native.data),
		undo: (native: FakeNative) => step.invokeRollback(native, native.data),
	}),
});

export function fakeNative(data: object = {}, logs: string[] = []): FakeNative {
	return { data, logs };
}
