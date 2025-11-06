# CKanban

> Multi‑project Kanban & bookmark assistant – delivered as a Chrome Extension that replaces your New Tab page with a lightweight, offline board. Current version: **0.7.0**.

---
## Table of Contents
1. [Overview](#overview)
2. [Features](#features)
3. [Quick Start (Install)](#quick-start-install)
4. [Usage Guide](#usage-guide)
5. [Card Status Change Timestamp](#card-status-change-timestamp)
6. [Worked Report Modal](#worked-report-modal)
7. [Keyboard Shortcuts](#keyboard-shortcuts)
8. [Data Model & Persistence](#data-model--persistence)
9. [Architecture](#architecture)
10. [Export / Import Format](#export--import-format)
11. [Privacy & Permissions](#privacy--permissions)
12. [Roadmap](#roadmap)
13. [Contributing](#contributing)
14. [Development Workflow](#development-workflow)
15. [Versioning](#versioning)
16. [Security Notes](#security-notes)
17. [FAQ](#faq)
18. [License](#license)
19. [Acknowledgements](#acknowledgements)

---
## Overview
CKanban is a minimal, dependency‑free Kanban board optimized for personal multi‑project tracking directly in the browser. It overrides Chrome's New Tab page to put your work front and center. All data is stored **locally** using `chrome.storage.local` and can be exported to JSON or printed as a PDF report.

Why this project?
- Reduce friction: instant board access on every new tab.
- Keep control: fully client‑side, no external services, easy to back up.
- Focus on essentials: projects, cards, links, per‑project notes, bookmarks.

---
## Features
- Multiple projects with drag & drop reordering.
- Per‑project Kanban columns: Links, Backlog, In Progress, On Hold, Complete.
- Color palette for project headers (+ contrast aware text color).
- Per‑project notes (plain text area, timestamped updates).
- Inline project name edit (pencil icon on header).
- Bookmarks panel + Quick Bookmarks modal (fuzzy search, `Ctrl+B`).
- Per‑card status change timestamp (top‑left of each card; updates only on moves between columns).
- Worked report modal (daily summary of cards whose status changed; grouped by status excluding Links).
- Card & link management (add, edit, move, delete) with keyboard prompts.
- JSON export / import for backups & migration (`kanban.v1` schema).
- One‑click printable PDF project report (uses browser print to save).
- Collapse / expand individual or all projects.
- Simple fuzzy scoring for quick bookmark search.
- Low overhead: single self‑contained JS file, no external libraries.
- New Tab override for immediate access (optional if you remove the line in `manifest.json`).

---
## Quick Start (Install)
### Option A: Load Unpacked (Development / Manual Use)
1. Clone the repository:
   ```bash
   git clone https://github.com/your-user/ckanban.git
   cd ckanban
   ```
2. Open Chrome and navigate to: `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top-right).
4. Click **Load unpacked** and select the `dist/` directory.
5. Open a new tab – CKanban should appear immediately.

### Option B: Pack & Distribute Manually
1. Increment the `version` in `dist/manifest.json`.
2. Zip the contents of the `dist/` folder (its root, not the parent).
3. Upload to the Chrome Web Store (requires developer account) or share the zip for manual installation.

Removal: Disable or remove the extension from `chrome://extensions/` to restore the default New Tab.

---
## Usage Guide
Core interactions:
- Add a project: Type a name, press Enter or click Add Project.
- Add a card: '+' in Backlog column.
- Add a link: '+' in Links column (enter display name + URL).
- Move cards: drag within or across columns (same project only).
- Reorder projects: drag the colored header bar.
- Edit project name: pencil icon, then save or cancel.
- Project notes: Edit / Save buttons in the Notes section, `Ctrl+Enter` saves.
- Color selection: palette opens from the 🎨 button in the header.
- Bookmarks: open panel, '+ Bookmark' to add; quick search with `Ctrl+B`.
- View status change time: small timestamp at top‑left of each card.
- Worked report: click `Worked` button, enter date (YYYY-MM-DD) to see daily status movements.
- Export: JSON file named `ckanban-export.json` for backups.
- Import: choose JSON file matching schema to replace current board.
- PDF: Generate a printable summary of all projects.
- Clear All: wipes all data (confirmation required).
- Expand / Collapse: toggle each project or use global button.

Data safety:
- Every mutation debounces persistence (~250ms) to reduce writes.
- Export regularly for manual backup if data is critical.

---
## Card Status Change Timestamp
Each card stores a `statusChangedAt` ISO timestamp:
- Set on card creation (same as `createdAt`).
- Updated ONLY when the card is moved between columns (status change).
- Not modified when editing the card title or link details.
- Displayed (formatted as `YYYY-MM-DD HH:MM`) in the card header, top‑left.
- Included in JSON export / import for reproducible Worked reports.

Use cases:
- Daily stand‑up prep (filter for today’s moved cards).
- Lightweight activity auditing without full history tracking.

---
## Worked Report Modal
Quick daily summary of what progressed:
- Open via `Worked` button in the top header or `Ctrl+W` (Windows/Linux) / `Cmd+W` (macOS will normally close the tab, so use the button there).
- Prompts for a date (defaults to today) in `YYYY-MM-DD` format.
- Lists all cards whose `statusChangedAt` date portion matches the input.
- Groups by status (Backlog, In Progress, On Hold, Complete) – Links are excluded.
- Shows per‑group counts and project names for each card.
- Closes via Close button, `Esc`, or clicking outside the inner panel.

Notes & limitations:
- Shortcut: `Ctrl+W` opens the prompt (on macOS prefer the button due to default tab close).
- Uses local timestamps; timezone is the browser’s environment.
- Ephemeral view: does not persist or export separate analytics.

---
## Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| `Enter` (in new project input) | Add project |
| `Ctrl+Enter` (inside notes editor) | Save notes |
| `Ctrl+B` | Open / toggle Quick Bookmarks modal |
| `Ctrl+W` | Open Worked date prompt |
| `Esc` (Quick Bookmarks / Notes edit / Worked modal) | Close / Cancel |
| `ArrowUp/ArrowDown` (Quick Bookmarks) | Navigate results |
| `Enter` (Quick Bookmarks active item) | Open bookmark |

---
## Data Model & Persistence
- Storage key: `ckanban.board.v1`
- Stored in: `chrome.storage.local` (no remote sync by design).
- Project object (simplified):
  ```json
  {
    "id": "uuid",
    "name": "Project Name",
    "createdAt": "2025-01-01T12:00:00.000Z",
    "order": 0,
    "collapsed": true,
    "color": "#eceff3",
    "columns": {
      "links": ["cardId"],
      "backlog": [],
      "inProgress": [],
      "onHold": [],
      "complete": []
    },
    "notes": { "text": "...", "updatedAt": "2025-01-01T12:10:00.000Z" }
  }
  ```
- Card object (simplified task):
  ```json
  {
    "id": "uuid",
    "projectId": "uuid",
    "title": "Card title",
    "type": "card",
    "createdAt": "2025-01-01T12:00:00.000Z",
    "updatedAt": "2025-01-01T13:00:00.000Z",
    "statusChangedAt": "2025-01-01T13:00:00.000Z"
  }
  ```
- Link card adds: `"url": "https://..."` (still includes `statusChangedAt`).
- `statusChangedAt` aligns with column movements; editing a title does not update it.

Save strategy: calls `chrome.storage.local.set` after a short debounce (250ms) to batch rapid edits.

---
## Architecture
The app is a single New Tab HTML page (`dist/ui/board.html`) + a plain JavaScript file (`dist/ui/board.js`) and stylesheet (`dist/ui/board.css`). Key points:
- No frameworks; uses imperative DOM creation for performance and simplicity.
- Central state store singleton with `get`, `set`, `update`, and `subscribe` methods.
- Subscriptions trigger rerenders of board, bookmarks and global UI state.
- Drag & drop implemented with native HTML5 drag events.
- Color accessibility: luminance check ensures readable text over backgrounds.
- Quick Bookmarks modal uses basic fuzzy scoring and keyboard navigation.
- Export & import functions serialize and validate against a simple schema tag (`schema: "kanban.v1").

Modifying code:
- Colors: edit `PROJECT_COLOR_PALETTE` constant.
- Persistence: adjust `STORAGE_KEY` or switch to `chrome.storage.sync` (future roadmap).
- Columns: modify `STATUSES` array (ensure UI + schema + validations updated).

---
## Export / Import Format
Export JSON structure:
```json
{
  "schema": "kanban.v1",
  "exportedAt": "ISO timestamp",
  "projects": [ /* project objects */ ],
  "cards": { "cardId": { /* card object */ } },
  "bookmarks": [ { "id": "uuid", "title": "label", "url": "https://...", "order": 0 } ]
}
```
Import validation checks: `schema`, array/object shapes, presence of columns for each status.

Backward compatibility: older exports without `notes` / `bookmarks` are normalized on import.

---
## Privacy & Permissions
Manifest permissions:
- `storage` – for local persistence only.

No network requests are performed by the extension. Data never leaves your machine unless you manually export or open links. Opening links uses `target="_blank"` with `rel="noopener"` for safety.

---
## Roadmap
Planned & suggested enhancements (feel free to contribute):
1. Optional sync via `chrome.storage.sync`.
2. Tagging / labeling system for cards.
3. Card detail modal (description, checklist, due dates).
4. Dark mode / theming system.
5. Global search across cards & notes.
6. Automatic backup rotation (local file or sync).
7. Multi‑language i18n support.
8. Accessibility audit (focus rings, ARIA refinements).
9. Unit tests (store, drag & drop edge cases).
10. Firefox / Edge builds (manifest v3 compatibility).

Open an issue to discuss priorities or propose others.

---
## Contributing
Contributions are welcome!
1. Fork the repo & create a feature branch (`feat/...`, `fix/...`).
2. Keep changes focused and atomic.
3. Update README sections if you add visible features.
4. Open a Pull Request with a clear description (motivation + screenshots/gifs if UI changes).
5. Follow conventional commit style for messages (e.g. `feat: add dark mode toggle`).

Please also:
- Avoid introducing heavy dependencies unless justified.
- Preserve zero‑framework architecture unless feature clearly benefits from abstraction.
- Consider performance of rerenders (batch mutations where practical).

---
## Development Workflow
The project currently ships unbuilt assets:
- Edit files directly in `dist/ui/`.
- Test by reloading the New Tab or using the Extensions page "Reload" button.
- Before release: bump `version` in `manifest.json` and generate a fresh zip.

Suggested additions (PRs welcome):
- npm script for linting / packaging.
- Automated schema validation for import JSON.
- Basic test harness (e.g. Jest for pure functions).

Directory structure (simplified):
```
ckanban/
  dist/
    manifest.json
    assets/icons/*
    ui/
      board.html
      board.css
      board.js
```

---
## Versioning
Uses [Semantic Versioning](https://semver.org/) ideals:
- MAJOR: incompatible changes (e.g. schema bump from `kanban.v1`).
- MINOR: new features (current: 0.5.x incremental).
- PATCH: fixes & minor improvements.

Current active schema: `kanban.v1` (notes & bookmarks included).

---
## Security Notes
- Local only; risk surface minimal.
- User‑supplied input stored verbatim (no HTML injection currently because text inserted via `textContent` – safe from markup injection).
- Links open in new tab with `noopener` to mitigate reverse tabnabbing.
- No evaluation of arbitrary code.

Potential improvements:
- URL validation / normalization for links & bookmarks.
- Optional content sanitization for future rich card descriptions.

Report issues via GitHub Issues labeled `security`.

---
## FAQ
**Q: Can I use this without overriding New Tab?**  
A: Yes – remove the `chrome_url_overrides` block from `manifest.json` and load the extension. Then open the page via `chrome-extension://<id>/ui/board.html` or add an action popup referencing it.

**Q: Does this sync across devices?**  
A: Not yet. Roadmap includes optional sync support.

**Q: Can I add more columns?**  
A: Add to `STATUSES` array, update labels & validations, adjust export/import and rendering.

**Q: How do I back up data?**  
A: Use Export JSON regularly; store off‑device if important.

**Q: Are there analytics?**  
A: No. Zero telemetry by design.

---
## Acknowledgements
- Icon & color inspirations from modern material design palettes.
- Community suggestions will be credited in CHANGELOG / README as features land.

---

---
## Disclaimer
CKanban is not affiliated with Atlassian, Jira, GitHub, or any other vendor whose names might appear in user‑entered link titles. Use at your own risk.

---
