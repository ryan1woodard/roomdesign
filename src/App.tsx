import { useEffect } from 'react';
import RoomCanvas from './components/RoomCanvas';
import Toolbar from './components/Toolbar';
import SearchBar from './components/SearchBar';
import LayersPanel from './components/LayersPanel';
import Inspector from './components/Inspector';
import CellPicker from './components/CellPicker';
import DrawerView from './components/DrawerView';
import { useStore } from './store/store';
import './app.css';

export default function App() {
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const selection = useStore((s) => s.selection);
  const removeObject = useStore((s) => s.removeObject);
  const duplicateObject = useStore((s) => s.duplicateObject);
  const closeDrawer = useStore((s) => s.closeDrawer);
  const openPicker = useStore((s) => s.openPicker);
  const openLocation = useStore((s) => s.openLocation);
  const pickerObjectId = useStore((s) => s.pickerObjectId);
  const clearSelection = useStore((s) => s.clearSelection);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;

      if (e.key === 'Escape') {
        if (openLocation) closeDrawer();
        else if (pickerObjectId) openPicker(null);
        else clearSelection();
        return;
      }
      if (typing) return;

      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        selection.forEach((id) => duplicateObject(id));
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length) {
        e.preventDefault();
        selection.forEach((id) => removeObject(id));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, selection, removeObject, duplicateObject, closeDrawer, openPicker, openLocation, pickerObjectId, clearSelection]);

  return (
    <div className="app-root">
      <RoomCanvas />

      <div className="ui-layer">
        <div className="top-bar">
          <Toolbar />
          <SearchBar />
        </div>
        <LayersPanel />
        <Inspector />
      </div>

      <CellPicker />
      <DrawerView />

      <div className="hint-bar">
        Double-click furniture to open · Scroll to zoom · Drag to pan · Everything auto-saves
      </div>
    </div>
  );
}
