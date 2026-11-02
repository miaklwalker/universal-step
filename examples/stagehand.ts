/**
 * The shared steps in a real stagehand script. A stagehand `Script` needs no
 * infrastructure, so this runs for real: a successful run, then one where a
 * later step fails and the shared step's rollback fires.
 */
import { Script } from "@michaelrwalker/stagehand";
import { chargeCard, loadUser } from "./commonSteps.ts";

function makeScript() {
	return (
		new Script<{ userId: string; amount: number }>({
			name: "checkout",
			plain: true,
		})
			.addPhase("Charge")
			// `.stageHand` is a stagehand step like any other. `userId` and `amount`
			// are read from the script's input; `user` from the ctx loadUser built.
			.addStep(loadUser.stageHand)
			.addStep(chargeCard.stageHand)
	);
}

const ok = await makeScript().run({ userId: "u_1", amount: 42 });
console.log("success run:", ok.ok, ok.ok ? ok.ctx : undefined);

const failing = await makeScript()
	.addPhase("Ship")
	.addStep({
		name: "ship",
		handler: async () => {
			throw new Error("warehouse is down");
		},
	})
	.run({ userId: "u_2", amount: 15 });

console.log(
	"failing run:",
	failing.ok,
	failing.ok ? undefined : String(failing.error),
);
