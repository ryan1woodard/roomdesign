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
- **Multi-user** — runs on a server everyone connects to; edits sync per
  entity, so two people working at once never overwrite each other. Undo is
  per-person. See "Running it on a server" below.
- **Design** — dark-mode-first, glassmorphism, rounded corners, and animated
  transitions throughout.

## Tech

- **React + TypeScript + Vite**
- **react-konva / Konva** for the interactive canvas
- **Zustand** for state, with a coalescing undo/redo history, scoped per room
- **framer-motion** for overlay/drawer transitions
- **Express + SQLite** (`server/`) for the shared, multi-user backend
- **localforage** (IndexedDB) for this device's own preferences only

The code separates concerns: rendering (`components/`), state (`store/`), and
pure inventory/geometry logic (`lib/`). Multi-user sync is isolated to
`lib/entities.ts` (decomposing state into per-entity operations) and
`lib/serverSync.ts` (upload queue + delta polling), hooked into the store at
its single mutation chokepoint — so none of the ~60 individual actions have
to know a server exists.

## Running it on a server (multi-user)

The app is designed to run as one process on a server computer that everyone
points a browser at. All rooms, furniture, inventory, tags, checkouts and the
activity log live on that server, so every person sees and edits the same
data — there is no per-browser copy.

```bash
npm install
npm run build     # compile the front-end into dist/
npm run server    # serve the app + API on port 8080
# or in one step:
npm start
```

Then everyone opens `http://<server-name-or-ip>:8080`. Set `PORT` to use a
different port, `HOST` to restrict which interface it binds to, and
`DATA_DIR` to move the database.

### How multi-user editing works

The unit of concurrency is the **individual entity** — one object, one item,
one wall, one tag. When you drag a shelf, only that shelf is sent to the
server; when a co-worker edits an item in another room, only that item is
sent. Two people working on different things therefore never collide at all.
If two people edit *the same* field at the same moment, the later write wins,
which is what people expect.

Each browser polls for changes every few seconds, so an open tab picks up
other people's edits on its own, and a refresh always shows the current
state. The header indicator reports whether your work has actually reached
the server:

| Indicator | Meaning |
| --- | --- |
| **Saved** | Everything you've done is on the server. |
| **Saving…** | A change is in flight. |
| **Offline** | The server can't be reached. Your edits are queued locally and upload automatically when it comes back — nothing is lost, but nobody else can see them yet. |

**Undo is per-person.** Your undo stack contains only the changes *you* made
and rewinds only those, so pressing Ctrl+Z can never roll back a co-worker's
unrelated work.

**What stays on your own machine:** your display units, Design/Inventory
mode, the Labels and Icons toggles, which room you have open, and where each
room's camera is pointed. These are per-person view preferences — syncing
them would mean one person panning would drag everyone else's screen along.

### Accounts

There are no passwords. Anyone who can reach the server picks a name from the
shared roster (or adds themselves), and that name is used to attribute
changes in the activity log. **This assumes the server is only reachable by
people you trust** — e.g. on an internal network. Don't expose it directly to
the internet without putting authentication in front of it (a reverse proxy
with basic auth or SSO is the usual approach).

### Keeping it running

`npm run server` is a foreground process; nothing restarts it if it crashes
or the machine reboots. For real use put it under a process manager:

```ini
# /etc/systemd/system/srs-lab-designer.service
[Unit]
Description=SRS Lab Designer
After=network.target

[Service]
WorkingDirectory=/opt/roomdesign
ExecStart=/usr/bin/node server/index.js
Restart=always
Environment=PORT=8080

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now srs-lab-designer
```

(`pm2 start server/index.js --name srs-lab-designer` works just as well.)

### Backups

Everything shared lives in one SQLite file, `server/data/app.db`. Copy or
snapshot it like any other database file — that single file is the whole
project. It's git-ignored because it's per-deployment data, not source.

```bash
sqlite3 server/data/app.db ".backup '/backups/app-$(date +%F).db'"
```

### Upgrading

Pull, rebuild, restart — the database is untouched by a redeploy:

```bash
git pull && npm install && npm run build && sudo systemctl restart srs-lab-designer
```

## Local development

```bash
npm run dev
```

That starts both halves together — the API server on :8080 and Vite on
:5173 (which proxies `/api` to it). Open http://localhost:5173.

Running `vite` alone won't work: with no API server behind it the app has
nothing to load and will tell you it can't reach the server. Use
`npm run dev:web` / `npm run dev:server` if you deliberately want them in
separate terminals.

`npm run build` type-checks and produces the production bundle;
`npm run typecheck` runs the type-checker alone.

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
