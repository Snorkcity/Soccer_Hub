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

**How to apply:** consult the source documents and linked policies when extending training analytics. The coach subsequently approved the first implementation, including CSV ingestion and Player, Team and Coach views; do not treat every suggestion in the source briefs as approved scope.

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

## Coach history and planned-versus-recorded duration

The Coach view must support trends and drill-down across tracked sessions, not just a single-session time breakdown. Selecting a named component such as Technical activation should reveal its tracked occurrences, durations, patterns and comparisons over time, with access to individual session detail. The coach wants their observed average durations to inform realistic allocations in the separate session-planning app.

**Why:** the coach wants to distinguish consistently meeting a planned time allowance from routinely overrunning it, then choose whether to shorten the activity or revise future plans.

**How to apply:** count each session's marked component once when calculating coaching averages, not once per player. Show sample size, missing components and useful duration variability alongside the average. Support optional planned durations or ranges versus recorded durations without requiring extra upload work; the coach's examples of a 20–25-minute main part and nine-minute passing activation illustrate the comparison, not approved default targets. Preserve the applicable historical allowance if targets are introduced, so changing a future plan does not reinterpret older sessions. Do not automatically label longer or shorter components as good or bad, and do not assume integration with the retired Hub planner.

## Player and Team session summaries

Include short coaching insights beneath both the Player and Team training tabs for each selected session. Requested examples include identifying the part where a player recorded their highest metres per minute and the part containing their highest recorded speed. Insights should help the coach understand player responses and session design, not merely repeat every chart.

**Why:** the coach explicitly requested useful summaries at the bottom of both views and delegated judgement about other helpful insights.

**How to apply:** ground statements in valid selected-session measurements; add historical and positional comparisons only when comparable evidence exists. Distinguish duration, accumulated output and intensity; handle ties and missing recordings honestly. Use the existing weighted-insight policy and confidence-aware voice, including meaningful watch points when supported, without inventing concerns or equating GPS output with effort, football performance, injury risk or selection readiness.

## Confirmed import location

Training CSV ingestion belongs in the existing GPS ingestion section of Data Entry, alongside match GPS ingestion, not a separate upload area.

**Why:** the coach explicitly directed that the existing GPS Data Entry workflow should support training CSVs too.

**How to apply:** extend that workflow with training-aware identification, split mapping and review while preserving existing match uploads. Keep campaign season separate from the actual session date and training measurements out of match-only analysis and Gref.

## Whole-session Player chart

The Player tab must include a prominent overall session chart across tracked dates, not just charts for individual practice components.

**Why:** when approving implementation, the coach specifically emphasised “for sure an overall chart, not just the individual element charts.”

**How to apply:** retain the overall view alongside the five-part comparisons and component drill-downs. Compute overall output from the selected parts, disclose incomplete totals, and do not substitute the untrimmed source recording.

## Team review simplicity

The coach finds repeated part and metric selection difficult. They want the Team view to show a separate player chart for each metric down the page, using their Catapult screenshot as the reference: total distance, Power Plays, HSM, VHSM and other categories. They especially like the relative-standing table as an all-in-one view and want Full session included alongside the individual parts.

**Why:** the coach explicitly said the first Team view lacked simplicity and required too much scrolling back to change selections.

**How to apply:** favour scanning the session's metrics without repeated dropdown changes. Keep the all-in-one relative comparison available, retain component and positional analysis without making them prerequisites, and do not mistake the screenshot's game-value grading for a requested training benchmark.

The coach refined the review flow: choose the session near Matches/Training, then Player/Team/Coach, then relevant period and view controls underneath. Group Team charts into about three expandable sections, with relative standings after the charts. Give each player-comparison chart its own sort and Totals/Per-minute controls rather than one distant control for every chart.

**Why:** the coach found the top controls congested, including the horizontal scrollbar, and wanted less scrolling through charts and back to global controls.

**How to apply:** keep session selection above view selection, show only meaningful controls for each view (Coach does not use player metric/rate controls), and keep chart sorting/rate settings independent.

## Team-to-player exploration

The coach wants clicking a player or their metric in Team training analysis to open a closable pop-up, not leave them on the Player tab. The requested example is clicking a player's total distance to see their distance across everything tracked, then returning to the same Team analysis.

**Why:** switching tabs for a brief player drill-down left the coach feeling stuck and interrupted team analysis.

**How to apply:** retain Team position, filters, chart groups and sorting underneath the pop-up. Scope history to the selected league and campaign; keep any date, metric or period exploration inside the pop-up separate from Team settings.

## Player review simplicity

Use the same grouped, all-metrics flow for the main Player training view: select the player and Full session or a practice part, then scan separate charts for all metrics across tracked dates. The default is chronological, with the newest session on the right; provide sorting controls too.

**Why:** the coach confirmed the Team flow is becoming easier and explicitly directed that Player should follow that same flow, rather than requiring repeated metric selection.

**How to apply:** retain historical totals and component analysis with clear period headings. Keep the focused Team-to-player pop-up useful rather than replacing it with the whole all-metrics screen. Do not discard previously tracked sessions when adding newer dates.
