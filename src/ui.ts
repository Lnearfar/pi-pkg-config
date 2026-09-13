import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	CURSOR_MARKER,
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
	type Focusable,
	type KeybindingsManager,
} from "@earendil-works/pi-tui";
import { PackageManagerModel } from "./model.ts";
import type { ManagedResource } from "./types.ts";

export type UiAction =
	| { type: "close"; pending: boolean }
	| { type: "save" }
	| { type: "remove"; resource: ManagedResource };

export class PackageManagerComponent implements Focusable {
	focused = false;
	private details = false;
	private readonly model: PackageManagerModel;
	private readonly theme: Theme;
	private readonly done: (action: UiAction) => void;
	private readonly requestRender: () => void;
	private readonly keybindings: KeybindingsManager;
	private readonly listRowBudget: number;

	constructor(
		model: PackageManagerModel,
		theme: Theme,
		keybindings: KeybindingsManager,
		done: (action: UiAction) => void,
		requestRender: () => void,
		listRowBudget = 11,
	) {
		this.model = model;
		this.theme = theme;
		this.keybindings = keybindings;
		this.done = done;
		this.requestRender = requestRender;
		this.listRowBudget = Math.max(1, listRowBudget);
	}

	handleInput(data: string): void {
		const view = this.model.view;
		if (this.details) {
			if (
				this.keybindings.matches(data, "tui.select.cancel") ||
				this.keybindings.matches(data, "tui.select.confirm") ||
				matchesKey(data, Key.escape) ||
				matchesKey(data, Key.enter)
			) {
				this.details = false;
				this.requestRender();
			}
			return;
		}

		if (matchesKey(data, Key.ctrl("s"))) {
			if (this.model.pending.size > 0) this.done({ type: "save" });
			return;
		}

		if (this.keybindings.matches(data, "tui.input.tab") || matchesKey(data, Key.tab)) {
			this.model.type = this.model.type === "skills" ? "extensions" : "skills";
			this.model.clampSelection();
			this.requestRender();
			return;
		}
		if (matchesKey(data, Key.left) || matchesKey(data, Key.right)) {
			this.model.scope = this.model.scope === "project" ? "global" : "project";
			this.model.clampSelection();
			this.requestRender();
			return;
		}

		if (view.searching) {
			if (this.keybindings.matches(data, "tui.select.cancel") || matchesKey(data, Key.escape)) {
				view.searching = false;
				this.model.setQuery("");
			} else if (matchesKey(data, Key.backspace)) {
				this.model.setQuery(Array.from(view.query).slice(0, -1).join(""));
			} else if (!/[\u0000-\u001f\u007f]/.test(data)) {
				this.model.setQuery(view.query + data);
			}
			this.requestRender();
			return;
		}

		if (data === "/") {
			view.searching = true;
			this.requestRender();
			return;
		}
		if (this.keybindings.matches(data, "tui.select.up") || matchesKey(data, Key.up)) {
			this.model.move(-1);
		} else if (this.keybindings.matches(data, "tui.select.down") || matchesKey(data, Key.down)) {
			this.model.move(1);
		} else if (this.keybindings.matches(data, "tui.select.pageUp")) {
			this.model.move(-8);
		} else if (this.keybindings.matches(data, "tui.select.pageDown")) {
			this.model.move(8);
		} else if (matchesKey(data, Key.space)) {
			this.model.toggle();
		} else if (data === "r") {
			this.model.reset();
		} else if (this.keybindings.matches(data, "tui.select.confirm") || matchesKey(data, Key.enter)) {
			if (this.model.selectedResource()) this.details = true;
		} else if (matchesKey(data, Key.delete)) {
			const resource = this.model.selectedResource();
			if (resource && this.canRemove(resource)) this.done({ type: "remove", resource });
		} else if (this.keybindings.matches(data, "tui.select.cancel") || matchesKey(data, Key.escape)) {
			this.done({ type: "close", pending: this.model.pending.size > 0 });
		}
		this.requestRender();
	}

	private canRemove(resource: ManagedResource): boolean {
		if (!resource.packageSource || resource.selfProtected) return false;
		if (this.model.scope === "project") {
			return this.model.projectTrusted && !resource.inheritedGlobal && resource.metadata.scope === "project";
		}
		return resource.metadata.scope === "user";
	}

	render(width: number): string[] {
		if (width < 4) return [" ".repeat(Math.max(0, width))];
		const w = width;
		const inner = w - 2;
		const lines: string[] = [];
		const border = (text: string) => this.theme.fg("borderAccent", text);
		const row = (content = "") => {
			const clipped = truncateToWidth(content, inner, "");
			return `${border("│")}${clipped}${" ".repeat(Math.max(0, inner - visibleWidth(clipped)))}${border("│")}`;
		};
		lines.push(border(`╭${"─".repeat(inner)}╮`));
		lines.push(row(this.renderHeader()));
		lines.push(row(this.theme.fg("dim", "─".repeat(inner))));
		if (this.details) this.renderDetails(row, lines, inner);
		else this.renderList(row, lines);
		lines.push(row(this.theme.fg("dim", "─".repeat(inner))));
		for (const footerLine of this.renderFooter()) lines.push(row(footerLine));
		lines.push(border(`╰${"─".repeat(inner)}╯`));
		return lines;
	}

	private renderHeader(): string {
		const tab = (label: string, active: boolean) =>
			active ? this.theme.fg("accent", this.theme.bold(`[${label}]`)) : this.theme.fg("dim", ` ${label} `);
		const scope = (label: string, active: boolean) =>
			active ? this.theme.fg("accent", this.theme.bold(`[${label}]`)) : this.theme.fg("dim", ` ${label} `);
		return ` ${this.theme.bold("Package Manager")}  ${tab("Skills", this.model.type === "skills")} ${tab("Extensions", this.model.type === "extensions")}  ${scope("Project", this.model.scope === "project")} ${scope("Global", this.model.scope === "global")}`;
	}

	private renderList(row: (content?: string) => string, lines: string[]): void {
		const resources = this.model.resources();
		const view = this.model.view;
		if (view.searching) {
			const marker = this.focused ? CURSOR_MARKER : "";
			lines.push(row(` Search: ${view.query}${marker}${this.theme.inverse(" ")}`));
		} else if (view.query) {
			lines.push(row(` Filter: ${this.theme.fg("accent", view.query)}`));
		}
		if (this.model.scope === "project" && !this.model.projectTrusted) {
			lines.push(row(this.theme.fg("warning", " Project is not trusted. Trust it with Pi to edit project settings.")));
		}
		if (resources.length === 0) {
			lines.push(row(""));
			lines.push(row(this.theme.fg("muted", " No detected resources match this view.")));
			for (let index = 2; index < this.listRowBudget + 1; index++) lines.push(row(""));
			return;
		}

		const listRowBudget = this.listRowBudget; // Reserve one stable row for the position indicator.
		const buildWindow = (start: number) => {
			const visible: Array<{ resource: ManagedResource; index: number; showGroup: boolean }> = [];
			let used = 0;
			let lastGroup = "";
			for (let index = start; index < resources.length; index++) {
				const resource = resources[index]!;
				const showGroup = resource.groupKey !== lastGroup;
				const needed = showGroup ? 2 : 1;
				if (used + needed > listRowBudget) break;
				visible.push({ resource, index, showGroup });
				used += needed;
				lastGroup = resource.groupKey;
			}
			return { visible, used };
		};

		if (view.selected < view.scroll) view.scroll = view.selected;
		let window = buildWindow(view.scroll);
		while (view.scroll < view.selected && !window.visible.some((entry) => entry.index === view.selected)) {
			view.scroll++;
			window = buildWindow(view.scroll);
		}
		for (const entry of window.visible) {
			const { resource } = entry;
			if (entry.showGroup) {
				const groupItems = resources.filter((item) => item.groupKey === resource.groupKey);
				const enabled = groupItems.filter((item) => this.model.effectiveEnabled(item)).length;
				lines.push(row(this.theme.fg("muted", ` ${resource.groupLabel}  ${enabled}/${groupItems.length} enabled`)));
			}
			const selected = entry.index === view.selected;
			const enabled = this.model.effectiveEnabled(resource);
			const status = this.status(resource, enabled);
			const scope = resource.inheritedGlobal ? "global" : resource.metadata.scope === "project" ? "project" : "global";
			let suffix = scope;
			if (this.model.scope === "project") {
				const override = this.model.currentOverride(resource);
				suffix = resource.inheritedGlobal ? override : override === "inherit" ? "project" : `project ${override}`;
			}
			if (resource.selfProtected) suffix = "🔒 required";
			if (this.model.isPending(resource)) suffix += "  * unsaved";
			const inherited = this.model.scope === "project" && resource.inheritedGlobal && this.model.currentOverride(resource) === "inherit";
			const name = inherited ? this.theme.fg("dim", resource.name) : resource.name;
			const text = ` ${selected ? "›" : " "} ${status} ${name}  ${this.theme.fg("dim", `${suffix} · ${scope}`)}`;
			lines.push(row(selected ? this.theme.bg("selectedBg", text) : text));
		}
		for (let index = window.used; index < listRowBudget; index++) lines.push(row(""));
		lines.push(row(this.theme.fg("dim", ` ${view.selected + 1}/${resources.length}`)));
	}

	private isShadowed(resource: ManagedResource): boolean {
		return resource.diagnostics.some(
			(item) => item.type === "collision" && item.collision?.loserPath === resource.path,
		);
	}

	private status(resource: ManagedResource, enabled: boolean): string {
		const error = resource.diagnostics.some((item) => item.type === "error");
		if (error) return this.theme.fg("error", "⚠");
		if (this.isShadowed(resource) && enabled) return this.theme.fg("warning", "◇");
		return enabled ? this.theme.fg("success", "●") : this.theme.fg("dim", "○");
	}

	private renderDetails(row: (content?: string) => string, lines: string[], inner: number): void {
		const resource = this.model.selectedResource();
		if (!resource) return;
		const enabled = this.model.effectiveEnabled(resource);
		const hasError = resource.diagnostics.some((item) => item.type === "error");
		const state = hasError ? "error" : this.isShadowed(resource) && enabled ? "shadowed" : enabled ? "enabled" : "disabled";
		lines.push(row(` ${this.theme.bold(resource.name)}  ${this.status(resource, enabled)} ${state}`));
		const detailLines = [
			` Type: ${resource.type}`,
			` Scope: ${this.model.scope === "project" && resource.inheritedGlobal ? "Global (project view)" : resource.metadata.scope === "project" ? "Project" : "Global"}`,
			` Source: ${resource.groupLabel}`,
			...(resource.packageSource ? [` Package: ${resource.packageSource}`] : []),
			` Path: ${resource.path}`,
			` Override: ${this.model.scope === "project" ? this.model.currentOverride(resource) : "not applicable"}`,
		];
		for (const detail of detailLines) lines.push(...wrapTextWithAnsi(detail, inner).map((part) => row(part)));
		const pending = this.model.pendingChanges().find((change) => change.resource.id === resource.id && change.scope === this.model.scope);
		if (pending) {
			const usesOverride = pending.scope === "project" && pending.resource.inheritedGlobal;
			const before = usesOverride
				? pending.beforeOverride
				: pending.beforeEnabled
					? "enabled"
					: "disabled";
			const after = usesOverride ? pending.afterOverride : pending.afterEnabled ? "enabled" : "disabled";
			lines.push(row(this.theme.fg("warning", ` Unsaved: ${before} -> ${after}`)));
		}
		if (resource.selfProtected) lines.push(row(this.theme.fg("warning", " 🔒 required: use external `pi remove` to uninstall this manager.")));
		if (resource.diagnostics.length === 0) lines.push(row(this.theme.fg("dim", " Diagnostics: none")));
		for (const diagnostic of resource.diagnostics) {
			lines.push(...wrapTextWithAnsi(` ${diagnostic.type.toUpperCase()}: ${diagnostic.message}`, inner).map((part) => row(this.theme.fg(diagnostic.type === "error" ? "error" : "warning", part))));
			if (diagnostic.collision?.loserPath === resource.path) {
				lines.push(row(this.theme.fg("dim", ` Shadowed by: ${diagnostic.collision.winnerPath}`)));
			} else if (diagnostic.collision?.winnerPath === resource.path) {
				lines.push(row(this.theme.fg("dim", ` Shadows: ${diagnostic.collision.loserPath}`)));
			}
		}
		lines.push(row(""));
		lines.push(row(this.theme.fg("dim", " Esc or Enter: back")));
	}

	private renderFooter(): string[] {
		if (this.model.view.searching) return [" Type to search locally · Backspace Delete · Esc Clear"];
		const pending = this.model.pending.size;
		const save = pending > 0 ? `${pending} unsaved changes · Ctrl+S Save` : "No unsaved changes";
		return [
			` ${save} · ↑↓ Move · Space Toggle · r Inherit`,
			" Tab Type · ←→ Scope · / Search · Enter Details · Del Remove · Esc Close",
		];
	}

	invalidate(): void {}
}
