import type { PathMetadata, ResourceDiagnostic, SettingsManager } from "@earendil-works/pi-coding-agent";

export type Settings = ReturnType<SettingsManager["getGlobalSettings"]>;

export const RESOURCE_TYPES = ["skills", "extensions"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];
export type ViewScope = "project" | "global";
export type OverrideState = "inherit" | "load" | "unload";

export interface ManagedResource {
	id: string;
	type: ResourceType;
	path: string;
	name: string;
	enabled: boolean;
	globalEnabled: boolean;
	metadata: PathMetadata;
	/** Skill description from Pi's skill loader, when Pi resolved one. */
	description?: string;
	/** True when this exact path is present in the global-only resolution. */
	inheritedGlobal: boolean;
	packageSource?: string;
	groupKey: string;
	groupLabel: string;
	diagnostics: ResourceDiagnostic[];
	selfProtected: boolean;
}

export interface PendingChange {
	key: string;
	resource: ManagedResource;
	scope: ViewScope;
	beforeEnabled: boolean;
	beforeOverride: OverrideState;
	afterEnabled: boolean;
	afterOverride: OverrideState;
}

export interface ResolvedCatalog {
	global: ManagedResource[];
	project: ManagedResource[];
	globalSettings: Settings;
	projectSettings: Settings;
}

export interface ViewState {
	query: string;
	searching: boolean;
	selected: number;
	scroll: number;
}

export interface SavePreview {
	lines: string[];
	versions: Record<ViewScope, string>;
	externallyChanged: ViewScope[];
}

export interface SaveResult {
	savedScopes: ViewScope[];
	failedScopes: Array<{ scope: ViewScope; message: string }>;
	staleScopes: ViewScope[];
}
