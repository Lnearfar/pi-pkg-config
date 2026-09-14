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
	const component = new PackageManagerComponent(model(), theme, keybindings, () => {}, () => {}, 3);
	for (const width of [1, 4, 10, 40]) {
		for (const line of component.render(width)) assert.ok(visibleWidth(line) <= width, `${visibleWidth(line)} > ${width}`);
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
});

test("Global rows show Global state and omit the inherit action", () => {
	const state = model();
	state.scope = "global";
	const component = new PackageManagerComponent(state, theme, keybindings, () => {}, () => {}, 3);
	const output = component.render(120).join("\n");
	assert.match(output, /Global/);
	assert.doesNotMatch(output, /Inherit/);
});

test("Project status marker distinguishes inherited Global off from explicit Project states", () => {
	const global: ManagedResource = {
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
