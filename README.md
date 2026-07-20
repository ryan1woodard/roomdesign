# Roomcraft

A **room designer with an integrated visual inventory system**. The room is the
primary interface — inventory lives *inside* the furniture, shelves, and drawers
you draw. Instead of scrolling spreadsheets, you open a drawer and see your
things laid out as cards, exactly where they physically are.

> Think Figma for organizing physical spaces, not a database with a room diagram
> bolted on.

## Highlights

- **Room designer** — infinite 2D canvas with smooth pan/zoom, a snap grid,
  furniture, shelves, containers, text labels, resize/rotate handles,
  multi-select, duplicate, undo/redo, and copy of position.
- **Layers** — Figma-style named layers you can show/hide, reorder, rename, and
  delete; switching visibility instantly changes what's on the canvas.
- **Shelf builder** — turn any object into a grid of compartments, then **drag
  the divider lines** to resize them like spreadsheet columns. Each compartment
  is its own storage location and can be a shelf or a drawer.
- **Drawer interface** — clicking a compartment opens a full-screen, responsive
  grid of item **cards** (image · name · quantity · color-coded tags). Cards
  never overlap or leave the drawer, hover reveals detail, click opens the
  inspector.
- **Inventory** — items require only *name, photo, quantity, tags*; everything
  else (notes, dimensions, purchase date, value, serial) is optional.
- **Search** — type anything and the room dims, the matching object **glows and
  pulses**, and a result list lets you jump straight to the item.
- **Drag & drop** — drag an item card onto any other location to move it.
- **Space awareness** — optional mode that tracks how full each container is
  from item dimensions.
- **Auto-save** — every change is persisted to IndexedDB. There is no save
  button.
- **Design** — dark-mode-first, glassmorphism, rounded corners, and animated
  transitions throughout.

## Tech

- **React + TypeScript + Vite**
- **react-konva / Konva** for the interactive canvas
- **Zustand** for state, with a coalescing undo/redo history
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

## Keyboard shortcuts

| Action            | Shortcut              |
| ----------------- | --------------------- |
| Undo / Redo       | ⌘/Ctrl+Z / ⌘/Ctrl+⇧Z |
| Duplicate object  | ⌘/Ctrl+D              |
| Delete object     | Delete / Backspace    |
| Close / deselect  | Esc                   |

## How it's organized

```
src/
  types.ts             # domain model (objects, storage, items, tags, layers)
  lib/
    units.ts           # inch-canonical unit conversion
    shelf.ts           # grid/compartment geometry
    selectors.ts       # search matching + item sorting
  store/
    store.ts           # Zustand store, actions, undo/redo, persistence
    demo.ts            # first-run seed room
  components/
    RoomCanvas.tsx     # Konva stage, camera, grid, transformer
    ObjectNode.tsx     # a single furniture/shelf object on the canvas
    Toolbar.tsx        # tools, view toggles, units, undo/redo
    SearchBar.tsx      # global search + jump-to results
    LayersPanel.tsx    # layer management
    Inspector.tsx      # selected-object properties
    ShelfEditor.tsx    # rows/cols + draggable divider builder
    CellPicker.tsx     # "choose a compartment" overlay
    DrawerView.tsx     # full-screen inventory + move rail
    ItemCard.tsx       # inventory card
    ItemInspector.tsx  # full item editor
```
