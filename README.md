<div align="center">

# pi-pkg-config

*Configure Pi skills and extensions from one TUI.*

![Pi 0.85.1](https://img.shields.io/badge/pi-0.85.1-2ea043)
![Node 22.19+](https://img.shields.io/badge/node-%E2%89%A522.19-2ea043)

[Features](#features) · [Install](#install) · [Use](#use) · [Scopes](#scopes) · [Development](#development)

</div>

`pi-pkg-config` configures Pi's resolved Skills and Extensions. It stages resource changes, applies Project overrides, displays resolved details, and removes installed packages after confirmation.

<div align="center">
  <img src="docs/images/pkg-config.png" alt="pi-pkg-config running in Pi with Project and Skills selected" width="900">
  <br>
  <sub>Real Pi session with demo skills.</sub>
</div>

## Features

- **Control resources** — enable or disable each detected Skill and Extension.
- **Switch fast** — a two-row header keeps the `Skills` / `Extensions` tabs and the `Project` / `Global` scope in view; `Tab` and `Shift+Tab` flip them, `←` / `→` jump a screen.
- **Compare scopes** — Project shows aligned `Project` and `Global` state for every resource.
- **Cycle Project state** — `Space` moves through inherit, on, and off.
- **Review changes** — `Ctrl+S` shows the merged settings candidate before it writes.
- **Inspect resolution** — details include skill descriptions, paths, sources, overrides, and diagnostics.
- **Remove packages safely** — review all affected resources before removal.
- **Protect settings** — saves merge unrelated edits and use locks with atomic replacement.

The active package remains available as `🔒 in use`.

## Install

Install globally from GitHub:

```bash
pi install git:github.com/Lnearfar/pi-pkg-config
```

Install for the current project:

```bash
pi install git:github.com/Lnearfar/pi-pkg-config -l
```

Run `/config` in a Pi TUI session.

> [!NOTE]
> Upgrading from the old `pi-pkg-manager` repository? Remove it first with `pi remove git:github.com/Lnearfar/pi-pkg-manager`. Both packages register `/config`, and Pi renames duplicate commands, so `/config` would otherwise be unavailable as `/config:1` / `/config:2`.

## Use

1. Run `/config`.
2. `Tab` switches the Skills / Extensions tabs, `Shift+Tab` switches the Project / Global scope.
3. Select a resource with `↑` / `↓`, then press `Space`.
4. Press `Ctrl+S`, review the candidate, and choose reload timing.

| Key | Action |
|---|---|
| `Tab` | Switch Skills / Extensions |
| `Shift+Tab` | Switch Project / Global |
| `↑` / `↓` | Navigate resources |
| `←` / `→`, `PageUp` / `PageDown` | Jump one visible screen of resources |
| `Space` | Cycle inherit / on / off (Project) or toggle (Global) |
| `/` | Search resolved resources locally |
| `Enter` | Open resource details |
| `Delete` | Review package removal |
| `Ctrl+S` | Review and save staged changes |
| `Esc` | Clear search, return, discard, or close |

## Scopes

| View | Resources | Columns | Change target |
|---|---|---|---|
| **Project** | Project resources followed by inherited Global resources | `Project` and `Global` | Current project settings and overrides |
| **Global** | Resources resolved from the global Pi environment | `Global` | Global Pi settings |

Inherited rows show `— (on)` or `— (off)`; explicit Project choices show `on` or `off`. Project-only resources show `—` in the Global column. Below 64 columns of inner width, headers shorten to `P` and `G`.

A source with one Extension renders as one row named after its source. Skill source labels retain the `skills` directory, such as `./.agents/skills` and `~/.pi/agent/skills`. A resource that Project settings pull back in from a global directory stays in that directory's group, so one file never appears under two different sources.

> [!IMPORTANT]
> Pi trust enables Project settings. An untrusted Project view shows `trust required` and remains read-only.

## Safety

Pi resolves every displayed resource. The extension uses Pi's package and settings APIs for the same provenance model.

- Local searches stay inside Pi's resolved catalog.
- Saves retain unrelated external settings edits.
- Package removal persists settings before managed-file cleanup.
- Local package removal keeps local source files in place.

## Development

```bash
npm ci
npm run check
npm run pack:check
pi -e .
```

`npm run check` runs TypeScript type-checking and the Node test suite. `npm run pack:check` shows the exact npm tarball contents.

Releases are Git tags. Tag a commit and push it:

```bash
git tag v0.3.0 && git push origin v0.3.0
```

Pin a tag with `pi install git:github.com/Lnearfar/pi-pkg-config@v0.3.0` and keep the tag matching the `package.json` version.

## Documentation

- [`docs/requirements.md`](docs/requirements.md) — confirmed behavior and design decisions
- [`CHANGELOG.md`](CHANGELOG.md) — release history
