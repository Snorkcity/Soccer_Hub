/** Synthetic, non-personal CSV fixture. Never substitute this for live data. */
export function trainingCsvFixture(): string {
  const headers = [
    "Date", "Session Title", "Player Name", "Split Name", "Tags",
    "Split Start Time", "Split End Time", "Duration", "Distance (km)",
    "Sprint Distance (m)", "Player Load", "Top Speed (m/s)", "Power Plays",
    "Hr Load", "Hr Max (bpm)", "Distance in Speed Zone 5 (km)",
    "Max Acceleration (m/s/s)", "Max Deceleration (m/s/s)",
    ...["Accelerations", "Deceleration"].flatMap(prefix => [
      `${prefix} Zone Count: 0 - 1 m/s/s`, `${prefix} Zone Count: 1 - 2 m/s/s`,
      `${prefix} Zone Count: 2 - 3 m/s/s`, `${prefix} Zone Count: 3 - 4 m/s/s`,
      `${prefix} Zone Count: > 4 m/s/s`,
    ]),
  ];
  const rows: (string | number)[][] = [headers];
  const durations = [322, 799, 1063, 1197, 779];
  const distances = [400, 800, 1100, 1800, 1200];
  const parts = ["warmup", "1st third", "2nd third", "3rd third", "Split 2"];
  const clock = (sec: number) => `${String(Math.floor(sec / 3600)).padStart(2, "0")}:${String(Math.floor(sec % 3600 / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
  for (let player = 0; player < 20; player++) {
    const name = `P${String(player + 1).padStart(2, "0")}.Sample`;
    const row = (part: string, start: number, end: number, duration: number, distance: number, speed: number) =>
      ["2026-11-09", "Synthetic training", name, part, " training", clock(start), clock(end),
        duration, distance / 1000, 20, 10, speed, 3, 0, 0, .001, 5, 6, 2, 3, 4, 5, 6, 2, 3, 4, 5, 6];
    rows.push(row("all", 17 * 3600 + 50 * 60, 20 * 3600 + 10 * 60, 8400, 99000, 12));
    let start = 18 * 3600;
    for (let part = 0; part < 5; part++) {
      rows.push(row(parts[part], start, start + durations[part],
        player === 0 && part === 0 ? 223 : durations[part], distances[part] + player * 10, 8 + part * .25));
      start += durations[part] + 120;
    }
  }
  return rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
}
