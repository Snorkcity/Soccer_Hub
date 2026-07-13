import dash
from dash import dcc, html, Input, Output, State, ctx
import pandas as pd
import plotly.graph_objects as go
from dash import dash_table
import plotly.express as px
import gspread
import io
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from oauth2client.service_account import ServiceAccountCredentials
import zipfile
import os
import json
import plotly.io as pio
import numpy as np

# -------------------------
# APP
# -------------------------
app = dash.Dash(
    __name__,
    external_stylesheets=["https://fonts.googleapis.com/css2?family=Inter&display=swap"]
)

# -------------------------
# GOOGLE SHEETS
# -------------------------
scope = [
    "https://spreadsheets.google.com/feeds",
    "https://www.googleapis.com/auth/drive",
]

if os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON"):
    print("🌐 Using Railway env variable")
    creds_dict = json.loads(os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"])
    creds = ServiceAccountCredentials.from_json_keyfile_dict(creds_dict, scope)
elif os.path.exists("service_account.json"):
    print("🖥️ Using local service_account.json")
    creds = ServiceAccountCredentials.from_json_keyfile_name("service_account.json", scope)
else:
    raise EnvironmentError("❌ No credentials found. Set env var or add service_account.json.")

client = gspread.authorize(creds)

# -------------------------
# LOAD TESTING DATA (NEW)
# -------------------------
SPREADSHEET_NAME = "2026_season-stats-1sts"
TAB_2025 = "2025-testing"
TAB_2026 = "2026-testing"

spreadsheet_1sts = client.open(SPREADSHEET_NAME)

testing_2025 = pd.DataFrame(spreadsheet_1sts.worksheet(TAB_2025).get_all_records())
testing_2026 = pd.DataFrame(spreadsheet_1sts.worksheet(TAB_2026).get_all_records())

# Basic cleanup
for df in (testing_2025, testing_2026):
    df.columns = [c.strip() for c in df.columns]
    if "Player" in df.columns:
        df["Player"] = df["Player"].astype(str).str.strip()
    if "Position" in df.columns:
        df["Position"] = df["Position"].astype(str).str.strip()

# Remove "Averages" row (we calculate averages in code if needed)
testing_2025 = testing_2025[testing_2025["Player"].str.lower() != "averages"].copy()
testing_2026 = testing_2026[testing_2026["Player"].str.lower() != "averages"].copy()

# -------------------------
# UI STYLES
# -------------------------
button_style = {
    "backgroundColor": "skyblue",
    "color": "black",
    "border": "none",
    "padding": "10px 16px",
    "marginRight": "10px",
    "borderRadius": "6px",
    "fontWeight": "bold",
    "fontFamily": "Arial",
    "cursor": "pointer",
    "boxShadow": "2px 2px 5px rgba(0, 0, 0, 0.3)",
    "textAlign": "left"
}

POSITION_ORDER = ["Goalkeeper", "Defender", "Midfielder", "Forward"]
POSITION_MAP = {
    "GK": "Goalkeeper",
    "GKP": "Goalkeeper",
    "KEEPER": "Goalkeeper",
    "DEF": "Defender",
    "D": "Defender",
    "MID": "Midfielder",
    "M": "Midfielder",
    "FWD": "Forward",
    "F": "Forward",
    "ATT": "Forward",
    "ATTACKER": "Forward",
}

C_YELLOW = "#FFD700"       # 2026 avg
C_LIGHTPURPLE = "#CFA9FF"  # 2025 avg

def normalise_position_series(s: pd.Series) -> pd.Series:
    s = s.astype(str).str.strip()
    s = s.replace({"": np.nan, "nan": np.nan, "None": np.nan})
    s_up = s.str.upper()
    s = s_up.map(POSITION_MAP).fillna(s)          # map shorthands
    s = s.where(s.isin(POSITION_ORDER), other="Unknown")
    return s

for df in (testing_2025, testing_2026):
    if "Position" not in df.columns:
        df["Position"] = "Unknown"
    df["Position"] = normalise_position_series(df["Position"])

# -------------------------
# CHARTS: helpers
# -------------------------


PAGE_STYLE = {
    "backgroundColor": "#0B0F1A",
    "minHeight": "100vh",
    "padding": "20px",
    "fontFamily": "Segoe UI, Arial, sans-serif",
}


CARD_STYLE = {
    "backgroundColor": "#000000",
    "borderRadius": "12px",
    "padding": "18px",
    "margin": "18px auto",
    "width": "92%",
    "boxShadow": "0 6px 18px rgba(0,0,0,0.4)",
    "border": "1px solid rgba(255,255,255,0.2)",   # 👈 add this
}

SECTION_WRAP_STYLE = {
    "backgroundColor": "#1E3A5F",
    "borderRadius": "12px",
    "padding": "14px",
    "margin": "0 auto 18px auto",
    "width": "94%",
    "border": "1px solid rgba(255,255,255,0.25)",
}

BTN_STYLE = {
    "backgroundColor": "skyblue",
    "color": "black",
    "border": "none",
    "padding": "10px 16px",
    "marginRight": "10px",
    "borderRadius": "8px",
    "fontWeight": "bold",
    "fontFamily": "Arial",
    "cursor": "pointer",
}


LOWER_IS_BETTER = {
    "Balsom (s)",
    "0-10 split",
    "10-20 split",
    "20-30 split",
    "Total 30m",
}

ID_COLS = ["Player", "Position"]

def get_metric_cols(df: pd.DataFrame) -> list[str]:
    return [c for c in df.columns if c not in ID_COLS]

def add_percentiles(df: pd.DataFrame, metrics: list[str]) -> pd.DataFrame:
    df = df.copy()
    for m in metrics:
        s = pd.to_numeric(df[m], errors="coerce")
        if m in LOWER_IS_BETTER:
            pct = 1.0 - s.rank(pct=True, method="average")
        else:
            pct = s.rank(pct=True, method="average")
        df[f"{m}__pct"] = (pct * 100).round(1)
    return df

def bar_metric_chart(
    df: pd.DataFrame,
    metric: str,
    mode: str,
    year_label: str,
    sort_mode: str,
) -> go.Figure:

    df = df.copy()
    y_col = metric if mode == "raw" else f"{metric}__pct"

    # Sort
    ascending = (sort_mode == "low")
    df = df.sort_values(by=y_col, ascending=ascending)
    x_order = df["Player"].tolist()

    fig = px.bar(
        df,
        x="Player",
        y=y_col,
        color="Position",
        text=y_col,
        category_orders={
            "Player": x_order,
            "Position": ["Goalkeeper", "Defender", "Midfielder", "Forward", "Unknown"],
        },
    )

    # Format bar values (1 decimal place)
    fig.update_traces(
        texttemplate="%{text:.1f}",
        textposition="outside",
    )

    # Average line
    avg = pd.to_numeric(df[y_col], errors="coerce").mean()
    if np.isfinite(avg):
        fig.add_hline(
            y=avg,
            line_width=2,
            line_dash="dash",
            annotation_text=f"Average: {avg:.1f}",
            annotation_position="top left",
        )

    fig.update_layout(
        title=f"{year_label} — {metric} ({'Raw' if mode=='raw' else 'Percentile'})",
        xaxis_title="",
        yaxis_title=metric if mode == "raw" else "Percentile (higher = better)",
        legend_title="Position",
        bargap=0.25,
        margin=dict(l=20, r=20, t=60, b=40),

        paper_bgcolor="#000000",
        plot_bgcolor="#000000",

        font=dict(
            family="Segoe UI",
            color="white"
        ),
        title_font=dict(
            family="Segoe UI Black",
            color="white",
            size=20
        ),
        legend=dict(
            font=dict(
                family="Segoe UI",
                color="white"
            )
        ),
    )

    fig.update_xaxes(
        tickangle=-35,
        showgrid=False,
        color="white",
    )

    fig.update_yaxes(
        showgrid=True,
        gridcolor="rgba(255,255,255,0.08)",
        color="white",
    )

    return fig

def sprint_profile_chart(df: pd.DataFrame, year_label: str) -> go.Figure:
    d = df.copy()

    # Ensure numeric
    for c in ["0-10 split", "10-20 split", "20-30 split"]:
        d[c] = pd.to_numeric(d[c], errors="coerce")

    # Cumulative
    d["t0"] = 0.0
    d["t10"] = d["0-10 split"]
    d["t20"] = d["0-10 split"] + d["10-20 split"]
    d["t30"] = d["0-10 split"] + d["10-20 split"] + d["20-30 split"]

    # Sort (fastest first)
    if "Total 30m" in d.columns:
        d["Total 30m"] = pd.to_numeric(d["Total 30m"], errors="coerce")
        d = d.sort_values("Total 30m", ascending=True)
    else:
        d = d.sort_values("t30", ascending=True)

    # Long format
    long = d.melt(
        id_vars=["Player", "Position"],
        value_vars=["t0", "t10", "t20", "t30"],
        var_name="Checkpoint",
        value_name="Time",
    )

    checkpoint_map = {"t0": 0, "t10": 10, "t20": 20, "t30": 30}
    long["Distance"] = long["Checkpoint"].map(checkpoint_map)

    fig = px.line(
        long,
        x="Distance",
        y="Time",
        color="Position",
        line_group="Player",
        hover_name="Player",
        markers=True,
    )

    fig.update_traces(
        hovertemplate="<b>%{hovertext}</b><br>Distance: %{x}m<br>Time: %{y:.2f}s<extra></extra>",
    )

    fig.update_layout(
        title=f"{year_label} — 30m Sprint Profile (Cumulative Time)",
        xaxis_title="Distance (m)",
        yaxis_title="Time (s)",
        legend_title="Position",
        margin=dict(l=20, r=20, t=60, b=50),

        paper_bgcolor="#000000",
        plot_bgcolor="#000000",

        font=dict(
            family="Segoe UI",
            color="white"
        ),
        title_font=dict(
            family="Segoe UI Black",
            color="white",
            size=20
        ),
        legend=dict(
            font=dict(
                family="Segoe UI",
                color="white"
            )
        ),
    )

    fig.update_xaxes(
        tickmode="array",
        tickvals=[0, 10, 20, 30],
        showgrid=True,
        gridcolor="rgba(255,255,255,0.08)",
        color="white",
    )

    fig.update_yaxes(
        showgrid=True,
        gridcolor="rgba(255,255,255,0.08)",
        color="white",
        tickformat=".1f",
    )

    return fig

def sprint_head_to_head_chart(
    player_1: str,
    year_1: str,
    player_2: str,
    year_2: str,
    df_2025: pd.DataFrame,
    df_2026: pd.DataFrame,
) -> go.Figure:

    def get_df(year):
        return df_2025 if year == "2025" else df_2026

    def get_player_row(player, year):
        df = get_df(year)
        row = df[df["Player"] == player]
        return row.iloc[0] if not row.empty else None

    r1 = get_player_row(player_1, year_1)
    r2 = get_player_row(player_2, year_2)

    fig = go.Figure()

    if r1 is not None:
        y1 = [
            0.0,
            float(r1["0-10 split"]),
            float(r1["0-10 split"]) + float(r1["10-20 split"]),
            float(r1["0-10 split"]) + float(r1["10-20 split"]) + float(r1["20-30 split"]),
        ]
        fig.add_trace(
            go.Scatter(
                x=[0, 10, 20, 30],
                y=y1,
                mode="lines+markers+text",
                name=f"{player_1} ({year_1})",
                text=[f"{v:.2f}" for v in y1],
                textposition="top center",
                line=dict(color="#7EC8F2", width=4),
                marker=dict(size=9, color="#7EC8F2"),
                hovertemplate=f"<b>{player_1} ({year_1})</b><br>Distance: %{{x}}m<br>Time: %{{y:.2f}}s<extra></extra>",
            )
        )

    if r2 is not None:
        y2 = [
            0.0,
            float(r2["0-10 split"]),
            float(r2["0-10 split"]) + float(r2["10-20 split"]),
            float(r2["0-10 split"]) + float(r2["10-20 split"]) + float(r2["20-30 split"]),
        ]
        fig.add_trace(
            go.Scatter(
                x=[0, 10, 20, 30],
                y=y2,
                mode="lines+markers+text",
                name=f"{player_2} ({year_2})",
                text=[f"{v:.2f}" for v in y2],
                textposition="bottom center",
                line=dict(color="#D9D9D9", width=4),
                marker=dict(size=9, color="#D9D9D9"),
                hovertemplate=f"<b>{player_2} ({year_2})</b><br>Distance: %{{x}}m<br>Time: %{{y:.2f}}s<extra></extra>",
            )
        )

    fig.update_layout(
        title="30m Sprint Head-to-Head",
        xaxis_title="Distance (m)",
        yaxis_title="Cumulative Time (s)",
        margin=dict(l=20, r=20, t=60, b=50),
        paper_bgcolor="#000000",
        plot_bgcolor="#000000",
        font=dict(family="Segoe UI", color="white"),
        title_font=dict(family="Segoe UI Black", color="white", size=20),
        legend=dict(font=dict(family="Segoe UI", color="white")),
    )

    fig.update_xaxes(
        tickmode="array",
        tickvals=[0, 10, 20, 30],
        showgrid=True,
        gridcolor="rgba(255,255,255,0.08)",
        color="white",
    )

    fig.update_yaxes(
        showgrid=True,
        gridcolor="rgba(255,255,255,0.08)",
        color="white",
    )

    return fig

def player_spotlight_chart(
    df_2025: pd.DataFrame,
    df_2026: pd.DataFrame,
    year: str,
    metric: str,
    player: str,
) -> go.Figure:

    df = df_2025.copy() if year == "2025" else df_2026.copy()
    d = df.copy()

    d[metric] = pd.to_numeric(d[metric], errors="coerce")
    d = d.dropna(subset=[metric])

    # Sort logic
    lower_is_better = {"Balsom (s)", "0-10 split", "10-20 split", "20-30 split", "Total 30m"}
    ascending = metric in lower_is_better
    d = d.sort_values(metric, ascending=ascending).reset_index(drop=True)

    # Highlight selected player
    d["Bar Colour"] = d["Player"].apply(lambda x: "#7EC8F2" if x == player else "#A9A9A9")
    d["Text Colour"] = d["Player"].apply(lambda x: "white" if x == player else "#D9D9D9")

    avg_value = d[metric].mean()

    fig = go.Figure()

    fig.add_bar(
        x=d["Player"],
        y=d[metric],
        marker=dict(
            color=d["Bar Colour"],
            line=dict(
                color=d["Player"].apply(lambda x: "white" if x == player else "rgba(0,0,0,0)"),
                width=2
            )
        ),
        text=d[metric],
        texttemplate="%{text:.2f}" if metric in lower_is_better else "%{text:.1f}",
        textposition="outside",
        customdata=np.stack([d["Position"]], axis=-1),
        hovertemplate=(
            "<b>%{x}</b><br>"
            f"{metric}: " + ("%{y:.2f}" if metric in lower_is_better else "%{y:.1f}") + "<br>"
            "Position: %{customdata[0]}<extra></extra>"
        ),
    )

    fig.add_hline(
        y=avg_value,
        line_width=2,
        line_dash="dash",
        line_color="yellow",
        annotation_text=f"Squad Avg: {avg_value:.2f}" if metric in lower_is_better else f"Squad Avg: {avg_value:.1f}",
        annotation_position="top left",
    )

    fig.update_layout(
        title=f"Player Spotlight — {player} | {metric} ({year})",
        xaxis_title="",
        yaxis_title=metric,
        margin=dict(l=20, r=20, t=60, b=60),
        paper_bgcolor="#000000",
        plot_bgcolor="#000000",
        font=dict(family="Segoe UI", color="white"),
        title_font=dict(family="Segoe UI Black", color="white", size=20),
        showlegend=False,
    )

    fig.update_xaxes(
        tickangle=0,
        showgrid=False,
        color="white",
        categoryorder="array",
        categoryarray=d["Player"].tolist(),
        tickvals=[player],   # only show this player's name
        ticktext=[player],
    )

    fig.update_yaxes(
        showgrid=True,
        gridcolor="rgba(255,255,255,0.08)",
        color="white",
    )

    return fig


def player_comparison_chart(
    df_2025: pd.DataFrame,
    df_2026: pd.DataFrame,
    player: str,
    metrics: list[str],
    sort_mode: str,   # "high" or "low"
) -> go.Figure:

    metric_order = [
        "Vertical start",
        "Vertical (m)",
        "Vertical Total",
        "Horizontal (m)",
        "0-10 split",
        "10-20 split",
        "20-30 split",
        "Total 30m",
        "Balsom (s)",
    ]   
    
    # Colours
    C_WHITE = "#FFFFFF"
    C_LIGHTBLUE = "skyblue"
    C_GREEN = "#00C853"
    C_RED = "#FF5252"
    C_BLACK = "#000000"

    row25 = df_2025[df_2025["Player"] == player]
    row26 = df_2026[df_2026["Player"] == player]

    has25 = not row25.empty
    has26 = not row26.empty

    # Build percentiles + averages (per metric)
    p25 = {}
    p26 = {}
    a25 = {}
    a26 = {}
    r25 = {}
    r26 = {}
    ra25 = {}
    ra26 = {}

    for m in metrics:
        col = f"{m}__pct"
        p25[m] = float(row25.iloc[0][col]) if (has25 and col in row25.columns) else np.nan
        p26[m] = float(row26.iloc[0][col]) if (has26 and col in row26.columns) else np.nan
        a25[m] = float(pd.to_numeric(df_2025[col], errors="coerce").mean()) if col in df_2025.columns else np.nan
        a26[m] = float(pd.to_numeric(df_2026[col], errors="coerce").mean()) if col in df_2026.columns else np.nan
        r25[m] = float(row25.iloc[0][m]) if (has25 and m in row25.columns) else np.nan
        r26[m] = float(row26.iloc[0][m]) if (has26 and m in row26.columns) else np.nan
        ra25[m] = float(pd.to_numeric(df_2025[m], errors="coerce").mean()) if m in df_2025.columns else np.nan
        ra26[m] = float(pd.to_numeric(df_2026[m], errors="coerce").mean()) if m in df_2026.columns else np.nan

    comp = pd.DataFrame({
        "Metric": metric_order,
        "P25": [p25.get(m, np.nan) for m in metric_order],
        "P26": [p26.get(m, np.nan) for m in metric_order],
        "A25": [a25.get(m, np.nan) for m in metric_order],
        "A26": [a26.get(m, np.nan) for m in metric_order],
        "R25": [r25.get(m, np.nan) for m in metric_order],
        "R26": [r26.get(m, np.nan) for m in metric_order],
        "RA25": [ra25.get(m, np.nan) for m in metric_order],
        "RA26": [ra26.get(m, np.nan) for m in metric_order],
    })

    # Conditional outline colour for 2026 vs 2025
    def outline_colour(row):
        if not has25 or not has26 or pd.isna(row["P25"]) or pd.isna(row["P26"]):
            return C_WHITE
        return C_GREEN if row["P26"] >= row["P25"] else C_RED

    comp["C26"] = comp.apply(outline_colour, axis=1)

    fig = go.Figure()

    # 2025 bars (left)
    if has25:
        fig.add_bar(
            name="2025",
            x=comp["Metric"],
            y=comp["P25"],
            marker=dict(
                color="#D9D9D9",
                line=dict(color="#D9D9D9", width=0)
            ),
            text=comp["P25"],
            texttemplate="%{text:.1f}",
            textposition="outside",
            textfont=dict(color=C_LIGHTBLUE),

            customdata=np.stack([comp["R25"], comp["RA25"]], axis=-1),

            hovertemplate=(
                "<b>%{x}</b><br>"
                "2025 Percentile: %{y:.1f}<br>"
                "2025 Raw: %{customdata[0]:.2f}<br>"
                "2025 Squad Avg: %{customdata[1]:.2f}"
                "<extra></extra>"
            ),
        )

        # Avg tick for 2025 (black line marker)
        fig.add_scatter(
            name="Avg 2025",
            x=comp["Metric"],
            y=comp["A25"],
            mode="markers",
            marker=dict(
                symbol="triangle-up",
                size=12,
                color=C_LIGHTPURPLE,
                line=dict(width=1, color=C_LIGHTPURPLE),
            ),
            hovertemplate="Avg 2025: %{y:.1f}<extra></extra>",
            showlegend=False,
        )

    # 2026 bars (right) with red/green outline
    if has26:
        fig.add_bar(
            name="2026",
            x=comp["Metric"],
            y=comp["P26"],
            marker=dict(
                color="#7EC8F2",
                line=dict(color="#7EC8F2", width=0)
            ),
            text=comp["P26"],
            texttemplate="%{text:.1f}",
            textposition="outside",
            textfont=dict(color=C_LIGHTBLUE),

            customdata=np.stack([comp["R26"], comp["RA26"]], axis=-1),

            hovertemplate=(
                "<b>%{x}</b><br>"
                "2026 Percentile: %{y:.1f}<br>"
                "2026 Raw: %{customdata[0]:.2f}<br>"
                "2026 Squad Avg: %{customdata[1]:.2f}"
                "<extra></extra>"
            ),
        )

        # Avg tick for 2026 (black line marker)
        fig.add_scatter(
            name="Avg 2026",
            x=comp["Metric"],
            y=comp["A26"],
            mode="markers",
            marker=dict(
                symbol="triangle-up",
                size=12,
                color=C_YELLOW,
                line=dict(width=1, color=C_YELLOW),
            ),
            hovertemplate="Avg 2026: %{y:.1f}<extra></extra>",
            showlegend=False,
        )

    fig.update_xaxes(
        categoryorder="array",
        categoryarray=metric_order,
        tickangle=-30,
        showgrid=False,
        color="white",
    )


    fig.update_layout(
        barmode="group",
        title=f"Player Percentile Comparison — {player}",
        xaxis_title="",
        yaxis_title="Percentile (0–100, higher = better)",
        yaxis=dict(range=[0, 105]),

        margin=dict(l=20, r=20, t=60, b=90),

        paper_bgcolor="#000000",
        plot_bgcolor="#000000",

        font=dict(
            family="Segoe UI",
            color="white"
        ),
        title_font=dict(
            family="Segoe UI Black",
            color="white",
            size=20
        ),
        legend=dict(
            font=dict(
                family="Segoe UI",
                color="white"
            )
        ),
        legend_title_text="",
    )

    fig.update_xaxes(tickangle=-30, showgrid=False, color="white")
    fig.update_yaxes(showgrid=True, gridcolor="rgba(255,255,255,0.08)", color="white")

    return fig


def generate_athletic_context(player: str, df_2026: pd.DataFrame, metrics: list[str]):

    row = df_2026[df_2026["Player"] == player]
    if row.empty:
        return html.Div("No data available.", style={"color": "white"})

    # Collect percentiles
    pct = {}
    for m in metrics:
        col = f"{m}__pct"
        if col in row.columns:
            pct[m] = float(row.iloc[0][col])
    
    # Sort metrics by percentile
    sorted_metrics = sorted(pct.items(), key=lambda x: x[1], reverse=True)

    strengths = [m for m, v in sorted_metrics if v >= 65][:2]
    risks = [m for m, v in sorted(pct.items(), key=lambda x: x[1]) if v <= 35][:2]

    # Football language mapping
    context_map = {
        "Vertical Total": "Set-piece threat and aerial first-contact defender.",
        "Vertical (m)": "Set-piece threat and aerial first-contact defender.",
        "Vertical start": "Reach profile helps in aerial duels.",
        "Horizontal (m)": "Explosive first step to create separation or close space.",
        "0-10 split": "Trust short acceleration in 1v1 close-downs and spins.",
        "10-20 split": "Can sustain speed after the first duel.",
        "20-30 split": "Reliable in longer recovery or chase runs.",
        "Total 30m": "Overall sprint capacity to defend space or threaten behind.",
        "Balsom (s)": "Strong change-of-direction for pressing and tight defending.",
    }

    strength_lines = [
        html.Li(f"{m}: {context_map.get(m, '')}") for m in strengths
    ] if strengths else [html.Li("Balanced profile — no standout strengths.")]

    risk_lines = [
        html.Li(f"{m}: Manage situations that expose this quality.") for m in risks
    ] if risks else [html.Li("No major physical exposure areas detected.")]

    return html.Div(
        [
            html.H3("Athletic Context — What You Can Trust", style={"color": "white"}),
            html.Ul(strength_lines, style={"color": "white"}),

            html.H3("Be Aware Of", style={"color": "white", "marginTop": "15px"}),
            html.Ul(risk_lines, style={"color": "white"}),
        ]
    )


# -------------------------
# CHARTS: prepare data
# -------------------------
metric_cols = get_metric_cols(testing_2026)

for c in metric_cols:
    testing_2025[c] = pd.to_numeric(testing_2025[c], errors="coerce")
    testing_2026[c] = pd.to_numeric(testing_2026[c], errors="coerce")

if "Position" not in testing_2025.columns:
    testing_2025["Position"] = "Unknown"
if "Position" not in testing_2026.columns:
    testing_2026["Position"] = "Unknown"

testing_2025 = add_percentiles(testing_2025, metric_cols)
testing_2026 = add_percentiles(testing_2026, metric_cols)

# -------------------------
# CHARTS: layout block (define this ABOVE app.layout)
# -------------------------
all_players = sorted(set(testing_2025["Player"]).union(set(testing_2026["Player"])))
default_player = all_players[0] if all_players else None
default_metric = metric_cols[0] if metric_cols else None

charts_block = html.Div(
    [
        html.H2(
            "Testing Charts (2025 vs 2026)",
            style={"textAlign": "center", "color": "white", "fontFamily": "Arial Black"},
        ),

        dcc.Store(id="sort_2026", data="high"),
        dcc.Store(id="sort_2025", data="high"),
        dcc.Store(id="sort_player", data="high"),

        # Global controls (affect 2025 + 2026 charts)
        html.Div(
            [
                # Metric
                html.Div(
                    [
                        html.Label("Metric", style={"color": "white", "fontFamily": "Segoe UI Black"}),
                        dcc.Dropdown(
                            id="metric_dd",
                            options=[{"label": m, "value": m} for m in metric_cols],
                            value=default_metric,
                            clearable=False,
                            style={
                                "width": "260px",
                                "fontFamily": "Segoe UI Black",
                            },
                        ),
                    ],
                    style={"display": "flex", "flexDirection": "column"},
                ),

                # Mode
                html.Div(
                    [
                        html.Label("Mode", style={"color": "white", "fontFamily": "Segoe UI Black"}),
                        dcc.RadioItems(
                            id="mode_toggle",
                            options=[
                                {"label": "Raw", "value": "raw"},
                                {"label": "Percentile", "value": "pct"},
                            ],
                            value="raw",
                            inline=True,
                            style={"color": "white", "fontFamily": "Segoe UI Black"},
                        ),
                    ],
                    style={"display": "flex", "flexDirection": "column"},
                ),

                # Sort Buttons (2026)
                html.Div(
                    [
                        html.Button("2026 High to Low", id="btn_26_high", style=button_style),
                        html.Button("2026 Low to High", id="btn_26_low", style=button_style),
                    ],
                    style={"display": "flex", "gap": "10px", "alignItems": "flex-end"},
                ),
            ],
            style={
                "display": "flex",
                "justifyContent": "center",
                "alignItems": "flex-end",
                "gap": "40px",
                "marginBottom": "20px",
                "flexWrap": "wrap",
            },
        ),
        
        html.Div([dcc.Graph(id="chart_2026")], style=CARD_STYLE),

        
        # -------- 2025 chart controls --------
        html.Div(
            [
                html.Button("2025 High to Low", id="btn_25_high", n_clicks=0, style=BTN_STYLE),
                html.Button("2025 Low to High", id="btn_25_low", n_clicks=0, style=BTN_STYLE),
            ],
            #style={"textAlign": "left", "marginBottom": "10px", "marginTop": "10px"},
            style={
                "textAlign": "left",
                "marginLeft": "650px",
                "marginBottom": "10px",
                "marginTop": "10px",
            }
        ),
        html.Div([dcc.Graph(id="chart_2025")], style=CARD_STYLE),
       

        # -------- player comparison controls --------
        html.Div(
            [
                # Left spacer (pushes dropdown toward centre)
                html.Div(style={"flex": "1"}),

                # Dropdown (middle)
                html.Div(
                    [
                        html.Label(
                            "Player (comparison)",
                            style={"color": "white", "fontFamily": "Segoe UI Black"},
                        ),
                        dcc.Dropdown(
                            id="player_dd",
                            options=[{"label": p, "value": p} for p in all_players],
                            value=default_player,
                            clearable=False,
                            style={
                                "width": "280px",
                                "fontFamily": "Segoe UI Black",
                            },
                        ),
                    ],
                    style={"display": "flex", "flexDirection": "column", "alignItems": "center"},
                ),

                # Buttons (right side)
                html.Div(
                    [
                        html.Button("Player High to Low", id="btn_p_high", n_clicks=0, style=button_style),
                        html.Button("Player Low to High", id="btn_p_low", n_clicks=0, style=button_style),
                    ],
                    style={
                        "display": "flex",
                        "gap": "10px",
                        "alignItems": "flex-end",
                        "marginLeft": "40px",
                    },
                ),
            ],
            style={
                "display": "flex",
                "alignItems": "flex-end",
                "justifyContent": "flex-start",   # <-- change this
                "gap": "10px",
                "padding": "10px 40px",          # add left padding to control offset
            },
        ),
        html.Div([dcc.Graph(id="chart_player_comp")], style=CARD_STYLE),

        # -------- atheltic context and insights --------
        html.Div(id="athletic-context-panel", style=CARD_STYLE),

        # -------- player sprint chart profile --------

        html.Div([dcc.Graph(id="chart_sprint_profile")], style=CARD_STYLE),

        # -------- sprint head-to-head --------
        html.Div(
            [
                html.H2(
                    "Sprint Head-to-Head",
                    style={"textAlign": "center", "color": "white", "fontFamily": "Segoe UI Black"},
                ),

                html.Div(
                    [
                        html.Div(
                            [
                                html.Label("Player 1", style={"color": "white", "fontFamily": "Segoe UI Black"}),
                                dcc.Dropdown(
                                    id="h2h_player_1",
                                    options=[{"label": p, "value": p} for p in all_players],
                                    value=default_player,
                                    clearable=False,
                                    style={"width": "220px", "fontFamily": "Segoe UI Black"},
                                ),
                            ],
                            style={"display": "flex", "flexDirection": "column"},
                        ),

                        html.Div(
                            [
                                html.Label("Year 1", style={"color": "white", "fontFamily": "Segoe UI Black"}),
                                dcc.Dropdown(
                                    id="h2h_year_1",
                                    options=[
                                        {"label": "2025", "value": "2025"},
                                        {"label": "2026", "value": "2026"},
                                    ],
                                    value="2026",
                                    clearable=False,
                                    style={"width": "120px", "fontFamily": "Segoe UI Black"},
                                ),
                            ],
                            style={"display": "flex", "flexDirection": "column"},
                        ),

                        html.Div(
                            [
                                html.Label("Player 2", style={"color": "white", "fontFamily": "Segoe UI Black"}),
                                dcc.Dropdown(
                                    id="h2h_player_2",
                                    options=[{"label": p, "value": p} for p in all_players],
                                    value=all_players[1] if len(all_players) > 1 else default_player,
                                    clearable=False,
                                    style={"width": "220px", "fontFamily": "Segoe UI Black"},
                                ),
                            ],
                            style={"display": "flex", "flexDirection": "column"},
                        ),

                        html.Div(
                            [
                                html.Label("Year 2", style={"color": "white", "fontFamily": "Segoe UI Black"}),
                                dcc.Dropdown(
                                    id="h2h_year_2",
                                    options=[
                                        {"label": "2025", "value": "2025"},
                                        {"label": "2026", "value": "2026"},
                                    ],
                                    value="2026",
                                    clearable=False,
                                    style={"width": "120px", "fontFamily": "Segoe UI Black"},
                                ),
                            ],
                            style={"display": "flex", "flexDirection": "column"},
                        ),
                    ],
                    style={
                        "display": "flex",
                        "justifyContent": "center",
                        "alignItems": "flex-end",
                        "gap": "20px",
                        "flexWrap": "wrap",
                        "marginBottom": "15px",
                    },
                ),

                html.Div([dcc.Graph(id="chart_sprint_h2h")], style=CARD_STYLE),
            ],
            #style=SECTION_WRAP_STYLE,
        ),

        html.Hr(style={"borderColor": "white"}),

        # -------- player spotlight --------
        html.Div(
            [
                html.H2(
                    "Individual Player Feedback",
                    style={"textAlign": "center", "color": "white", "fontFamily": "Segoe UI Black"},
                ),

                html.Div(
                    [
                        html.Div(
                            [
                                html.Label("Year", style={"color": "white", "fontFamily": "Segoe UI Black"}),
                                dcc.Dropdown(
                                    id="spotlight_year",
                                    options=[
                                        {"label": "2025", "value": "2025"},
                                        {"label": "2026", "value": "2026"},
                                    ],
                                    value="2026",
                                    clearable=False,
                                    style={"width": "120px", "fontFamily": "Segoe UI Black"},
                                ),
                            ],
                            style={"display": "flex", "flexDirection": "column"},
                        ),

                        html.Div(
                            [
                                html.Label("Metric", style={"color": "white", "fontFamily": "Segoe UI Black"}),
                                dcc.Dropdown(
                                    id="spotlight_metric",
                                    options=[{"label": m, "value": m} for m in metric_cols],
                                    value=default_metric,
                                    clearable=False,
                                    style={"width": "240px", "fontFamily": "Segoe UI Black"},
                                ),
                            ],
                            style={"display": "flex", "flexDirection": "column"},
                        ),

                        html.Div(
                            [
                                html.Label("Player", style={"color": "white", "fontFamily": "Segoe UI Black"}),
                                dcc.Dropdown(
                                    id="spotlight_player",
                                    options=[{"label": p, "value": p} for p in all_players],
                                    value=default_player,
                                    clearable=False,
                                    style={"width": "240px", "fontFamily": "Segoe UI Black"},
                                ),
                            ],
                            style={"display": "flex", "flexDirection": "column"},
                        ),
                    ],
                    style={
                        "display": "flex",
                        "justifyContent": "center",
                        "alignItems": "flex-end",
                        "gap": "20px",
                        "flexWrap": "wrap",
                        "marginBottom": "15px",
                    },
                ),

                html.Div([dcc.Graph(id="chart_player_spotlight")], style=CARD_STYLE),
            ],
            style={"marginTop": "20px"},
        ),


        html.Hr(style={"borderColor": "white"}),
    ],
    style=SECTION_WRAP_STYLE,
)

# -------------------------
# APP LAYOUT (keep only components inside the list)
# -------------------------
app.layout = html.Div(
    [
        html.Img(src="/assets/clublogo.png", style={"height": "100px", "float": "right", "marginTop": "10px", "marginRight": "40px",}),
        html.H1(
            "NPLW - Athletic Testing Dashboard",
            style={"textAlign": "center", "color": "#FFFFFF", "fontFamily": "Segoe UI Black"},
        ),
        html.Br(),
        html.Br(),

        charts_block,

        # OLD APP CONTINUES BELOW (reports/exports etc)
        # html.Div([...]),
    ]
, style=PAGE_STYLE)

# -------------------------
# CALLBACKS (define BELOW app.layout)
# -------------------------

# 1) Update the charts (now includes sort stores as Inputs)
@app.callback(
    Output("chart_2026", "figure"),
    Output("chart_2025", "figure"),    
    Output("chart_player_comp", "figure"),
    Output("chart_sprint_profile", "figure"),
    Output("athletic-context-panel", "children"),
    Output("chart_sprint_h2h", "figure"),
    Output("chart_player_spotlight", "figure"),
    Input("metric_dd", "value"),
    Input("mode_toggle", "value"),
    Input("player_dd", "value"),
    Input("sort_2026", "data"),
    Input("sort_2025", "data"),
    Input("sort_player", "data"),
    Input("h2h_player_1", "value"),
    Input("h2h_year_1", "value"),
    Input("h2h_player_2", "value"),
    Input("h2h_year_2", "value"),
    Input("spotlight_year", "value"),
    Input("spotlight_metric", "value"),
    Input("spotlight_player", "value"),
)
def update_charts(
    metric, mode, player, sort_26, sort_25, sort_p,
    h2h_p1, h2h_y1, h2h_p2, h2h_y2,
    spotlight_year, spotlight_metric, spotlight_player
):

    fig26 = bar_metric_chart(testing_2026, metric, mode, "2026", sort_26) if metric else go.Figure()
    fig25 = bar_metric_chart(testing_2025, metric, mode, "2025", sort_25) if metric else go.Figure()
    figp = player_comparison_chart(testing_2025, testing_2026, player, metric_cols, sort_p) if player else go.Figure()
    fig_profile = sprint_profile_chart(testing_2026, "2026")
    context = generate_athletic_context(player, testing_2026, metric_cols)

    fig_h2h = sprint_head_to_head_chart(
        h2h_p1, h2h_y1, h2h_p2, h2h_y2,
        testing_2025, testing_2026
    )

    fig_spotlight = player_spotlight_chart(
        testing_2025, testing_2026,
        spotlight_year, spotlight_metric, spotlight_player
    )

    return fig26, fig25, figp, fig_profile, context, fig_h2h, fig_spotlight


# 2) Set sort modes (your existing callback is fine)
@app.callback(
    Output("sort_2026", "data"),
    Output("sort_2025", "data"),
    Output("sort_player", "data"),
    Input("btn_26_high", "n_clicks"),
    Input("btn_26_low", "n_clicks"),
    Input("btn_25_high", "n_clicks"),
    Input("btn_25_low", "n_clicks"),
    Input("btn_p_high", "n_clicks"),
    Input("btn_p_low", "n_clicks"),
    State("sort_2026", "data"),
    State("sort_2025", "data"),
    State("sort_player", "data"),
)
def set_sort_modes(n26h, n26l, n25h, n25l, nph, npl, s26, s25, sp):
    trig = ctx.triggered_id
    if trig == "btn_26_high":
        s26 = "high"
    elif trig == "btn_26_low":
        s26 = "low"
    elif trig == "btn_25_high":
        s25 = "high"
    elif trig == "btn_25_low":
        s25 = "low"
    elif trig == "btn_p_high":
        sp = "high"
    elif trig == "btn_p_low":
        sp = "low"
    return s26, s25, sp


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 8050)),
        debug=False,
    )