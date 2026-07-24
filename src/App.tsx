import { useEffect, useState } from 'react';
import RoomCanvas from './components/RoomCanvas';
import Toolbar from './components/Toolbar';
import SearchBar from './components/SearchBar';
import ModeSwitch from './components/ModeSwitch';
import LayersPanel from './components/LayersPanel';
import RoomNavigator from './components/RoomNavigator';
import Inspector from './components/Inspector';
import WallInspector from './components/WallInspector';
import CellPicker from './components/CellPicker';
import ShelfLayoutModal from './components/ShelfLayoutModal';
import DrawerView from './components/DrawerView';
import ObjectContextMenu from './components/ObjectContextMenu';
import LoadingScreen from './components/LoadingScreen';
import LogViewer from './components/LogViewer';
import InventoryDatabase from './components/InventoryDatabase';
import PersonalInventory from './components/PersonalInventory';
import LoginScreen from './components/LoginScreen';
import UserMenu from './components/UserMenu';
import ToastStack from './components/Toast';
import { useStore, useActiveRoom, useSaveStore } from './store/store';
import './app.css';

function useHydrated() {
  const [hydrated, setHydrated] = useState(() => useStore.persist?.hasHydrated?.() ?? true);
  useEffect(() => {
    if (useStore.persist?.hasHydrated?.()) {
      setHydrated(true);
      return;
    }
    const unsub = useStore.persist?.onFinishHydration?.(() => setHydrated(true));
    return () => unsub?.();
  }, []);
  return hydrated;
}

function useUnsavedChangesGuard() {
  const saveStatus = useSaveStore((s) => s.saveStatus);
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (saveStatus === 'saved') return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [saveStatus]);
}

export default function App() {
  const hydrated = useHydrated();
  useUnsavedChangesGuard();
  const currentUser = useStore((s) => s.currentUser);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const selection = useStore((s) => s.selection);
  const removeObject = useStore((s) => s.removeObject);
  const duplicateObject = useStore((s) => s.duplicateObject);
  const closeDrawer = useStore((s) => s.closeDrawer);
  const openPicker = useStore((s) => s.openPicker);
  const openLocation = useStore((s) => s.openLocation);
  const pickerObjectId = useStore((s) => s.pickerObjectId);
  const shelfEditObjectId = useStore((s) => s.shelfEditObjectId);
  const openShelfEditor = useStore((s) => s.openShelfEditor);
  const clearSelection = useStore((s) => s.clearSelection);
  const closeContextMenu = useStore((s) => s.closeContextMenu);
  const contextMenu = useStore((s) => s.contextMenu);
  const copySelection = useStore((s) => s.copySelection);
  const pasteClipboard = useStore((s) => s.pasteClipboard);
  const requestFitToView = useStore((s) => s.requestFitToView);

  const wallTool = useStore((s) => s.wallTool);
  const setWallTool = useStore((s) => s.setWallTool);
  const objectTool = useStore((s) => s.objectTool);
  const setObjectTool = useStore((s) => s.setObjectTool);
  const wallDraft = useStore((s) => s.wallDraft);
  const cancelWallDraft = useStore((s) => s.cancelWallDraft);
  const wallSelection = useStore((s) => s.wallSelection);
  const selectWallEntity = useStore((s) => s.selectWallEntity);
  const deleteWall = useStore((s) => s.deleteWall);
  const removeOpening = useStore((s) => s.removeOpening);

  const mode = useStore((s) => s.settings.mode);
  const setMode = useStore((s) => s.setMode);
  const room = useActiveRoom();
  const activeLayer = room?.layers.find((l) => l.id === room.activeLayerId);
  const isWallMode = mode === 'design' && activeLayer?.kind === 'wall';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;

      if (e.key === 'Escape') {
        if (wallDraft) cancelWallDraft();
        else if (openLocation) closeDrawer();
        else if (pickerObjectId) openPicker(null);
        else if (shelfEditObjectId) openShelfEditor(null);
        else if (contextMenu) closeContextMenu();
        else if (wallSelection) selectWallEntity(null);
        else if (isWallMode && wallTool !== 'select') setWallTool('select');
        else if (!isWallMode && objectTool !== 'freeMove') setObjectTool('freeMove');
        else clearSelection();
        return;
      }
      if (e.key === 'Enter' && isWallMode && wallTool === 'draw' && wallDraft) {
        cancelWallDraft();
        return;
      }
      if (typing) return;

      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
        e.preventDefault();
        e.key.toLowerCase() === 'y' || e.shiftKey ? redo() : undo();
      } else if (mode === 'design' && mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        selection.forEach((id) => duplicateObject(id));
      } else if (mode === 'design' && mod && e.key.toLowerCase() === 'c') {
        if (selection.length) copySelection();
      } else if (mode === 'design' && mod && e.key.toLowerCase() === 'v') {
        pasteClipboard();
      } else if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        document.getElementById('global-search-input')?.focus();
      } else if (e.key.toLowerCase() === 'f' && !mod) {
        requestFitToView();
      } else if (mode === 'design' && !isWallMode && !mod && e.key.toLowerCase() === 'g') {
        setObjectTool('freeMove');
      } else if (mode === 'design' && !isWallMode && !mod && e.key.toLowerCase() === 'm') {
        setObjectTool('move');
      } else if (mode === 'design' && !isWallMode && !mod && e.key.toLowerCase() === 'r') {
        setObjectTool('rotate');
      } else if (mode === 'design' && !isWallMode && !mod && e.key.toLowerCase() === 's') {
        // No dedicated Scale tool yet — Select is the closest equivalent,
        // since its resize handles are how objects are scaled today.
        setObjectTool('select');
      } else if (!mod && e.key.toLowerCase() === 'd') {
        setMode('design');
      } else if (!mod && e.key.toLowerCase() === 'i') {
        setMode('inventory');
      } else if (mode === 'design' && (e.key === 'Delete' || e.key === 'Backspace')) {
        if (wallSelection) {
          e.preventDefault();
          if (wallSelection.type === 'wall') deleteWall(wallSelection.id);
          else if (wallSelection.type === 'opening') removeOpening(wallSelection.id);
          else if (wallSelection.type === 'vertex') {
            const connected = Object.values(room.walls).filter((w) => w.a === wallSelection.id || w.b === wallSelection.id);
            connected.forEach((w) => deleteWall(w.id));
          }
        } else if (selection.length) {
          e.preventDefault();
          selection.forEach((id) => removeObject(id));
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    undo,
    redo,
    selection,
    removeObject,
    duplicateObject,
    closeDrawer,
    openPicker,
    openLocation,
    pickerObjectId,
    shelfEditObjectId,
    openShelfEditor,
    clearSelection,
    contextMenu,
    closeContextMenu,
    copySelection,
    pasteClipboard,
    requestFitToView,
    wallDraft,
    cancelWallDraft,
    wallSelection,
    selectWallEntity,
    deleteWall,
    removeOpening,
    isWallMode,
    wallTool,
    setWallTool,
    objectTool,
    setObjectTool,
    room,
    mode,
    setMode,
  ]);

  if (!hydrated) return <LoadingScreen />;
  if (!currentUser) return <LoginScreen />;

  return (
    <div className="app-root">
      <RoomCanvas />

      <div className="ui-layer">
        <div className="top-bar">
          <Toolbar />
          <SearchBar />
          <UserMenu />
        </div>
        <div className="left-rail">
          <ModeSwitch />
          <RoomNavigator />
          <LayersPanel />
        </div>
        {isWallMode ? <WallInspector /> : <Inspector />}
      </div>

      <CellPicker />
      <ShelfLayoutModal />
      <DrawerView />
      <ObjectContextMenu />
      <LogViewer />
      <InventoryDatabase />
      <PersonalInventory />
      <ToastStack />
    </div>
  );
}
