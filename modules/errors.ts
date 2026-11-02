/**
 * Thrown for anything wrong with how the app is set up: a bad adapter name, a
 * helper missing an implementation, a step without a handler. The same rules
 * are enforced by the types; this is for JavaScript callers and `as` casts.
 */
export class UniversalStepError extends Error {
	override name = "UniversalStepError";
}
