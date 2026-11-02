/**
 * Testing a shared step with no queue, no script and no mocks: `.function` is
 * the step called like any other function. It runs through the same core as
 * `.stageHand` and `.stepQueue` — same data merging, same helpers (their
 * `function` implementations), same narrowing of what a rollback may see.
 */
import assert from "node:assert";
import { chargeCard, loadUser } from "./commonSteps.ts";

const { user } = await loadUser.function({ userId: "u_1" });
assert.deepStrictEqual(user, { id: "u_1", name: "Ada" });

const { chargeId } = await chargeCard.function({ user, amount: 42 });
assert.strictEqual(chargeId, "ch_u_1_42");

// The rollback is typed to, and only given, the keys it declared.
await chargeCard.function.rollback({ chargeId });

console.log("all assertions passed");
