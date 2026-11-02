import { UniversalSteps } from "../../modules/index.ts";
import { stagehandAdapter } from "../../stagehand.ts";
import { stepQueueAdapter } from "../../step-queue.ts";
import type { Empty } from "../support.ts";

/** One helper call, tagged with the environment whose implementation made it. */
export interface Call {
	readonly environment: string;
	readonly helper: string;
	readonly message: string;
}

/** Every helper call, in order. The spec clears it before each test. */
export const calls: Call[] = [];

/** What each `charge` rollback was handed. The spec clears it before each test. */
export const rollbackSeen: object[] = [];

const record = (environment: string, helper: string) => (message: string) => {
	calls.push({ environment, helper, message });
};

/**
 * The app every environment is tested through: both real frameworks, and
 * `log`/`status` helpers whose implementations record the call (so the spec
 * can see *which environment's* implementation ran) before doing what that
 * framework does with it.
 */
export const steps = new UniversalSteps()
	.use("stageHand", stagehandAdapter)
	.use("stepQueue", stepQueueAdapter)
	.defineHelpers({
		log: {
			stageHand: (ctx) => (message: string) => {
				record("stageHand", "log")(message);
				ctx.log(message);
			},
			stepQueue: (job) => (message: string) => {
				record("stepQueue", "log")(message);
				void job.log(message);
			},
			function: () => record("function", "log"),
		},
		status: {
			stageHand: (ctx) => (message: string) => {
				record("stageHand", "status")(message);
				ctx.status(message);
			},
			// step-queue has no live status line, so the closest thing is a log row.
			stepQueue: (job) => (message: string) => {
				record("stepQueue", "status")(message);
				void job.log(`[status] ${message}`);
			},
			function: () => record("function", "status"),
		},
	});

export const loadUser = steps.defineStep<Empty, { userId: string }>()({
	name: "loadUser",
	handler: async ({ userId }, { log, status }) => {
		status("loading");
		log(`user ${userId}`);
		return { user: { id: userId, name: "Ada" } };
	},
});

export const charge = steps.defineStep<
	{ user: { id: string } },
	{ amount: number; secret: string }
>()({
	name: "charge",
	handler: async ({ user, amount }) => ({
		chargeId: `ch_${user.id}_${amount}`,
	}),
	rollbackKeys: ["chargeId", "user"],
	rollback: async (data, { log }) => {
		rollbackSeen.push(data);
		log(`refunding ${data.chargeId}`);
	},
});

export const failing = steps.defineStep<Empty>()({
	name: "failing",
	handler: async (): Promise<void> => {
		throw new Error("nope");
	},
});
