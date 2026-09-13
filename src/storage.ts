import {
	closeSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";

type SettingsScope = "global" | "project";
interface SettingsStorage {
	withLock(scope: SettingsScope, fn: (current: string | undefined) => string | undefined): void;
}

const PREFIX = ".pi-pkg-manager-settings-";
const STALE_MS = 5 * 60_000;

export function contentVersion(content: string | undefined): string {
	return content === undefined ? "missing" : createHash("sha256").update(content).digest("hex");
}

export class AtomicSettingsStorage implements SettingsStorage {
	private staged = new Map<SettingsScope, string>();
	private batching = false;
	readonly paths: Record<SettingsScope, string>;

	constructor(cwd: string, agentDir: string) {
		this.paths = {
			global: join(resolve(agentDir), "settings.json"),
			project: join(resolve(cwd), CONFIG_DIR_NAME, "settings.json"),
		};
		this.cleanupStaleFiles();
	}

	read(scope: SettingsScope): string | undefined {
		const path = this.paths[scope];
		return existsSync(path) ? readFileSync(path, "utf8") : undefined;
	}

	versions(): Record<SettingsScope, string> {
		return { global: contentVersion(this.read("global")), project: contentVersion(this.read("project")) };
	}

	begin(): void {
		this.staged.clear();
		this.batching = true;
	}

	withLock(scope: SettingsScope, fn: (current: string | undefined) => string | undefined): void {
		const current = this.staged.get(scope) ?? this.read(scope);
		const next = fn(current);
		if (next === undefined) return;
		if (!this.batching) throw new Error("Atomic settings writes require an active batch");
		this.staged.set(scope, next);
	}

	commit(expected: Partial<Record<SettingsScope, string>>): {
		written: SettingsScope[];
		stale: SettingsScope[];
		failed: Array<{ scope: SettingsScope; message: string }>;
	} {
		const written: SettingsScope[] = [];
		const stale: SettingsScope[] = [];
		const failed: Array<{ scope: SettingsScope; message: string }> = [];
		for (const scope of ["global", "project"] as const) {
			const next = this.staged.get(scope);
			if (next === undefined) continue;
			try {
				const result = this.writeAtomic(scope, next, expected[scope]);
				if (result === "stale") stale.push(scope);
				else written.push(scope);
			} catch (error) {
				failed.push({ scope, message: error instanceof Error ? error.message : String(error) });
			}
		}
		this.staged.clear();
		this.batching = false;
		return { written, stale, failed };
	}

	discard(scope: SettingsScope): void {
		this.staged.delete(scope);
	}

	abort(): void {
		this.staged.clear();
		this.batching = false;
	}

	private acquireLock(path: string): () => void {
		// Use Pi's own lock path/protocol so Pi and this extension cannot write the
		// same settings file between the reviewed-version check and atomic rename.
		let lastError: unknown;
		for (let attempt = 0; attempt < 20; attempt++) {
			try {
				return lockfile.lockSync(path, { realpath: false, stale: 30_000 });
			} catch (error) {
				lastError = error;
				if ((error as NodeJS.ErrnoException).code !== "ELOCKED") throw error;
				const start = Date.now();
				while (Date.now() - start < 10) {
					// SettingsStorage is synchronous; keep the retry bounded.
				}
			}
		}
		throw lastError instanceof Error ? lastError : new Error(`Unable to acquire settings lock for ${path}`);
	}

	private writeAtomic(scope: SettingsScope, next: string, expected?: string): "written" | "stale" {
		const path = this.paths[scope];
		const dir = dirname(path);
		mkdirSync(dir, { recursive: true });
		const release = this.acquireLock(path);
		let tempPath: string | undefined;
		try {
			const current = this.read(scope);
			if (expected !== undefined && contentVersion(current) !== expected) return "stale";
			tempPath = join(dir, `${PREFIX}${process.pid}-${randomBytes(6).toString("hex")}.tmp`);
			const mode = existsSync(path) ? statSync(path).mode & 0o777 : 0o600;
			const fd = openSync(tempPath, "wx", mode);
			try {
				writeFileSync(fd, next, "utf8");
				fsyncSync(fd);
			} finally {
				closeSync(fd);
			}
			renameSync(tempPath, path);
			tempPath = undefined;
			try {
				const dirFd = openSync(dir, "r");
				try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
			} catch {
				// Some platforms cannot fsync directories; the file itself is flushed.
			}
			return "written";
		} finally {
			if (tempPath && existsSync(tempPath)) unlinkSync(tempPath);
			release();
		}
	}

	private cleanupStaleFiles(): void {
		for (const path of Object.values(this.paths)) {
			const dir = dirname(path);
			if (!existsSync(dir)) continue;
			for (const name of readdirSync(dir)) {
				if (!name.startsWith(PREFIX)) continue;
				const candidate = join(dir, name);
				try {
					if (Date.now() - statSync(candidate).mtimeMs > STALE_MS) unlinkSync(candidate);
				} catch { /* best effort */ }
			}
		}
	}
}
