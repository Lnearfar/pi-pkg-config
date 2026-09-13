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
