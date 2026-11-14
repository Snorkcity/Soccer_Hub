---
name: GPS methodology and training brief
description: Source documents and approved training-review refinements, alongside the existing match methodology.
---

## Documents to read together

- Match methodology: `attached_assets/BUFC_GPS_Performance_Methodology_v1.0_1791066031026.docx`, titled “BUFC GPS Performance Methodology — Version 1.0 — Match Physical Readiness”.
- Training brief: `attached_assets/Pasted--Replit-Development-Brief-Training-GPS-Analytics-1-Obje_1794282815519.txt`.
- Sample training export: `attached_assets/20261109-T-N_1794634643570.csv`.
- Subsequent coach-supplied handover: `attached_assets/Pasted-Copy-this-into-Touchline-and-attach-the-CSV-Catapult-tr_1794634720134.txt`. Treat as additional context, not a verbatim replacement of this project's agreed direction.
- Existing agreed training requirements are in [GPS Insights](gps-insights.md); approved match-reference interpretation is in [Player Development policy](gps-development-policy.md).

Keep the documents and the coach-approved review together. The training brief complements the match methodology; it does not replace match qualification rules or turn training into qualifying Gref appearances. Where source documents differ from subsequent coach decisions, use the later decisions, including the existing Catapult speed thresholds.

**Why:** the coach asked to keep the training brief and our discussion together and asked about their earlier methodology document.

**How to apply:** consult the source documents and linked policies before implementing training analytics. The sample export has now been supplied; implementation approval is still separate from reading and discussing it.

## Additional refinements approved in the training-brief review

- Treat “End Part” and “End-game” as labels to reconcile against the actual export, not automatically different practice components.
- Preserve complete-session totals without adding them on top of their component rows. Combined rates must use the appropriate totals and duration, not an unweighted average of component rates.
- Confirm Catapult's duration definition. Do not silently subtract quiet periods or coaching stoppages to inflate intensity.
- Keep elite men's maximum-speed categories secondary and provisional, not validated grades or an initial prerequisite for useful training comparisons.
- Do not require pitch dimensions, rules or practice descriptions at upload; optional exercise metadata can come later. The coach has replaced the Hub planner/library with a separate “Football Session Library & Builder” app; do not make the old modules dependencies of training GPS.
- Implement reliable imports and the initial session dashboard before historical heatmaps and more advanced drill-downs. Historical interpretation needs accumulating evidence.

**Why:** the coach accepted the proposed review and asked to retain it with the supplied material.

**How to apply:** refine the import and dashboard design from the actual spreadsheet, preserve existing match functionality, and avoid treating every feature in the supplied brief as an immediate implementation commitment.

## Training preparation clarified in the later handover

The handover explains that Catapult restricts the available part names. For this workflow, retain Warm-up as an additional selected component alongside the four football components. The untrimmed `all` recording is not the intended analytical total: construct and clearly label a total from the five selected parts, while retaining the source recording for traceability. The source handover contains the precise label mapping.

Downtime within selected parts should remain included; the coach does not want extra manual cutting of the overall recording. Label included duration as “Time in session parts”, not continuous moving or true active time. Individual recorded participation may legitimately differ from the marked part length. The coach subsequently confirmed that the scheduled training session is 90 minutes; do not infer that window from the longest raw device recording.

The handover adds interest in acceleration bands, especially for technical activation, and Power Plays, especially for main part and end game, alongside the already agreed metrics and team/individual comparisons.

**Why:** the coach supplied the other chat's summary to avoid repeating the discussion, while explicitly saying not to take it verbatim or replace the direction already developed here.

**How to apply:** incorporate these preparation and coaching goals into the proposed design, verify source values independently, and preserve match/Gref separation. Do not invent speed-zone boundaries from numbered CSV columns; distinguish the app's established metric mapping from confirmation of this export's settings.

## Confirmed Training navigation and coaching time view

Training should have Player and Team tabs, similar in organisation to the existing match GPS views, plus a Coach view. The Coach view shows the duration of each of the five selected parts, their combined time, and the time outside those parts within the confirmed 90-minute session.

**Why:** the coach explicitly wants to understand how they allocate training time and whether each part receives the intended duration.

**How to apply:** base coaching allocation on the marked part timetable, not the mean or sum of individual player participation. Keep shorter player recordings in individual analysis. Describe the remainder as time outside selected parts, not proven inactivity: breaks within the marked parts remain included. Exact placement of the scheduled window still needs an actual start time if drawing leading/trailing gaps.
