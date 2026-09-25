import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultPackageManager } from "@earendil-works/pi-coding-agent";
import { PackageManagerBackend } from "../src/backend.ts";
import { PackageManagerModel } from "../src/model.ts";
import type { ManagedResource, PendingChange } from "../src/types.ts";

function pending(path: string): PendingChange {
	const resource: ManagedResource = {
		id: `skills:${path}`,
		type: "skills",
		path,
		name: "demo",
		enabled: true,
		globalEnabled: true,
		metadata: { source: "auto", scope: "user", origin: "top-level", baseDir: join(path, "../../..") },
		inheritedGlobal: true,
		groupKey: "auto",
		groupLabel: "Local skills",
		diagnostics: [],
	};
	return {
		key: `global:${resource.id}`,
		resource,
		scope: "global",
		beforeEnabled: true,
		beforeOverride: "inherit",
		afterEnabled: false,
		afterOverride: "inherit",
	};
}

test("a full project package at the same path is project-owned, not inherited", async () => {
	const root = mkdtempSync(join(tmpdir(), "pi-pkg-backend-"));
	try {
		const agentDir = join(root, "agent");
		const cwd = join(root, "repo");
		const packageDir = join(root, "demo-package");
		const skillDir = join(packageDir, "skills", "demo");
		mkdirSync(skillDir, { recursive: true });
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "demo", pi: { skills: ["./skills"] } }));
		writeFileSync(join(skillDir, "SKILL.md"), "---\nname: demo\ndescription: demo\n---\n");
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [{ source: packageDir, skills: [] }] }));
		writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ packages: [packageDir] }));
		const backend = new PackageManagerBackend(cwd, true, "/extension", agentDir);
		const catalog = await backend.resolve();
		const projectItem = catalog.project.find((item) => item.path === join(skillDir, "SKILL.md"))!;
		assert.equal(projectItem.inheritedGlobal, false);
		assert.equal(projectItem.metadata.scope, "project");
		const model = new PackageManagerModel(catalog, cwd, agentDir, true);
		assert.equal(model.effectiveEnabled(projectItem), true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("relative project package sources are removed from settings without deleting local files", async () => {
	const root = mkdtempSync(join(tmpdir(), "pi-pkg-backend-"));
	try {
		const agentDir = join(root, "agent");
		const cwd = join(root, "repo");
		const packageDir = join(cwd, "pkg");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(packageDir, { recursive: true });
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "demo", pi: {} }));
		writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ packages: ["../pkg"] }));
		const backend = new PackageManagerBackend(cwd, true, "/extension", agentDir);
		await backend.removePackage("../pkg", "project");
		assert.deepEqual(JSON.parse(readFileSync(join(cwd, ".pi", "settings.json"), "utf8")).packages, []);
		assert.equal(readFileSync(join(packageDir, "package.json"), "utf8").includes("demo"), true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("package files are not removed when settings persistence fails", async () => {
	const root = mkdtempSync(join(tmpdir(), "pi-pkg-backend-"));
	const originalRemove = DefaultPackageManager.prototype.remove;
	try {
		const agentDir = join(root, "agent");
		const packageDir = join(root, "demo-package");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(packageDir, { recursive: true });
		const settingsPath = join(agentDir, "settings.json");
		writeFileSync(settingsPath, JSON.stringify({ packages: [packageDir] }));
		const backend = new PackageManagerBackend(root, true, "/extension", agentDir);
		let removeCalled = false;
		DefaultPackageManager.prototype.remove = async () => {
			removeCalled = true;
		};
		backend.storage.commit = () => ({
			written: [],
			stale: [],
			failed: [{ scope: "global", message: "simulated write failure" }],
		});
		await assert.rejects(backend.removePackage(packageDir, "global"), /simulated write failure/);
		assert.equal(removeCalled, false);
		assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")).packages, [packageDir]);
	} finally {
		DefaultPackageManager.prototype.remove = originalRemove;
		rmSync(root, { recursive: true, force: true });
	}
});

test("backend merges pending resource edits onto externally changed settings through SettingsManager", async () => {
	const root = mkdtempSync(join(tmpdir(), "pi-pkg-backend-"));
	try {
		const agentDir = join(root, "agent");
		mkdirSync(agentDir, { recursive: true });
		const settingsPath = join(agentDir, "settings.json");
		writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }, null, 2));
		const backend = new PackageManagerBackend(root, true, "/extension", agentDir);
		writeFileSync(settingsPath, JSON.stringify({ theme: "dark", defaultModel: "external-model" }, null, 2));
		const change = pending(join(agentDir, "skills/demo/SKILL.md"));
		const preview = backend.prepareSave([change]);
		assert.deepEqual(preview.externallyChanged, ["global"]);
		assert.match(preview.lines.join("\n"), /Merged Global skills:/);
		assert.match(preview.lines.join("\n"), /external-model/);
		const result = await backend.commitSave([change], preview);
		assert.deepEqual(result.savedScopes, ["global"]);
		assert.deepEqual(result.failedScopes, []);
		const saved = JSON.parse(readFileSync(settingsPath, "utf8"));
		assert.equal(saved.defaultModel, "external-model");
		assert.deepEqual(saved.skills, [`-${change.resource.path}`]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

