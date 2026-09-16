import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const profile = mkdtempSync(join(tmpdir(), "pi-pkg-config-smoke-"));
const home = join(profile, "home");
const agentDir = join(home, ".pi", "agent");
const workdir = join(profile, "work");
const pi = join(packageRoot, "node_modules", ".bin", process.platform === "win32" ? "pi.cmd" : "pi");

try {
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(workdir, { recursive: true });
	const result = spawnSync(pi, ["--mode", "rpc", "-ne", "-ns", "-e", packageRoot], {
		cwd: workdir,
		input: '{"type":"get_commands"}\n',
		encoding: "utf8",
		env: {
			...process.env,
			HOME: home,
			PI_CODING_AGENT_DIR: agentDir,
			PI_SKIP_VERSION_CHECK: "1",
		},
		timeout: 60_000,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(result.stderr || result.stdout || `pi exited with ${result.status}`);
	const response = result.stdout
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line))
		.find((message) => message.type === "response" && message.command === "get_commands");
	if (!response) throw new Error("Pi did not return get_commands.");
	const commands = response.data.commands
		.filter((command) => command.source === "extension")
		.map((command) => command.name);
	if (!commands.includes("config")) throw new Error(`/config is missing: ${commands.join(", ")}`);
	if (commands.some((name) => /(?:pkg|skills|extensions)-manager/.test(name))) {
		throw new Error(`Legacy manager command registered: ${commands.join(", ")}`);
	}
	console.log("Pi package smoke test passed: /config registered.");
} finally {
	rmSync(profile, { recursive: true, force: true });
}
