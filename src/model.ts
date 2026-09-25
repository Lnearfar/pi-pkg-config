import { getProjectOverride, sourcesMatch } from "./mutations.ts";
import type {
	ManagedResource,
	OverrideState,
	PendingChange,
	ResolvedCatalog,
	ResourceType,
	Settings,
	ViewScope,
	ViewState,
} from "./types.ts";

function viewKey(type: ResourceType, scope: ViewScope): string {
	return `${type}:${scope}`;
}

function pendingKey(resource: ManagedResource, scope: ViewScope): string {
	return `${scope}:${resource.type}:${resource.path}`;
}

export class PackageManagerModel {
	type: ResourceType = "skills";
	scope: ViewScope = "project";
	readonly pending = new Map<string, PendingChange>();
	private readonly views = new Map<string, ViewState>();
	catalog: ResolvedCatalog;
	readonly cwd: string;
	readonly agentDir: string;
	projectTrusted: boolean;

	constructor(catalog: ResolvedCatalog, cwd: string, agentDir: string, projectTrusted: boolean) {
		this.catalog = catalog;
		this.cwd = cwd;
		this.agentDir = agentDir;
		this.projectTrusted = projectTrusted;
		for (const type of ["skills", "extensions"] as const) {
			for (const scope of ["project", "global"] as const) {
				this.views.set(viewKey(type, scope), { query: "", searching: false, selected: 0, scroll: 0 });
			}
		}
	}

	get view(): ViewState {
		return this.views.get(viewKey(this.type, this.scope))!;
	}

	setCatalog(catalog: ResolvedCatalog): void {
		this.catalog = catalog;
		this.clampSelection();
	}

	resources(): ManagedResource[] {
		const source = this.scope === "global" ? this.catalog.global : this.catalog.project;
		const query = this.view.query.trim().toLocaleLowerCase();
		const terms = query.split(/\s+/).filter(Boolean);
		const filtered = source.filter((resource) => {
			if (resource.type !== this.type) return false;
			if (terms.length === 0) return true;
			const haystack = `${resource.name} ${resource.path} ${resource.groupLabel} ${resource.metadata.source}`.toLocaleLowerCase();
			return terms.every((term) => haystack.includes(term));
		});
		return filtered.sort((a, b) => this.compareResources(a, b));
	}

	private compareResources(a: ManagedResource, b: ManagedResource): number {
		if (this.scope === "project") {
			const aProject = !a.inheritedGlobal && a.metadata.scope === "project";
			const bProject = !b.inheritedGlobal && b.metadata.scope === "project";
			if (aProject !== bProject) return aProject ? -1 : 1;
		}
		return a.groupLabel.localeCompare(b.groupLabel) || a.name.localeCompare(b.name) || a.path.localeCompare(b.path);
	}

	selectedResource(): ManagedResource | undefined {
		return this.resources()[this.view.selected];
	}

	move(delta: number): void {
		const count = this.resources().length;
		this.view.selected = Math.max(0, Math.min(Math.max(0, count - 1), this.view.selected + delta));
		if (this.view.selected < this.view.scroll) this.view.scroll = this.view.selected;
	}

	clampSelection(): void {
		const count = this.resources().length;
		this.view.selected = Math.min(this.view.selected, Math.max(0, count - 1));
		this.view.scroll = Math.min(this.view.scroll, this.view.selected);
	}

	setQuery(query: string): void {
		this.view.query = query;
		this.view.selected = 0;
		this.view.scroll = 0;
	}

	originalOverride(resource: ManagedResource): OverrideState {
		return getProjectOverride(resource, this.catalog.projectSettings, this.cwd, this.agentDir);
	}

	currentOverride(resource: ManagedResource): OverrideState {
		return this.pending.get(pendingKey(resource, "project"))?.afterOverride ?? this.originalOverride(resource);
	}

	globalResource(resource: ManagedResource): ManagedResource | undefined {
		return this.catalog.global.find((item) => item.type === resource.type && item.path === resource.path);
	}

	globalState(resource: ManagedResource): boolean | undefined {
		const globalResource = this.globalResource(resource);
		if (!globalResource) return undefined;
		return this.pending.get(pendingKey(globalResource, "global"))?.afterEnabled ?? globalResource.enabled;
	}

	private globalEnabled(resource: ManagedResource): boolean {
		return this.globalState(resource) ?? resource.globalEnabled;
	}

	effectiveEnabled(resource: ManagedResource): boolean {
		if (this.scope === "global") {
			return this.pending.get(pendingKey(resource, "global"))?.afterEnabled ?? resource.enabled;
		}
		const projectPending = this.pending.get(pendingKey(resource, "project"));
		const state = projectPending?.afterOverride ?? this.originalOverride(resource);
		if (state === "load") return true;
		if (state === "unload") return false;
		if (!resource.inheritedGlobal) return resource.enabled;
		const globalPending = this.pending.get(pendingKey(resource, "global"));
		// The project resolver is authoritative when a non-exact project pattern
		// changes the resource relative to its global state. Otherwise, preview a
		// staged global edit through normal inheritance.
		if (!projectPending && resource.enabled !== resource.globalEnabled) return resource.enabled;
		return globalPending?.afterEnabled ?? resource.globalEnabled;
	}

	toggle(resource = this.selectedResource()): boolean {
		if (!resource || (this.scope === "project" && !this.projectTrusted)) return false;
		const key = pendingKey(resource, this.scope);
		if (this.scope === "global") {
			const before = resource.enabled;
			const after = !this.effectiveEnabled(resource);
			if (after === before) this.pending.delete(key);
			else {
				this.pending.set(key, {
					key,
					resource,
					scope: "global",
					beforeEnabled: before,
					beforeOverride: "inherit",
					afterEnabled: after,
					afterOverride: "inherit",
				});
			}
			return true;
		}

		const beforeOverride = this.originalOverride(resource);
		if (resource.inheritedGlobal) {
			// Inherited resources cycle through inherit -> load -> unload -> inherit.
			const current = this.currentOverride(resource);
			const afterOverride: OverrideState = current === "inherit" ? "load" : current === "load" ? "unload" : "inherit";
			if (afterOverride === beforeOverride) this.pending.delete(key);
			else {
				this.pending.set(key, {
					key,
					resource,
					scope: "project",
					beforeEnabled: resource.enabled,
					beforeOverride,
					afterEnabled: afterOverride === "inherit" ? this.globalEnabled(resource) : afterOverride === "load",
					afterOverride,
				});
			}
			return true;
		}

		// A project-owned resource has no global state to inherit, so it cycles
		// between its two resolved states.
		const afterEnabled = !this.effectiveEnabled(resource);
		if (afterEnabled === resource.enabled) this.pending.delete(key);
		else {
			this.pending.set(key, {
				key,
				resource,
				scope: "project",
				beforeEnabled: resource.enabled,
				beforeOverride,
				afterEnabled,
				afterOverride: afterEnabled ? "load" : "unload",
			});
		}
		return true;
	}

	isPending(resource: ManagedResource, scope = this.scope): boolean {
		return this.pending.has(pendingKey(resource, scope));
	}

	pendingChanges(): PendingChange[] {
		return [...this.pending.values()];
	}

	discardAll(): void {
		this.pending.clear();
	}

	discardScope(scope: ViewScope): void {
		for (const [key, change] of this.pending) if (change.scope === scope) this.pending.delete(key);
	}

	discardPackage(source: string, scope: ViewScope): void {
		const sourceScope = scope === "project" ? "project" : "user";
		for (const [key, change] of this.pending) {
			const packageSource = change.resource.packageSource;
			if (!packageSource) continue;
			const resourceScope = change.resource.metadata.scope === "project" ? "project" : "user";
			if (sourcesMatch(source, sourceScope, packageSource, resourceScope, this.cwd, this.agentDir)) {
				this.pending.delete(key);
			}
		}
	}

	markScopesSaved(scopes: readonly ViewScope[], latestSettings: { global: Settings; project: Settings }): void {
		for (const scope of scopes) this.discardScope(scope);
		this.catalog.globalSettings = latestSettings.global;
		this.catalog.projectSettings = latestSettings.project;
	}
}
