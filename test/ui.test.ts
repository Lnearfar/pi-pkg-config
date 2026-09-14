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
	assert.match(output, /Space  Cycle/);
	assert.doesNotMatch(output, /Inherit/);
});

test("Global rows show Global state and omit the inherit action", () => {
	const state = model();
	state.scope = "global";
	const component = new PackageManagerComponent(state, theme, keybindings, () => {}, () => {}, 3);
	const output = component.render(120).join("\n");
	assert.match(output, /Global/);
	assert.match(output, /Space  Toggle/);
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
	assert.doesNotMatch(component.render(65).join("\n"), /Project|Global/);
	assert.match(component.render(66).join("\n"), /Project/);
	assert.match(component.render(66).join("\n"), /Global/);
	assert.match(component.render(50)[1] ?? "", /\[P\].*G/);
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
	const base = model().catalog.global[0]!;
	const resource: ManagedResource = {
		...base,
		id: "extensions:/tmp/example.ts",
		type: "extensions",
		path: "/tmp/example.ts",
	};
	const state = new PackageManagerModel(
		{ global: [resource], project: [resource], globalSettings: {}, projectSettings: {} },
		"/repo",
		"/agent",
		true,
	);
	state.type = "extensions";
	const component = new PackageManagerComponent(state, theme, keybindings, () => {}, () => {}, 3);
	const output = component.render(120).join("\n");
	assert.match(output, /⌄ A very long global source label/);
	assert.doesNotMatch(output, /enabled/);
});

test("selected rows keep their background when a long name is truncated", () => {
	const resource: ManagedResource = {
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
