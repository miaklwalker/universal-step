/**
 * Steps written once, against the app in ./app.ts. Nothing here mentions
 * stagehand or step-queue: a step declares the data it needs, the helpers it
 * calls, and how to undo itself.
 */
import type { NoData } from "../modules/index.ts";
import { steps } from "./app.ts";

// Needs nothing from earlier steps — only `userId`, straight from the run's
// input. (`NoData` means "nothing required".)
export const loadUser = steps.defineStep<NoData, { userId: string }>()({
	name: "loadUser",
	handler: async ({ userId }, { status }) => {
		status(`loading ${userId}`);
		return { user: { id: userId, name: "Ada" } };
	},
});

// A mix: `user` is expected from an earlier step's output, `amount` from the
// run's input. The handler sees them as one object either way.
export const chargeCard = steps.defineStep<
	{ user: { id: string; name: string } },
	{ amount: number }
>()({
	name: "chargeCard",
	handler: async ({ user, amount }, { log }) => {
		log(`charging ${user.name} $${amount}`);
		return { chargeId: `ch_${user.id}_${amount}` };
	},
	// Only `chargeId` is handed to the rollback, in every framework.
	rollbackKeys: ["chargeId"],
	rollback: async ({ chargeId }, { log }) => {
		log(`refunding ${chargeId}`);
	},
});
