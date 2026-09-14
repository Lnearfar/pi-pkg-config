import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import pkgManagerExtension from "../src/index.ts";

test("registers the package, skills, and extensions manager commands", () => {
	const commands = new Map<string, { description: string }>();
	const extension = {
		registerCommand(name: string, command: { description: string }) {
			commands.set(name, command);
		},
	} as unknown as ExtensionAPI;

	pkgManagerExtension(extension);

	assert.deepEqual([...commands.keys()].sort(), ["extensions-manager", "pkg-manager", "skills-manager"]);
	assert.equal(commands.get("skills-manager")?.description, "Manage Pi skills");
	assert.equal(commands.get("extensions-manager")?.description, "Manage Pi extensions");
});
