import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AtomicSettingsStorage } from "../src/storage.ts";

test("atomic storage writes one scope and leaves no config temp or lock files", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-pkg-config-"));
	try {
		const agentDir = join(root, "agent");
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ theme: "dark" }));
		const storage = new AtomicSettingsStorage(root, agentDir);
		const expected = storage.versions();
		storage.begin();
		storage.withLock("global", (current) => {
			const parsed = JSON.parse(current!);
			parsed.skills = ["-/a/SKILL.md"];
			return JSON.stringify(parsed, null, 2);
		});
		const result = storage.commit(expected);
		assert.deepEqual(result.written, ["global"]);
		assert.deepEqual(JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")), {
			theme: "dark",
			skills: ["-/a/SKILL.md"],
		});
		assert.equal(readdirSync(agentDir).some((name) => name.startsWith(".pi-pkg-config-settings-")), false);
		assert.equal(existsSync(join(agentDir, "settings.json.lock")), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("atomic storage removes stale legacy temp files", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-pkg-config-"));
	try {
		const agentDir = join(root, "agent");
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(join(agentDir, "settings.json"), "{}\n");
		const legacy = join(agentDir, ".pi-pkg-manager-settings-stale.tmp");
		writeFileSync(legacy, "stale");
		const old = new Date(Date.now() - 6 * 60_000);
		utimesSync(legacy, old, old);
		new AtomicSettingsStorage(root, agentDir);
		assert.equal(existsSync(legacy), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("atomic storage refuses a stale reviewed version without overwriting external edits", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-pkg-config-"));
	try {
		const agentDir = join(root, "agent");
		mkdirSync(agentDir, { recursive: true });
		const path = join(agentDir, "settings.json");
		writeFileSync(path, JSON.stringify({ theme: "dark" }));
		const storage = new AtomicSettingsStorage(root, agentDir);
		const reviewed = storage.versions();
		storage.begin();
		storage.withLock("global", () => JSON.stringify({ theme: "light" }));
		writeFileSync(path, JSON.stringify({ theme: "external", defaultModel: "new" }));
		const result = storage.commit(reviewed);
		assert.deepEqual(result.stale, ["global"]);
		assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { theme: "external", defaultModel: "new" });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
