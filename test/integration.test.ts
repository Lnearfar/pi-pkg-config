import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PackageManagerBackend } from "../src/backend.ts";
import { PackageManagerModel } from "../src/model.ts";

test("disabling the last positive package include does not enable a sibling", async () => {
	const root = mkdtempSync(join(tmpdir(), "pi-pkg-positive-filter-"));
	try {
		const agentDir = join(root, "agent");
		const cwd = join(root, "repo");
		const packageDir = join(agentDir, "pkg");
		for (const name of ["a", "b"]) {
			mkdirSync(join(packageDir, "skills", name), { recursive: true });
			writeFileSync(join(packageDir, "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name}\n---\n`);
		}
		mkdirSync(cwd, { recursive: true });
		writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "demo", pi: { skills: ["skills"] } }));
		writeFileSync(
			join(agentDir, "settings.json"),
			JSON.stringify({ packages: [{ source: "./pkg", skills: ["skills/a"] }] }),
		);

		const backend = new PackageManagerBackend(cwd, true, "/extension", agentDir);
		let catalog = await backend.resolve();
		const a = catalog.global.find((resource) => resource.path.endsWith("/skills/a/SKILL.md"))!;
		const b = catalog.global.find((resource) => resource.path.endsWith("/skills/b/SKILL.md"))!;
		assert.equal(a.enabled, true);
		assert.equal(b.enabled, false);
		const model = new PackageManagerModel(catalog, cwd, agentDir, true);
		model.scope = "global";
		model.toggle(a);
		const preview = backend.prepareSave(model.pendingChanges());
		await backend.commitSave(model.pendingChanges(), preview);

		catalog = await backend.resolve();
		assert.equal(catalog.global.find((resource) => resource.path === a.path)?.enabled, false);
		assert.equal(catalog.global.find((resource) => resource.path === b.path)?.enabled, false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("global disable and project enable/reset round-trip through Pi resolution", async () => {
	const root = mkdtempSync(join(tmpdir(), "pi-pkg-integration-"));
	try {
		const agentDir = join(root, "agent");
		const cwd = join(root, "repo");
		const skillPath = join(agentDir, "skills", "demo", "SKILL.md");
		mkdirSync(join(agentDir, "skills", "demo"), { recursive: true });
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(skillPath, "---\nname: demo\ndescription: demo\n---\n");
		writeFileSync(join(agentDir, "settings.json"), "{}\n");
		writeFileSync(join(cwd, ".pi", "settings.json"), "{}\n");

		const backend = new PackageManagerBackend(cwd, true, "/extension", agentDir);
		let catalog = await backend.resolve();
		let model = new PackageManagerModel(catalog, cwd, agentDir, true);
		model.scope = "global";
		const globalItem = model.resources().find((resource) => resource.path === skillPath)!;
		model.toggle(globalItem);
		let preview = backend.prepareSave(model.pendingChanges());
		let result = await backend.commitSave(model.pendingChanges(), preview);
		assert.deepEqual(result.savedScopes, ["global"]);
		assert.deepEqual(JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")).skills, [`-${skillPath}`]);

		catalog = await backend.resolve();
		assert.equal(catalog.global.find((resource) => resource.path === skillPath)?.enabled, false);
		model = new PackageManagerModel(catalog, cwd, agentDir, true);
		const inherited = model.resources().find((resource) => resource.path === skillPath)!;
		model.toggle(inherited);
		preview = backend.prepareSave(model.pendingChanges());
		result = await backend.commitSave(model.pendingChanges(), preview);
		assert.deepEqual(result.savedScopes, ["project"]);
		assert.deepEqual(JSON.parse(readFileSync(join(cwd, ".pi", "settings.json"), "utf8")).skills, [skillPath, `+${skillPath}`]);

		catalog = await backend.resolve();
		assert.equal(catalog.project.find((resource) => resource.path === skillPath)?.enabled, true);
		model = new PackageManagerModel(catalog, cwd, agentDir, true);
		const overridden = model.resources().find((resource) => resource.path === skillPath)!;
		model.toggle(overridden); // load -> unload
		model.toggle(overridden); // unload -> inherit
		preview = backend.prepareSave(model.pendingChanges());
		result = await backend.commitSave(model.pendingChanges(), preview);
		assert.deepEqual(result.savedScopes, ["project"]);
		assert.deepEqual(JSON.parse(readFileSync(join(cwd, ".pi", "settings.json"), "utf8")).skills, []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("project sources shorten to a cwd-relative path while global sources use the home path", async () => {
	const root = mkdtempSync(join(tmpdir(), "pi-pkg-labels-"));
	const previousHome = process.env.HOME;
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	try {
		const home = join(root, "home");
		const agentDir = join(home, ".pi", "agent");
		const cwd = join(home, "Documents", "repo");
		mkdirSync(join(agentDir, "skills", "global-skill"), { recursive: true });
		mkdirSync(join(cwd, ".agents", "skills", "project-skill"), { recursive: true });
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(agentDir, "skills", "global-skill", "SKILL.md"), "---\nname: global-skill\ndescription: g\n---\n");
		writeFileSync(join(cwd, ".agents", "skills", "project-skill", "SKILL.md"), "---\nname: project-skill\ndescription: p\n---\n");
		writeFileSync(join(agentDir, "settings.json"), "{}\n");
		writeFileSync(join(cwd, ".pi", "settings.json"), "{}\n");
		process.env.HOME = home;
		process.env.PI_CODING_AGENT_DIR = agentDir;

		const backend = new PackageManagerBackend(cwd, true, "/extension");
		const catalog = await backend.resolve();
		assert.equal(catalog.project.find((resource) => resource.name === "project-skill")?.groupLabel, "Local ./.agents");
		assert.equal(catalog.project.find((resource) => resource.name === "global-skill")?.groupLabel, "Local ~/.pi/agent");
	} finally {
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(root, { recursive: true, force: true });
	}
});
