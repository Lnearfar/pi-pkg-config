<div align="center">

# pi-pkg-manager

*Control Pi skills and extensions from one TUI.*

[Features](#features) · [Install](#install) · [Use it](#use-it) · [Scopes](#scopes) · [Safety](#safety) · [Development](#development)

</div>

`pi-pkg-manager` manages the Skills and Extensions in Pi's resolved catalog. It stages resource-level state changes, applies Project overrides, shows resolved details, and removes installed packages with confirmation.

<div align="center">
  <img src="docs/images/pkg-manager.png" alt="pi-pkg-manager running in Pi with the Skills and Project views selected" width="900">
  <br>
  <sub>Actual run with a local demo package.</sub>
</div>

> [!NOTE]
> This interface covers local search, resource state, Project overrides, details, and package removal. Pi's package commands handle discovery, installation, downloads, and updates.

## Features

- **Control individual resources** — enable or disable each detected Skill and Extension.
- **Apply the right scope** — edit Global settings and create Project `load` / `unload` overrides.
- **Review staged changes** — `Ctrl+S` reviews and saves the transaction; `Esc` discards it.
- **Inspect Pi's resolution** — search locally and open details for paths, sources, overrides, and diagnostics.
- **Remove installed packages** — review every affected resource before confirming removal from the active scope.
- **Preserve settings integrity** — merge unrelated external edits and save through a lock plus atomic replacement.

`pi-pkg-manager` is required inside its own interface.

## Install

Install globally from GitHub:

```bash
pi install git:github.com/Lnearfar/pi-pkg-manager
```

Install for the current project:

```bash
pi install git:github.com/Lnearfar/pi-pkg-manager -l
```

Start a new Pi session and run:

```text
/pkg-manager
```

> [!TIP]
> The manager opens in **Skills → Project** and shows the current Pi configuration immediately.

## Use it

1. Run `/pkg-manager`.
2. Select a Skill or Extension with `↑` / `↓`.
3. Press `Space` to stage a state change.
4. Press `Ctrl+S`, review the merged candidate, and choose Pi reload timing.

| Key | Action |
|---|---|
| `Tab` | Switch Skills / Extensions |
| `←` / `→` | Switch Project / Global |
| `↑` / `↓` | Navigate resources |
| `Space` | Stage enablement state |
| `r` | Restore inherit for a Global resource in Project view |
| `/` | Search resolved resources locally |
| `Enter` | Open resource details |
| `Delete` | Review package removal |
| `Ctrl+S` | Review and save staged changes |
| `Esc` | Clear search, return, discard, or close |

## Scopes

| View | Resources | Change target |
|---|---|---|
| **Global** | Resources resolved from the global Pi environment | Global Pi settings |
| **Project** | Project resources followed by inherited Global resources | Current project settings and overrides |

Global resources start in the Project view with the `inherit` state. A Project change creates an explicit `load` or `unload` override. Press `r` to restore `inherit`.

> [!IMPORTANT]
> Project settings become editable after Pi trusts the project.

## Remove a package

Press `Delete` on a resource supplied by an installed package. The confirmation lists the package, active scope, and affected Skills and Extensions.

- The active scope owns the removal operation.
- Removal completes immediately and stays separate from staged resource changes.
- Settings persist before npm or git managed files are cleaned up.
- Local package removal updates the Pi settings entry and keeps source files in place.
- Removal clears staged resource changes for that package across every view.

## Safety

Pi resolves and discovers every displayed resource. The extension uses Pi's package and settings APIs for the same resolution and provenance model.

- The resolver skips missing package paths during opening and search.
- Save transactions retain unrelated external settings edits.
- Same-directory temporary files and locks support atomic saves and cleanup.
- Pi offers reload after saving or removing a package. Choosing later keeps the saved change and shows `/reload`.

## Development

```bash
npm install
npm run check
npm pack --dry-run
pi -e ./src/index.ts
```

`npm run check` runs TypeScript type-checking and the Node test suite.

```text
src/                  Extension, backend, model, storage, and TUI
test/                 Unit and integration tests
docs/requirements.md  Confirmed v1 behavior and design decisions
CONTEXT.md            Project terminology
```

## Compatibility

- Validated with Pi `0.85.1`.
- This interface manages **Skills** and **Extensions**. Pi's existing interfaces cover prompts and themes.
- Search filters the resources Pi detects locally.
- Extension diagnostics use safe path checks. Skill validation and collision diagnostics use Pi's public skill loader.
- Project overrides can contain absolute paths; move the resource and refresh its override when its location changes.
- `/pkg-manager` runs in Pi's TUI mode.

## Documentation

- [`docs/requirements.md`](docs/requirements.md) — confirmed v1 requirements and behavior
- [`CONTEXT.md`](CONTEXT.md) — project terminology
