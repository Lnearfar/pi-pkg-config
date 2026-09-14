import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { PackageManagerBackend } from "./backend.ts";
import { PackageManagerModel } from "./model.ts";
import { PackageManagerComponent, type UiAction } from "./ui.ts";
import type { ManagedResource, ResourceType, ViewScope } from "./types.ts";

const EXTENSION_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function askReload(ctx: ExtensionCommandContext): Promise<boolean> {
	const reload = await ctx.ui.confirm("Reload now?", "Reload extensions and skills to apply the saved configuration?");
	if (reload) {
		await ctx.reload();
		return true;
	}
	ctx.ui.notify("Changes are saved. Run /reload later to apply them.", "info");
	return false;
}

function removalSummary(model: PackageManagerModel, resource: ManagedResource): string {
	const scope: ViewScope = model.scope;
	const source = scope === "global" ? model.catalog.global : model.catalog.project;
	const affected = source.filter(
		(item) =>
			item.packageSource === resource.packageSource &&
			(scope === "global" ? item.metadata.scope === "user" : item.metadata.scope === "project" && !item.inheritedGlobal),
	);
	const skills = affected.filter((item) => item.type === "skills").map((item) => item.name);
	const extensions = affected.filter((item) => item.type === "extensions").map((item) => item.name);
	return [
		`Package: ${resource.packageSource}`,
		`Scope: ${scope === "project" ? "Project" : "Global"}`,
		`Skills: ${skills.length > 0 ? skills.join(", ") : "none"}`,
		`Extensions: ${extensions.length > 0 ? extensions.join(", ") : "none"}`,
		"This removes the package and its settings entry. Local package files are not deleted.",
	].join("\n");
}

async function savePending(
	ctx: ExtensionCommandContext,
	backend: PackageManagerBackend,
	model: PackageManagerModel,
): Promise<"continue" | "reloaded"> {
	while (model.pending.size > 0) {
		const changes = model.pendingChanges();
		let preview;
		try {
			preview = backend.prepareSave(changes);
		} catch (error) {
			ctx.ui.notify(`Unable to read settings: ${error instanceof Error ? error.message : String(error)}`, "error");
			return "continue";
		}
		const confirmed = await ctx.ui.confirm("Save all pending changes?", preview.lines.join("\n"));
		if (!confirmed) return "continue";
		const result = await backend.commitSave(changes, preview);
		if (result.savedScopes.length > 0) {
			for (const scope of result.savedScopes) model.discardScope(scope);
			try {
				model.setCatalog(await backend.resolve());
			} catch (error) {
				ctx.ui.notify(`Changes were saved, but resources could not be refreshed: ${error instanceof Error ? error.message : String(error)}`, "warning");
			}
		}
		if (result.staleScopes.length > 0) {
			ctx.ui.notify("Settings changed again before the write. Review the refreshed candidate.", "warning");
			continue;
		}
		if (result.failedScopes.length > 0) {
			ctx.ui.notify(
				result.failedScopes.map((failure) => `${failure.scope}: ${failure.message}`).join("\n"),
				"error",
			);
			return "continue";
		}
		if (model.pending.size === 0 && (await askReload(ctx))) return "reloaded";
		return "continue";
	}
	return "continue";
}

const OVERLAY_CHROME_ROWS = 11; // Borders, header, column header, separator, status line, and wrapped actions.

async function runManager(ctx: ExtensionCommandContext, command: string, initialType: ResourceType = "skills"): Promise<void> {
	if (ctx.mode !== "tui") {
		ctx.ui.notify(`${command} requires TUI mode.`, "error");
		return;
	}
	const backend = new PackageManagerBackend(ctx.cwd, ctx.isProjectTrusted(), EXTENSION_ROOT);
	let catalog;
	try {
		catalog = await backend.resolve();
	} catch (error) {
		ctx.ui.notify(`Unable to resolve Pi resources: ${error instanceof Error ? error.message : String(error)}`, "error");
		return;
	}
	const model = new PackageManagerModel(catalog, ctx.cwd, backend.agentDir, ctx.isProjectTrusted());
	model.type = initialType;

	for (;;) {
		const action = await ctx.ui.custom<UiAction>(
			(tui, theme, keybindings, done) =>
				new PackageManagerComponent(
					model,
					theme,
					keybindings,
					done,
					() => tui.requestRender(),
					Math.max(1, Math.min(10, Math.floor(tui.terminal.rows * 0.8) - OVERLAY_CHROME_ROWS)),
				),
			{
				overlay: true,
				overlayOptions: {
					anchor: "center",
					width: 80,
					minWidth: 50,
					maxHeight: "80%",
					margin: 1,
				},
			},
		);

		if (action.type === "close") {
			if (!action.pending || (await ctx.ui.confirm("Discard unsaved changes?", "Discard all pending changes and close?"))) {
				model.discardAll();
				return;
			}
			continue;
		}

		if (action.type === "save") {
			if ((await savePending(ctx, backend, model)) === "reloaded") return;
			continue;
		}

		const resource = action.resource;
		const source = resource.packageSource;
		if (!source) continue;
		const confirmed = await ctx.ui.confirm("Remove package?", removalSummary(model, resource));
		if (!confirmed) continue;
		try {
			const cleanupWarning = await backend.removePackage(source, model.scope);
			model.discardPackage(source, model.scope);
			try {
				model.setCatalog(await backend.resolve());
			} catch (error) {
				ctx.ui.notify(`Package was removed, but resources could not be refreshed: ${error instanceof Error ? error.message : String(error)}`, "warning");
			}
			ctx.ui.notify(`Removed ${source} from ${model.scope} scope.`, "info");
			if (cleanupWarning) ctx.ui.notify(cleanupWarning, "warning");
			if (await askReload(ctx)) return;
		} catch (error) {
			ctx.ui.notify(`Package removal failed: ${error instanceof Error ? error.message : String(error)}`, "error");
		}
	}
}

export default function pkgManagerExtension(pi: ExtensionAPI): void {
	pi.registerCommand("pkg-manager", {
		description: "Manage Pi skills and extensions",
		handler: async (_args, ctx) => runManager(ctx, "/pkg-manager"),
	});
	pi.registerCommand("skills-manager", {
		description: "Manage Pi skills",
		handler: async (_args, ctx) => runManager(ctx, "/skills-manager", "skills"),
	});
	pi.registerCommand("extensions-manager", {
		description: "Manage Pi extensions",
		handler: async (_args, ctx) => runManager(ctx, "/extensions-manager", "extensions"),
	});
}
