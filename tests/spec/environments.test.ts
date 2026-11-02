import { functionHarness, stagehandHarness } from "./harnesses.ts";
import { defineStepSpec } from "./stepSpec.ts";

// The environments that need no infrastructure. step-queue's runs the same
// spec through a real BullMQ worker; see `npm run test:queue`.
defineStepSpec(functionHarness);
defineStepSpec(stagehandHarness);
