/**
 * The same shared steps, in step-queue.
 *
 * A real run needs a live queue and a worker — `npm run test:queue` does
 * exactly that, with a Redis it starts itself. Here the step's handler is
 * called against a stand-in job, which is enough to show the helpers landing
 * in `job.log`. The `ProcessorBuilder` chain is a compile-time proof (checked
 * by `tsc`, never run: step-queue ships raw `.ts`, which Node won't load from
 * node_modules) that `.stepQueue` is a step step-queue accepts.
 */
import type { ProcessorBuilder, TypedJob } from "@michaelrwalker/step-queue";
import { chargeCard, loadUser } from "./commonSteps.ts";

type Start = ReturnType<
	typeof ProcessorBuilder.init<{ userId: string; amount: number }>
>;

// Fails to compile if `chargeCard` came before `loadUser`: it needs `user`.
export const chain = (builder: Start) =>
	builder.addStep(loadUser.stepQueue).addStep(chargeCard.stepQueue);

function fakeJob<TData extends object>(data: TData): TypedJob<TData> {
	return {
		data,
		log: async (row: string) => {
			console.log(`[job.log] ${row}`);
			return 0;
		},
	} as unknown as TypedJob<TData>;
}

const { user } = (await loadUser.stepQueue.handler(
	fakeJob({ userId: "u_1" }),
	undefined,
)) as { user: { id: string; name: string } };

const { chargeId } = await chargeCard.stepQueue.handler(
	fakeJob({ user, amount: 42 }),
	undefined,
);
console.log(`charged: ${chargeId}`);

// A later step failed: unwind what already succeeded.
await chargeCard.stepQueue.rollback?.(fakeJob({ chargeId }), undefined);
