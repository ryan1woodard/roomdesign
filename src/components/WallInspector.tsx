import { Trash2, Scissors, Merge, X, RectangleHorizontal, Spline } from 'lucide-react';
import { useStore, useActiveRoom } from '../store/store';
import { fromInches, toInches, UNIT_LABEL } from '../lib/units';
import { canMergeAt, wallVector } from '../lib/walls';

export default function WallInspector() {
  const room = useActiveRoom();
  const wallSelection = useStore((s) => s.wallSelection);
  const units = useStore((s) => s.settings.units);
  const wallAngleSnap = useStore((s) => s.settings.wallAngleSnap);
  const toggleWallAngleSnap = useStore((s) => s.toggleWallAngleSnap);
  const defaultThickness = useStore((s) => s.settings.wallThickness);
  const setWallThicknessDefault = useStore((s) => s.setWallThicknessDefault);

  const updateWallThickness = useStore((s) => s.updateWallThickness);
  const toggleWallCurved = useStore((s) => s.toggleWallCurved);
  const setWallCurveOffset = useStore((s) => s.setWallCurveOffset);
  const deleteWall = useStore((s) => s.deleteWall);
  const mergeAtVertex = useStore((s) => s.mergeAtVertex);
  const updateOpening = useStore((s) => s.updateOpening);
  const removeOpening = useStore((s) => s.removeOpening);
  const selectWallEntity = useStore((s) => s.selectWallEntity);
  const setFloorStyle = useStore((s) => s.setFloorStyle);

  const u = UNIT_LABEL[units];

  if (!wallSelection) {
    return (
      <div className="inspector glass wall-inspector">
        <div className="inspector-head">
          <strong>Wall Designer</strong>
        </div>
        <div className="inspector-body">
          <p className="hint">
            Draw walls, then add doors and windows. Click an existing wall, vertex handle, or opening to edit it.
          </p>
          <div className="section">
            <span className="label">Default wall thickness</span>
            <div className="num-input-wrap">
              <input
                className="field"
                type="number"
                value={Math.round(fromInches(defaultThickness, units) * 100) / 100}
                onChange={(e) => setWallThicknessDefault(toInches(parseFloat(e.target.value) || 1, units))}
              />
              <span className="num-unit">{u}</span>
            </div>
          </div>
          <label className="check-row">
            <input type="checkbox" checked={wallAngleSnap} onChange={toggleWallAngleSnap} />
            Snap angles to 15°
          </label>
          <div className="section">
            <span className="label">Floor</span>
            <div className="swatches">
              <input
                type="color"
                className="color-picker"
                value={room.floorColor}
                onChange={(e) => setFloorStyle(e.target.value, room.floorOpacity)}
              />
            </div>
            <label className="num-field">
              <span className="label">Opacity</span>
              <input
                className="field"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={room.floorOpacity}
                onChange={(e) => setFloorStyle(room.floorColor, parseFloat(e.target.value))}
              />
            </label>
          </div>
        </div>
      </div>
    );
  }

  if (wallSelection.type === 'wall') {
    const wall = room.walls[wallSelection.id];
    if (!wall) return null;
    const length = wallVector(wall, room.vertices).length;
    return (
      <div className="inspector glass wall-inspector">
        <div className="inspector-head">
          <strong>Wall</strong>
          <button className="btn icon" onClick={() => selectWallEntity(null)}>
            <X size={15} />
          </button>
        </div>
        <div className="inspector-body">
          <div className="section">
            <span className="label">Length</span>
            <p className="wall-length">{fromInches(length, units).toFixed(1)} {u}</p>
          </div>
          <div className="section">
            <span className="label">Thickness</span>
            <div className="num-input-wrap">
              <input
                className="field"
                type="number"
                value={Math.round(fromInches(wall.thickness, units) * 100) / 100}
                onChange={(e) => updateWallThickness(wall.id, toInches(parseFloat(e.target.value) || 1, units))}
              />
              <span className="num-unit">{u}</span>
            </div>
          </div>
          <label className="check-row">
            <input type="checkbox" checked={wall.curved} onChange={() => toggleWallCurved(wall.id)} />
            <Spline size={14} /> Curved wall
          </label>
          {wall.curved && (
            <label className="num-field">
              <span className="label">Curve amount</span>
              <input
                className="field"
                type="range"
                min={-72}
                max={72}
                value={wall.curveOffset}
                onChange={(e) => setWallCurveOffset(wall.id, parseFloat(e.target.value))}
              />
            </label>
          )}
          <div className="inspector-actions">
            <button
              className="btn danger"
              onClick={() => {
                deleteWall(wall.id);
              }}
            >
              <Trash2 size={14} /> Delete wall
            </button>
          </div>
          <p className="hint">Double-click the wall to split it. Drag its endpoint handles to reshape.</p>
        </div>
      </div>
    );
  }

  if (wallSelection.type === 'vertex') {
    const vertex = room.vertices[wallSelection.id];
    if (!vertex) return null;
    const mergeable = canMergeAt(vertex.id, room.vertices, room.walls);
    return (
      <div className="inspector glass wall-inspector">
        <div className="inspector-head">
          <strong>Vertex</strong>
          <button className="btn icon" onClick={() => selectWallEntity(null)}>
            <X size={15} />
          </button>
        </div>
        <div className="inspector-body">
          <p className="hint">Drag this handle to reshape the room. Insert new vertices by double-clicking a wall.</p>
          {mergeable && (
            <button className="btn" onClick={() => mergeAtVertex(vertex.id)}>
              <Merge size={14} /> Merge straight walls
            </button>
          )}
        </div>
      </div>
    );
  }

  // opening
  const opening = room.openings[wallSelection.id];
  if (!opening) return null;
  return (
    <div className="inspector glass wall-inspector">
      <div className="inspector-head">
        <strong>{opening.kind === 'door' ? 'Door' : 'Window'}</strong>
        <button className="btn icon" onClick={() => selectWallEntity(null)}>
          <X size={15} />
        </button>
      </div>
      <div className="inspector-body">
        <div className="section">
          <span className="label">Width</span>
          <div className="num-input-wrap">
            <input
              className="field"
              type="number"
              value={Math.round(fromInches(opening.width, units) * 100) / 100}
              onChange={(e) => updateOpening(opening.id, { width: toInches(parseFloat(e.target.value) || 1, units) })}
            />
            <span className="num-unit">{u}</span>
          </div>
        </div>
        {opening.kind === 'window' && (
          <p className="hint">
            <RectangleHorizontal size={13} style={{ verticalAlign: '-2px' }} /> Windows sit centered in the wall thickness.
          </p>
        )}
        <div className="inspector-actions">
          <button className="btn danger" onClick={() => removeOpening(opening.id)}>
            <Scissors size={14} /> Remove {opening.kind}
          </button>
        </div>
      </div>
    </div>
  );
}
