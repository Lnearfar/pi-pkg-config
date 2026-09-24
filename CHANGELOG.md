# Changelog

## [0.3.0] - 2026-09-24

- Rebuild the header as two rows: `Package Config [Project] Global` above a centre-split `Skills | Extensions` tab strip.
- Move the view switches to `Tab` (Skills / Extensions) and `Shift+Tab` (Project / Global), shown as hints in the status line that shrink from full labels to initials and drop when the save hint needs the room.
- Make `←` / `→` and `PageUp` / `PageDown` jump one visible screen of resources instead of a fixed eight rows.
- Keep inherited resources in their global directory group when project settings pull them back in, instead of a separate `Project settings` group.
- Colour source group headers with accent bold and lighten the `Project` / `Global` column headers.
- Regenerate the screenshot and document the legacy `pi-pkg-manager` migration for the duplicate `/config` command.

## [0.2.0] - 2026-09-16

- Rename the package, command, and repository to `pi-pkg-config` with `/config` as the only entry point.
- Distribute through GitHub; npm publishing stays out of scope.
- Soften the overlay frame color and regenerate the screenshot.
- Add CI with type checking, tests, and an isolated package smoke load.
- Publish under the MIT license.

## [0.1.0] - 2026-09-13

- Manage Pi skills and extensions from a `/pkg-manager` TUI with Project and Global scopes.
- Stage toggles, review the merged settings candidate, and write atomically.
- Remove installed npm and git packages after confirmation.
