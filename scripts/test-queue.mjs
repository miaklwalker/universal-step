// Runs the shared step spec through a real step-queue (BullMQ) worker.
//
// Starts a throwaway Redis with `npx redis-memory-server`, points the tests at
// it, runs them, and shuts it down again. The first run compiles Redis from
// source (the package needs `make`) and caches the binary under
// node_modules/.cache, so only that first run is slow.
import { spawn } from "node:child_process";
import net from "node:net";

const port = Number(process.env.REDISMS_PORT ?? 60866);
const startupTimeoutMs = 10 * 60_000;

function canConnect() {
	return new Promise((resolve) => {
		const socket = net.connect({ port, host: "127.0.0.1" });
		socket.once("connect", () => {
			socket.destroy();
			resolve(true);
		});
		socket.once("error", () => resolve(false));
	});
}

async function waitForRedis(server) {
	const deadline = Date.now() + startupTimeoutMs;
	while (Date.now() < deadline) {
		if (server.exitCode !== null) {
			throw new Error(
				`redis-memory-server exited early (code ${server.exitCode}).`,
			);
		}
		if (await canConnect()) return;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`Redis did not come up on port ${port} in time.`);
}

/** Ask Redis to exit, in case killing `npx` leaves the server behind. */
function shutdownRedis() {
	return new Promise((resolve) => {
		const socket = net.connect({ port, host: "127.0.0.1" });
		socket.once("connect", () =>
			socket.end("*2\r\n$8\r\nSHUTDOWN\r\n$6\r\nNOSAVE\r\n"),
		);
		socket.once("error", () => resolve());
		socket.once("close", () => resolve());
	});
}

if (await canConnect()) {
	console.error(
		`Something is already listening on port ${port}. Set REDISMS_PORT to a free port.`,
	);
	process.exit(1);
}

console.log(
	`Starting Redis on port ${port} (the first run compiles it, which can take a few minutes)...`,
);
const server = spawn("npx", ["redis-memory-server"], {
	env: { ...process.env, REDISMS_PORT: String(port) },
	stdio: ["ignore", "ignore", "inherit"],
	detached: true,
});

let exitCode = 1;
try {
	await waitForRedis(server);
	console.log("Redis is up; running the queue tests.\n");
	const tests = spawn(
		process.execPath,
		[
			"--import",
			"./scripts/register-ts-in-node-modules.mjs",
			"--experimental-transform-types",
			"--disable-warning=ExperimentalWarning",
			"--test",
			"tests/queue/stepQueue.queue.ts",
		],
		{
			env: {
				...process.env,
				REDIS_HOST: "127.0.0.1",
				REDIS_PORT: String(port),
			},
			stdio: "inherit",
		},
	);
	exitCode = await new Promise((resolve) =>
		tests.on("exit", (code) => resolve(code ?? 1)),
	);
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
} finally {
	await shutdownRedis();
	try {
		process.kill(-server.pid, "SIGTERM");
	} catch {
		// already gone
	}
}
process.exit(exitCode);
