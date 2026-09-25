import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
	DefaultPackageManager,
	SettingsManager,
	getAgentDir,
	loadSkills,
	type PackageSource,
	type PathMetadata,
	type ResolvedPaths,
	type ResolvedResource,
	type ResourceDiagnostic,
} from "@earendil-works/pi-coding-agent";
import { applyPendingToSettings, changedFields, isLocalSource, metadataKey, sourcesMatch } from "./mutations.ts";
import { AtomicSettingsStorage } from "./storage.ts";
import type {
	ManagedResource,
	PendingChange,
	ResolvedCatalog,
	ResourceType,
	SavePreview,
	SaveResult,
	Settings,
	ViewScope,
} from "./types.ts";

function canonical(path: string): string {
	return resolve(path);
}

function resourceName(type: ResourceType, path: string): string {
	return type === "skills" && basename(path) === "SKILL.md" ? basename(dirname(path)) : basename(path);
}

function shortPath(path: string, cwd: string, preferCwd: boolean): string {
	if (preferCwd) {
		const projectPath = relative(cwd, path);
		if (projectPath === "") return ".";
		if (!projectPath.startsWith("..")) return `./${projectPath}`;
	}
	const home = homedir();
	if (path === home || path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
	const fromCwd = relative(cwd, path);
	return !fromCwd.startsWith("..") ? `./${fromCwd}` : path;
}

function sourceRoot(metadata: PathMetadata, path: string): string | undefined {
	if (!metadata.baseDir) return undefined;
	const [first] = relative(metadata.baseDir, path).split(/[\\/]/);
	return first === "skills" ? join(metadata.baseDir, "skills") : metadata.baseDir;
}

function groupLabel(metadata: PathMetadata, path: string, cwd: string): string {
	const scope = metadata.scope === "project" ? "Project" : "Global";
	if (metadata.origin === "package") return `${scope} ${metadata.source}`;
	const root = sourceRoot(metadata, path);
	if (root) return `${scope} ${shortPath(root, cwd, metadata.scope === "project").replace(/^\.\//, "")}`;
	return metadata.scope === "project" ? "Project settings" : "Global settings";
}

export function selfProtected(resource: ResolvedResource, extensionRoot: string): boolean {
	const path = canonical(resource.path);
	const root = canonical(extensionRoot);
	if (path === root || path.startsWith(`${root}/`)) return true;
	// Only the current identity is protected. A legacy pi-pkg-manager install stays
	// manageable so it can be removed after migrating to pi-pkg-config.
	return /(?:^|[/@:])pi-pkg-config(?:@|$|[/])/i.test(resource.metadata.source);
}

interface SkillValidation {
	diagnostics: ResourceDiagnostic[];
	descriptions: Map<string, string>;
}

function validateSkills(resources: ResolvedResource[], cwd: string, agentDir: string): SkillValidation {
	const diagnostics: ResourceDiagnostic[] = [];
	const descriptions = new Map<string, string>();
	const collect = (loaded: ReturnType<typeof loadSkills>) => {
		diagnostics.push(...loaded.diagnostics);
		for (const skill of loaded.skills) descriptions.set(canonical(skill.filePath), skill.description);
	};
	try {
		const enabledPaths = resources.filter((resource) => resource.enabled).map((resource) => resource.path);
		collect(loadSkills({ cwd, agentDir, skillPaths: enabledPaths, includeDefaults: false }));
		// Disabled skills are validated in isolation so they can show parse errors
		// without creating collisions that do not exist in Pi's active skill set.
		for (const resource of resources) {
			if (resource.enabled) continue;
			const isolated = loadSkills({ cwd, agentDir, skillPaths: [resource.path], includeDefaults: false });
			diagnostics.push(...isolated.diagnostics.filter((diagnostic) => diagnostic.type !== "collision"));
			for (const skill of isolated.skills) descriptions.set(canonical(skill.filePath), skill.description);
		}
	} catch (error) {
		diagnostics.push({ type: "error", message: error instanceof Error ? error.message : String(error) });
	}
	return { diagnostics, descriptions };
}

function sourceString(source: PackageSource): string {
	return typeof source === "string" ? source : source.source;
}

function isFullProjectPackage(
	metadata: PathMetadata,
	projectSettings: Settings,
	cwd: string,
	agentDir: string,
): boolean {
	if (metadata.origin !== "package" || metadata.scope !== "project") return false;
	const entry = (projectSettings.packages ?? []).find((pkg) =>
		sourcesMatch(metadata.source, "project", sourceString(pkg), "project", cwd, agentDir),
	);
	return entry !== undefined && (typeof entry === "string" || entry.autoload !== false);
}

function changedSettingKeys(before: Settings, after: Settings): string[] {
	const left = before as Record<string, unknown>;
	const right = after as Record<string, unknown>;
	return [...new Set([...Object.keys(left), ...Object.keys(right)])]
		.filter((key) => JSON.stringify(left[key]) !== JSON.stringify(right[key]))
		.sort();
}

function diagnosticsFor(path: string, diagnostics: ResourceDiagnostic[]): ResourceDiagnostic[] {
	return diagnostics.filter(
		(diagnostic) =>
			diagnostic.path === path ||
			diagnostic.collision?.loserPath === path ||
			diagnostic.collision?.winnerPath === path,
	);
}

function mapResolved(
	resolved: ResolvedPaths,
	globalByKey: Map<string, ResolvedResource>,
	cwd: string,
	agentDir: string,
	extensionRoot: string,
	projectSettings: Settings,
): ManagedResource[] {
	const skillValidation = validateSkills(resolved.skills, cwd, agentDir);
	const result: ManagedResource[] = [];
	for (const type of ["skills", "extensions"] as const) {
		for (const resource of resolved[type]) {
			const path = canonical(resource.path);
			const global = globalByKey.get(`${type}:${path}`);
			const inheritedGlobal = global !== undefined && !isFullProjectPackage(resource.metadata, projectSettings, cwd, agentDir);
			const diagnostics = diagnosticsFor(path, skillValidation.diagnostics);
			if (!existsSync(path)) diagnostics.push({ type: "error", path, message: "Resource path does not exist" });
			// An explicit settings entry loses the directory metadata (`baseDir`/`source`) that
			// auto-discovered resources carry. Reuse the global resolution's metadata so an
			// inherited resource stays in the directory group the user sees in the Global view
			// instead of landing in the synthetic settings bucket.
			const groupSource =
				global !== undefined && resource.metadata.origin !== "package" && sourceRoot(resource.metadata, path) === undefined
					? global.metadata
					: resource.metadata;
			const groupKey = metadataKey(groupSource);
			result.push({
				id: `${type}:${path}`,
				type,
				path,
				name: resourceName(type, path),
				enabled: resource.enabled,
				globalEnabled: global?.enabled ?? resource.enabled,
				metadata: resource.metadata,
				description: type === "skills" ? skillValidation.descriptions.get(path) : undefined,
				inheritedGlobal,
				packageSource: resource.metadata.origin === "package" ? resource.metadata.source : undefined,
				groupKey,
				groupLabel: groupLabel(groupSource, path, cwd),
				diagnostics,
				selfProtected: selfProtected(resource, extensionRoot),
			});
		}
	}
	return result;
}

export class PackageManagerBackend {
	readonly agentDir: string;
	readonly storage: AtomicSettingsStorage;
	private baseVersions: Record<ViewScope, string>;
	private baseSettings: Record<ViewScope, Settings> = { global: {}, project: {} };
	readonly cwd: string;
	readonly projectTrusted: boolean;
	readonly extensionRoot: string;

	constructor(cwd: string, projectTrusted: boolean, extensionRoot: string, agentDir = getAgentDir()) {
		this.cwd = cwd;
		this.projectTrusted = projectTrusted;
		this.extensionRoot = extensionRoot;
		this.agentDir = agentDir;
		this.storage = new AtomicSettingsStorage(cwd, agentDir);
		this.baseVersions = this.storage.versions();
	}

	async resolve(): Promise<ResolvedCatalog> {
		const globalManager = SettingsManager.create(this.cwd, this.agentDir, { projectTrusted: false });
		const projectManager = SettingsManager.create(this.cwd, this.agentDir, { projectTrusted: this.projectTrusted });
		const settingsErrors = [...globalManager.drainErrors(), ...projectManager.drainErrors()];
		if (settingsErrors.length > 0) throw settingsErrors[0]!.error;
		const globalResolved = await new DefaultPackageManager({
			cwd: this.cwd,
			agentDir: this.agentDir,
			settingsManager: globalManager,
		}).resolve(async () => "skip");
		const projectResolved = this.projectTrusted
			? await new DefaultPackageManager({ cwd: this.cwd, agentDir: this.agentDir, settingsManager: projectManager }).resolve(
					async () => "skip",
				)
			: globalResolved;
		const globalByKey = new Map<string, ResolvedResource>();
		for (const type of ["skills", "extensions"] as const) {
			for (const resource of globalResolved[type]) globalByKey.set(`${type}:${canonical(resource.path)}`, resource);
		}
		const globalSettings = globalManager.getGlobalSettings();
		const projectSettings = projectManager.getProjectSettings();
		const global = mapResolved(globalResolved, globalByKey, this.cwd, this.agentDir, this.extensionRoot, {});
		const project = mapResolved(
			projectResolved,
			globalByKey,
			this.cwd,
			this.agentDir,
			this.extensionRoot,
			projectSettings,
		);
		this.baseSettings = { global: globalSettings, project: projectSettings };
		return { global, project, globalSettings, projectSettings };
	}

	prepareSave(changes: readonly PendingChange[]): SavePreview {
		const versions = this.storage.versions();
		const externallyChanged = (["global", "project"] as const).filter(
			(scope) => changes.some((change) => change.scope === scope) && versions[scope] !== this.baseVersions[scope],
		);
		const manager = SettingsManager.fromStorage(this.storage, { projectTrusted: this.projectTrusted });
		const readErrors = manager.drainErrors();
		if (readErrors.length > 0) throw readErrors[0]!.error;
		const latest = { global: manager.getGlobalSettings(), project: manager.getProjectSettings() };
		const merged = {
			global: applyPendingToSettings(latest.global, changes, "global", this.cwd, this.agentDir),
			project: applyPendingToSettings(latest.project, changes, "project", this.cwd, this.agentDir),
		};
		const lines = changes.map((change) => {
			const usesOverride = change.scope === "project" && change.resource.inheritedGlobal;
			const before = usesOverride
				? change.beforeOverride
				: change.beforeEnabled
					? "enabled"
					: "disabled";
			const after = usesOverride ? change.afterOverride : change.afterEnabled ? "enabled" : "disabled";
			return `${change.scope === "project" ? "Project" : "Global"} ${change.resource.type}: ${change.resource.name}  ${before} -> ${after}`;
		});
		if (externallyChanged.length > 0) {
			lines.unshift("Settings changed on disk. Review the merged values below before saving.");
			for (const scope of externallyChanged) {
				const label = scope === "project" ? "Project" : "Global";
				const latestRecord = latest[scope] as Record<string, unknown>;
				for (const field of changedSettingKeys(this.baseSettings[scope], latest[scope])) {
					lines.push(`External ${label} ${field} (kept): ${JSON.stringify(latestRecord[field]) ?? "<removed>"}`);
				}
				for (const field of changedFields(latest[scope], merged[scope])) {
					lines.push("", `Merged ${label} ${field}:`);
					lines.push(`  disk: ${JSON.stringify(latest[scope][field] ?? [])}`);
					lines.push(`  save: ${JSON.stringify(merged[scope][field] ?? [])}`);
				}
			}
		}
		return { lines, versions, externallyChanged };
	}

	async commitSave(changes: readonly PendingChange[], preview: SavePreview): Promise<SaveResult> {
		const manager = SettingsManager.fromStorage(this.storage, { projectTrusted: this.projectTrusted });
		const before = { global: manager.getGlobalSettings(), project: manager.getProjectSettings() };
		const next = {
			global: applyPendingToSettings(before.global, changes, "global", this.cwd, this.agentDir),
			project: applyPendingToSettings(before.project, changes, "project", this.cwd, this.agentDir),
		};
		this.storage.begin();
		try {
			for (const field of changedFields(before.global, next.global)) this.setField(manager, "global", field, next.global);
			for (const field of changedFields(before.project, next.project)) this.setField(manager, "project", field, next.project);
			await manager.flush();
			const managerErrors = manager.drainErrors();
			const failedByManager = new Set(managerErrors.map((item) => item.scope));
			for (const scope of failedByManager) this.storage.discard(scope);
			const committed = this.storage.commit(preview.versions);
			for (const scope of committed.written) this.baseVersions[scope] = this.storage.versions()[scope];
			return {
				savedScopes: committed.written,
				staleScopes: committed.stale,
				failedScopes: [
					...managerErrors.map((item) => ({ scope: item.scope, message: item.error.message })),
					...committed.failed,
				],
			};
		} catch (error) {
			this.storage.abort();
			return {
				savedScopes: [],
				staleScopes: [],
				failedScopes: [{ scope: "global", message: error instanceof Error ? error.message : String(error) }],
			};
		}
	}

	private setField(
		manager: SettingsManager,
		scope: ViewScope,
		field: ResourceType | "packages",
		settings: Settings,
	): void {
		if (field === "packages") {
			if (scope === "global") manager.setPackages(settings.packages ?? []);
			else manager.setProjectPackages(settings.packages ?? []);
		} else if (field === "skills") {
			if (scope === "global") manager.setSkillPaths(settings.skills ?? []);
			else manager.setProjectSkillPaths(settings.skills ?? []);
		} else if (scope === "global") manager.setExtensionPaths(settings.extensions ?? []);
		else manager.setProjectExtensionPaths(settings.extensions ?? []);
	}

	async removePackage(source: string, scope: ViewScope): Promise<string | undefined> {
		const settingsScope = scope === "project" ? "project" : "user";
		const initialManager = SettingsManager.fromStorage(this.storage, { projectTrusted: this.projectTrusted });
		const initialErrors = initialManager.drainErrors();
		if (initialErrors.length > 0) throw initialErrors[0]!.error;
		const packages = new DefaultPackageManager({
			cwd: this.cwd,
			agentDir: this.agentDir,
			settingsManager: initialManager,
		});
		const configured = packages
			.listConfiguredPackages()
			.find((pkg) => pkg.source === source && pkg.scope === settingsScope);
		if (!configured) throw new Error(`Package is not removable from ${scope} scope`);
		const physicalRemovalSource = isLocalSource(source) ? configured.installedPath ?? source : source;

		// Persist the semantic removal before deleting managed files. A failed
		// settings write therefore leaves the installed package untouched.
		let persisted = false;
		for (let attempt = 0; attempt < 3; attempt++) {
			const expected = this.storage.versions();
			const manager = SettingsManager.fromStorage(this.storage, { projectTrusted: this.projectTrusted });
			const readErrors = manager.drainErrors();
			if (readErrors.length > 0) throw readErrors[0]!.error;
			const currentPackages = new DefaultPackageManager({
				cwd: this.cwd,
				agentDir: this.agentDir,
				settingsManager: manager,
			});
			const currentEntry = currentPackages
				.listConfiguredPackages()
				.find((pkg) => pkg.source === source && pkg.scope === settingsScope);
			if (!currentEntry) {
				persisted = true;
				break;
			}

			this.storage.begin();
			try {
				const settingsRemovalSource = isLocalSource(source) ? currentEntry.installedPath ?? source : source;
				if (!currentPackages.removeSourceFromSettings(settingsRemovalSource, { local: scope === "project" })) {
					this.storage.abort();
					throw new Error("Package settings entry was not found");
				}
				await manager.flush();
				const errors = manager.drainErrors();
				if (errors.length > 0) {
					this.storage.abort();
					throw errors[0]!.error;
				}
				const result = this.storage.commit(expected);
				if (result.failed.length > 0) throw new Error(result.failed[0]!.message);
				if (result.stale.length > 0) continue;
				persisted = true;
				break;
			} catch (error) {
				this.storage.abort();
				throw error;
			}
		}
		if (!persisted) throw new Error("Settings kept changing during package removal; reopen the manager and retry");

		this.baseVersions = this.storage.versions();
		const verifyManager = SettingsManager.fromStorage(this.storage, { projectTrusted: this.projectTrusted });
		const verifyErrors = verifyManager.drainErrors();
		if (verifyErrors.length > 0) throw verifyErrors[0]!.error;
		const verifyPackages = new DefaultPackageManager({
			cwd: this.cwd,
			agentDir: this.agentDir,
			settingsManager: verifyManager,
		});
		if (
			verifyPackages
				.listConfiguredPackages()
				.some((pkg) => pkg.source === source && pkg.scope === settingsScope)
		) {
			throw new Error("Package was re-added while removal was in progress; installed files were left untouched");
		}
		try {
			await packages.remove(physicalRemovalSource, { local: scope === "project" });
			return undefined;
		} catch (error) {
			return `Settings were removed, but managed-file cleanup failed: ${error instanceof Error ? error.message : String(error)}`;
		}
	}
}
