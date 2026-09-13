import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { CONFIG_DIR_NAME, type PackageSource, type PathMetadata } from "@earendil-works/pi-coding-agent";
import type { ManagedResource, OverrideState, PendingChange, ResourceType, Settings, ViewScope } from "./types.ts";

const FILTER_KEYS = ["extensions", "skills", "prompts", "themes"] as const;

function toPosixTarget(target: string): string {
	return target.replaceAll("\\", "/");
}

function normalizeExactTarget(target: string): string {
	const withoutDot = target.startsWith("./") || target.startsWith(".\\") ? target.slice(2) : target;
	return toPosixTarget(withoutDot);
}

export function entryTarget(entry: string): string {
	if (isExactOverride(entry)) return normalizeExactTarget(entry.slice(1));
	const target = entry.startsWith("!") ? entry.slice(1) : entry;
	return toPosixTarget(target);
}

function isExactOverride(entry: string): boolean {
	return entry.startsWith("+") || entry.startsWith("-");
}

function sourceString(source: PackageSource): string {
	return typeof source === "string" ? source : source.source;
}

export function isLocalSource(source: string): boolean {
	return (
		source.startsWith(".") ||
		source.startsWith("/") ||
		source.startsWith("~") ||
		isAbsolute(source)
	);
}

function sourceBase(scope: "user" | "project", cwd: string, agentDir: string): string {
	return scope === "project" ? join(cwd, CONFIG_DIR_NAME) : agentDir;
}

function resolveLocalSource(source: string, base: string): string {
	const expanded = source === "~" ? homedir() : source.startsWith("~/") ? join(homedir(), source.slice(2)) : source;
	return resolve(base, expanded);
}

export function sourcesMatch(
	left: string,
	leftScope: "user" | "project",
	right: string,
	rightScope: "user" | "project",
	cwd: string,
	agentDir: string,
): boolean {
	const leftLocal = isLocalSource(left);
	const rightLocal = isLocalSource(right);
	if (leftLocal || rightLocal) {
		if (!leftLocal || !rightLocal) return false;
		return (
			resolveLocalSource(left, sourceBase(leftScope, cwd, agentDir)) ===
			resolveLocalSource(right, sourceBase(rightScope, cwd, agentDir))
		);
	}
	return left === right;
}

export function packagePattern(resource: Pick<ManagedResource, "path" | "metadata">): string {
	return normalizeExactTarget(relative(resource.metadata.baseDir ?? dirname(resource.path), resource.path));
}

function packageTargets(resource: ManagedResource): Set<string> {
	const target = packagePattern(resource);
	const targets = new Set([target]);
	if (resource.type === "skills" && basename(resource.path) === "SKILL.md") {
		targets.add(normalizeExactTarget(dirname(target)));
	}
	return targets;
}

function topLevelTargets(resource: ManagedResource, scope: "user" | "project", cwd: string, agentDir: string): Set<string> {
	const base = sourceBase(scope, cwd, agentDir);
	const rawTargets = new Set([resource.path, relative(base, resource.path)]);
	if (resource.metadata.baseDir) rawTargets.add(relative(resource.metadata.baseDir, resource.path));
	if (resource.type === "skills" && basename(resource.path) === "SKILL.md") {
		for (const target of [...rawTargets]) rawTargets.add(dirname(target));
	}
	return new Set([...rawTargets].map(normalizeExactTarget));
}

function findPackage(
	settings: Settings,
	resource: ManagedResource,
	targetScope: "user" | "project",
	cwd: string,
	agentDir: string,
): { packages: PackageSource[]; index: number } {
	const packages = structuredClone(settings.packages ?? []);
	const resourceScope = resource.metadata.scope === "project" ? "project" : "user";
	const index = packages.findIndex((pkg) =>
		sourcesMatch(resource.metadata.source, resourceScope, sourceString(pkg), targetScope, cwd, agentDir),
	);
	return { packages, index };
}

export function getProjectOverride(
	resource: ManagedResource,
	projectSettings: Settings,
	cwd: string,
	agentDir: string,
): OverrideState {
	if (resource.metadata.origin === "top-level") {
		const entries = (projectSettings[resource.type] ?? []) as string[];
		const targets = topLevelTargets(resource, "project", cwd, agentDir);
		let state: OverrideState = "inherit";
		for (const entry of entries) {
			if (!targets.has(entryTarget(entry))) continue;
			if (entry.startsWith("!") || entry.startsWith("-")) state = "unload";
			else state = "load";
		}
		return state;
	}

	const found = findPackage(projectSettings, resource, "project", cwd, agentDir);
	const pkg = found.packages[found.index];
	if (!pkg || typeof pkg === "string") return "inherit";
	const entries = pkg[resource.type];
	if (entries === undefined) return "inherit";
	if (entries.length === 0 && pkg.autoload !== false) return "unload";
	let state: OverrideState = "inherit";
	const targets = packageTargets(resource);
	for (const entry of entries) {
		if (!targets.has(entryTarget(entry))) continue;
		state = entry.startsWith("!") || entry.startsWith("-") ? "unload" : "load";
	}
	return state;
}

function setTopLevel(
	settings: Settings,
	resource: ManagedResource,
	scope: ViewScope,
	state: OverrideState,
	cwd: string,
	agentDir: string,
): void {
	const current = [...((settings[resource.type] ?? []) as string[])];
	const targetScope = scope === "global" ? "user" : "project";
	const targets = topLevelTargets(resource, targetScope, cwd, agentDir);
	// Absolute exact patterns avoid Pi applying the same relative pattern to
	// both ~/.pi/agent and ~/.agents roots.
	const pattern = normalizeExactTarget(resource.path);
	const updated = current.filter((entry) => {
		if (!targets.has(entryTarget(entry))) return true;
		if (scope === "project" && state === "inherit" && resource.inheritedGlobal) return false;
		return !/^[!+-]/.test(entry);
	});

	if (state !== "inherit") {
		// Pi needs a normal absolute entry to bring inherited top-level resources into
		// project resolution before its exact +/- override can take effect.
		if (scope === "project" && resource.inheritedGlobal && !updated.includes(resource.path)) updated.push(resource.path);
		updated.push(`${state === "load" ? "+" : "-"}${pattern}`);
	}
	(settings as Record<string, unknown>)[resource.type] = updated;
}

function createDeltaSource(resource: ManagedResource, cwd: string, agentDir: string): PackageSource {
	const source = resource.metadata.source;
	if (!isLocalSource(source)) return { source, autoload: false };
	const resourceScope = resource.metadata.scope === "project" ? "project" : "user";
	const absolute = resolveLocalSource(source, sourceBase(resourceScope, cwd, agentDir));
	return { source: relative(sourceBase("project", cwd, agentDir), absolute) || ".", autoload: false };
}

function setPackage(
	settings: Settings,
	resource: ManagedResource,
	scope: ViewScope,
	state: OverrideState,
	cwd: string,
	agentDir: string,
): void {
	const targetScope = scope === "global" ? "user" : "project";
	const found = findPackage(settings, resource, targetScope, cwd, agentDir);
	let { index } = found;
	const { packages } = found;
	if (index < 0) {
		if (state === "inherit") return;
		packages.push(scope === "project" ? createDeltaSource(resource, cwd, agentDir) : resource.metadata.source);
		index = packages.length - 1;
	}

	let pkg = packages[index];
	if (typeof pkg === "string") {
		pkg = { source: pkg };
		packages[index] = pkg;
	}
	const target = packagePattern(resource);
	const targets = packageTargets(resource);
	const existing = pkg[resource.type];
	const stickyAllDisabled = existing?.length === 0 && pkg.autoload !== false;
	// Plain includes and !excludes define the package baseline. Preserve them:
	// removing the last positive include changes Pi's default from "only these"
	// to "all", which can unexpectedly enable sibling extensions or skills.
	const entries = [...(existing ?? [])].filter(
		(entry) => !isExactOverride(entry) || !targets.has(entryTarget(entry)),
	);
	if (stickyAllDisabled && state === "load") entries.push("!**");
	if (state !== "inherit") entries.push(`${state === "load" ? "+" : "-"}${target}`);
	(pkg as Record<string, unknown>)[resource.type] = entries.length > 0 ? entries : undefined;

	const hasFilters = FILTER_KEYS.some((key) => pkg[key] !== undefined);
	if (!hasFilters) {
		if (scope === "project" && pkg.autoload === false) packages.splice(index, 1);
		else if (pkg.autoload === undefined) packages[index] = pkg.source;
	}
	settings.packages = packages;
}

/** Apply pending changes to a clone while preserving every unrelated setting. */
export function applyPendingToSettings(
	base: Settings,
	changes: readonly PendingChange[],
	scope: ViewScope,
	cwd: string,
	agentDir: string,
): Settings {
	const next = structuredClone(base);
	for (const change of changes) {
		if (change.scope !== scope) continue;
		const state: OverrideState = scope === "global" ? (change.afterEnabled ? "load" : "unload") : change.afterOverride;
		if (change.resource.metadata.origin === "package") {
			setPackage(next, change.resource, scope, state, cwd, agentDir);
		} else {
			setTopLevel(next, change.resource, scope, state, cwd, agentDir);
		}
	}
	return next;
}

export function changedFields(before: Settings, after: Settings): Array<ResourceType | "packages"> {
	const fields: Array<ResourceType | "packages"> = ["skills", "extensions", "packages"];
	return fields.filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
}

export function metadataKey(metadata: PathMetadata): string {
	return `${metadata.origin}:${metadata.scope}:${metadata.source}:${metadata.baseDir ?? ""}`;
}
