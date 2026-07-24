# SRS Lab Designer

A **room designer with an integrated visual inventory system**. The room is the
primary interface — inventory lives *inside* the furniture, shelves, and drawers
you draw. Instead of scrolling spreadsheets, you open a drawer and see your
things laid out as cards, exactly where they physically are.

> Think Figma for organizing physical spaces, not a database with a room diagram
> bolted on.

## Highlights

- **Room designer** — infinite 2D canvas with smooth pan/zoom, a snap grid,
  furniture, shelves, containers, text labels, resize/rotate handles,
  multi-select, duplicate, undo/redo, and copy/paste.
- **Object labels** — hidden by default, fade in on hover, reposition
  automatically above the object's rotated/resized bounding box, scale to stay
  readable at any zoom, and auto-hide when zoomed far out. "Show All Labels"
  toolbar toggle overrides.
- **Wall Designer Mode** — activates automatically when the Walls layer is
  active. Click to place wall points, drag for a straight segment, angle
  snapping (15°), auto-close into a room, drag vertices to reshape, insert/
  split/merge/delete walls, adjustable thickness, optional curved walls, and
  an automatically generated floor polygon with adjustable color/opacity.
- **Doors & windows** — placed directly on a wall, they snap into position,
  visually cut the wall open, drag along the wall, auto-rotate with the wall's
  angle, resize, and (for doors) show a swing-direction indicator.
- **Layers** — Figma-style named layers you can show/hide, reorder, rename, and
  delete; switching visibility instantly changes what's on the canvas. Every
  room has one permanent Walls layer that drives Wall Designer Mode.
- **Multiple rooms** — a Room Navigator tree with generated thumbnails lets you
  create, rename, duplicate, reorder, and switch rooms instantly. Each room
  has fully independent walls, floor, furniture, layers, inventory, and camera
  position (viewport memory).
- **Moving between rooms** — right-click an object for "Move to Room", change
  an inventory item's location across rooms from its inspector, or copy/paste
  (⌘/Ctrl+C/V) to duplicate objects (with their inventory) into another room.
- **Shelf builder** — turn any object into a grid of compartments, then **drag
  the divider lines** to resize them like spreadsheet columns. Each compartment
  is its own storage location and can be a shelf or a drawer.
- **Drawer interface** — clicking a compartment opens a full-screen, responsive
  grid of item **cards** (image · name · quantity · color-coded tags). Cards
  never overlap or leave the drawer, hover reveals detail, click opens the
  inspector.
- **Inventory** — items require only *name, photo, quantity, tags*; everything
  else (notes, dimensions, purchase date, value, serial) is optional.
- **Search** — searches every room at once; the matching object **glows and
  pulses** and a result list jumps you straight to the item, switching rooms
  first if needed. Lives top-right with its own elevated, high-contrast styling.
- **Drag & drop** — drag an item card onto any other location to move it.
- **Space awareness** — optional mode that tracks how full each container is
  from item dimensions.
- **Fit to View** — frames every visible object/wall in the active room with
  one click or the `F` key, ignoring hidden layers.
- **Minimap** — small overview with a click-to-jump viewport indicator.
- **Room properties** — name, notes, floor color/opacity, and an importable
  blueprint reference image with adjustable opacity to trace over.
- **Auto-save** — every change is persisted to IndexedDB, with a periodic
  recovery snapshot as a safety net. There is no save button.
- **Design** — dark-mode-first, glassmorphism, rounded corners, and animated
  transitions throughout.

## Tech

- **React + TypeScript + Vite**
- **react-konva / Konva** for the interactive canvas
- **Zustand** for state, with a coalescing undo/redo history, scoped per room
- **localforage** (IndexedDB) for persistence via Zustand's `persist` middleware
- **framer-motion** for overlay/drawer transitions

The code separates concerns: rendering (`components/`), state + persistence
(`store/`), and pure inventory/geometry logic (`lib/`), so a cloud sync layer
can be added behind the same store API later.

## Getting started

```bash
npm install
npm run dev      # start the dev server (http://localhost:5173)
npm run build    # type-check + production build
npm run preview  # preview the production build
```

## Running as a shared multi-user server

`server/index.js` is a small Node process (Express + WebSocket + SQLite) that
lets several people on the same server computer see and edit the same rooms
and inventory live, and gives you a System Log of client/server errors — no
external service required.

```bash
npm run build   # produces dist/
npm run server  # or: npm start   (build + server in one step)
```

This serves the built app *and* the sync/log API from one process on
`http://<server-computer>:8787` (override with `PORT=...`). Everyone points
their browser at that address instead of running their own copy.

**How the sync works**: every connected browser pushes its rooms/tags/
checkouts/activity-log to the server (debounced ~300ms after a change), the
server persists it to `server/data/app.db` (SQLite) and rebroadcasts it to
every other connected browser. This is **whole-document, last-write-wins**
sync, not per-field merging — if two people edit at almost the same instant,
whichever update reaches the server last wins. That's the right trade-off for
a small team (edits rarely collide down to the same second); it is *not*
Google-Docs-style conflict resolution. Each browser's currently-open room and
its own UI toggles (labels/icons, mode, etc.) stay local and are never synced,
so switching rooms on one screen doesn't move everyone else's view.

The header shows a **Live / Connecting… / Offline** indicator next to the
save status — that reflects this connection, separate from the per-device
autosave, which keeps working locally even if the server is briefly
unreachable and catches up once it reconnects (automatic, with backoff — no
reload needed).

**Error monitoring**: any crash or uncaught error in any connected browser —
plus the server's own errors — is written to the `logs` table in the same
SQLite file and viewable in-app via the toolbar's bug-icon **System Log**
button (`/api/logs` under the hood). This is intentionally simple (no
external monitoring account, nothing leaves the server computer) rather than
a full observability stack like Sentry.

**Keeping it running**: `npm run server` is just a foreground Node process —
if it crashes or the machine reboots, nothing restarts it automatically. For
real use, run it under a process manager so it comes back on its own, e.g. a
systemd unit:

```ini
# /etc/systemd/system/srs-lab-designer.service
[Unit]
Description=SRS Lab Designer
After=network.target

[Service]
WorkingDirectory=/path/to/roomdesign
ExecStart=/usr/bin/node --experimental-sqlite server/index.js
Restart=always
Environment=PORT=8787

[Install]
WantedBy=multi-user.target
```

then `sudo systemctl enable --now srs-lab-designer`. (`pm2 start server/index.js --name srs-lab-designer` is an equally fine alternative if you'd rather not touch systemd.)

**Backups**: everything shared lives in one file, `server/data/app.db` —
back it up (or snapshot it) like you would any other database file. It's
git-ignored on purpose; it's per-deployment data, not source code.

## Keyboard shortcuts

| Action                      | Shortcut               |
| ---------------------------- | ---------------------- |
| Undo / Redo                  | ⌘/Ctrl+Z / ⌘/Ctrl+⇧Z   |
| Duplicate object              | ⌘/Ctrl+D               |
| Copy / Paste                  | ⌘/Ctrl+C / ⌘/Ctrl+V    |
| Delete object / wall / opening| Delete / Backspace     |
| Fit to view                   | F                       |
| Close / deselect / cancel     | Esc                     |
| Finish wall chain (no close)  | Enter / double-click    |

## How it's organized

```
src/
  types.ts               # domain model: rooms, objects, items, walls, layers
  lib/
    units.ts             # inch-canonical unit conversion
    shelf.ts             # grid/compartment geometry
    selectors.ts         # search matching + item sorting
    walls.ts             # wall/vertex/opening geometry, snapping, floor loops
    bounds.ts            # fit-to-view bounding box calculation
  store/
    store.ts             # Zustand store: rooms, walls, undo/redo, persistence
    demo.ts               # first-run seed project (two rooms)
  components/
    RoomCanvas.tsx        # Konva stage, per-room camera, grid, transformer
    ObjectNode.tsx        # a furniture/shelf object + its floating label
    WallLayer.tsx          # walls, vertices, openings, floor rendering + edit
    WallInspector.tsx      # selected wall/vertex/opening properties
    Toolbar.tsx            # tools (swaps to wall tools in Wall Designer Mode)
    SearchBar.tsx           # cross-room search + jump-to results
    LayersPanel.tsx         # layer management
    RoomNavigator.tsx       # room tree, thumbnails, room properties
    Minimap.tsx             # overview map with click-to-jump
    ObjectContextMenu.tsx   # right-click menu incl. Move to Room
    Inspector.tsx           # selected-object properties
    ShelfEditor.tsx         # rows/cols + draggable divider builder
    CellPicker.tsx          # "choose a compartment" overlay
    DrawerView.tsx          # full-screen inventory + move rail
    ItemCard.tsx            # inventory card
    ItemInspector.tsx       # full item editor (location spans all rooms)
    LoadingScreen.tsx       # branded splash while IndexedDB hydrates
```
