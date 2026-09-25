import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
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

interface StateCell {
	text: string;
	color: ThemeColor;
}

interface StateCells {
	project?: StateCell;
	global: StateCell;
}

interface StateColumns {
	width: number;
	compact: boolean;
	projectStart?: number;
	globalStart: number;
}

interface VisibleEntry {
	resource: ManagedResource;
	index: number;
	showGroup: boolean;
}

interface VisibleWindow {
	scroll: number;
	visible: VisibleEntry[];
	used: number;
}

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
		this.done = done;
		this.requestRender = requestRender;
		this.keybindings = keybindings;
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

		// Literal Shift+Tab wins over the configurable Tab binding, so remapping
		// `tui.input.tab` cannot swallow the scope switch.
		if (matchesKey(data, "shift+tab")) {
			this.model.scope = this.model.scope === "project" ? "global" : "project";
			this.model.clampSelection();
			this.requestRender();
			return;
		}
		if (this.keybindings.matches(data, "tui.input.tab") || matchesKey(data, Key.tab)) {
			this.model.type = this.model.type === "skills" ? "extensions" : "skills";
			this.model.clampSelection();
			this.requestRender();
			return;
		}
		// Both arrow keys stay usable while the search field is open, like the tab switches.
		if (matchesKey(data, Key.left) || matchesKey(data, Key.right)) {
			this.page(matchesKey(data, Key.right) ? 1 : -1);
			this.requestRender();
			return;
		}
		// Page keys stay live in both modes, but never steal a character the search field
		// would type, and `/` always opens search from the list.
		const printable = !/[\u0000-\u001f\u007f]/.test(data);
		if (!(view.searching ? printable : data === "/")) {
			const direction = this.pageDirection(data);
			if (direction !== 0) {
				this.page(direction);
				this.requestRender();
				return;
			}
		}

		if (view.searching) {
			if (this.keybindings.matches(data, "tui.select.cancel") || matchesKey(data, Key.escape)) {
				view.searching = false;
				this.model.setQuery("");
			} else if (matchesKey(data, Key.backspace)) {
				this.model.setQuery(Array.from(view.query).slice(0, -1).join(""));
			} else if (printable) {
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
		} else if (matchesKey(data, Key.space)) {
			this.model.toggle();
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

	/** Move the selection one visible screen in the given direction. */
	private page(direction: number): void {
		const resources = this.model.resources();
		const step = Math.max(1, this.resolveWindow(resources, this.collapsedGroups(resources)).visible.length);
		this.model.move(direction * step);
	}

	/** -1 for page up, 1 for page down, 0 when neither binding matches. */
	private pageDirection(data: string): -1 | 0 | 1 {
		if (this.keybindings.matches(data, "tui.select.pageUp")) return -1;
		if (this.keybindings.matches(data, "tui.select.pageDown")) return 1;
		return 0;
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
		const inner = width - 2;
		const lines: string[] = [];
		const border = (text: string) => this.theme.fg("accent", text);
		const row = (content = "") => {
			const clipped = truncateToWidth(content, inner, "");
			return `${border("│")}${clipped}${" ".repeat(Math.max(0, inner - visibleWidth(clipped)))}${border("│")}`;
		};

		lines.push(border(`╭${"─".repeat(inner)}╮`));
		lines.push(row(this.renderTitleRow()));
		lines.push(row(this.renderTabRow(inner)));
		lines.push(row(this.theme.fg("dim", "─".repeat(inner))));
		if (this.details) this.renderDetails(row, lines, inner);
		else this.renderList(row, lines, inner);
		lines.push(row(this.theme.fg("dim", "─".repeat(inner))));
		for (const footerLine of this.renderFooter(inner)) lines.push(row(footerLine));
		lines.push(border(`╰${"─".repeat(inner)}╯`));
		return lines;
	}

	private renderTitleRow(): string {
		// Fixed legend order: the active scope is bracketed in place, the pair never swaps.
		const active = this.model.scope;
		const label = (name: string, scope: "project" | "global") =>
			scope === active
				? this.theme.fg("accent", this.theme.bold(`[${name}]`))
				: this.theme.fg("dim", name);
		return ` ${this.theme.bold("Package Config")} ${label("Project", "project")}  ${label("Global", "global")} `;
	}

	private renderTabRow(inner: number): string {
		const leftWidth = Math.floor(inner / 2);
		const rightWidth = Math.max(0, inner - leftWidth - 1);
		const skills = this.renderTab("Skills", leftWidth, this.model.type === "skills");
		const extensions = this.renderTab("Extensions", rightWidth, this.model.type === "extensions");
		return `${skills}${this.theme.fg("dim", "│")}${extensions}`;
	}

	private renderTab(label: string, width: number, active: boolean): string {
		const clipped = truncateToWidth(label, Math.max(0, width), "");
		const padding = Math.max(0, width - visibleWidth(clipped));
		const leading = Math.floor(padding / 2);
		const body = `${" ".repeat(leading)}${clipped}${" ".repeat(padding - leading)}`;
		return active
			? this.theme.bg("selectedBg", this.theme.fg("accent", this.theme.bold(body)))
			: this.theme.fg("text", body);
	}

	private renderList(row: (content?: string) => string, lines: string[], inner: number): void {
		const resources = this.model.resources();
		const view = this.model.view;
		const columns = this.stateColumns(inner);
		if (view.searching) {
			const marker = this.focused ? CURSOR_MARKER : "";
			lines.push(row(this.theme.fg("borderMuted", ` ⌕ Search: `) + this.theme.fg("accent", view.query) + marker + this.theme.inverse(" ")));
		} else if (view.query) {
			lines.push(row(this.theme.fg("borderMuted", " ⌕ Search: ") + this.theme.fg("accent", view.query)));
		}
		if (this.model.scope === "project" && !this.model.projectTrusted) {
			lines.push(row(this.theme.fg("warning", " ⚠ Project settings require Pi trust")));
		}
		lines.push(row(this.renderColumnHeader(columns)));
		if (resources.length === 0) {
			lines.push(row(this.theme.fg("muted", " Current view has no detected resources.")));
			for (let index = 1; index < this.listRowBudget; index++) lines.push(row(""));
			return;
		}

		const collapsedGroups = this.collapsedGroups(resources);
		const window = this.resolveWindow(resources, collapsedGroups);
		for (const entry of window.visible) {
			const { resource } = entry;
			const collapsed = collapsedGroups.has(resource.groupKey);
			if (entry.showGroup && !collapsed) {
				const groupItems = resources.filter((item) => item.groupKey === resource.groupKey);
				lines.push(row(this.renderGroupHeader(resource, groupItems, inner)));
			}
			lines.push(row(this.renderResource(resource, entry.index === view.selected, columns, collapsed)));
		}
		for (let index = window.used; index < this.listRowBudget; index++) lines.push(row(""));
	}

	/** Rows that fit from `start`, honouring group headers and collapsed sources. */
	private buildWindow(resources: ManagedResource[], collapsedGroups: Set<string>, start: number): { visible: VisibleEntry[]; used: number } {
		const visible: VisibleEntry[] = [];
		let used = 0;
		let lastGroup = "";
		for (let index = start; index < resources.length; index++) {
			const resource = resources[index]!;
			const showGroup = resource.groupKey !== lastGroup;
			let needed = showGroup && !collapsedGroups.has(resource.groupKey) ? 2 : 1;
			// A short list still has to show one resource, even when its source header cannot fit.
			if (needed > this.listRowBudget) needed = 1;
			if (used + needed > this.listRowBudget) break;
			visible.push({ resource, index, showGroup: showGroup && needed === 2 });
			used += needed;
			lastGroup = resource.groupKey;
		}
		return { visible, used };
	}

	/**
	 * The window rendered for the current view, scrolled until the selection is visible.
	 * The resolved scroll is written back so list rendering and paging agree on the page size.
	 */
	private resolveWindow(resources: ManagedResource[], collapsedGroups: Set<string>): VisibleWindow {
		const view = this.model.view;
		let scroll = Math.min(view.scroll, view.selected);
		let window = this.buildWindow(resources, collapsedGroups, scroll);
		while (scroll < view.selected && !window.visible.some((entry) => entry.index === view.selected)) {
			scroll++;
			window = this.buildWindow(resources, collapsedGroups, scroll);
		}
		view.scroll = scroll;
		return { scroll, ...window };
	}

	private collapsedGroups(resources: ManagedResource[]): Set<string> {
		if (this.model.type !== "extensions") return new Set();
		const counts = new Map<string, number>();
		for (const resource of resources) counts.set(resource.groupKey, (counts.get(resource.groupKey) ?? 0) + 1);
		return new Set([...counts].filter(([, count]) => count === 1).map(([key]) => key));
	}

	private stateColumns(inner: number): StateColumns {
		const width = Math.max(1, inner - 2); // Reserve the selection-edge cell on both sides of every resource row.
		const compact = inner < 64;
		const globalWidth = compact ? 4 : 8;
		const globalStart = Math.max(0, width - globalWidth);
		if (this.model.scope === "global") return { width, compact, globalStart };
		const projectWidth = compact ? 9 : 15;
		const gap = compact ? 1 : 2;
		const projectStart = Math.max(0, globalStart - gap - projectWidth);
		return { width, compact, projectStart, globalStart };
	}

	private renderColumnHeader(columns: StateColumns): string {
		const cells: StateCells = {
			project:
				columns.projectStart === undefined
					? undefined
					: { text: columns.compact ? "P" : "Project", color: "muted" },
			global: { text: columns.compact ? "G" : "Global", color: "muted" },
		};
		return ` ${this.composeStateRow("", cells, columns)} `;
	}

	private renderGroupHeader(resource: ManagedResource, groupItems: ManagedResource[], inner: number): string {
		const statistics =
			this.model.type === "extensions" ? "" : ` ${this.groupCount(groupItems)}/${groupItems.length} enabled`;
		const prefix = " ⌄ ";
		const available = Math.max(1, inner - visibleWidth(prefix) - visibleWidth(statistics));
		const label = this.middleTruncate(resource.groupLabel, available);
		return `${this.theme.fg("muted", prefix)}${this.theme.fg("mdLink", label)}${this.theme.fg("muted", statistics)}`;
	}

	private groupCount(resources: ManagedResource[]): number {
		return resources.filter((resource) => this.model.effectiveEnabled(resource)).length;
	}

	private renderResource(resource: ManagedResource, selected: boolean, columns: StateColumns, collapsed = false): string {
		const state = this.stateCells(resource, columns.compact);
		const markers = this.diagnosticMarkers(resource);
		const inUse = resource.selfProtected ? ` 🔒 ${this.tag("in use", "warning")}` : "";
		const pending = this.model.isPending(resource) ? ` ${this.theme.fg("warning", "*")}` : "";
		const lead = `${selected ? "› " : "  "}${this.status(resource)} `;
		const trailing = `${markers}${inUse}${pending}`;
		const nameEnd = columns.projectStart ?? columns.globalStart;
		const label = collapsed ? resource.groupLabel : resource.name;
		const name = this.middleTruncate(label, Math.max(1, nameEnd - visibleWidth(lead) - visibleWidth(trailing)));
		const body = this.composeStateRow(`${lead}${this.theme.fg("text", name)}${trailing}`, state, columns);
		if (selected) {
			return `${this.theme.fg("borderAccent", "▌")}${this.theme.bg("selectedBg", body)}${this.theme.fg("borderAccent", "▐")}`;
		}
		return ` ${body} `;
	}

	private composeStateRow(prefix: string, cells: StateCells, columns: StateColumns): string {
		const nameEnd = columns.projectStart ?? columns.globalStart;
		let result = this.pad(prefix, nameEnd);
		if (columns.projectStart !== undefined) {
			const projectWidth = Math.max(0, columns.globalStart - columns.projectStart - (columns.compact ? 1 : 2));
			const project = cells.project ? this.theme.fg(cells.project.color, cells.project.text) : "";
			result += this.pad(project, projectWidth);
			result += " ".repeat(columns.compact ? 1 : 2);
		}
		result += this.pad(this.theme.fg(cells.global.color, cells.global.text), Math.max(0, columns.width - columns.globalStart));
		return this.pad(result, columns.width);
	}

	private stateCells(resource: ManagedResource, compact: boolean): StateCells {
		if (this.model.scope === "global") {
			return { global: { text: this.model.effectiveEnabled(resource) ? "on" : "off", color: "muted" } };
		}

		const global = this.model.globalState(resource);
		if (!this.model.projectTrusted) {
			return {
				project: { text: compact ? "trust" : "trust required", color: "warning" },
				global: { text: global === undefined ? "—" : global ? "on" : "off", color: "muted" },
			};
		}

		const effective = this.model.effectiveEnabled(resource);
		if (!resource.inheritedGlobal) {
			return {
				project: { text: effective ? "on" : "off", color: "text" },
				global: { text: global === undefined ? "—" : global ? "on" : "off", color: "muted" },
			};
		}

		const override = this.model.currentOverride(resource);
		const project =
			override === "inherit"
				? { text: `— (${effective ? "on" : "off"})`, color: "muted" as ThemeColor }
				: { text: effective ? "on" : "off", color: "text" as ThemeColor };
		return {
			project,
			global: { text: global ? "on" : "off", color: "muted" },
		};
	}

	private status(resource: ManagedResource): string {
		if (this.model.scope === "global") {
			return this.model.effectiveEnabled(resource) ? this.theme.fg("syntaxComment", "●") : this.theme.fg("muted", "○");
		}
		if (!this.model.projectTrusted) return this.theme.fg("warning", "?");
		const effective = this.model.effectiveEnabled(resource);
		if (!resource.inheritedGlobal) return this.theme.fg(effective ? "syntaxComment" : "error", "●");
		const global = this.model.globalState(resource);
		if (global === false && this.model.currentOverride(resource) === "inherit") return this.theme.fg("muted", "○");
		return this.theme.fg(effective ? "syntaxComment" : "error", "●");
	}

	private diagnosticMarkers(resource: ManagedResource): string {
		const markers: string[] = [];
		if (this.isShadowed(resource)) markers.push(this.theme.fg("warning", "◇"));
		if (resource.diagnostics.some((item) => item.type === "error")) markers.push(this.theme.fg("error", "⚠"));
		return markers.length > 0 ? ` ${markers.join(" ")}` : "";
	}

	private isShadowed(resource: ManagedResource): boolean {
		return resource.diagnostics.some(
			(item) => item.type === "collision" && item.collision?.loserPath === resource.path,
		);
	}

	private renderDetails(row: (content?: string) => string, lines: string[], inner: number): void {
		const resource = this.model.selectedResource();
		if (!resource) return;
		const cells = this.stateCells(resource, inner < 64);
		const detailLines = [
			` ${this.status(resource)} ${resource.name}${resource.selfProtected ? "  🔒 in use" : ""}`,
			...(resource.description ? [` Description: ${resource.description}`] : []),
			...(this.model.scope === "project" ? [` Project: ${cells.project?.text ?? "—"}`] : []),
			` Global: ${cells.global.text}`,
			` Type: ${resource.type}`,
			` Source: ${resource.groupLabel}`,
			...(resource.packageSource ? [` Package: ${resource.packageSource}`] : []),
			` Path: ${resource.path}`,
		];
		for (const detail of detailLines) lines.push(...wrapTextWithAnsi(detail, inner).map((part) => row(part)));
		const pending = this.model.pendingChanges().find((change) => change.resource.id === resource.id && change.scope === this.model.scope);
		if (pending) {
			const before = pending.scope === "project" && pending.resource.inheritedGlobal
				? pending.beforeOverride
				: pending.beforeEnabled
					? "on"
					: "off";
			const after = pending.scope === "project" && pending.resource.inheritedGlobal
				? pending.afterOverride
				: pending.afterEnabled
					? "on"
					: "off";
			lines.push(row(this.theme.fg("warning", ` Pending: ${before} → ${after}`)));
		}
		if (resource.selfProtected) lines.push(row(this.theme.fg("warning", " 🔒 In use by this manager.")));
		if (resource.diagnostics.length === 0) lines.push(row(this.theme.fg("dim", " Diagnostics: clear")));
		for (const diagnostic of resource.diagnostics) {
			lines.push(
				...wrapTextWithAnsi(` ${diagnostic.type.toUpperCase()}: ${diagnostic.message}`, inner).map((part) =>
					row(this.theme.fg(diagnostic.type === "error" ? "error" : "warning", part)),
				),
			);
			if (diagnostic.collision?.loserPath === resource.path) {
				lines.push(row(this.theme.fg("dim", ` Shadowed by: ${diagnostic.collision.winnerPath}`)));
			} else if (diagnostic.collision?.winnerPath === resource.path) {
				lines.push(row(this.theme.fg("dim", ` Shadows: ${diagnostic.collision.loserPath}`)));
			}
		}
	}

	private renderFooter(inner: number): string[] {
		if (this.details) return [...this.statusParts(inner), ...this.actionLines([this.action("Back", "Enter"), this.action("Back", "Esc")], inner)];
		if (this.model.view.searching) {
			return [
				...this.statusParts(inner),
				...this.actionLines([this.action("Delete", "Backspace"), this.action("Clear", "Esc")], inner),
			];
		}
		const actions = [this.action("Move", "↑↓"), this.action("Page", "←→"), this.action("on/off", "Space")];
		actions.push(this.action("Search", "/"), this.action("Details", "Enter"), this.action("Remove", "Del"), this.action("Close", "Esc"));
		return [ ...this.statusParts(inner), ...this.actionLines(actions, inner)];
	}

	private statusParts(inner: number): string[] {
		const resources = this.model.resources();
		const index = resources.length === 0 ? "0/0" : `${this.model.view.selected + 1}/${resources.length}`;
		const pending = this.model.pending.size;
		const right =
			pending > 0
				? `${this.theme.fg("warning", `${pending} unsaved changes`)} · ${this.keycap("Ctrl+S", "accent")} ${this.theme.fg("accent", "Save")}`
				: this.theme.fg("accent", this.theme.bold("Ready to edit"));
		const left = this.theme.fg("dim", ` ${index}`);
		// Both switches come from the same Tab family, so they abbreviate as one unit:
		// full labels, then initials, then gone when the save hint needs the room.
		const hintPair = (scopeKey: string, scopeLabel: string, typeLabel: string) =>
			`${this.keycap(scopeKey)} ${this.theme.fg("muted", scopeLabel)}   ${this.keycap("Tab")} ${this.theme.fg("muted", typeLabel)}`;
		const body = (hints: string) => `${left}  ${hints}`;
		for (const hints of [
			hintPair("Shift+Tab", "Project/Global", "Skills/Extensions"),
			hintPair("⇧Tab", "P/G", "S/E"),
		]) {
			const candidate = body(hints);
			if (visibleWidth(candidate) + visibleWidth(right) + 1 <= inner) {
				return [`${candidate}${" ".repeat(Math.max(1, inner - visibleWidth(candidate) - visibleWidth(right)))}${right}`];
			}
		}
		const withIndex = `${left}${" ".repeat(Math.max(1, inner - visibleWidth(left) - visibleWidth(right)))}${right}`;
		if (visibleWidth(withIndex) <= inner) return [withIndex];
		// Never clip the edit state: the position indicator yields, then the edit state wraps.
		if (visibleWidth(right) + 1 <= inner) return [`${' '.repeat(inner - visibleWidth(right))}${right}`];
		const indent = inner >= 2 ? " " : "";
		const wrapped = wrapTextWithAnsi(right, Math.max(1, inner - indent.length)).map((line) => `${indent}${line}`);
		return visibleWidth(left) <= inner ? [left, ...wrapped] : wrapped;
	}

	private action(label: string, key: string): string {
		return `${this.keycap(key)} ${this.theme.fg("text", label)}`;
	}

	private actionLines(actions: string[], inner: number): string[] {
		const lines: string[] = [];
		let current = " ";
		for (const action of actions) {
			const candidate = current.trim().length === 0 ? ` ${action}` : `${current}  ${action}`;
			if (visibleWidth(candidate) <= inner || current.trim().length === 0) {
				current = candidate;
			} else {
				lines.push(current);
				current = ` ${action}`;
			}
		}
		if (current.trim().length > 0) lines.push(current);
		return lines;
	}

	private keycap(label: string, color: ThemeColor = "muted"): string {
		return this.theme.bg("selectedBg", this.theme.fg(color, ` ${label} `));
	}

	private tag(label: string, color: ThemeColor): string {
		return this.theme.bg("selectedBg", this.theme.fg(color, ` ${label} `));
	}

	private pad(text: string, width: number): string {
		// truncateToWidth closes truncated styles with a full reset, which would also
		// cancel the selected-row background for the trailing padding. Drop it and let
		// the active style continue across the padded cells.
		const clipped = truncateToWidth(text, Math.max(0, width), "").replace(/\x1b\[0m$/, "");
		return `${clipped}${" ".repeat(Math.max(0, width - visibleWidth(clipped)))}`;
	}

	private middleTruncate(text: string, width: number): string {
		if (visibleWidth(text) <= width) return text;
		if (width <= 1) return "…".slice(0, width);
		const characters = Array.from(text);
		const left = Math.ceil((width - 1) / 2);
		const right = Math.floor((width - 1) / 2);
		const suffix = right > 0 ? characters.slice(-right).join("") : "";
		return `${characters.slice(0, left).join("")}…${suffix}`;
	}

	invalidate(): void {}
}
