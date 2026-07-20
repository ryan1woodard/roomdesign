export default function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-mark">◆</div>
      <div className="loading-name">SRS Lab Designer</div>
      <div className="loading-bar">
        <div className="loading-bar-fill" />
      </div>
      <div className="loading-hint">Loading your project…</div>
    </div>
  );
}
