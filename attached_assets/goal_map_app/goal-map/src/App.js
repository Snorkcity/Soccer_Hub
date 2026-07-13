import React, { useState, useEffect } from "react";

const PITCH_WIDTH = 100;
const PITCH_LENGTH = 40;

const PENALTY_BOX = { x0: 20, x1: 80, y0: 0, y1: 18 };
const SIX_BOX = { x0: 36, x1: 64, y0: 0, y1: 6 };
const GOAL = { x0: 44, x1: 56, y0: -3, y1: 0 };
const ARC = { left: 38, right: 62, topY: 18, peakY: 26 };

export default function GoalMapCoordinateTool() {
  const [points, setPoints] = useState([]);
  const [showGrid, setShowGrid] = useState(true);
  const [snap, setSnap] = useState(false);
  const [gridSize, setGridSize] = useState(1);
  const [hover, setHover] = useState(null);

  const snapValue = (val, size) => Math.round(val / size) * size;

  const getCoords = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();

    let x = ((e.clientX - rect.left) / rect.width) * PITCH_WIDTH;
    let y = ((e.clientY - rect.top) / rect.height) * PITCH_LENGTH;

    if (snap) {
      x = snapValue(x, gridSize);
      y = snapValue(y, gridSize);
    }

    x = Math.max(0, Math.min(PITCH_WIDTH, x));
    y = Math.max(0, Math.min(PITCH_LENGTH, y));

    return {
      x: Number(x.toFixed(1)),
      y: Number(y.toFixed(1)),
    };
  };

  const handleClick = async (e) => {
    const { x, y } = getCoords(e);
    setPoints((prev) => [...prev, { x, y }]);
    await copyPointToClipboard(x, y);
  };

  const handleMove = (e) => {
    const { x, y } = getCoords(e);
    setHover({ x, y });
  };

  const clearPoints = () => setPoints([]);
  const undoLast = () => setPoints((prev) => prev.slice(0, -1));

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        setPoints((prev) => prev.slice(0, -1));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const exportCSV = () => {
    const rows = points.map((p) => `${p.x},${p.y}`).join("\n");
    const blob = new Blob(["x,y\n" + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "goal_map_coordinates.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const format = (n) => Number(n).toFixed(1);

  const buttonStyle = {
    padding: "8px 12px",
    borderRadius: "6px",
    border: "1px solid #004F44",
    backgroundColor: "#0D0D0E",
    color: "#00BFFF",
    cursor: "pointer",
    fontFamily: "Segoe UI",
  };

  const [copiedText, setCopiedText] = useState("");
  
  const copyPointToClipboard = async (x, y) => {
    const text = `${x}\t${y}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(`Copied: ${x}, ${y}`);
      setTimeout(() => setCopiedText(""), 1500);
    } catch (err) {
      console.error("Clipboard copy failed:", err);
    }
  };


  return (
    <div
      style={{
        padding: "16px",
        fontFamily: "Segoe UI",
        backgroundColor: "#121212",   // charcoal
        color: "#00BFFF",             // sky blue text
        minHeight: "100vh",
      }}
    >
      <h1
        style={{
          fontSize: "24px",
          fontWeight: "bold",
          marginBottom: "8px",
          color: "#00BFFF",
        }}
      >
        BUFC Goal Map Coordinate Tool
      </h1>

      <p style={{ marginBottom: "16px", color: "#A0AEC0" }}>
        Click the pitch to log coordinates in the same x/y system used by your goal map plot
        (x: 0–100, y: 0–24).
      </p>

      <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
        <button onClick={undoLast} disabled={points.length === 0} style={buttonStyle}>
          Undo
        </button>

        <button onClick={clearPoints} style={buttonStyle}>
          Clear
        </button>

        <button onClick={() => setShowGrid(!showGrid)} style={buttonStyle}>
          {showGrid ? "Hide Grid" : "Show Grid"}
        </button>

        <button onClick={() => setSnap(!snap)} style={buttonStyle}>
          {snap ? "Snap: ON" : "Snap: OFF"}
        </button>

        <select
          value={gridSize}
          onChange={(e) => setGridSize(Number(e.target.value))}
          style={{ padding: "8px", borderRadius: "6px" }}
        >
          <option value={0.5}>0.5</option>
          <option value={1}>1</option>
          <option value={2}>2</option>
          <option value={5}>5</option>
        </select>

        <button onClick={exportCSV} style={buttonStyle}>
          Export CSV
        </button>
      </div>

      <div
        style={{
          position: "relative",
          border: "2px solid #166534",
          backgroundColor: "#1F7A3E",   // slightly darker green
          width: "100%",
          maxWidth: "1000px",
          aspectRatio: `${PITCH_WIDTH} / ${PITCH_LENGTH}`,
          overflow: "visible",
        }}
        onClick={handleClick}
        onMouseMove={handleMove}
      >
        {showGrid && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              backgroundImage: `
                linear-gradient(to right, rgba(255,255,255,0.15) 1px, transparent 1px),
                linear-gradient(to bottom, rgba(255,255,255,0.15) 1px, transparent 1px)
              `,
              backgroundSize: `${(gridSize / PITCH_WIDTH) * 100}% ${(gridSize / PITCH_LENGTH) * 100}%`,
            }}
          />
        )}

        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "2px",
            backgroundColor: "white",
            pointerEvents: "none",
          }}
        />

        <div
          style={{
            position: "absolute",
            left: `${(50 / PITCH_WIDTH) * 100}%`,
            top: `${(12 / PITCH_LENGTH) * 100}%`,
            transform: "translate(-50%, -50%)",
            width: "6px",
            height: "6px",
            backgroundColor: "white",
            borderRadius: "50%",
            pointerEvents: "none",
          }}
        />

        <div
          style={{
            position: "absolute",
            top: `${(PENALTY_BOX.y0 / PITCH_LENGTH) * 100}%`,
            left: `${(PENALTY_BOX.x0 / PITCH_WIDTH) * 100}%`,
            width: `${((PENALTY_BOX.x1 - PENALTY_BOX.x0) / PITCH_WIDTH) * 100}%`,
            height: `${((PENALTY_BOX.y1 - PENALTY_BOX.y0) / PITCH_LENGTH) * 100}%`,
            border: "2px solid white",
            pointerEvents: "none",
            boxSizing: "border-box",
          }}
        />

        <div
          style={{
            position: "absolute",
            top: `${(SIX_BOX.y0 / PITCH_LENGTH) * 100}%`,
            left: `${(SIX_BOX.x0 / PITCH_WIDTH) * 100}%`,
            width: `${((SIX_BOX.x1 - SIX_BOX.x0) / PITCH_WIDTH) * 100}%`,
            height: `${((SIX_BOX.y1 - SIX_BOX.y0) / PITCH_LENGTH) * 100}%`,
            border: "2px solid white",
            pointerEvents: "none",
            boxSizing: "border-box",
          }}
        />

        <div
          style={{
            position: "absolute",
            top: `${(GOAL.y1 / PITCH_LENGTH) * 100}%`,
            left: `${(GOAL.x0 / PITCH_WIDTH) * 100}%`,
            width: `${((GOAL.x1 - GOAL.x0) / PITCH_WIDTH) * 100}%`,
            height: "2px",
            backgroundColor: "black",
            pointerEvents: "none",
          }}
        />

        <svg
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
          viewBox="0 0 100 40"
          preserveAspectRatio="none"
        >
          <path
            d={`M ${ARC.left} ${ARC.topY} Q 50 ${ARC.peakY} ${ARC.right} ${ARC.topY}`}
            fill="none"
            stroke="white"
            strokeWidth="1.4"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {hover && (
          <>
            <div
              style={{
                position: "absolute",
                width: "100%",
                height: "1px",
                backgroundColor: "rgba(255,255,255,0.4)",
                top: `${(hover.y / PITCH_LENGTH) * 100}%`,
                pointerEvents: "none",
              }}
            />
            <div
              style={{
                position: "absolute",
                height: "100%",
                width: "1px",
                backgroundColor: "rgba(255,255,255,0.4)",
                left: `${(hover.x / PITCH_WIDTH) * 100}%`,
                pointerEvents: "none",
              }}
            />

            <div
              style={{
                position: "absolute",
                left: `${(hover.x / PITCH_WIDTH) * 100}%`,
                top: `${(hover.y / PITCH_LENGTH) * 100}%`,
                transform: "translate(8px, 8px)",
                backgroundColor: "rgba(0,0,0,0.7)",
                color: "white",
                fontSize: "12px",
                padding: "4px 6px",
                borderRadius: "4px",
                pointerEvents: "none",
              }}
            >
              x: {format(hover.x)}, y: {format(hover.y)}
            </div>
          </>
        )}

        {points.map((p, i) => (
          <div
            key={`${p.x}-${p.y}-${i}`}
            style={{
              position: "absolute",
              left: `${(p.x / PITCH_WIDTH) * 100}%`,
              top: `${(p.y / PITCH_LENGTH) * 100}%`,
              transform: "translate(-50%, -50%)",
            }}
          >
            <div
              style={{
                width: "12px",
                height: "12px",
                backgroundColor: "#dc2626",
                borderRadius: "50%",
                border: "1px solid white",
                boxShadow: "0 2px 4px rgba(0,0,0,0.35)",
              }}
            />
          </div>
        ))}
      </div>

      {copiedText && (
        <div style={{ marginBottom: "12px", color: "#00BFFF", fontSize: "14px" }}>
          {copiedText}
        </div>
      )}

      <div style={{ marginTop: "16px" }}>
        <h2 style={{ fontWeight: "bold", fontSize: "18px" }}>Logged Coordinates</h2>
        <ul
          style={{
            fontSize: "14px",
            maxHeight: "180px",
            overflow: "auto",
            color: "#00BFFF",
          }}
        >
          {points.map((p, i) => (
            <li key={i}>
              #{i + 1}: (x: {format(p.x)}, y: {format(p.y)})
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}