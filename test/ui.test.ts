import assert from "node:assert/strict";
import test from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type KeybindingsManager } from "@earendil-works/pi-tui";
import { PackageManagerModel } from "../src/model.ts";
import type { ManagedResource, ResolvedCatalog } from "../src/types.ts";
import { PackageManagerComponent } from "../src/ui.ts";

const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	inverse: (text: string) => text,
} as unknown as Theme;

const keybindings = { matches: () => false } as unknown as KeybindingsManager;

function model(): PackageManagerModel {
	const resource: ManagedResource = {
		id: "skills:/tmp/example/SKILL.md",
		type: "skills",
		path: "/tmp/example/SKILL.md",
		name: "a-very-long-resource-name",
		enabled: true,
		globalEnabled: true,
		metadata: { source: "auto", scope: "user", origin: "top-level", baseDir: "/tmp" },
		inheritedGlobal: true,
		groupKey: "global",
		groupLabel: "A very long global source label",
		diagnostics: [],
		selfProtected: false,
	};
	const catalog: ResolvedCatalog = {
		global: [resource],
		project: [resource],
		globalSettings: {},
		projectSettings: {},
	};
	return new PackageManagerModel(catalog, "/repo", "/agent", true);
}

test("overlay rendering never exceeds the width requested by Pi", () => {
	const project = new PackageManagerComponent(model(), theme, keybindings, () => {}, () => {}, 3);
	const globalState = model();
	globalState.scope = "global";
	const globalView = new PackageManagerComponent(globalState, theme, keybindings, () => {}, () => {}, 3);
	for (const width of [1, 4, 10, 40, 50, 63, 65, 66, 80]) {
		for (const component of [project, globalView]) {
			for (const line of component.render(width)) {
				assert.ok(visibleWidth(line) <= width, `${visibleWidth(line)} > ${width}`);
			}
		}
	}
});

test("the title row keeps a fixed scope order and brackets the active one", () => {
	const component = new PackageManagerComponent(model(), theme, keybindings, () => {}, () => {}, 3);
	assert.match(component.render(120)[1]!, /Package Config \[Project\]\s+Global/);
	const globalState = model();
	globalState.scope = "global";
	const globalView = new PackageManagerComponent(globalState, theme, keybindings, () => {}, () => {}, 3);
	assert.match(globalView.render(120)[1]!, /Package Config Project\s+\[Global\]/);
});

test("the tab row splits on the centre column and highlights only the active tab", () => {
	const taggedTheme = {
		fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
		bg: (color: string, text: string) => `<${color}>${text}</${color}>`,
		bold: (text: string) => text,
		inverse: (text: string) => text,
	} as unknown as Theme;
	const state = model();
	const component = new PackageManagerComponent(state, taggedTheme, keybindings, () => {}, () => {}, 3);
	const skillsRow = component.render(500)[2]!;
	assert.match(skillsRow, /<selectedBg><accent>\s*Skills/);
	assert.doesNotMatch(skillsRow, /<selectedBg><accent>\s*Extensions/);
	assert.match(skillsRow, /<text>\s*Extensions/);
	state.type = "extensions";
	const extensionsRow = component.render(500)[2]!;
	assert.match(extensionsRow, /<selectedBg><accent>\s*Extensions/);
	assert.doesNotMatch(extensionsRow, /<selectedBg><accent>\s*Skills/);
});

test("the status line carries both switch hints and abbreviates them as one unit", () => {
	const statusOf = (lines: string[]) => lines.find((line) => line.includes("Ready to edit"))!;
	const wide = new PackageManagerComponent(model(), theme, keybindings, () => {}, () => {}, 3);
	assert.match(statusOf(wide.render(80)), /Shift\+Tab  Project\/Global\s+Tab  Skills\/Extensions/);
	const narrow = new PackageManagerComponent(model(), theme, keybindings, () => {}, () => {}, 3);
	assert.match(statusOf(narrow.render(66)), /⇧Tab  P\/G\s+Tab  S\/E/);
});

test("unsaved changes drop the switch hints before truncating the save hint", () => {
	const state = model();
	state.toggle();
	assert.equal(state.pending.size, 1);
	const component = new PackageManagerComponent(state, theme, keybindings, () => {}, () => {}, 3);
	const status = component.render(50).find((line) => line.includes("unsaved changes"))!;
	assert.match(status, /1 unsaved changes/);
	assert.doesNotMatch(status, /P\/G|S\/E/);
});

test("selected inherited resources use the readable text foreground", () => {
	const taggedTheme = {
		fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
		bg: (color: string, text: string) => `<${color}>${text}</${color}>`,
		bold: (text: string) => text,
		inverse: (text: string) => text,
	} as unknown as Theme;
	const component = new PackageManagerComponent(model(), taggedTheme, keybindings, () => {}, () => {}, 3);
	const selectedLine = component.render(500).find((line) => line.includes("a-very-long-resource-name"));
	assert.ok(selectedLine?.includes("<text>a-very-long-resource-name</text>"));
});

test("Project rows render aligned Project and Global state columns", () => {
	const component = new PackageManagerComponent(model(), theme, keybindings, () => {}, () => {}, 3);
	const output = component.render(120).join("\n");
	assert.match(output, /Project/);
	assert.match(output, /Global/);
	assert.match(output, /— \(on\)/);
	assert.match(output, /⌄ A very long global source label/);
	assert.match(output, /▌.*a-very-long-resource-name.*▐/);
	assert.match(output, /Space  on\/off/);
	assert.doesNotMatch(output, /Inherit/);
});

test("Global rows show Global state and omit the inherit action", () => {
	const state = model();
	state.scope = "global";
	const component = new PackageManagerComponent(state, theme, keybindings, () => {}, () => {}, 3);
	const output = component.render(120).join("\n");
	assert.match(output, /Global/);
	assert.match(output, /Space  on\/off/);
	assert.doesNotMatch(output, /Inherit/);
});

test("Project status marker distinguishes inherited Global off from explicit Project states", () => {	const global: ManagedResource = {
		...model().catalog.global[0]!,
		enabled: false,
		globalEnabled: false,
	};
	const project: ManagedResource = { ...global, enabled: false, globalEnabled: false };
	const state = new PackageManagerModel(
		{ global: [global], project: [project], globalSettings: {}, projectSettings: {} },
		"/repo",
		"/agent",
		true,
	);
	const taggedTheme = {
		fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
		bg: (_color: string, text: string) => text,
		bold: (text: string) => text,
		inverse: (text: string) => text,
	} as unknown as Theme;
	const component = new PackageManagerComponent(state, taggedTheme, keybindings, () => {}, () => {}, 3);

	assert.match(component.render(500).join("\n"), /<muted>○<\/muted>/);
	state.toggle(project);
	assert.match(component.render(500).join("\n"), /<success>●<\/success>/);
	state.toggle(project);
	assert.match(component.render(500).join("\n"), /<error>●<\/error>/);
});

test("compact mode switches the column headers at the inner width boundary", () => {
	const component = new PackageManagerComponent(model(), theme, keybindings, () => {}, () => {}, 3);
	const narrow = component.render(65);
	const wide = component.render(66);
	assert.match(narrow[4]!, /\bP\b.*\bG\b/);
	assert.doesNotMatch(narrow[4]!, /Project|Global/);
	assert.match(wide[4]!, /Project/);
	assert.match(wide[4]!, /Global/);
});

test("untrusted Project view marks trust and counts inherited state", () => {	const resource = model().catalog.global[0]!;
	const state = new PackageManagerModel(
		{ global: [resource], project: [resource], globalSettings: {}, projectSettings: {} },
		"/repo",
		"/agent",
		false,
	);
	const component = new PackageManagerComponent(state, theme, keybindings, () => {}, () => {}, 3);
	const output = component.render(120).join("\n");
	assert.match(output, /trust required/);
	assert.match(output, /1\/1 enabled/);
});

test("group statistics follow the source label with a single space", () => {
	const component = new PackageManagerComponent(model(), theme, keybindings, () => {}, () => {}, 3);
	const output = component.render(120).join("\n");
	assert.match(output, /⌄ A very long global source label 1\/1 enabled/);
	assert.doesNotMatch(output, /1\/1 enabled\s*$/m);
});

test("Extensions view omits group statistics", () => {
	const state = extensionModel(["alpha.ts", "beta.ts"]);
	state.type = "extensions";
	const component = new PackageManagerComponent(state, theme, keybindings, () => {}, () => {}, 4);
	const output = component.render(120).join("\n");
	assert.match(output, /⌄ npm:pi-demo/);
	assert.doesNotMatch(output, /enabled/);
});

test("selected rows keep their background when a long name is truncated", () => {	const resource: ManagedResource = {
		...model().catalog.global[0]!,
		name: "an-extremely-long-resource-name-that-overflows-the-name-column",
	};
	const state = new PackageManagerModel(
		{ global: [resource], project: [resource], globalSettings: {}, projectSettings: {} },
		"/repo",
		"/agent",
		true,
	);
	const ansiTheme = {
		fg: (_color: string, text: string) => `\x1b[38;5;1m${text}\x1b[39m`,
		bg: (_color: string, text: string) => `\x1b[48;5;2m${text}\x1b[49m`,
		bold: (text: string) => text,
		inverse: (text: string) => text,
	} as unknown as Theme;
	const component = new PackageManagerComponent(state, ansiTheme, keybindings, () => {}, () => {}, 3);
	for (const width of [50, 65, 66, 80]) {
		const lines = component.render(width);
		const selected = lines.filter((line) => line.includes("▌"));
		assert.equal(selected.length, 1, `selected row at width ${width}`);
		assert.ok(!selected[0]!.includes("\x1b[0m"), `full style reset in the selected row at width ${width}`);
		for (const line of lines) assert.ok(visibleWidth(line) <= width, `${visibleWidth(line)} > ${width}`);
	}
});

function extensionModel(names: string[]): PackageManagerModel {
	const resources: ManagedResource[] = names.map((name, index) => ({
		id: `extensions:/pkg/${name}`,
		type: "extensions" as const,
		path: `/pkg/${name}`,
		name,
		enabled: true,
		globalEnabled: true,
		metadata: { source: "npm:pi-demo", scope: "user", origin: "package", baseDir: "/pkg" },
		inheritedGlobal: true,
		packageSource: "npm:pi-demo",
		groupKey: "package:npm:pi-demo",
		groupLabel: "npm:pi-demo",
		diagnostics: [],
		selfProtected: false,
	}));
	return new PackageManagerModel(
		{ global: resources, project: resources, globalSettings: {}, projectSettings: {} },
		"/repo",
		"/agent",
		true,
	);
}

test("a single-extension package renders as one labelled row without a group header", () => {
	const state = extensionModel(["index.ts"]);
	state.type = "extensions";
	const component = new PackageManagerComponent(state, theme, keybindings, () => {}, () => {}, 3);
	const output = component.render(120).join("\n");
	assert.match(output, /● npm:pi-demo/);
	assert.doesNotMatch(output, /index\.ts/);
	assert.doesNotMatch(output, /⌄/);
});

test("a multi-extension package keeps its group header and file rows", () => {
	const state = extensionModel(["alpha.ts", "beta.ts"]);
	state.type = "extensions";
	const component = new PackageManagerComponent(state, theme, keybindings, () => {}, () => {}, 4);
	const output = component.render(120).join("\n");
	assert.match(output, /⌄ npm:pi-demo/);
	assert.match(output, /● alpha\.ts/);
	assert.match(output, /● beta\.ts/);
});

test("the details page shows the skill description", () => {
	const base = model().catalog.global[0]!;
	const resource: ManagedResource = { ...base, description: "Summarize a repository's state." };
	const state = new PackageManagerModel(
		{ global: [resource], project: [resource], globalSettings: {}, projectSettings: {} },
		"/repo",
		"/agent",
		true,
	);
	const component = new PackageManagerComponent(state, theme, keybindings, () => {}, () => {}, 3);
	assert.doesNotMatch(component.render(120).join("\n"), /Description:/);
	component.handleInput("\r");
	const details = component.render(120).join("\n");
	assert.match(details, /Description: Summarize a repository's state\./);
});

test("Tab switches resource type and Shift+Tab switches scope", () => {
	const state = model();
	const component = new PackageManagerComponent(state, theme, keybindings, () => {}, () => {}, 3);
	component.handleInput("\t");
	assert.equal(state.type, "extensions");
	assert.equal(state.scope, "project");
	component.handleInput("\u001b[Z");
	assert.equal(state.scope, "global");
	assert.equal(state.type, "extensions");
	component.handleInput("\t");
	assert.equal(state.type, "skills");
	component.handleInput("\u001b[Z");
	assert.equal(state.scope, "project");
});

test("arrow and page keys jump one visible screen of resources", () => {
	const resources: ManagedResource[] = Array.from({ length: 12 }, (_, index) => ({
		...model().catalog.global[0]!,
		id: `skills:/tmp/example-${index}/SKILL.md`,
		path: `/tmp/example-${index}/SKILL.md`,
		name: `resource-${index}`,
	}));
	const state = new PackageManagerModel(
		{ global: resources, project: resources, globalSettings: {}, projectSettings: {} },
		"/repo",
		"/agent",
		true,
	);
	// The first group header costs two rows, so a five-row budget shows four entries.
	const pageKeys = {
		matches: (data: string, name: string) =>
			(name === "tui.select.pageDown" && data === "\u001b[6~") || (name === "tui.select.pageUp" && data === "\u001b[5~"),
	} as unknown as KeybindingsManager;
	const component = new PackageManagerComponent(state, theme, pageKeys, () => {}, () => {}, 5);
	component.render(80);
	component.handleInput("\u001b[C");
	assert.equal(state.view.selected, 4);
	assert.equal(state.view.scroll, 0);
	component.render(80);
	assert.equal(state.view.scroll, 1);
	component.handleInput("\u001b[D");
	assert.equal(state.view.selected, 0);
	component.handleInput("\u001b[6~");
	assert.equal(state.view.selected, 4);
	component.handleInput("\u001b[5~");
	assert.equal(state.view.selected, 0);
});

test("page keys still move the selection while the search field is open", () => {
	const resources: ManagedResource[] = Array.from({ length: 12 }, (_, index) => ({
		...model().catalog.global[0]!,
		id: `skills:/tmp/example-${index}/SKILL.md`,
		path: `/tmp/example-${index}/SKILL.md`,
		name: `resource-${index}`,
	}));
	const state = new PackageManagerModel(
		{ global: resources, project: resources, globalSettings: {}, projectSettings: {} },
		"/repo",
		"/agent",
		true,
	);
	const pageKeys = {
		matches: (data: string, name: string) =>
			(name === "tui.select.pageDown" && data === "\u001b[6~") || (name === "tui.select.pageUp" && data === "\u001b[5~"),
	} as unknown as KeybindingsManager;
	const component = new PackageManagerComponent(state, theme, pageKeys, () => {}, () => {}, 5);
	component.handleInput("/");
	component.handleInput("resource-1");
	assert.equal(state.view.searching, true);
	assert.equal(state.resources().length, 3); // resource-1, resource-10, resource-11
	component.render(80);
	component.handleInput("\u001b[6~");
	assert.equal(state.view.selected, 2);
	component.handleInput("\u001b[5~");
	assert.equal(state.view.selected, 0);
	component.handleInput("\u001b[C");
	assert.equal(state.view.selected, 2);
	component.handleInput("\u001b[D");
	assert.equal(state.view.selected, 0);
});

test("a one-row list budget still shows a resource instead of an empty panel", () => {
	const state = model();
	const component = new PackageManagerComponent(state, theme, keybindings, () => {}, () => {}, 1);
	const output = component.render(80).join("\n");
	assert.match(output, /a-very-long-resource-name/);
	assert.doesNotMatch(output, /⌄/);
	assert.doesNotMatch(output, /Current view has no detected resources/);
});

test("page keys stay live while searching without stealing typed characters", () => {
	const resources: ManagedResource[] = Array.from({ length: 12 }, (_, index) => ({
		...model().catalog.global[0]!,
		id: `skills:/tmp/example-j${index}/SKILL.md`,
		path: `/tmp/example-j${index}/SKILL.md`,
		name: `resource-j${index}`,
	}));
	const state = new PackageManagerModel(
		{ global: resources, project: resources, globalSettings: {}, projectSettings: {} },
		"/repo",
		"/agent",
		true,
	);
	// A user may bind the page keys to printable characters.
	const remapped = {
		matches: (data: string, name: string) =>
			name === "tui.select.pageDown" && (data === "j" || data === "\u001b[6~"),
	} as unknown as KeybindingsManager;
	const component = new PackageManagerComponent(state, theme, remapped, () => {}, () => {}, 5);
	component.handleInput("/");
	assert.equal(state.view.searching, true);
	component.handleInput("j");
	assert.equal(state.view.query, "j");
	assert.equal(state.view.selected, 0);
	component.handleInput("\u001b[6~");
	assert.equal(state.view.query, "j");
	assert.equal(state.view.selected, 4);
});

test("the search shortcut outranks a printable page-key remap", () => {
	const state = model();
	const remapped = {
		matches: (data: string, name: string) => name === "tui.select.pageDown" && data === "/",
	} as unknown as KeybindingsManager;
	const component = new PackageManagerComponent(state, theme, remapped, () => {}, () => {}, 3);
	component.handleInput("/");
	assert.equal(state.view.searching, true);
});

test("status parts never exceed the inner width and keep the edit state", () => {
	const state = model();
	state.toggle();
	const component = new PackageManagerComponent(state, theme, keybindings, () => {}, () => {}, 1);
	for (const width of [4, 5, 6, 8, 12, 20, 39, 80]) {
		for (const line of component.render(width)) {
			assert.ok(visibleWidth(line) <= width, `line overflows at width ${width}`);
		}
	}
	// Below the word-wrap width the edit state wraps character by character, so compare
	// the stripped character stream there instead of looking for the word.
	const tiny = component
		.render(4)
		.map((line) => line.replace(/[^A-Za-z0-9+]/g, ""))
		.join("");
	assert.ok(tiny.includes("Save"), "save hint lost at width 4");
	for (const width of [12, 20, 39, 80]) {
		assert.ok(component.render(width).join("\n").includes("Save"), `save hint clipped at width ${width}`);
	}
});

test("a remapped Tab binding cannot swallow Shift+Tab", () => {
	const state = model();
	const remapped = {
		matches: (data: string, name: string) => name === "tui.input.tab" && data === "\u001b[Z",
	} as unknown as KeybindingsManager;
	const component = new PackageManagerComponent(state, theme, remapped, () => {}, () => {}, 3);
	component.handleInput("\u001b[Z");
	assert.equal(state.scope, "global");
	assert.equal(state.type, "skills");
});
