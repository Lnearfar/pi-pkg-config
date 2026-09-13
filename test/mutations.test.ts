import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { applyPendingToSettings, getProjectOverride, sourcesMatch } from "../src/mutations.ts";
import type { ManagedResource, PendingChange, Settings } from "../src/types.ts";

const cwd = "/work/repo";
const agentDir = "/home/test/.pi/agent";

function resource(overrides: Partial<ManagedResource> = {}): ManagedResource {
	return {
		id: "skills:/home/test/.agents/skills/review/SKILL.md",
		type: "skills",
		path: "/home/test/.agents/skills/review/SKILL.md",
		name: "review",
		enabled: true,
		globalEnabled: true,
		metadata: {
			source: "auto",
			scope: "user",
			origin: "top-level",
			baseDir: "/home/test/.agents",
		},
		inheritedGlobal: true,
		groupKey: "global-auto",
		groupLabel: "Local ~/.agents",
		diagnostics: [],
		selfProtected: false,
		...overrides,
	};
}

function change(item: ManagedResource, scope: "global" | "project", after: boolean | "inherit"): PendingChange {
	return {
		key: `${scope}:${item.id}`,
		resource: item,
		scope,
		beforeEnabled: item.enabled,
		beforeOverride: scope === "project" ? "inherit" : "inherit",
		afterEnabled: after === "inherit" ? item.globalEnabled : after,
		afterOverride: after === "inherit" ? "inherit" : after ? "load" : "unload",
	};
}

test("project top-level override uses normal absolute discovery entry and exact absolute override", () => {
	const item = resource();
	const next = applyPendingToSettings({ theme: "dark", skills: ["keep-me"] }, [change(item, "project", false)], "project", cwd, agentDir);
	assert.deepEqual(next.skills, ["keep-me", item.path, `-${item.path}`]);
	assert.equal(next.theme, "dark");
	assert.equal(getProjectOverride(item, next, cwd, agentDir), "unload");
});

test("direct-scope top-level mutations use absolute patterns to avoid cross-root collisions", () => {
	const item = resource({ inheritedGlobal: false });
	const next = applyPendingToSettings({}, [change(item, "global", false)], "global", cwd, agentDir);
	assert.deepEqual(next.skills, [`-${item.path}`]);
});

test("skill directory overrides are recognized and replaced", () => {
	const item = resource();
	const skillDir = join(item.path, "..");
	const projectBase: Settings = { skills: [`-${skillDir}`] };
	assert.equal(getProjectOverride(item, projectBase, cwd, agentDir), "unload");
	const enabled = applyPendingToSettings(projectBase, [change(item, "project", true)], "project", cwd, agentDir);
	assert.deepEqual(enabled.skills, [item.path, `+${item.path}`]);

	const packaged = resource({
		path: "/packages/demo/skills/a/SKILL.md",
		metadata: { source: "npm:demo", scope: "user", origin: "package", baseDir: "/packages/demo" },
		packageSource: "npm:demo",
	});
	const packageEnabled = applyPendingToSettings(
		{ packages: [{ source: "npm:demo", skills: ["-skills/a"] }] },
		[change(packaged, "global", true)],
		"global",
		cwd,
		agentDir,
	);
	assert.deepEqual(packageEnabled.packages, [{ source: "npm:demo", skills: ["+skills/a/SKILL.md"] }]);
});

test("top-level exact patterns normalize leading dot and path separators", () => {
	const item = resource();
	for (const existing of ["-./skills/review/SKILL.md", "-skills\\review\\SKILL.md"]) {
		const result = applyPendingToSettings(
			{ skills: [existing] },
			[change(item, "global", true)],
			"global",
			cwd,
			agentDir,
		);
		assert.deepEqual(result.skills, [`+${item.path}`]);
	}
});

test("same relative local source is resolved independently per scope", () => {
	assert.equal(sourcesMatch("./same", "user", "./same", "project", cwd, agentDir), false);
	assert.equal(sourcesMatch("npm:demo", "user", "npm:demo", "project", cwd, agentDir), true);
});

test("project reset removes only matching inherited top-level entries", () => {
	const item = resource();
	const base: Settings = { skills: ["other", item.path, `-${item.path}`] };
	const reset = change(item, "project", "inherit");
	reset.beforeOverride = "unload";
	const next = applyPendingToSettings(base, [reset], "project", cwd, agentDir);
	assert.deepEqual(next.skills, ["other"]);
});

test("project package override creates and later removes an autoload false delta", () => {
	const item = resource({
		id: "extensions:/home/test/.pi/agent/npm/pkg/extensions/index.ts",
		type: "extensions",
		path: "/home/test/.pi/agent/npm/pkg/extensions/index.ts",
		name: "index.ts",
		metadata: {
			source: "npm:demo-pkg",
			scope: "user",
			origin: "package",
			baseDir: "/home/test/.pi/agent/npm/pkg",
		},
		packageSource: "npm:demo-pkg",
	});
	const disabled = applyPendingToSettings({}, [change(item, "project", false)], "project", cwd, agentDir);
	assert.deepEqual(disabled.packages, [
		{ source: "npm:demo-pkg", autoload: false, extensions: ["-extensions/index.ts"] },
	]);
	assert.equal(getProjectOverride(item, disabled, cwd, agentDir), "unload");

	const reset = change(item, "project", "inherit");
	reset.beforeOverride = "unload";
	const inherited = applyPendingToSettings(disabled, [reset], "project", cwd, agentDir);
	assert.deepEqual(inherited.packages, []);
});

test("disabling a positive package include preserves its sibling baseline", () => {
	const item = resource({
		path: "/packages/demo/skills/a/SKILL.md",
		metadata: { source: "npm:demo", scope: "user", origin: "package", baseDir: "/packages/demo" },
		packageSource: "npm:demo",
	});
	const result = applyPendingToSettings(
		{ packages: [{ source: "npm:demo", skills: ["skills/a"] }] },
		[change(item, "global", false)],
		"global",
		cwd,
		agentDir,
	);
	assert.deepEqual(result.packages, [
		{ source: "npm:demo", skills: ["skills/a", "-skills/a/SKILL.md"] },
	]);
});

test("Pi-equivalent exact patterns are normalized before replacement", () => {
	const extension = resource({
		type: "extensions",
		path: "/packages/demo/extensions/a.ts",
		metadata: { source: "npm:demo", scope: "project", origin: "package", baseDir: "/packages/demo" },
		packageSource: "npm:demo",
	});
	for (const existing of ["-./extensions/a.ts", "-extensions\\a.ts"]) {
		const settings: Settings = { packages: [{ source: "npm:demo", autoload: false, extensions: [existing] }] };
		assert.equal(getProjectOverride(extension, settings, cwd, agentDir), "unload");
		const result = applyPendingToSettings(settings, [change(extension, "project", true)], "project", cwd, agentDir);
		assert.deepEqual(result.packages, [
			{ source: "npm:demo", autoload: false, extensions: ["+extensions/a.ts"] },
		]);
	}
});

test("enabling one resource preserves a package-wide empty filter", () => {
	const item = resource({
		id: "skills:/packages/demo/skills/a/SKILL.md",
		path: "/packages/demo/skills/a/SKILL.md",
		enabled: false,
		metadata: { source: "npm:demo", scope: "user", origin: "package", baseDir: "/packages/demo" },
		packageSource: "npm:demo",
	});
	const next = applyPendingToSettings(
		{ packages: [{ source: "npm:demo", skills: [] }] },
		[change(item, "global", true)],
		"global",
		cwd,
		agentDir,
	);
	assert.deepEqual(next.packages, [
		{ source: "npm:demo", skills: ["!**", "+skills/a/SKILL.md"] },
	]);
});

test("global package mutation preserves unrelated filters and settings", () => {
	const item = resource({
		id: "skills:/packages/demo/skills/a/SKILL.md",
		path: "/packages/demo/skills/a/SKILL.md",
		metadata: { source: "./demo", scope: "user", origin: "package", baseDir: "/packages/demo" },
		packageSource: "./demo",
	});
	const base: Settings = {
		defaultModel: "x",
		packages: [{ source: "./demo", extensions: ["-extensions/old.ts"], skills: ["-skills/old/SKILL.md"] }],
	};
	const next = applyPendingToSettings(base, [change(item, "global", false)], "global", cwd, agentDir);
	assert.equal(next.defaultModel, "x");
	assert.deepEqual(next.packages, [
		{
			source: "./demo",
			extensions: ["-extensions/old.ts"],
			skills: ["-skills/old/SKILL.md", "-skills/a/SKILL.md"],
		},
	]);
});
