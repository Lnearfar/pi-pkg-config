import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import pkgConfigExtension from "../src/index.ts";
import type { PackageManagerModel } from "../src/model.ts";

interface RegisteredCommand {
	description: string;
	handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}

function register(): Map<string, RegisteredCommand> {
	const commands = new Map<string, RegisteredCommand>();
	pkgConfigExtension({
		registerCommand: (name: string, command: RegisteredCommand) => commands.set(name, command),
	} as unknown as ExtensionAPI);
	return commands;
}

test("registers the config command", () => {
	const commands = register();

	assert.deepEqual([...commands.keys()], ["config"]);
	assert.equal(commands.get("config")?.description, "Configure Pi skills and extensions");
});

test("config opens the Skills view", async () => {
	const root = mkdtempSync(join(tmpdir(), "pi-pkg-config-commands-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	try {
		const agentDir = join(root, "agent");
		const cwd = join(root, "repo");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(agentDir, "settings.json"), "{}\n");
		writeFileSync(join(cwd, ".pi", "settings.json"), "{}\n");
		process.env.PI_CODING_AGENT_DIR = agentDir;

		let type: string | undefined;
		const ctx = {
			mode: "tui",
			cwd,
			isProjectTrusted: () => true,
			ui: {
				custom: (factory: (...args: unknown[]) => { model: PackageManagerModel }) => {
					const component = factory(
						{ requestRender: () => {}, terminal: { rows: 40 } },
						undefined,
						{ matches: () => false },
						() => {},
					);
					type = component.model.type;
					return Promise.resolve({ type: "close" });
				},
				notify: () => {},
				confirm: async () => true,
			},
			reload: async () => {},
		} as unknown as ExtensionCommandContext;

		const command = register().get("config");
		assert.ok(command);
		await command.handler("", ctx);
		assert.equal(type, "skills");
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(root, { recursive: true, force: true });
	}
});
