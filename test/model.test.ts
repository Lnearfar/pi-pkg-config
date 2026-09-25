import assert from "node:assert/strict";
import test from "node:test";
import { PackageManagerModel } from "../src/model.ts";
import type { ManagedResource, ResolvedCatalog } from "../src/types.ts";

function item(path: string, overrides: Partial<ManagedResource> = {}): ManagedResource {
	return {
		id: `skills:${path}`,
		type: "skills",
		path,
		name: path.split("/").at(-2) ?? path,
		enabled: true,
		globalEnabled: true,
		metadata: { source: "auto", scope: "user", origin: "top-level", baseDir: "/home/u/.agents" },
		inheritedGlobal: true,
		groupKey: "global",
		groupLabel: "Local ~/.agents",
		diagnostics: [],
		...overrides,
	};
}

function model(global: ManagedResource[], project = global, projectSettings = {}): PackageManagerModel {
	const catalog: ResolvedCatalog = { global, project, globalSettings: {}, projectSettings };
	return new PackageManagerModel(catalog, "/repo", "/home/u/.pi/agent", true);
}

test("defaults to Skills and Project and sorts project resources before inherited global ones", () => {
	const global = item("/home/u/.agents/skills/global/SKILL.md");
	const local = item("/repo/.agents/skills/local/SKILL.md", {
		metadata: { source: "auto", scope: "project", origin: "top-level", baseDir: "/repo/.agents" },
		inheritedGlobal: false,
		groupKey: "project",
		groupLabel: "Local ./.agents",
	});
	const state = model([global], [global, local]);
	assert.equal(state.type, "skills");
	assert.equal(state.scope, "project");
	assert.deepEqual(state.resources().map((resource) => resource.name), ["local", "global"]);
});

test("global toggles are staged and toggling back removes pending state", () => {
	const state = model([item("/home/u/.agents/skills/a/SKILL.md")]);
	state.scope = "global";
	assert.equal(state.toggle(), true);
	assert.equal(state.effectiveEnabled(state.selectedResource()!), false);
	assert.equal(state.pending.size, 1);
	state.toggle();
	assert.equal(state.effectiveEnabled(state.selectedResource()!), true);
	assert.equal(state.pending.size, 0);
});

test("global state reflects staged Global edits in the Project matrix", () => {
	const resource = item("/home/u/.agents/skills/a/SKILL.md");
	const state = model([resource]);
	assert.equal(state.globalState(resource), true);
	state.scope = "global";
	state.toggle(resource);
	state.scope = "project";
	assert.equal(state.globalState(resource), false);
	assert.equal(state.effectiveEnabled(resource), false);
});

test("project effective state respects non-exact project filters", () => {
	const filtered = item("/home/u/.agents/skills/a/SKILL.md", { enabled: false, globalEnabled: true });
	const state = model([item(filtered.path)], [filtered], { skills: ["!**"] });
	assert.equal(state.currentOverride(filtered), "inherit");
	assert.equal(state.effectiveEnabled(filtered), false);
	state.toggle(filtered);
	assert.equal(state.currentOverride(filtered), "load");
	assert.equal(state.effectiveEnabled(filtered), true);
});

test("project Space cycles inherit, load, and unload", () => {
	const state = model([item("/home/u/.agents/skills/a/SKILL.md")]);
	const selected = state.selectedResource()!;
	assert.equal(state.currentOverride(selected), "inherit");
	state.toggle();
	assert.equal(state.currentOverride(selected), "load");
	assert.equal(state.effectiveEnabled(selected), true);
	state.toggle();
	assert.equal(state.currentOverride(selected), "unload");
	assert.equal(state.effectiveEnabled(selected), false);
	state.toggle();
	assert.equal(state.currentOverride(selected), "inherit");
	assert.equal(state.pending.size, 0);
});

test("project-owned resources cycle between on and off", () => {
	const local = item("/repo/.agents/skills/local/SKILL.md", {
		metadata: { source: "auto", scope: "project", origin: "top-level", baseDir: "/repo/.agents" },
		inheritedGlobal: false,
		groupKey: "project",
	});
	const state = model([], [local]);
	assert.equal(state.toggle(), true);
	assert.equal(state.effectiveEnabled(local), false);
	assert.equal(state.pending.size, 1);
	state.toggle();
	assert.equal(state.effectiveEnabled(local), true);
	assert.equal(state.pending.size, 0);
});

test("untrusted project resources are read-only", () => {
	const untrusted = model([item("/y/SKILL.md")]);
	untrusted.projectTrusted = false;
	assert.equal(untrusted.toggle(), false);
	assert.equal(untrusted.pending.size, 0);
	untrusted.scope = "global";
	assert.equal(untrusted.toggle(), true);
});

test("removing a package discards its pending changes across all scopes", () => {
	const packaged = item("/packages/demo/skills/a/SKILL.md", {
		metadata: { source: "npm:demo", scope: "user", origin: "package", baseDir: "/packages/demo" },
		packageSource: "npm:demo",
	});
	const state = model([packaged]);
	state.toggle();
	state.scope = "global";
	state.toggle();
	assert.equal(state.pending.size, 2);
	state.discardPackage("npm:demo", "global");
	assert.equal(state.pending.size, 0);
});

test("package pending cleanup does not conflate same relative sources from different scopes", () => {
	const global = item("/home/u/.pi/agent/same/skills/a/SKILL.md", {
		metadata: { source: "./same", scope: "user", origin: "package", baseDir: "/home/u/.pi/agent/same" },
		packageSource: "./same",
	});
	const project = item("/repo/.pi/same/skills/a/SKILL.md", {
		metadata: { source: "./same", scope: "project", origin: "package", baseDir: "/repo/.pi/same" },
		packageSource: "./same",
		inheritedGlobal: false,
		groupKey: "project",
	});
	const state = model([global], [project, global]);
	state.toggle(project);
	state.scope = "global";
	state.toggle(global);
	state.discardPackage("./same", "global");
	assert.equal(state.pending.size, 1);
	assert.equal(state.pendingChanges()[0]?.resource.path, project.path);
});

test("search is local to each independent view", () => {
	const alpha = item("/home/u/.agents/skills/alpha/SKILL.md");
	const beta = item("/home/u/.agents/skills/beta/SKILL.md");
	const state = model([alpha, beta]);
	state.setQuery("alpha");
	assert.deepEqual(state.resources().map((resource) => resource.name), ["alpha"]);
	state.scope = "global";
	assert.equal(state.view.query, "");
	assert.equal(state.resources().length, 2);
	state.scope = "project";
	assert.equal(state.view.query, "alpha");
});
