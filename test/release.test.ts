import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts", "verify-release.mjs");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };

function verify(tag: string): void {
	execFileSync(process.execPath, [script], {
		env: { ...process.env, GITHUB_REF_NAME: tag },
		stdio: "pipe",
	});
}

test("release verification accepts the matching version tag", () => {
	assert.doesNotThrow(() => verify(`v${version}`));
});

test("release verification rejects a mismatched tag", () => {
	assert.throws(() => verify("v999.0.0"), /Release tag/);
});
