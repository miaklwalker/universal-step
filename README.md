# @michaelrwalker/universal-step

Define a step once and use it in [`@michaelrwalker/stagehand`](https://www.npmjs.com/package/@michaelrwalker/stagehand),
in [`@michaelrwalker/step-queue`](https://www.npmjs.com/package/@michaelrwalker/step-queue),
and as a plain function in your tests. The three solve different problems — a
saga-style script in a terminal, a job moving through BullMQ, a unit test —
but a step is the same thing in all of them: it declares the data it needs,
hands back what it adds, and can undo itself given exactly the keys it asked
for. This package is that shared shape, plus a small contract for plugging in
the frameworks that run it.

You register the frameworks you use, once, by name. Each step you define then
comes out as a ready-made step for every one of them:

```ts
import { type NoData, UniversalSteps } from "@michaelrwalker/universal-step";
import { stagehandAdapter } from "@michaelrwalker/universal-step/stagehand";
import { stepQueueAdapter } from "@michaelrwalker/universal-step/step-queue";

const steps = new UniversalSteps()
  .use("stageHand", stagehandAdapter)
  .use("stepQueue", stepQueueAdapter)
  .defineHelpers({
    status: {
      stageHand: (ctx) => (message: string) => ctx.status(message),
      stepQueue: (job) => (message: string) => void job.log(message),
      function: () => (_message: string) => {},
    },
  });

const loadUser = steps.defineStep<NoData, { userId: string }>()({
  name: "loadUser",
  handler: async ({ userId }, { status }) => {
    status("loading");
    return { user: await db.users.find(userId) };
  },
});

script.addStep(loadUser.stageHand);        // in a stagehand script
processor.addStep(loadUser.stepQueue);     // in a step-queue processor
const { user } = await loadUser.function({ userId: "u1" }); // in a test
```

`loadUser.stageHand` and `loadUser.stepQueue` are each framework's own step
type, so from there on they are indistinguishable from a step written directly
against it: the framework's own generics still catch a step used before its
data exists. And the types hold from the other side too: a helper missing an
implementation for a registered framework, helpers that disagree on their
arguments, a step asking for a helper that doesn't exist, and a reserved or
duplicate adapter name are all compile errors.

## Install

```bash
npm install @michaelrwalker/universal-step
```

The package ships as TypeScript source with no build step, so a project using
it needs something that runs TypeScript from `node_modules` (bun, tsx, or a
bundler). Node itself refuses to strip types from files under `node_modules`.
step-queue publishes raw TypeScript for the same reason, so if you use it you
already have this.

It has no runtime dependencies. `@michaelrwalker/step-queue` and
`@michaelrwalker/stagehand` are **optional peer dependencies**, imported by the
adapters as types only, so install whichever you register:

```bash
npm install @michaelrwalker/stagehand     # for @michaelrwalker/universal-step/stagehand
npm install @michaelrwalker/step-queue    # for @michaelrwalker/universal-step/step-queue
```

## Setting up an app

`new UniversalSteps()` is created once per project, and its order is enforced:

1. **`.use(name, adapter)`** registers a framework under a name you choose. The
   name becomes the property it appears under on every step, and the key its
   helper implementations are written under. `function` and `name` are
   reserved, and a name can only be registered once.
2. **`.defineHelpers({...})`** registers the helpers. Helpers are checked
   against the adapters registered before them, so `.use()` is no longer
   available afterwards.
3. **`.defineStep<TRequired, TInput>()({...})`** defines steps. An app with no
   helpers can skip the second step.

## Defining a step

`defineStep<TRequired, TInput?>()` is curried, because TypeScript can't infer
part of a type argument list: the two data types are fixed first, and the rest
is inferred from the object.

Data comes in two flavours, because the frameworks disagree about whether the
distinction exists. `TRequired` is data some earlier step is expected to have
produced. `TInput` is data the run is expected to have started with.
step-queue never notices the difference (`job.data` is both from the start),
but stagehand keeps `ctx` and `input` apart, and the stagehand adapter maps
`TRequired` onto the first and `TInput` onto the second, so `.addStep()` checks
each as stagehand always has. The handler and rollback see them merged.

| Field          | Type                                              | Notes                                                                                                   |
| -------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `name`         | `string`                                          | Required.                                                                                               |
| `description`  | `string?`                                         | Passed to stagehand; step-queue has no such field.                                                      |
| `handler`      | `(data, helpers) => TOutput \| Promise<TOutput>`  | `data` is `TRequired & TInput`. Whatever it resolves to is merged into the data later steps see.        |
| `rollbackKeys` | `readonly (keyof (data & output))[]`              | The only keys `rollback` receives. Declaring them also reserves them from `clean` in either framework.  |
| `rollback`     | `(data, helpers) => void \| Promise<void>`        | Runs when a later step fails. `data` is exactly the declared keys, narrowed by the core in every environment. |

What comes back has the step's `name` and one property per environment:

| Property            | What it is                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| `step.<adapterName>`| That framework's own step: a `StepDef` for stagehand, a `StandaloneStep` for step-queue.         |
| `step.function`     | The step as a callable, `(data) => Promise<output>`, with `.rollback(data)`. Always present.   |

### The frameworks' own options

stagehand's `when`, `cache` (including its `key`), `retry` and `timeoutMs`, and
step-queue's `progressReport` and `clean`, are settings of the host framework,
not of a step. A universal step has no options of its own: add them where you
mount it, by spreading, which stays fully typed by the host framework:

```ts
script.addStep({ ...loadUser.stageHand, timeoutMs: 5_000 });
processor.addStep({ ...loadUser.stepQueue, clean: ["password"] });
```

## Helpers

Helpers are small utilities that mean something different in each framework, so
a step never branches on where it is running: `log`, `note`, `status`. None
ship with the library. You define the ones you want, and every step in the app
gets them as the second argument to its handler and rollback.

A helper is one implementation per registered adapter, and one for `function`.
Each implementation is curried: it receives the framework's native context,
typed from the adapter, and returns the function the step calls.

```ts
.defineHelpers({
  status: {
    stageHand: (ctx) => (message: string) => ctx.status(message),
    // step-queue has no live status line, so the closest thing is a log row.
    stepQueue: (job) => (message: string) => void job.log(`[status] ${message}`),
    function:  () => (message: string) => console.log(message),
  },
})
```

Nothing can be silently missing. Leaving out an implementation, writing one for
an adapter that isn't registered, or giving the implementations different
arguments is a compile error on the offending helper (and a `UniversalStepError`
if the types were bypassed). A framework with no real equivalent does the
closest thing it can; there is no "unsupported". When you register another
adapter later, TypeScript points at every helper that needs a new
implementation.

The stagehand native context a helper receives is the part that exists in both
a handler and a rollback (`log`, `status`, `note`, `progress`, `input`,
`signal`, `phase`, `step`, `cache`, `flags`), since the same helpers are bound
for both. Anything handler-only, such as `prompt`, isn't a candidate for a
shared helper; write that step directly against stagehand.

## Testing steps

`step.function` runs through the same core as `.stageHand` and `.stepQueue`:
the same data merging, the same helpers (their `function` implementations), the
same narrowing of what a rollback sees. A test needs no queue, no script and no
mocks:

```ts
const { user } = await loadUser.function({ userId: "u_1" });
const { chargeId } = await chargeCard.function({ user, amount: 42 });
await chargeCard.function.rollback({ chargeId });
```

To assert on helper calls, write the `function` implementation to record them.
The implementations are yours, so nothing is stateful inside the library.

The repository tests every environment against one shared spec
(`tests/spec/stepSpec.ts`), which asserts what a step must mean wherever it is
mounted: the handler's data, the helpers' environment, a failing handler, what
a rollback sees. It runs against the plain function and a real stagehand
`Script` under `npm test`, and against a real BullMQ worker under
`npm run test:queue`.

## Writing an adapter

The two bundled adapters are a few dozen lines of code between them (25 and
52), because the core owns everything about running a step. An adapter says where the native context and
the data come from, and what shape its framework wants:

```ts
import { type AsStep, defineAdapter, type TargetKind } from "@michaelrwalker/universal-step";

interface MyKind extends TargetKind {
  // What a step becomes in this framework, computed from the step's own types.
  readonly target: MyStep<AsStep<this["step"]>["output"]>;
}

export const myAdapter = defineAdapter<MyNative, MyKind>({
  build: (step) => ({
    run: (native: MyNative) => step.invoke(native, readData(native)),
    undo: (native: MyNative) => step.invokeRollback(native, readData(native)),
  }),
});
```

`step.invoke(native, data)` runs the handler with the helpers bound to
`native`. `step.invokeRollback(native, data)` accepts everything the framework
has to hand and narrows it to the step's `rollbackKeys` itself. `build`'s
return type is erased, so `MyKind` is what consumers see and `build` is
responsible for actually matching it.

## Errors

`UniversalStepError` is thrown for setup mistakes the types would also catch,
for callers who bypass them: an empty, reserved or duplicate adapter name, an
adapter without a `build`, a helper missing an implementation for a registered
adapter (or for `function`), a helper implemented for an unregistered adapter,
and a step without a `name` or a `handler`. Errors thrown by a handler propagate
unchanged, wrapped only by whatever the host framework does with a failed step.

## Development

```bash
npm test             # unit, type-level, real stagehand Script, plain-function spec; no infrastructure
npm run test:queue   # the shared spec through a real BullMQ worker
npm run typecheck    # tsc --noEmit
npm run format       # biome format --write
npm run fix          # biome lint --write
```

`npm run test:queue` starts a throwaway Redis with `npx redis-memory-server`
(the first run compiles Redis from source, so it needs `make`), runs the spec,
and shuts Redis down. It also loads step-queue's raw `.ts` through a small
hook in `scripts/`, since Node won't strip types under `node_modules`.

The `examples/` directory shows the setup (`app.ts`), shared steps
(`commonSteps.ts`), a real stagehand run, the step-queue wiring, and testing a
step with no framework at all.
