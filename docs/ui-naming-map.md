# Name map: internal identifier ↔ user-facing label

> The code and the interface use different names for the same concept in several places in the
> system — deliberately, in some cases (the internal identifier stays stable so saved tasks don't
> break; the user-facing label changes when the wording improves). This document is the conversion
> table, for anyone new to the project who doesn't want to get lost searching the code for "Skills"
> and not finding it. A companion catalog covers every individual Blockly block (icon, color, type,
> IO description) in the project's internal documentation; this document extends the same idea to
> the page/route/component level, which that catalog doesn't cover.

Verified against the code on 2026-07-31. If a row stops matching, the code is right — update this
table, not the other way around.

---

## Pages and routes

| Internal identifier | User-facing label | Where it appears | File:line |
|---|---|---|---|
| Route `/actions` | **Skills** | Sidebar entry, page title | `menu-items/libraries.ts:29-31`, `pages/actions/listActions.tsx:57,125` |
| Folder `pages/objects`/`locations`/`actions` | **Library** | Sidebar group header | `menu-items/libraries.ts:9-11` |
| `DigitalTwinPanel.tsx` (file/component name) | **Robot** | Panel header title | `components/DigitalTwinPanel.tsx:744` (`id="digital-twin-title"`, wired via `aria-labelledby` at `:699`) |
| Sidebar group `id: 'studio'` | *(no label — single "Tasks" entry)* | Operator/manager sidebar | `menu-items/define.ts:7-20` |
| Sidebar group `id: 'operations'` (operator) | *(no label — single "My Robot" entry)* | Operator sidebar | `menu-items/management.ts:40-52` |
| Management sidebar group (manager) | **Administration** | Manager sidebar | `menu-items/management.ts:11-13` |

## Blockly: block type ↔ label

| Block type (backend + frontend) | User-facing label | Notes |
|---|---|---|
| `macro_task_block` | **Saved Task** (toolbox) | `features/blockly/toolbox/toolboxRegistry.ts:298-301` |
| Macro-expansion action | **"Break Saved Task into steps"** | Same text in the context menu and the modal — `UI_TEXT.breakSavedTaskIntoSteps`, `contextMenu.ts:392-410`, `InlineTaskDialog.tsx:52` |
| `human_action_block` | **Pause and show message** | `toolboxRegistry.ts:167-168` |
| `processing_block` | **Execute skill** | `toolboxRegistry.ts:112-115` |
| `action_block` | **Skills** | `toolboxRegistry.ts:208-211` |
| `when_start` | *(start marker, not a step — silently skipped by the parser)* |  |
| `timer_block`, `logic_and/or/not` | *(hidden from palette and picker, definition intact)* |  |

## Cross-cutting components

| Internal identifier | User-facing label | Actual behavior | File:line |
|---|---|---|---|
| `ChatThread.tsx` (chat panel) | **Copilot** | — | `layout/MainLayout/Header/index.tsx:280` |
| `toggleContextualHelp` (internal function name) | **"Proactive analysis"** (no longer "Contextual help") | When a task with conformance issues is opened, automatically fires an LLM call that explains/proposes a fix (`requestProactiveHelp`) | `components/ChatThread.tsx:126-138,296-386,601-630` |
| `CustomToolbox.tsx` header | **TOOLBOX** (now `UI_TEXT.toolbox.toUpperCase()`) | — | `features/blockly/toolbox/CustomToolbox.tsx:457` |
| Block-palette toggle button | **"Hide toolbox"** / **"Show toolbox"** | — | `CustomToolbox.tsx:497,501`; `features/blockly/editor/BlocklyEditor.tsx:1594,1601` |
| "⋯" menu insert entry | **"Add a step"** | Opens the ⌘K search dialog | `features/blockly/editor/BlocklyEditor.tsx:1872-1882` |
| Empty shadow slot (sequence) | **"Add a step"** | Tooltip: "Drop a block here to add a step." | `features/blockly/blocks/definitions.ts:609-622` |
| Empty shadow slot (first step) | **"Add first step"** | Tooltip: "Connect the first block of your program here." | `features/blockly/blocks/definitions.ts:624-644` |
| ⌘K search dialog | **"Search for a step"** | — | `features/blockly/editor/dialogs/BlockSearchDialog.tsx:94` |
| `simOpen`/`toggleSim` (Redux) | **"Run"** (header button) | Now a real toggle, no longer a no-op when already open | `layout/MainLayout/Header/index.tsx:368` |
| `executionTarget: 'sim'\|'real'` | **Simulate** / **Run on robot** | — | `UI_TEXT.simulate`/`UI_TEXT.runOnRobot`, `constants/uiVocabulary.ts` |
| `taskStatus === 'published_with_draft'` | **Published** chip + secondary note **"Unpublished changes"** (never a chip starting with "Draft") | — | `utils/taskStatus.ts:63-77` |

## Vocabulary source of truth

`constants/uiVocabulary.ts` (`UI_TEXT`) is the single source for recurring user-facing terms, 17
keys, imported from 13 files (listed in the project's internal UI audit notes). When a term in this
table changes, it changes there first; this document gets resynced to match, not the other way
around.
