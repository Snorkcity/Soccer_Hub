import dash
from dash import dcc, html, Input, Output, State, callback
import dash_bootstrap_components as dbc
import pandas as pd
from dash import dash_table
from dash import ctx
from dash import Dash
import plotly.express as px
import gspread
import plotly.graph_objects as go
from oauth2client.service_account import ServiceAccountCredentials
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from datetime import datetime
from io import BytesIO
from plotly.io import to_image
import os
import numpy as np
import json
from dotenv import load_dotenv


# ============================
# APP SETUP
# ============================

app = dash.Dash(__name__, suppress_callback_exceptions=True, external_stylesheets=[dbc.themes.CYBORG])
server = app.server

APP_VERSION = "2026_v1.17"

load_dotenv()

# Google Sheets API scope
scope = [
    "https://spreadsheets.google.com/feeds",
    "https://www.googleapis.com/auth/drive"
]

# Choose credentials source
if os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON"):
    creds_dict = json.loads(os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"])
    creds = ServiceAccountCredentials.from_json_keyfile_dict(creds_dict, scope)
elif os.path.exists("service_account.json"):
    creds = ServiceAccountCredentials.from_json_keyfile_name("service_account.json", scope)
else:
    raise EnvironmentError("No credentials found. Set GOOGLE_SERVICE_ACCOUNT_JSON or add service_account.json.")

# Authorize client
client = gspread.authorize(creds)


# ============================
# APP CONFIG
# ============================

APP_TITLE = "Belco NPLW - GPS Insights Dashboard"
PANEL_BG = "#0F2C44"
ACCENT = "skyblue"
SPREADSHEET_NAME = "2026_GPS-stats"
WORKSHEET_NAME = "individual stats"


# ============================
# APP SETUP
# ============================

app = dash.Dash(__name__, suppress_callback_exceptions=True, external_stylesheets=[dbc.themes.CYBORG])
server = app.server

APP_VERSION = "2026_v1.03"

load_dotenv()

# Google Sheets API scope
scope = [
    "https://spreadsheets.google.com/feeds",
    "https://www.googleapis.com/auth/drive"
]

# Choose credentials source
if os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON"):
    creds_dict = json.loads(os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"])
    creds = ServiceAccountCredentials.from_json_keyfile_dict(creds_dict, scope)
elif os.path.exists("service_account.json"):
    creds = ServiceAccountCredentials.from_json_keyfile_name("service_account.json", scope)
else:
    raise EnvironmentError("No credentials found. Set GOOGLE_SERVICE_ACCOUNT_JSON or add service_account.json.")

# Authorize client
client = gspread.authorize(creds)


# ============================
# APP CONFIG
# ============================

APP_TITLE = "Belco NPLW - GPS Insights Dashboard"
PANEL_BG = "#0F2C44"
ACCENT = "skyblue"
SPREADSHEET_NAME = "2026_GPS-stats"

YEAR_SHEET_MAP = {
    "2026": "individual stats",
    "2025": "stats 2025",
    "2024": "stats 2024",
}

DEFAULT_YEAR = "2026"


# ============================
# DATA LOAD
# ============================

def load_gps_data(year=DEFAULT_YEAR):
    ss = client.open(SPREADSHEET_NAME)
    ws = ss.worksheet(YEAR_SHEET_MAP[year])

    df = pd.DataFrame(ws.get_all_records())

    # ---------- tidy headers ----------
    df.columns = [c.strip() for c in df.columns]

    # ---------- common cleaning ----------
    if "Player Name" in df.columns:
        df["Player Name"] = df["Player Name"].astype(str).str.strip()

    if "Match ID" in df.columns:
        df["Match ID"] = df["Match ID"].astype(str).str.strip()

    if "Team" in df.columns:
        df["Team"] = df["Team"].astype(str).str.strip()

    df["Year"] = year

    return df


def load_all_gps_data():
    frames = []

    for year in YEAR_SHEET_MAP:
        try:
            frames.append(load_gps_data(year))
        except Exception as e:
            print(f"Could not load {year}: {e}")

    if frames:
        return pd.concat(frames, ignore_index=True)

    return pd.DataFrame()


df = load_all_gps_data()

if not df.empty:
    print("Loaded years:", sorted(df["Year"].dropna().unique()))
    print("Loaded players:", sorted(df["Player Name"].dropna().unique()))
    print("Row count:", len(df))
else:
    print("No GPS data loaded.")


# =================================================
# I THINK THIS WILL BE HELPER CODE AND STYLING AREA
# =================================================

SECTION_CARD_STYLE = {
    "backgroundColor": PANEL_BG,
    "padding": "20px",
    "border": "1px solid white",
    "borderRadius": "10px",
    "marginBottom": "20px",
}

BUTTON_ROW_STYLE = {
    "textAlign": "left",
    "padding": "10px",
    "paddingLeft": "40px",
}

# ---------- FONT / STYLE TOKENS ----------


BASE_FONT = "Segoe UI"
HEADER_FONT = "Segoe UI Black"

base_font = {
    "fontFamily": BASE_FONT,
    "fontSize": "14px"
}

title_font = {
    "fontFamily": HEADER_FONT,
    "fontSize": "18px"
}

button_style = {
    "backgroundColor": "#0D0D0E",
    "color": "white",
    "border": "1px solid #004F44",
    "padding": "8px 14px",
    "marginRight": "10px",
    "borderRadius": "6px",
    "fontWeight": "bold",
    "fontFamily": "Segoe UI",
    "fontSize": "13px",
    "cursor": "pointer",
    "boxShadow": "0px 2px 4px rgba(0,0,0,0.4)",
    "textAlign": "center",
}

TAB_PANEL_STYLE = {
    "backgroundColor": PANEL_BG,
    "padding": "15px",
    "border": "1px solid white",
    "borderRadius": "10px",
    "marginBottom": "20px",
}

PLACEHOLDER_INNER_STYLE = {
    "backgroundColor": "black",
    "borderRadius": "8px",
    "minHeight": "220px",
    "display": "flex",
    "alignItems": "center",
    "justifyContent": "center",
    "color": "white",
    "fontFamily": base_font["fontFamily"],
    "fontSize": "16px",
}

# ================================
# STYLING FOR CHART TITLE

def chart_header(title_text):
    return html.Div(
        [
            html.H3(
                title_text,
                style={
                    "color": "white",
                    "fontFamily": HEADER_FONT,
                    "fontSize": "18px",
                    "marginBottom": "10px",
                },
            ),
            html.Hr(
                style={
                    "borderColor": "#2c2c2c",
                    "marginTop": "0px",
                    "marginBottom": "10px",
                }
            ),
        ]
    )


# =========================================
# PLAYER GPS ---- HELPER FOR TOTAL DISTANCE

def create_player_total_distance_chart(df_filtered, selected_player, sort_order):
    df_1st_half = df_filtered[df_filtered["Split Name"] == "1st.half"][
        ["Round", "Date", "Distance (km)", "Mins played"]
    ].copy()

    df_2nd_half = df_filtered[df_filtered["Split Name"] == "2nd.half"][
        ["Round", "Date", "Distance (km)", "Mins played"]
    ].copy()

    df_game = df_filtered[df_filtered["Split Name"] == "game"][
        ["Round", "Date", "Mins played"]
    ].copy()

    df_1st_half = df_1st_half.rename(columns={
        "Distance (km)": "Distance (km) 1st Half",
        "Mins played": "Mins played 1st Half"
    })

    df_2nd_half = df_2nd_half.rename(columns={
        "Distance (km)": "Distance (km) 2nd Half",
        "Mins played": "Mins played 2nd Half"
    })

    df_game = df_game.rename(columns={"Mins played": "Mins played Game"})

    df_distance = pd.merge(df_1st_half, df_2nd_half, on=["Round", "Date"], how="outer")
    df_distance = pd.merge(df_distance, df_game, on=["Round", "Date"], how="left")

    df_distance["Date"] = pd.to_datetime(df_distance["Date"], errors="coerce", dayfirst=True)

    numeric_cols = [
        "Distance (km) 1st Half",
        "Distance (km) 2nd Half",
        "Mins played 1st Half",
        "Mins played 2nd Half",
        "Mins played Game",
    ]
    for col in numeric_cols:
        df_distance[col] = pd.to_numeric(df_distance[col], errors="coerce").fillna(0)

    df_distance["Total Distance"] = (
        df_distance["Distance (km) 1st Half"] + df_distance["Distance (km) 2nd Half"]
    )

    df_distance["Avg 1st Half (m/min)"] = (
        (df_distance["Distance (km) 1st Half"] * 1000)
        / df_distance["Mins played 1st Half"].replace(0, pd.NA)
    ).fillna(0)

    df_distance["Avg 2nd Half (m/min)"] = (
        (df_distance["Distance (km) 2nd Half"] * 1000)
        / df_distance["Mins played 2nd Half"].replace(0, pd.NA)
    ).fillna(0)

    df_distance["Total Avg per min (m/min)"] = (
        (df_distance["Total Distance"] * 1000)
        / df_distance["Mins played Game"].replace(0, pd.NA)
    ).fillna(0)

    if sort_order == "value":
        df_distance = df_distance.sort_values("Total Distance", ascending=True)
    elif sort_order == "form":
        df_distance = (
            df_distance.sort_values(by="Date", ascending=False)
            .drop_duplicates(subset=["Round"])
            .head(5)
            .sort_values(by="Date", ascending=True)
        )
    else:
        df_distance = df_distance.sort_values(by="Date", ascending=True)

    hover_text = [
        f"1st Half: {first_half:.2f} km ({avg1:.1f} m/min)<br>"
        f"2nd Half: {second_half:.2f} km ({avg2:.1f} m/min)<br>"
        f"Total: {total:.2f} km<br>"
        f"1st Half Minutes: {mins1:.0f}<br>"
        f"2nd Half Minutes: {mins2:.0f}<br>"
        f"Total Minutes: {mins_total:.0f}<br>"
        f"Total Avg: {avg_total:.1f} m/min"
        for first_half, second_half, total, avg1, avg2, mins1, mins2, mins_total, avg_total in zip(
            df_distance["Distance (km) 1st Half"],
            df_distance["Distance (km) 2nd Half"],
            df_distance["Total Distance"],
            df_distance["Avg 1st Half (m/min)"],
            df_distance["Avg 2nd Half (m/min)"],
            df_distance["Mins played 1st Half"],
            df_distance["Mins played 2nd Half"],
            df_distance["Mins played Game"],
            df_distance["Total Avg per min (m/min)"],
        )
    ]

    fig = go.Figure(
        data=[
            go.Bar(
                name="1st Half",
                x=df_distance["Round"],
                y=df_distance["Distance (km) 1st Half"],
                marker_color="#87CEEB",
                hoverinfo="text",
                hovertext=hover_text,
            ),
            go.Bar(
                name="2nd Half",
                x=df_distance["Round"],
                y=df_distance["Distance (km) 2nd Half"],
                marker_color="#000080",
                hoverinfo="text",
                hovertext=hover_text,
            ),
        ]
    )

    fig.update_layout(
        barmode="stack",
        title={
            "text": f"Total Distance - {selected_player}",
            "y": 0.95,
            "x": 0.5,
            "xanchor": "center",
            "yanchor": "top",
            "font": {"size": 20, "family": BASE_FONT, "color": "white"},
        },
        xaxis_title="Round",
        yaxis_title="Distance (km)",
        xaxis=dict(
            showline=True,
            showgrid=False,
            showticklabels=True,
            linecolor="white",
            linewidth=2,
            ticks="outside",
            tickfont=dict(family=BASE_FONT, size=14, color="white"),
            categoryorder="array",
            categoryarray=df_distance["Round"].tolist(),
        ),
        yaxis=dict(
            showline=True,
            showgrid=False,
            zeroline=False,
            linecolor="white",
            linewidth=2,
            tickfont=dict(family=BASE_FONT, size=14, color="white"),
        ),
        plot_bgcolor="black",
        paper_bgcolor="black",
        legend=dict(
            x=0.8,
            y=1.1,
            bgcolor="rgba(0,0,0,0)",
            bordercolor="rgba(0,0,0,0)",
            font=dict(family=BASE_FONT, size=14, color="white"),
        ),
        font=dict(color="white", size=14, family=BASE_FONT),
        hoverlabel=dict(font=dict(family=BASE_FONT)),
        margin=dict(l=20, r=20, t=60, b=20),
    )

    return fig

# ================================
# PLAYER GPS ---- HELPER FOR HIGH SPEED METRES CHART

def create_sprint_distance_chart(df_filtered, selected_player, sort_order):
    df_1st_half = df_filtered[df_filtered["Split Name"] == "1st.half"][
        ["Round", "Date", "Sprint Distance (m)", "Mins played"]
    ].copy()

    df_2nd_half = df_filtered[df_filtered["Split Name"] == "2nd.half"][
        ["Round", "Date", "Sprint Distance (m)", "Mins played"]
    ].copy()

    df_game = df_filtered[df_filtered["Split Name"] == "game"][
        ["Round", "Date", "Mins played"]
    ].copy()

    df_1st_half = df_1st_half.rename(columns={
        "Sprint Distance (m)": "Sprint Distance (m) 1st Half",
        "Mins played": "Mins played 1st Half"
    })

    df_2nd_half = df_2nd_half.rename(columns={
        "Sprint Distance (m)": "Sprint Distance (m) 2nd Half",
        "Mins played": "Mins played 2nd Half"
    })

    df_sprint = pd.merge(df_1st_half, df_2nd_half, on=["Round", "Date"], how="outer")
    df_sprint = pd.merge(df_sprint, df_game, on=["Round", "Date"], how="left")
    df_sprint = df_sprint.rename(columns={"Mins played": "Total Mins played"})

    numeric_cols = [
        "Sprint Distance (m) 1st Half",
        "Sprint Distance (m) 2nd Half",
        "Mins played 1st Half",
        "Mins played 2nd Half",
        "Total Mins played",
    ]

    for col in numeric_cols:
        df_sprint[col] = pd.to_numeric(df_sprint[col], errors="coerce")

    df_sprint["Total Sprint Distance"] = (
        df_sprint["Sprint Distance (m) 1st Half"].fillna(0)
        + df_sprint["Sprint Distance (m) 2nd Half"].fillna(0)
    )

    df_sprint["Avg per min 1st Half"] = (
        df_sprint["Sprint Distance (m) 1st Half"] /
        df_sprint["Mins played 1st Half"].replace(0, np.nan)
    ).fillna(0)

    df_sprint["Avg per min 2nd Half"] = (
        df_sprint["Sprint Distance (m) 2nd Half"] /
        df_sprint["Mins played 2nd Half"].replace(0, np.nan)
    ).fillna(0)

    df_sprint["Total Avg per min"] = (
        df_sprint["Total Sprint Distance"] /
        df_sprint["Total Mins played"].replace(0, np.nan)
    ).fillna(0)

    df_sprint["Date"] = pd.to_datetime(df_sprint["Date"], errors="coerce", dayfirst=True)

    if sort_order == "value":
        df_sprint = df_sprint.sort_values("Total Sprint Distance", ascending=True)
    elif sort_order == "form":
        df_sprint = (
            df_sprint.sort_values(by="Date", ascending=False)
            .drop_duplicates(subset=["Round"])
            .head(5)
            .sort_values(by="Date", ascending=True)
        )
    else:
        df_sprint = df_sprint.sort_values(by="Date", ascending=True)

    fig = go.Figure()

    fig.add_trace(
        go.Bar(
            name="1st Half",
            x=df_sprint["Round"],
            y=df_sprint["Sprint Distance (m) 1st Half"],
            marker_color="#87CEEB",
            hovertext=[
                f"1st Half High Speed Metres: {int(float(val) or 0)} m<br>"
                f"1st Half Minutes: {int(float(mins) or 0)} min<br>"
                f"Avg per min: {float(avg):.1f} m/min<br>"
                f"Total High Speed Metres: {int(float(total) or 0)} m"
                for val, mins, avg, total in zip(
                    df_sprint["Sprint Distance (m) 1st Half"].fillna(0),
                    df_sprint["Mins played 1st Half"].fillna(0),
                    df_sprint["Avg per min 1st Half"].fillna(0),
                    df_sprint["Total Sprint Distance"].fillna(0),
                )
            ],
            hoverinfo="text",
        )
    )

    fig.add_trace(
        go.Bar(
            name="2nd Half",
            x=df_sprint["Round"],
            y=df_sprint["Sprint Distance (m) 2nd Half"],
            marker_color="#000080",
            hovertext=[
                f"2nd Half High Speed Metres: {int(float(val) or 0)} m<br>"
                f"2nd Half Minutes: {int(float(mins) or 0)} min<br>"
                f"2nd Half Avg per min: {float(avg):.1f} m/min<br>"
                f"Total High Speed Metres: {int(float(total) or 0)} m<br>"
                f"Total Minutes Played: {int(float(total_mins) or 0)} min<br>"
                f"Total Avg per min: {float(total_avg):.1f} m/min"
                for val, mins, avg, total, total_mins, total_avg in zip(
                    df_sprint["Sprint Distance (m) 2nd Half"].fillna(0),
                    df_sprint["Mins played 2nd Half"].fillna(0),
                    df_sprint["Avg per min 2nd Half"].fillna(0),
                    df_sprint["Total Sprint Distance"].fillna(0),
                    df_sprint["Total Mins played"].fillna(0),
                    df_sprint["Total Avg per min"].fillna(0),
                )
            ],
            hoverinfo="text",
        )
    )

    fig.update_layout(
        barmode="stack",
        title={
            "text": f"High Speed Metres - 1st Half vs 2nd Half - {selected_player}",
            "y": 0.95,
            "x": 0.5,
            "xanchor": "center",
            "yanchor": "top",
            "font": {"size": 20, "family": BASE_FONT, "color": "white"},
        },
        xaxis_title="Round",
        yaxis_title="High Speed Metres",
        xaxis=dict(
            showline=True,
            showgrid=False,
            showticklabels=True,
            linecolor="white",
            linewidth=2,
            ticks="outside",
            tickfont=dict(family=BASE_FONT, size=14, color="white"),
        ),
        yaxis=dict(
            showgrid=False,
            zeroline=False,
            showline=True,
            linewidth=2,
            linecolor="white",
            tickfont=dict(family=BASE_FONT, size=14, color="white"),
        ),
        plot_bgcolor="black",
        paper_bgcolor="black",
        legend=dict(
            x=0.8,
            y=1.1,
            bgcolor="rgba(0, 0, 0, 0)",
            bordercolor="rgba(0, 0, 0, 0)",
            font=dict(family=BASE_FONT, size=14, color="white"),
        ),
        margin=dict(l=20, r=20, t=60, b=20),
        font=dict(family=BASE_FONT, color="white"),
        hoverlabel=dict(font=dict(family=BASE_FONT)),
    )

    return fig


# ================================
# PLAYER GPS ---- HELPER FOR VERY-HIGH SPEED METRES CHART

def create_player_vhs_chart(df_filtered, selected_player, sort_order):
    df_1st_half = df_filtered[df_filtered["Split Name"] == "1st.half"][
        ["Round", "Date", "Distance in Speed Zone 5 (km)", "Mins played"]
    ].copy()

    df_2nd_half = df_filtered[df_filtered["Split Name"] == "2nd.half"][
        ["Round", "Date", "Distance in Speed Zone 5 (km)", "Mins played"]
    ].copy()

    df_game = df_filtered[df_filtered["Split Name"] == "game"][
        ["Round", "Date", "Mins played"]
    ].copy()

    # Rename
    df_1st_half = df_1st_half.rename(columns={
        "Distance in Speed Zone 5 (km)": "VHS 1st Half (km)",
        "Mins played": "Mins 1st Half"
    })

    df_2nd_half = df_2nd_half.rename(columns={
        "Distance in Speed Zone 5 (km)": "VHS 2nd Half (km)",
        "Mins played": "Mins 2nd Half"
    })

    df_game = df_game.rename(columns={"Mins played": "Mins Game"})

    # Merge
    df_vhs = pd.merge(df_1st_half, df_2nd_half, on=["Round", "Date"], how="outer")
    df_vhs = pd.merge(df_vhs, df_game, on=["Round", "Date"], how="left")

    df_vhs["Date"] = pd.to_datetime(df_vhs["Date"], errors="coerce", dayfirst=True)

    # Convert + fill
    for col in [
        "VHS 1st Half (km)", "VHS 2nd Half (km)",
        "Mins 1st Half", "Mins 2nd Half", "Mins Game"
    ]:
        df_vhs[col] = pd.to_numeric(df_vhs[col], errors="coerce").fillna(0)

    # Convert to metres
    df_vhs["VHS 1st Half (m)"] = df_vhs["VHS 1st Half (km)"] * 1000
    df_vhs["VHS 2nd Half (m)"] = df_vhs["VHS 2nd Half (km)"] * 1000

    df_vhs["Total VHS (m)"] = df_vhs["VHS 1st Half (m)"] + df_vhs["VHS 2nd Half (m)"]

    # Per min
    df_vhs["Avg 1st Half (m/min)"] = (
        df_vhs["VHS 1st Half (m)"] / df_vhs["Mins 1st Half"].replace(0, pd.NA)
    ).fillna(0)

    df_vhs["Avg 2nd Half (m/min)"] = (
        df_vhs["VHS 2nd Half (m)"] / df_vhs["Mins 2nd Half"].replace(0, pd.NA)
    ).fillna(0)

    df_vhs["Total Avg (m/min)"] = (
        df_vhs["Total VHS (m)"] / df_vhs["Mins Game"].replace(0, pd.NA)
    ).fillna(0)

    # Sorting
    if sort_order == "value":
        df_vhs = df_vhs.sort_values("Total VHS (m)", ascending=True)
    elif sort_order == "form":
        df_vhs = (
            df_vhs.sort_values(by="Date", ascending=False)
            .drop_duplicates(subset=["Round"])
            .head(5)
            .sort_values(by="Date", ascending=True)
        )
    else:
        df_vhs = df_vhs.sort_values(by="Date", ascending=True)

    # Hover
    hover_text = [
        f"1st Half: {v1:.0f} m ({a1:.1f} m/min)<br>"
        f"2nd Half: {v2:.0f} m ({a2:.1f} m/min)<br>"
        f"Total: {total:.0f} m<br>"
        f"Minutes: {mins:.0f}<br>"
        f"Avg: {avg:.1f} m/min"
        for v1, v2, total, a1, a2, mins, avg in zip(
            df_vhs["VHS 1st Half (m)"],
            df_vhs["VHS 2nd Half (m)"],
            df_vhs["Total VHS (m)"],
            df_vhs["Avg 1st Half (m/min)"],
            df_vhs["Avg 2nd Half (m/min)"],
            df_vhs["Mins Game"],
            df_vhs["Total Avg (m/min)"],
        )
    ]

    fig = go.Figure(
        data=[
            go.Bar(
                name="1st Half",
                x=df_vhs["Round"],
                y=df_vhs["VHS 1st Half (m)"],
                marker_color="#87CEEB",
                hovertext=hover_text,
                hoverinfo="text",
            ),
            go.Bar(
                name="2nd Half",
                x=df_vhs["Round"],
                y=df_vhs["VHS 2nd Half (m)"],
                marker_color="#000080",
                hovertext=hover_text,
                hoverinfo="text",
            ),
        ]
    )

    fig.update_layout(
        barmode="stack",
        title={
            "text": f"Very High Speed Metres (>25 km/h) - {selected_player}",
            "x": 0.5,
            "y": 0.95,
            "xanchor": "center",
            "font": {"family": BASE_FONT, "size": 20, "color": "white"},
        },
        xaxis_title="Round",
        yaxis_title="Metres",
        plot_bgcolor="black",
        paper_bgcolor="black",
        font=dict(family=BASE_FONT, color="white"),
        xaxis=dict(showgrid=False),
        yaxis=dict(showgrid=False),
        margin=dict(l=20, r=20, t=60, b=20),
    )

    return fig

#=========================
# PLAYER GPS ---- HELPER TOP SPEED

def create_top_speed_chart(df_filtered, selected_player, sort_order):
    try:
        df_1st_half = df_filtered[df_filtered["Split Name"] == "1st.half"][
            ["Round", "Top Speed (m/s)", "Date"]
        ].copy()

        df_2nd_half = df_filtered[df_filtered["Split Name"] == "2nd.half"][
            ["Round", "Top Speed (m/s)", "Date"]
        ].copy()

        df_game = df_filtered[df_filtered["Split Name"] == "game"][
            ["Round", "Top Speed (m/s)", "Mins played", "Date"]
        ].copy()

        df_1st_half = df_1st_half.rename(columns={
            "Top Speed (m/s)": "Top Speed (m/s) 1st Half",
            "Date": "Date 1st Half"
        })

        df_2nd_half = df_2nd_half.rename(columns={
            "Top Speed (m/s)": "Top Speed (m/s) 2nd Half",
            "Date": "Date 2nd Half"
        })

    except KeyError as e:
        print(f"Error: Missing column {e} in the DataFrame.")
        return go.Figure()

    df_top_speed = pd.merge(df_1st_half, df_2nd_half, on="Round", how="outer")
    df_top_speed = pd.merge(df_top_speed, df_game, on="Round", how="left")

    df_top_speed = df_top_speed.infer_objects(copy=False)
    df_top_speed["Mins played"] = pd.to_numeric(
        df_top_speed["Mins played"], errors="coerce"
    ).fillna(0).astype(int)

    df_top_speed["Date"] = pd.to_datetime(
        df_top_speed["Date"], errors="coerce", dayfirst=True
    )

    if sort_order == "form":
        df_top_speed = (
            df_top_speed.sort_values(by="Date", ascending=False)
            .head(5)
            .sort_values(by="Date", ascending=True)
        )
    elif sort_order == "value":
        df_top_speed = df_top_speed.sort_values(by="Top Speed (m/s)", ascending=True)
    else:
        df_top_speed = df_top_speed.sort_values(by="Date", ascending=True)

    fig = go.Figure(
        data=[
            go.Bar(
                name="1st Half",
                x=df_top_speed["Round"],
                y=df_top_speed["Top Speed (m/s) 1st Half"],
                marker_color="#87CEEB",
                hoverinfo="text",
                hovertext=[
                    f"1st Half: {float(speed_1st):.1f} m/s<br>"
                    f"2nd Half: {float(speed_2nd):.1f} m/s<br>"
                    f"Total Minutes Played: {int(mins)}"
                    for speed_1st, speed_2nd, mins in zip(
                        df_top_speed["Top Speed (m/s) 1st Half"].fillna(0),
                        df_top_speed["Top Speed (m/s) 2nd Half"].fillna(0),
                        df_top_speed["Mins played"].fillna(0),
                    )
                ],
            ),
            go.Bar(
                name="2nd Half",
                x=df_top_speed["Round"],
                y=df_top_speed["Top Speed (m/s) 2nd Half"],
                marker_color="#4682B4",
                hoverinfo="text",
                hovertext=[
                    f"2nd Half: {float(speed_2nd):.1f} m/s<br>"
                    f"1st Half: {float(speed_1st):.1f} m/s<br>"
                    f"Total Minutes Played: {int(mins)}"
                    for speed_2nd, speed_1st, mins in zip(
                        df_top_speed["Top Speed (m/s) 2nd Half"].fillna(0),
                        df_top_speed["Top Speed (m/s) 1st Half"].fillna(0),
                        df_top_speed["Mins played"].fillna(0),
                    )
                ],
            ),
        ]
    )

    fig.update_layout(
        barmode="group",
        title={
            "text": f"Top Speed Comparison - {selected_player}",
            "x": 0.5,
            "xanchor": "center",
            "font": dict(family=BASE_FONT, size=20, color="white"),
        },
        xaxis_title="Round",
        yaxis_title="Top Speed (m/s)",
        font=dict(family=BASE_FONT, size=14, color="white"),
        plot_bgcolor="black",
        paper_bgcolor="black",
        xaxis=dict(
            showline=True,
            showgrid=False,
            showticklabels=True,
            linecolor="white",
            linewidth=2,
            ticks="outside",
            tickfont=dict(family=BASE_FONT, size=14, color="white"),
            categoryorder="array",
            categoryarray=df_top_speed["Round"].tolist(),
        ),
        yaxis=dict(
            showline=True,
            showgrid=False,
            zeroline=False,
            linecolor="white",
            linewidth=2,
            tickfont=dict(family=BASE_FONT, size=14, color="white"),
        ),
        hoverlabel=dict(font=dict(family=BASE_FONT)),
        margin=dict(l=20, r=20, t=60, b=20),
        legend=dict(
            font=dict(family=BASE_FONT, size=14, color="white"),
            bgcolor="rgba(0,0,0,0)",
        ),
    )

    return fig

# ============================
# PLAYER GPS ---- HELPER POWER PLAYS

def create_power_plays_chart(df_filtered, selected_player, sort_order):
    df_power_plays = df_filtered[df_filtered["Split Name"] == "game"][
        ["Player Name", "Round", "Date", "Power Plays", "Mins played"]
    ].copy()

    df_power_plays["Date"] = pd.to_datetime(
        df_power_plays["Date"], errors="coerce", dayfirst=True
    )

    df_power_plays["PP per 10min"] = (
        (df_power_plays["Power Plays"] / df_power_plays["Mins played"]) * 10
    ).replace([float("inf"), -float("inf")], 0).fillna(0).round(0).astype(int)

    if sort_order == "value":
        df_power_plays = df_power_plays.sort_values(by="Power Plays", ascending=True)
    elif sort_order == "form":
        df_power_plays = (
            df_power_plays.sort_values(by="Date", ascending=False)
            .head(5)
            .sort_values(by="Date", ascending=True)
        )
    else:
        df_power_plays = df_power_plays.sort_values(by="Date", ascending=True)

    fig = go.Figure(
        data=[
            go.Scatter(
                x=df_power_plays["Round"],
                y=df_power_plays["Power Plays"],
                mode="lines+markers",
                line=dict(color="#00BFFF", width=3),
                marker=dict(size=8),
                hoverinfo="text",
                hovertext=[
                    f"Round: {round_name}<br>"
                    f"Date: {date}<br>"
                    f"Power Plays: {int(val)}<br>"
                    f"PP per 10min: {int(pp10)}<br>"
                    f"Mins Played: {int(mins)}"
                    for round_name, date, val, pp10, mins in zip(
                        df_power_plays["Round"],
                        df_power_plays["Date"].dt.strftime("%d-%m-%Y"),
                        df_power_plays["Power Plays"].fillna(0),
                        df_power_plays["PP per 10min"].fillna(0),
                        df_power_plays["Mins played"].fillna(0),
                    )
                ],
            )
        ]
    )

    fig.update_layout(
        title={
            "text": f"Power Plays - {selected_player}",
            "font": dict(family=BASE_FONT, size=20, color="white"),
            "x": 0.5,
            "y": 0.95,
            "xanchor": "center",
            "yanchor": "top",
        },
        xaxis_title="Round",
        yaxis_title="Power Plays",
        font=dict(family=BASE_FONT, size=14, color="white"),
        plot_bgcolor="black",
        paper_bgcolor="black",
        xaxis=dict(
            showline=True,
            showgrid=False,
            showticklabels=True,
            linecolor="white",
            linewidth=2,
            ticks="outside",
            tickfont=dict(family=BASE_FONT, size=14, color="white"),
            categoryorder="array",
            categoryarray=df_power_plays["Round"].tolist(),
        ),
        yaxis=dict(
            showline=True,
            showgrid=False,
            zeroline=False,
            linecolor="white",
            linewidth=2,
            tickfont=dict(family=BASE_FONT, size=14, color="white"),
        ),
        hoverlabel=dict(font=dict(family=BASE_FONT)),
        margin=dict(l=20, r=20, t=60, b=20),
    )

    return fig

#===========================
# PLAYER GPS ---- HELPER DISTANCE PER MINUTE 

def create_distance_per_min_chart(df_filtered, selected_player, sort_order):
    df_1st_half = df_filtered[df_filtered["Split Name"] == "1st.half"][
        ["Round", "Date", "Distance Per Min (m/min)"]
    ].copy()

    df_2nd_half = df_filtered[df_filtered["Split Name"] == "2nd.half"][
        ["Round", "Date", "Distance Per Min (m/min)"]
    ].copy()

    df_game = df_filtered[df_filtered["Split Name"] == "game"][
        ["Round", "Date", "Distance Per Min (m/min)", "Mins played"]
    ].copy()

    df_1st_half = df_1st_half.rename(columns={"Distance Per Min (m/min)": "1st Half"})
    df_2nd_half = df_2nd_half.rename(columns={"Distance Per Min (m/min)": "2nd Half"})
    df_game = df_game.rename(columns={"Distance Per Min (m/min)": "Game"})

    df_merged = pd.merge(df_game, df_1st_half, on=["Round", "Date"], how="left")
    df_merged = pd.merge(df_merged, df_2nd_half, on=["Round", "Date"], how="left")

    df_merged["Date"] = pd.to_datetime(df_merged["Date"], errors="coerce", dayfirst=True)

    if sort_order == "value":
        df_merged = df_merged.sort_values("Game", ascending=True)
    elif sort_order == "form":
        df_merged = (
            df_merged.sort_values("Date", ascending=False)
            .head(5)
            .sort_values("Date", ascending=True)
        )
    else:
        df_merged = df_merged.sort_values("Date", ascending=True)

    df_merged = df_merged.fillna(0)

    fig = go.Figure(
        data=[
            go.Bar(
                name="Game",
                x=df_merged["Round"],
                y=df_merged["Game"],
                marker_color="#1E90FF",
                hoverinfo="text",
                hovertext=[
                    f"Total: {int(game)} m/min<br>"
                    f"2nd Half: {int(second)} m/min<br>"
                    f"1st Half: {int(first)} m/min<br>"
                    f"Mins Played: {int(mins)} min"
                    for game, second, first, mins in zip(
                        df_merged["Game"].fillna(0),
                        df_merged["2nd Half"].fillna(0),
                        df_merged["1st Half"].fillna(0),
                        df_merged["Mins played"].fillna(0),
                    )
                ],
            )
        ]
    )

    fig.update_layout(
        title={
            "text": f"Distance Per Min - {selected_player}",
            "x": 0.5,
            "xanchor": "center",
            "font": dict(size=20, family=BASE_FONT, color="white"),
        },
        xaxis_title="Round",
        yaxis_title="Distance Per Min (m/min)",
        font=dict(family=BASE_FONT, size=14, color="white"),
        plot_bgcolor="black",
        paper_bgcolor="black",
        xaxis=dict(
            showline=True,
            showgrid=False,
            showticklabels=True,
            linecolor="white",
            linewidth=2,
            ticks="outside",
            tickfont=dict(family=BASE_FONT, size=14, color="white"),
            categoryorder="array",
            categoryarray=df_merged["Round"].tolist(),
        ),
        yaxis=dict(
            showline=True,
            showgrid=False,
            zeroline=False,
            linecolor="white",
            linewidth=2,
            tickfont=dict(family=BASE_FONT, size=14, color="white"),
        ),
        margin=dict(l=20, r=20, t=60, b=20),
        legend=dict(
            x=0.8,
            y=1.1,
            bgcolor="rgba(0,0,0,0)",
            font=dict(family=BASE_FONT, size=14, color="white"),
        ),
        hoverlabel=dict(font=dict(family=BASE_FONT)),
    )

    return fig

# ================================
# PLAYER GPS ---- HELPER FOR PLAYER LOAD

def create_player_load_chart(df_filtered, selected_player, sort_order):
    df_game = df_filtered[df_filtered["Split Name"] == "game"].copy()

    df_game["Date"] = pd.to_datetime(df_game["Date"], errors="coerce", dayfirst=True)

    if sort_order == "form":
        df_game = (
            df_game.sort_values(by="Date", ascending=False)
            .head(5)
            .sort_values(by="Date", ascending=True)
        )
    elif sort_order == "value":
        df_game = df_game.sort_values(by="Player Load", ascending=True)
    else:
        df_game = df_game.sort_values(by="Date", ascending=True)

    fig = go.Figure(
        data=[
            go.Scatter(
                x=df_game["Round"],
                y=df_game["Player Load"],
                mode="lines+markers",
                line=dict(color="#00BFFF", width=3),
                marker=dict(size=8),
                hoverinfo="text",
                hovertext=[
                    f"Round: {round_value}<br>"
                    f"Player Load: {int(player_load)}<br>"
                    f"Energy: {int(energy)} kcal<br>"
                    f"Impacts: {int(impacts)}<br>"
                    f"Power Score: {float(power_score):.1f} w/kg<br>"
                    f"Work Ratio: {float(work_ratio):.1f}<br>"
                    f"Total Minutes Played: {int(total_minutes)} min"
                    for round_value, player_load, energy, impacts, power_score, work_ratio, total_minutes in zip(
                        df_game["Round"],
                        df_game["Player Load"].fillna(0),
                        df_game["Energy (kcal)"].fillna(0),
                        df_game["Impacts"].fillna(0),
                        df_game["Power Score (w/kg)"].fillna(0),
                        df_game["Work Ratio"].fillna(0),
                        df_game["Mins played"].fillna(0),
                    )
                ],
            )
        ]
    )

    fig.update_layout(
        title={
            "text": f"Player Load - {selected_player}",
            "x": 0.5,
            "xanchor": "center",
            "font": dict(family=BASE_FONT, size=20, color="white"),
        },
        xaxis_title="Round",
        yaxis_title="Player Load",
        font=dict(family=BASE_FONT, size=14, color="white"),
        plot_bgcolor="black",
        paper_bgcolor="black",
        xaxis=dict(
            showline=True,
            showgrid=False,
            showticklabels=True,
            linecolor="white",
            linewidth=2,
            ticks="outside",
            tickfont=dict(family=BASE_FONT, size=14, color="white"),
            categoryorder="array",
            categoryarray=df_game["Round"].tolist(),
        ),
        yaxis=dict(
            showline=True,
            showgrid=False,
            zeroline=False,
            linecolor="white",
            linewidth=2,
            tickfont=dict(family=BASE_FONT, size=14, color="white"),
        ),
        hoverlabel=dict(font=dict(family=BASE_FONT)),
        margin=dict(l=20, r=20, t=60, b=20),
    )

    return fig

#===================================
# PLAYER GPS ---- HELPER ACCELERATIONS DECELERATIONS

def create_accel_decel_chart(df_filtered, selected_player, sort_order):
    df_game = df_filtered[df_filtered["Split Name"] == "game"].copy()

    acceleration_columns = [
        "Accelerations Zone Count: 3 - 4 m/s/s",
        "Accelerations Zone Count: > 4 m/s/s",
    ]
    deceleration_columns = [
        "Deceleration Zone Count: 3 - 4 m/s/s",
        "Deceleration Zone Count: > 4 m/s/s",
    ]

    df_game["Date"] = pd.to_datetime(df_game["Date"], errors="coerce", dayfirst=True)

    df_game["Total Accelerations >3m/s/s"] = df_game[acceleration_columns].fillna(0).sum(axis=1)
    df_game["Total Decelerations >3m/s/s"] = df_game[deceleration_columns].fillna(0).sum(axis=1)

    if sort_order == "form":
        df_game = (
            df_game.sort_values(by="Date", ascending=False)
            .head(5)
            .sort_values(by="Date", ascending=True)
        )
    elif sort_order == "value":
        df_game = df_game.sort_values(by="Total Accelerations >3m/s/s", ascending=True)
    else:
        df_game = df_game.sort_values(by="Date", ascending=True)

    if df_game.empty:
        return go.Figure()

    fig = go.Figure(
        data=[
            go.Bar(
                name="Accelerations",
                x=df_game["Round"],
                y=df_game["Total Accelerations >3m/s/s"],
                marker_color="#00BFFF",
                hoverinfo="text",
                hovertext=[
                    f"Round: {round_val}<br>"
                    f"Accelerations: {int(val)}"
                    for round_val, val in zip(
                        df_game["Round"],
                        df_game["Total Accelerations >3m/s/s"].fillna(0),
                    )
                ],
            ),
            go.Bar(
                name="Decelerations",
                x=df_game["Round"],
                y=df_game["Total Decelerations >3m/s/s"],
                marker_color="#6495ED",
                hoverinfo="text",
                hovertext=[
                    f"Round: {round_val}<br>"
                    f"Decelerations: {int(val)}"
                    for round_val, val in zip(
                        df_game["Round"],
                        df_game["Total Decelerations >3m/s/s"].fillna(0),
                    )
                ],
            ),
        ]
    )

    fig.update_layout(
        title={
            "text": f"Accelerations / Decelerations >3m/s² - {selected_player}",
            "font": dict(family=BASE_FONT, size=20, color="white"),
            "x": 0.5,
            "y": 0.95,
            "xanchor": "center",
            "yanchor": "top",
        },
        xaxis_title="Round",
        yaxis_title="Count",
        font=dict(family=BASE_FONT, size=14, color="white"),
        plot_bgcolor="black",
        paper_bgcolor="black",
        xaxis=dict(
            showline=True,
            showgrid=False,
            showticklabels=True,
            linecolor="white",
            linewidth=2,
            ticks="outside",
            tickfont=dict(family=BASE_FONT, size=14, color="white"),
            categoryorder="array",
            categoryarray=df_game["Round"].tolist(),
        ),
        yaxis=dict(
            showline=True,
            showgrid=False,
            zeroline=False,
            linecolor="white",
            linewidth=2,
            tickfont=dict(family=BASE_FONT, size=14, color="white"),
        ),
        hoverlabel=dict(font=dict(family=BASE_FONT)),
        margin=dict(l=20, r=20, t=60, b=20),
        barmode="group",
        legend=dict(
            font=dict(family=BASE_FONT, size=14, color="white"),
            bgcolor="rgba(0,0,0,0)",
        ),
    )

    return fig

#=================================================
# TEAM GPS ---- HELPER TOTAL DISTANCE

def create_team_distance_chart(df_filtered, round_to_analyze, view_mode="total"):
    df_1st_half = df_filtered[df_filtered["Split Name"] == "1st.half"].copy()
    df_2nd_half = df_filtered[df_filtered["Split Name"] == "2nd.half"].copy()
    df_game = df_filtered[df_filtered["Split Name"] == "game"].copy()

    df_distance = pd.merge(
        df_1st_half[["Player Name", "Distance (km)", "Mins played"]],
        df_2nd_half[["Player Name", "Distance (km)", "Mins played"]],
        on="Player Name",
        suffixes=(" 1st Half", " 2nd Half"),
    )

    df_distance = pd.merge(
        df_distance,
        df_game[["Player Name", "Mins played"]],
        on="Player Name",
        how="left",
    )

    df_distance = df_distance.rename(columns={"Mins played": "Mins played Game"})

    df_distance["Distance (km) 1st Half"] = pd.to_numeric(
        df_distance["Distance (km) 1st Half"], errors="coerce"
    ).fillna(0)

    df_distance["Distance (km) 2nd Half"] = pd.to_numeric(
        df_distance["Distance (km) 2nd Half"], errors="coerce"
    ).fillna(0)

    df_distance["Mins played 1st Half"] = pd.to_numeric(
        df_distance["Mins played 1st Half"], errors="coerce"
    ).fillna(0)

    df_distance["Mins played 2nd Half"] = pd.to_numeric(
        df_distance["Mins played 2nd Half"], errors="coerce"
    ).fillna(0)

    df_distance["Mins played Game"] = pd.to_numeric(
        df_distance["Mins played Game"], errors="coerce"
    ).fillna(0)

    df_distance["Total Distance"] = (
        df_distance["Distance (km) 1st Half"] + df_distance["Distance (km) 2nd Half"]
    )

    df_distance["Avg 1st Half (m/min)"] = (
        (df_distance["Distance (km) 1st Half"] * 1000)
        / df_distance["Mins played 1st Half"].replace(0, pd.NA)
    ).fillna(0)

    df_distance["Avg 2nd Half (m/min)"] = (
        (df_distance["Distance (km) 2nd Half"] * 1000)
        / df_distance["Mins played 2nd Half"].replace(0, pd.NA)
    ).fillna(0)

    df_distance["Total Avg per min (m/min)"] = (
        (df_distance["Total Distance"] * 1000)
        / df_distance["Mins played Game"].replace(0, pd.NA)
    ).fillna(0)

    if view_mode == "rate":
        df_distance = df_distance.sort_values("Total Avg per min (m/min)", ascending=False)

        fig = go.Figure(
            data=[
                go.Bar(
                    x=df_distance["Player Name"],
                    y=df_distance["Total Avg per min (m/min)"],
                    marker_color="#00BFFF",
                    hoverinfo="text",
                    hovertext=[
                        f"{name}<br>"
                        f"Total Distance: {total:.2f} km<br>"
                        f"Total Minutes: {mins_game:.0f} min<br>"
                        f"Avg per min: {avg_total:.1f} m/min<br>"
                        f"Per 10 min: {rate10:.1f} m<br>"
                        f"1st Half: {val1:.2f} km ({avg1:.1f} m/min)<br>"
                        f"2nd Half: {val2:.2f} km ({avg2:.1f} m/min)"
                        for name, total, mins_game, avg_total, rate10, val1, avg1, val2, avg2 in zip(
                            df_distance["Player Name"],
                            df_distance["Total Distance"],
                            df_distance["Mins played Game"],
                            df_distance["Total Avg per min (m/min)"],
                            df_distance["Total Avg per min (m/min)"] * 10,
                            df_distance["Distance (km) 1st Half"],
                            df_distance["Avg 1st Half (m/min)"],
                            df_distance["Distance (km) 2nd Half"],
                            df_distance["Avg 2nd Half (m/min)"],
                        )
                    ],
                )
            ]
        )

        title_text = f"Total Distance per 10 min - {round_to_analyze}"
        y_title = "Distance per min (m/min)"
        barmode = "group"

    elif view_mode == "halves":
        df_distance = df_distance.sort_values("Total Distance", ascending=False)

        hover_text = [
            f"1st Half: {first_half:.2f} km ({avg1:.1f} m/min)<br>"
            f"2nd Half: {second_half:.2f} km ({avg2:.1f} m/min)<br>"
            f"Total: {total:.2f} km<br>"
            f"1st Half Minutes: {mins1:.0f}<br>"
            f"2nd Half Minutes: {mins2:.0f}"
            for first_half, second_half, total, avg1, avg2, mins1, mins2 in zip(
                df_distance["Distance (km) 1st Half"],
                df_distance["Distance (km) 2nd Half"],
                df_distance["Total Distance"],
                df_distance["Avg 1st Half (m/min)"],
                df_distance["Avg 2nd Half (m/min)"],
                df_distance["Mins played 1st Half"],
                df_distance["Mins played 2nd Half"],
            )
        ]

        fig = go.Figure(
            data=[
                go.Bar(
                    name="1st Half",
                    x=df_distance["Player Name"],
                    y=df_distance["Distance (km) 1st Half"],
                    marker_color="#87CEEB",
                    hoverinfo="text",
                    hovertext=hover_text,
                ),
                go.Bar(
                    name="2nd Half",
                    x=df_distance["Player Name"],
                    y=df_distance["Distance (km) 2nd Half"],
                    marker_color="#000080",
                    hoverinfo="text",
                    hovertext=hover_text,
                ),
            ]
        )

        title_text = f"Total Distance - 1st Half vs 2nd Half - {round_to_analyze}"
        y_title = "Distance (km)"
        barmode = "stack"

    else:
        df_distance = df_distance.sort_values("Total Distance", ascending=False)

        fig = go.Figure(
            data=[
                go.Bar(
                    x=df_distance["Player Name"],
                    y=df_distance["Total Distance"],
                    marker_color="#00BFFF",
                    hoverinfo="text",
                    hovertext=[
                        f"{name}<br>"
                        f"Total Distance: {total:.2f} km<br>"
                        f"Total Minutes: {mins_game:.0f} min<br>"
                        f"Avg per min: {avg_total:.1f} m/min<br>"
                        f"Per 10 min: {rate10:.1f} m<br>"
                        f"1st Half: {val1:.2f} km ({avg1:.1f} m/min)<br>"
                        f"2nd Half: {val2:.2f} km ({avg2:.1f} m/min)"
                        for name, total, mins_game, avg_total, rate10, val1, avg1, val2, avg2 in zip(
                            df_distance["Player Name"],
                            df_distance["Total Distance"],
                            df_distance["Mins played Game"],
                            df_distance["Total Avg per min (m/min)"],
                            df_distance["Total Avg per min (m/min)"] * 10,
                            df_distance["Distance (km) 1st Half"],
                            df_distance["Avg 1st Half (m/min)"],
                            df_distance["Distance (km) 2nd Half"],
                            df_distance["Avg 2nd Half (m/min)"],
                        )
                    ],
                )
            ]
        )

        title_text = f"Total Distance - {round_to_analyze}"
        y_title = "Distance (km)"
        barmode = "group"

    fig.update_layout(
        barmode=barmode,
        title={
            "text": title_text,
            "y": 0.95,
            "x": 0.5,
            "xanchor": "center",
            "yanchor": "top",
            "font": {"size": 20, "family": BASE_FONT, "color": "white"},
        },
        xaxis_title="Player Name",
        yaxis_title=y_title,
        xaxis=dict(
            showline=True,
            showgrid=False,
            linecolor="white",
            linewidth=2,
            tickfont=dict(family=BASE_FONT, size=14, color="white"),
            categoryorder="array",
            categoryarray=df_distance["Player Name"].tolist(),
        ),
        yaxis=dict(
            showline=True,
            showgrid=False,
            zeroline=False,
            linecolor="white",
            linewidth=2,
            tickfont=dict(family=BASE_FONT, size=14, color="white"),
        ),
        plot_bgcolor="black",
        paper_bgcolor="black",
        font=dict(color="white", size=14, family=BASE_FONT),
        legend=dict(
            x=0.8,
            y=1.1,
            bgcolor="rgba(0,0,0,0)",
            font=dict(family=BASE_FONT, size=14, color="white"),
        ),
        hoverlabel=dict(font=dict(family=BASE_FONT)),
        margin=dict(l=20, r=20, t=60, b=20),
    )

    return fig

#=================================================
# TEAM GPS ---- HELPER HIGH SPEED METRES

def create_team_sprint_distance_chart(df_filtered, round_to_analyze, view_mode="total"):
    df_1st_half = df_filtered[df_filtered["Split Name"] == "1st.half"].copy()
    df_2nd_half = df_filtered[df_filtered["Split Name"] == "2nd.half"].copy()
    df_game = df_filtered[df_filtered["Split Name"] == "game"].copy()

    df_sprint = pd.merge(
        df_1st_half[["Player Name", "Sprint Distance (m)", "Mins played"]],
        df_2nd_half[["Player Name", "Sprint Distance (m)", "Mins played"]],
        on="Player Name",
        suffixes=(" 1st Half", " 2nd Half"),
    )

    df_sprint = pd.merge(
        df_sprint,
        df_game[["Player Name", "Mins played"]],
        on="Player Name",
        how="left",
    )

    df_sprint = df_sprint.rename(columns={"Mins played": "Mins played Game"})

    df_sprint["Sprint Distance (m) 1st Half"] = pd.to_numeric(
        df_sprint["Sprint Distance (m) 1st Half"], errors="coerce"
    ).fillna(0)

    df_sprint["Sprint Distance (m) 2nd Half"] = pd.to_numeric(
        df_sprint["Sprint Distance (m) 2nd Half"], errors="coerce"
    ).fillna(0)

    df_sprint["Mins played 1st Half"] = pd.to_numeric(
        df_sprint["Mins played 1st Half"], errors="coerce"
    ).fillna(0)

    df_sprint["Mins played 2nd Half"] = pd.to_numeric(
        df_sprint["Mins played 2nd Half"], errors="coerce"
    ).fillna(0)

    df_sprint["Mins played Game"] = pd.to_numeric(
        df_sprint["Mins played Game"], errors="coerce"
    ).fillna(0)

    df_sprint["Total Sprint Distance"] = (
        df_sprint["Sprint Distance (m) 1st Half"] + df_sprint["Sprint Distance (m) 2nd Half"]
    )

    df_sprint["Avg 1st Half (m/min)"] = (
        df_sprint["Sprint Distance (m) 1st Half"]
        / df_sprint["Mins played 1st Half"].replace(0, pd.NA)
    ).fillna(0)

    df_sprint["Avg 2nd Half (m/min)"] = (
        df_sprint["Sprint Distance (m) 2nd Half"]
        / df_sprint["Mins played 2nd Half"].replace(0, pd.NA)
    ).fillna(0)

    df_sprint["Total Avg per min (m/min)"] = (
        df_sprint["Total Sprint Distance"]
        / df_sprint["Mins played Game"].replace(0, pd.NA)
    ).fillna(0)

    if view_mode == "rate":
        df_sprint = df_sprint.sort_values("Total Avg per min (m/min)", ascending=False)

        fig = go.Figure(
            data=[
                go.Bar(
                    x=df_sprint["Player Name"],
                    y=df_sprint["Total Avg per min (m/min)"],
                    marker_color="#00BFFF",
                    hoverinfo="text",
                    hovertext=[
                        f"{name}<br>"
                        f"Total High Speed Metres: {total:.0f} m<br>"
                        f"Total Minutes: {mins_game:.0f} min<br>"
                        f"Per 10 min: {rate10:.1f} m<br>"
                        f"Avg per min: {avg_total:.1f} m/min<br>"
                        f"1st Half: {val1:.0f} m ({avg1:.1f} m/min)<br>"
                        f"2nd Half: {val2:.0f} m ({avg2:.1f} m/min)"
                        for name, total, mins_game, avg_total, val1, avg1, val2, avg2, rate10 in zip(
                            df_sprint["Player Name"],
                            df_sprint["Total Sprint Distance"],
                            df_sprint["Mins played Game"],
                            df_sprint["Total Avg per min (m/min)"],
                            df_sprint["Sprint Distance (m) 1st Half"],
                            df_sprint["Avg 1st Half (m/min)"],
                            df_sprint["Sprint Distance (m) 2nd Half"],
                            df_sprint["Avg 2nd Half (m/min)"],
                            df_sprint["Total Avg per min (m/min)"] * 10,
                        )
                    ],
                )
            ]
        )

        title_text = f"High Speed Metres per 10 min - {round_to_analyze}"
        y_title = "High Speed Metres per min (m/min)"
        barmode = "group"

    elif view_mode == "halves":
        df_sprint = df_sprint.sort_values("Total Sprint Distance", ascending=False)

        hover_text = [
            f"1st Half High Speed Metres: {val1:.0f} m<br>"
            f"1st Half Minutes: {mins1:.0f} min<br>"
            f"1st Half Avg: {avg1:.1f} m/min<br>"
            f"2nd Half High Speed Metres: {val2:.0f} m<br>"
            f"2nd Half Minutes: {mins2:.0f} min<br>"
            f"2nd Half Avg: {avg2:.1f} m/min<br>"
            f"Total High Speed Metres: {total:.0f} m<br>"
            f"Total Minutes Played: {mins_total:.0f} min<br>"
            f"Total Avg: {avg_total:.1f} m/min"
            for val1, mins1, avg1, val2, mins2, avg2, total, mins_total, avg_total in zip(
                df_sprint["Sprint Distance (m) 1st Half"],
                df_sprint["Mins played 1st Half"],
                df_sprint["Avg 1st Half (m/min)"],
                df_sprint["Sprint Distance (m) 2nd Half"],
                df_sprint["Mins played 2nd Half"],
                df_sprint["Avg 2nd Half (m/min)"],
                df_sprint["Total Sprint Distance"],
                df_sprint["Mins played Game"],
                df_sprint["Total Avg per min (m/min)"],
            )
        ]

        fig = go.Figure(
            data=[
                go.Bar(
                    name="1st Half",
                    x=df_sprint["Player Name"],
                    y=df_sprint["Sprint Distance (m) 1st Half"],
                    marker_color="#87CEEB",
                    hoverinfo="text",
                    hovertext=hover_text,
                ),
                go.Bar(
                    name="2nd Half",
                    x=df_sprint["Player Name"],
                    y=df_sprint["Sprint Distance (m) 2nd Half"],
                    marker_color="#000080",
                    hoverinfo="text",
                    hovertext=hover_text,
                ),
            ]
        )

        title_text = f"High Speed Metres - 1st Half vs 2nd Half - {round_to_analyze}"
        y_title = "High Speed Metres"
        barmode = "stack"

    else:
        df_sprint = df_sprint.sort_values("Total Sprint Distance", ascending=False)

        fig = go.Figure(
            data=[
                go.Bar(
                    x=df_sprint["Player Name"],
                    y=df_sprint["Total Sprint Distance"],
                    marker_color="#00BFFF",
                    hoverinfo="text",
                    hovertext=[
                        f"{name}<br>"
                        f"Total High Speed Metres: {total:.0f} m<br>"
                        f"Total Minutes: {mins_game:.0f} min<br>"
                        f"Avg per min: {avg_total:.1f} m/min<br>"
                        f"Per 10 min: {rate10:.1f} m<br>"
                        f"1st Half: {val1:.0f} m ({avg1:.1f} m/min)<br>"
                        f"2nd Half: {val2:.0f} m ({avg2:.1f} m/min)"
                        for name, total, mins_game, avg_total, rate10, val1, avg1, val2, avg2 in zip(
                            df_sprint["Player Name"],
                            df_sprint["Total Sprint Distance"],
                            df_sprint["Mins played Game"],
                            df_sprint["Total Avg per min (m/min)"],
                            df_sprint["Total Avg per min (m/min)"] * 10,
                            df_sprint["Sprint Distance (m) 1st Half"],
                            df_sprint["Avg 1st Half (m/min)"],
                            df_sprint["Sprint Distance (m) 2nd Half"],
                            df_sprint["Avg 2nd Half (m/min)"],
                        )
                    ],
                )
            ]
        )

        title_text = f"High Speed Metres (>18km/h) - {round_to_analyze}"
        y_title = "High Speed Metres"
        barmode = "group"

    fig.update_layout(
        barmode=barmode,
        title={
            "text": title_text,
            "y": 0.95,
            "x": 0.5,
            "xanchor": "center",
            "yanchor": "top",
            "font": {"size": 20, "family": BASE_FONT, "color": "white"},
        },
        xaxis_title="Player Name",
        yaxis_title=y_title,
        xaxis=dict(
            showline=True,
            showgrid=False,
            linecolor="white",
            linewidth=2,
            tickfont=dict(family=BASE_FONT, size=14, color="white"),
            categoryorder="array",
            categoryarray=df_sprint["Player Name"].tolist(),
        ),
        yaxis=dict(
            showline=True,
            showgrid=False,
            zeroline=False,
            linecolor="white",
            linewidth=2,
            tickfont=dict(family=BASE_FONT, size=14, color="white"),
        ),
        plot_bgcolor="black",
        paper_bgcolor="black",
        legend=dict(
            x=0.8,
            y=1.1,
            bgcolor="rgba(0, 0, 0, 0)",
            bordercolor="rgba(0, 0, 0, 0)",
            font=dict(family=BASE_FONT, size=14, color="white"),
        ),
        font=dict(color="white", size=14, family=BASE_FONT),
        hoverlabel=dict(font=dict(family=BASE_FONT)),
        margin=dict(l=20, r=20, t=60, b=20),
    )

    return fig

#=================================================
# TEAM GPS ---- HELPER VERY HIGH SPEED METRES

def create_team_vhs_chart(df_filtered, round_to_analyze, view_mode="total"):
    df_1st_half = df_filtered[df_filtered["Split Name"] == "1st.half"].copy()
    df_2nd_half = df_filtered[df_filtered["Split Name"] == "2nd.half"].copy()
    df_game = df_filtered[df_filtered["Split Name"] == "game"].copy()

    zone5_col = "Distance in Speed Zone 5 (km)"

    df_vhs = pd.merge(
        df_1st_half[["Player Name", zone5_col, "Mins played"]],
        df_2nd_half[["Player Name", zone5_col, "Mins played"]],
        on="Player Name",
        suffixes=(" 1st Half", " 2nd Half"),
    )

    df_vhs = pd.merge(
        df_vhs,
        df_game[["Player Name", "Mins played"]],
        on="Player Name",
        how="left",
    )

    df_vhs = df_vhs.rename(columns={"Mins played": "Mins played Game"})

    df_vhs[f"{zone5_col} 1st Half"] = pd.to_numeric(
        df_vhs[f"{zone5_col} 1st Half"], errors="coerce"
    ).fillna(0)

    df_vhs[f"{zone5_col} 2nd Half"] = pd.to_numeric(
        df_vhs[f"{zone5_col} 2nd Half"], errors="coerce"
    ).fillna(0)

    df_vhs["Mins played 1st Half"] = pd.to_numeric(
        df_vhs["Mins played 1st Half"], errors="coerce"
    ).fillna(0)

    df_vhs["Mins played 2nd Half"] = pd.to_numeric(
        df_vhs["Mins played 2nd Half"], errors="coerce"
    ).fillna(0)

    df_vhs["Mins played Game"] = pd.to_numeric(
        df_vhs["Mins played Game"], errors="coerce"
    ).fillna(0)

    df_vhs["VHS 1st Half (m)"] = df_vhs[f"{zone5_col} 1st Half"] * 1000
    df_vhs["VHS 2nd Half (m)"] = df_vhs[f"{zone5_col} 2nd Half"] * 1000
    df_vhs["Total VHS (m)"] = df_vhs["VHS 1st Half (m)"] + df_vhs["VHS 2nd Half (m)"]

    df_vhs["Avg 1st Half (m/min)"] = (
        df_vhs["VHS 1st Half (m)"] / df_vhs["Mins played 1st Half"].replace(0, pd.NA)
    ).fillna(0)

    df_vhs["Avg 2nd Half (m/min)"] = (
        df_vhs["VHS 2nd Half (m)"] / df_vhs["Mins played 2nd Half"].replace(0, pd.NA)
    ).fillna(0)

    df_vhs["Total Avg per min (m/min)"] = (
        df_vhs["Total VHS (m)"] / df_vhs["Mins played Game"].replace(0, pd.NA)
    ).fillna(0)

    if view_mode == "rate":
        df_vhs = df_vhs.sort_values("Total Avg per min (m/min)", ascending=False)

        fig = go.Figure(
            data=[
                go.Bar(
                    x=df_vhs["Player Name"],
                    y=df_vhs["Total Avg per min (m/min)"],
                    marker_color="#00BFFF",
                    hoverinfo="text",
                    hovertext=[
                        f"{name}<br>"
                        f"Total VHS: {total:.0f} m<br>"
                        f"Total Minutes: {mins_game:.0f} min<br>"
                        f"Avg per min: {avg_total:.1f} m/min<br>"
                        f"Per 10 min: {rate10:.1f} m<br>"
                        f"1st Half: {val1:.0f} m ({avg1:.1f} m/min)<br>"
                        f"2nd Half: {val2:.0f} m ({avg2:.1f} m/min)"
                        for name, total, mins_game, avg_total, rate10, val1, avg1, val2, avg2 in zip(
                            df_vhs["Player Name"],
                            df_vhs["Total VHS (m)"],
                            df_vhs["Mins played Game"],
                            df_vhs["Total Avg per min (m/min)"],
                            df_vhs["Total Avg per min (m/min)"] * 10,
                            df_vhs["VHS 1st Half (m)"],
                            df_vhs["Avg 1st Half (m/min)"],
                            df_vhs["VHS 2nd Half (m)"],
                            df_vhs["Avg 2nd Half (m/min)"],
                        )
                    ],
                )
            ]
        )

        title_text = f"Very High Speed Metres (>25 km/h) per 10 min - {round_to_analyze}"
        y_title = "Metres per min (m/min)"
        barmode = "group"

    elif view_mode == "halves":
        df_vhs = df_vhs.sort_values("Total VHS (m)", ascending=False)

        hover_text = [
            f"1st Half: {val1:.0f} m ({avg1:.1f} m/min)<br>"
            f"2nd Half: {val2:.0f} m ({avg2:.1f} m/min)<br>"
            f"Total: {total:.0f} m<br>"
            f"1st Half Minutes: {mins1:.0f}<br>"
            f"2nd Half Minutes: {mins2:.0f}<br>"
            f"Total Minutes: {mins_game:.0f}<br>"
            f"Total Avg: {avg_total:.1f} m/min"
            for val1, avg1, val2, avg2, total, mins1, mins2, mins_game, avg_total in zip(
                df_vhs["VHS 1st Half (m)"],
                df_vhs["Avg 1st Half (m/min)"],
                df_vhs["VHS 2nd Half (m)"],
                df_vhs["Avg 2nd Half (m/min)"],
                df_vhs["Total VHS (m)"],
                df_vhs["Mins played 1st Half"],
                df_vhs["Mins played 2nd Half"],
                df_vhs["Mins played Game"],
                df_vhs["Total Avg per min (m/min)"],
            )
        ]

        fig = go.Figure(
            data=[
                go.Bar(
                    name="1st Half",
                    x=df_vhs["Player Name"],
                    y=df_vhs["VHS 1st Half (m)"],
                    marker_color="#87CEEB",
                    hoverinfo="text",
                    hovertext=hover_text,
                ),
                go.Bar(
                    name="2nd Half",
                    x=df_vhs["Player Name"],
                    y=df_vhs["VHS 2nd Half (m)"],
                    marker_color="#000080",
                    hoverinfo="text",
                    hovertext=hover_text,
                ),
            ]
        )

        title_text = f"Very High Speed Metres (>25 km/h) - 1st vs 2nd Half - {round_to_analyze}"
        y_title = "Metres"
        barmode = "stack"

    else:
        df_vhs = df_vhs.sort_values("Total VHS (m)", ascending=False)

        fig = go.Figure(
            data=[
                go.Bar(
                    x=df_vhs["Player Name"],
                    y=df_vhs["Total VHS (m)"],
                    marker_color="#00BFFF",
                    hoverinfo="text",
                    hovertext=[
                        f"{name}<br>"
                        f"Total VHS: {total:.0f} m<br>"
                        f"Total Minutes: {mins_game:.0f} min<br>"
                        f"Avg per min: {avg_total:.1f} m/min<br>"
                        f"Per 10 min: {rate10:.1f} m<br>"
                        f"1st Half: {val1:.0f} m ({avg1:.1f} m/min)<br>"
                        f"2nd Half: {val2:.0f} m ({avg2:.1f} m/min)"
                        for name, total, mins_game, avg_total, rate10, val1, avg1, val2, avg2 in zip(
                            df_vhs["Player Name"],
                            df_vhs["Total VHS (m)"],
                            df_vhs["Mins played Game"],
                            df_vhs["Total Avg per min (m/min)"],
                            df_vhs["Total Avg per min (m/min)"] * 10,
                            df_vhs["VHS 1st Half (m)"],
                            df_vhs["Avg 1st Half (m/min)"],
                            df_vhs["VHS 2nd Half (m)"],
                            df_vhs["Avg 2nd Half (m/min)"],
                        )
                    ],
                )
            ]
        )

        title_text = f"Very High Speed Metres (>25 km/h) - {round_to_analyze}"
        y_title = "Metres"
        barmode = "group"

    fig.update_layout(
        barmode=barmode,
        title={
            "text": title_text,
            "y": 0.95,
            "x": 0.5,
            "xanchor": "center",
            "yanchor": "top",
            "font": {"size": 20, "family": BASE_FONT, "color": "white"},
        },
        xaxis_title="Player Name",
        yaxis_title=y_title,
        xaxis=dict(
            showline=True,
            showgrid=False,
            linecolor="white",
            linewidth=2,
            tickfont=dict(family=BASE_FONT, size=14, color="white"),
            categoryorder="array",
            categoryarray=df_vhs["Player Name"].tolist(),
        ),
        yaxis=dict(
            showline=True,
            showgrid=False,
            zeroline=False,
            linecolor="white",
            linewidth=2,
            tickfont=dict(family=BASE_FONT, size=14, color="white"),
        ),
        plot_bgcolor="black",
        paper_bgcolor="black",
        legend=dict(
            x=0.8,
            y=1.1,
            bgcolor="rgba(0, 0, 0, 0)",
            bordercolor="rgba(0, 0, 0, 0)",
            font=dict(family=BASE_FONT, size=14, color="white"),
        ),
        font=dict(color="white", size=14, family=BASE_FONT),
        hoverlabel=dict(font=dict(family=BASE_FONT)),
        margin=dict(l=20, r=20, t=60, b=20),
    )

    return fig


#=================================================
# TEAM GPS ---- HELPER TOP SPEED

def create_team_top_speed_chart(df_filtered, round_to_analyze, view_mode="halves"):
    df_1st = (
        df_filtered[df_filtered["Split Name"] == "1st.half"][["Player Name", "Top Speed (m/s)"]]
        .rename(columns={"Top Speed (m/s)": "1st Half"})
        .copy()
    )

    df_2nd = (
        df_filtered[df_filtered["Split Name"] == "2nd.half"][["Player Name", "Top Speed (m/s)"]]
        .rename(columns={"Top Speed (m/s)": "2nd Half"})
        .copy()
    )

    df_game = df_filtered[df_filtered["Split Name"] == "game"][["Player Name", "Mins played"]].copy()

    df_top = pd.merge(df_1st, df_2nd, on="Player Name", how="outer")
    df_top = pd.merge(df_top, df_game, on="Player Name", how="left")

    df_top["1st Half"] = pd.to_numeric(df_top["1st Half"], errors="coerce").fillna(0)
    df_top["2nd Half"] = pd.to_numeric(df_top["2nd Half"], errors="coerce").fillna(0)
    df_top["Mins played"] = pd.to_numeric(df_top["Mins played"], errors="coerce").fillna(0)

    df_top["Max Speed"] = df_top[["1st Half", "2nd Half"]].max(axis=1)
    df_top = df_top.sort_values("Max Speed", ascending=False)

    if view_mode == "max":
        fig = go.Figure(
            data=[
                go.Bar(
                    x=df_top["Player Name"],
                    y=df_top["Max Speed"],
                    marker_color="#4682B4",
                    hoverinfo="text",
                    hovertext=[
                        f"{name}<br>"
                        f"Max Speed: {mx:.1f} m/s<br>"
                        f"1st Half: {s1:.1f} m/s<br>"
                        f"2nd Half: {s2:.1f} m/s<br>"
                        f"Minutes: {mins:.0f}"
                        for name, mx, s1, s2, mins in zip(
                            df_top["Player Name"],
                            df_top["Max Speed"],
                            df_top["1st Half"],
                            df_top["2nd Half"],
                            df_top["Mins played"],
                        )
                    ],
                )
            ]
        )

        chart_title = f"Top Speed (Max) - {round_to_analyze}"
        barmode = "group"

    else:
        fig = go.Figure(
            data=[
                go.Bar(
                    name="1st Half",
                    x=df_top["Player Name"],
                    y=df_top["1st Half"],
                    marker_color="#ADD8E6",
                    hoverinfo="text",
                    hovertext=[
                        f"1st Half: {s1:.1f} m/s<br>"
                        f"2nd Half: {s2:.1f} m/s<br>"
                        f"Max Speed: {mx:.1f} m/s<br>"
                        f"Minutes: {mins:.0f}"
                        for s1, s2, mx, mins in zip(
                            df_top["1st Half"],
                            df_top["2nd Half"],
                            df_top["Max Speed"],
                            df_top["Mins played"],
                        )
                    ],
                ),
                go.Bar(
                    name="2nd Half",
                    x=df_top["Player Name"],
                    y=df_top["2nd Half"],
                    marker_color="#4682B4",
                    hoverinfo="text",
                    hovertext=[
                        f"2nd Half: {s2:.1f} m/s<br>"
                        f"1st Half: {s1:.1f} m/s<br>"
                        f"Max Speed: {mx:.1f} m/s<br>"
                        f"Minutes: {mins:.0f}"
                        for s2, s1, mx, mins in zip(
                            df_top["2nd Half"],
                            df_top["1st Half"],
                            df_top["Max Speed"],
                            df_top["Mins played"],
                        )
                    ],
                ),
            ]
        )

        chart_title = f"Top Speed - 1st vs 2nd Half - {round_to_analyze}"
        barmode = "group"

    fig.update_layout(
        barmode=barmode,
        title={
            "text": chart_title,
            "y": 0.95,
            "x": 0.5,
            "xanchor": "center",
            "yanchor": "top",
            "font": {"size": 20, "family": BASE_FONT, "color": "white"},
        },
        xaxis_title="Player Name",
        yaxis_title="Top Speed (m/s)",
        xaxis=dict(
            showline=True,
            showgrid=False,
            linecolor="white",
            linewidth=2,
            tickfont=dict(family=BASE_FONT, size=14, color="white"),
            categoryorder="array",
            categoryarray=df_top["Player Name"].tolist(),
        ),
        yaxis=dict(
            showline=True,
            showgrid=False,
            zeroline=False,
            linecolor="white",
            linewidth=2,
            tickfont=dict(family=BASE_FONT, size=14, color="white"),
        ),
        plot_bgcolor="black",
        paper_bgcolor="black",
        font=dict(color="white", size=14, family=BASE_FONT),
        legend=dict(
            x=0.8,
            y=1.1,
            bgcolor="rgba(0,0,0,0)",
            font=dict(family=BASE_FONT, size=14, color="white"),
        ),
        hoverlabel=dict(font=dict(family=BASE_FONT)),
        margin=dict(l=20, r=20, t=60, b=20),
    )

    return fig

#=================================================
# TEAM GPS ---- HELPER POWER PLAYS

def create_team_power_plays_chart(df_filtered, round_to_analyze, view_mode="total"):
    df_game = df_filtered[df_filtered["Split Name"] == "game"].copy()

    df_power_plays = df_game[["Player Name", "Power Plays", "Mins played"]].copy()

    df_power_plays["Power Plays"] = pd.to_numeric(
        df_power_plays["Power Plays"], errors="coerce"
    ).fillna(0)

    df_power_plays["Mins played"] = pd.to_numeric(
        df_power_plays["Mins played"], errors="coerce"
    ).fillna(0)

    df_power_plays["PP per 10min"] = (
        (df_power_plays["Power Plays"] / df_power_plays["Mins played"].replace(0, pd.NA)) * 10
    ).fillna(0).round(1)

    if view_mode == "rate":
        df_power_plays = df_power_plays.sort_values("PP per 10min", ascending=False)
        y_col = "PP per 10min"
        y_title = "Power Plays per 10 min"
        chart_title = f"Power Plays per 10 min – {round_to_analyze}"
        hover_text = [
            f"{name}<br>"
            f"Power Plays: {int(total)}<br>"
            f"Minutes Played: {int(mins)}<br>"
            f"Per 10 min: {rate:.1f}"
            for name, total, mins, rate in zip(
                df_power_plays["Player Name"],
                df_power_plays["Power Plays"],
                df_power_plays["Mins played"],
                df_power_plays["PP per 10min"],
            )
        ]
    else:
        df_power_plays = df_power_plays.sort_values("Power Plays", ascending=False)
        y_col = "Power Plays"
        y_title = "Power Plays"
        chart_title = f"Power Plays – {round_to_analyze}"
        hover_text = [
            f"{name}<br>"
            f"Power Plays: {int(total)}<br>"
            f"Minutes Played: {int(mins)}<br>"
            f"Per 10 min: {rate:.1f}"
            for name, total, mins, rate in zip(
                df_power_plays["Player Name"],
                df_power_plays["Power Plays"],
                df_power_plays["Mins played"],
                df_power_plays["PP per 10min"],
            )
        ]

    fig = go.Figure(
        [
            go.Bar(
                x=df_power_plays["Player Name"],
                y=df_power_plays[y_col],
                marker_color="skyblue",
                hoverinfo="text",
                hovertext=hover_text,
            )
        ]
    )

    fig.update_layout(
        title={
            "text": chart_title,
            "y": 0.92,
            "x": 0.5,
            "xanchor": "center",
            "yanchor": "top",
            "font": {"size": 20, "family": BASE_FONT, "color": "white"},
        },
        xaxis_title="Player Name",
        yaxis_title=y_title,
        plot_bgcolor="black",
        paper_bgcolor="black",
        font=dict(family=BASE_FONT, size=14, color="white"),
        xaxis=dict(
            showline=True,
            showgrid=False,
            linecolor="white",
            linewidth=2,
            tickfont=dict(family=BASE_FONT, size=14, color="white"),
            categoryorder="array",
            categoryarray=df_power_plays["Player Name"].tolist(),
        ),
        yaxis=dict(
            showline=True,
            showgrid=False,
            zeroline=False,
            linecolor="white",
            linewidth=2,
            tickfont=dict(family=BASE_FONT, size=14, color="white"),
        ),
        hoverlabel=dict(font=dict(family=BASE_FONT)),
        margin=dict(l=20, r=20, t=60, b=20),
    )

    return fig

#=================================================
# TEAM GPS ---- HELPER DISTANCE PER MINUTE

def create_team_distance_per_min_chart(df_filtered, round_to_analyze, view_mode="total"):
    df_1st_half = df_filtered[df_filtered["Split Name"] == "1st.half"].copy()
    df_2nd_half = df_filtered[df_filtered["Split Name"] == "2nd.half"].copy()
    df_game = df_filtered[df_filtered["Split Name"] == "game"].copy()

    col = "Distance Per Min (m/min)"

    df_merged = pd.merge(
        df_1st_half[["Player Name", col]],
        df_2nd_half[["Player Name", col]],
        on="Player Name",
        suffixes=(" 1st Half", " 2nd Half"),
    )

    df_merged = pd.merge(
        df_merged,
        df_game[["Player Name", col, "Mins played"]],
        on="Player Name",
    ).rename(columns={col: "Game"})

    df_merged["Game"] = pd.to_numeric(df_merged["Game"], errors="coerce").fillna(0)
    df_merged[f"{col} 1st Half"] = pd.to_numeric(df_merged[f"{col} 1st Half"], errors="coerce").fillna(0)
    df_merged[f"{col} 2nd Half"] = pd.to_numeric(df_merged[f"{col} 2nd Half"], errors="coerce").fillna(0)
    df_merged["Mins played"] = pd.to_numeric(df_merged["Mins played"], errors="coerce").fillna(0)

    if view_mode == "halves":
        df_merged = df_merged.sort_values("Game", ascending=False)

        fig = go.Figure(
            data=[
                go.Bar(
                    name="1st Half",
                    x=df_merged["Player Name"],
                    y=df_merged[f"{col} 1st Half"],
                    marker_color="#87CEEB",
                    hoverinfo="text",
                    hovertext=[
                        f"{name}<br>"
                        f"1st Half: {first:.0f} m/min<br>"
                        f"2nd Half: {second:.0f} m/min<br>"
                        f"Game: {game:.0f} m/min"
                        for name, first, second, game in zip(
                            df_merged["Player Name"],
                            df_merged[f"{col} 1st Half"],
                            df_merged[f"{col} 2nd Half"],
                            df_merged["Game"],
                        )
                    ],
                ),
                go.Bar(
                    name="2nd Half",
                    x=df_merged["Player Name"],
                    y=df_merged[f"{col} 2nd Half"],
                    marker_color="#000080",
                    hoverinfo="text",
                    hovertext=[
                        f"{name}<br>"
                        f"2nd Half: {second:.0f} m/min<br>"
                        f"1st Half: {first:.0f} m/min<br>"
                        f"Game: {game:.0f} m/min"
                        for name, second, first, game in zip(
                            df_merged["Player Name"],
                            df_merged[f"{col} 2nd Half"],
                            df_merged[f"{col} 1st Half"],
                            df_merged["Game"],
                        )
                    ],
                ),
            ]
        )

        barmode = "group"
        title_text = f"Distance Per Min (Halves) - {round_to_analyze}"

    else:
        df_merged = df_merged.sort_values("Game", ascending=False)

        fig = go.Figure(
            data=[
                go.Bar(
                    x=df_merged["Player Name"],
                    y=df_merged["Game"],
                    marker_color="#00BFFF",
                    hoverinfo="text",
                    hovertext=[
                        f"{name}<br>"
                        f"Game: {game:.0f} m/min<br>"
                        f"1st Half: {first:.0f} m/min<br>"
                        f"2nd Half: {second:.0f} m/min<br>"
                        f"Minutes: {mins:.0f}"
                        for name, game, first, second, mins in zip(
                            df_merged["Player Name"],
                            df_merged["Game"],
                            df_merged[f"{col} 1st Half"],
                            df_merged[f"{col} 2nd Half"],
                            df_merged["Mins played"],
                        )
                    ],
                )
            ]
        )

        barmode = "group"
        title_text = f"Distance Per Min - {round_to_analyze}"

    fig.update_layout(
        barmode=barmode,
        title={
            "text": title_text,
            "y": 0.95,
            "x": 0.5,
            "xanchor": "center",
            "yanchor": "top",
            "font": {"size": 20, "family": BASE_FONT, "color": "white"},
        },
        xaxis_title="Player Name",
        yaxis_title="Distance Per Min (m/min)",
        xaxis=dict(
            showline=True,
            showgrid=False,
            linecolor="white",
            linewidth=2,
            tickfont=dict(family=BASE_FONT, size=14, color="white"),
            categoryorder="array",
            categoryarray=df_merged["Player Name"].tolist(),
        ),
        yaxis=dict(
            showline=True,
            showgrid=False,
            zeroline=False,
            linecolor="white",
            linewidth=2,
            tickfont=dict(family=BASE_FONT, size=14, color="white"),
        ),
        plot_bgcolor="black",
        paper_bgcolor="black",
        font=dict(color="white", size=14, family=BASE_FONT),
        legend=dict(
            x=0.8,
            y=1.1,
            bgcolor="rgba(0,0,0,0)",
            font=dict(family=BASE_FONT, size=14, color="white"),
        ),
        hoverlabel=dict(font=dict(family=BASE_FONT)),
        margin=dict(l=20, r=20, t=60, b=20),
    )

    return fig

#=================================================
# TEAM GPS ---- HELPER PLAYER LOAD

def create_team_player_load_chart(df_filtered, round_to_analyze, view_mode="total"):
    df_game = df_filtered[df_filtered["Split Name"] == "game"].copy()

    keep_cols = [
        "Player Name",
        "Player Load",
        "Mins played",
        "Energy (kcal)",
        "Impacts",
        "Power Score (w/kg)",
        "Work Ratio",
    ]
    df_game = df_game[keep_cols].copy()

    numeric_cols = [
        "Player Load",
        "Mins played",
        "Energy (kcal)",
        "Impacts",
        "Power Score (w/kg)",
        "Work Ratio",
    ]
    for col in numeric_cols:
        df_game[col] = pd.to_numeric(df_game[col], errors="coerce")

    df_game = df_game.dropna(subset=["Player Load", "Mins played"])

    df_game["Player Load per 10min"] = (
        (df_game["Player Load"] / df_game["Mins played"].replace(0, pd.NA)) * 10
    ).fillna(0).round(1)

    if view_mode == "rate":
        df_game = df_game.sort_values("Player Load per 10min", ascending=False)
        y_col = "Player Load per 10min"
        y_title = "Player Load per 10 min"
        chart_title = f"Player Load per 10 min - {round_to_analyze}"
    else:
        df_game = df_game.sort_values("Player Load", ascending=False)
        y_col = "Player Load"
        y_title = "Player Load"
        chart_title = f"Player Load - {round_to_analyze}"

    hover_text = [
        f"{player}<br>"
        f"Player Load: {load:.1f}<br>"
        f"Player Load per 10 min: {rate:.1f}<br>"
        f"Energy: {energy:.0f} kcal<br>"
        f"Impacts: {impacts:.0f}<br>"
        f"Power Score: {power:.1f} w/kg<br>"
        f"Work Ratio: {ratio:.1f}<br>"
        f"Minutes: {mins:.0f} min"
        for player, load, rate, energy, impacts, power, ratio, mins in zip(
            df_game["Player Name"],
            df_game["Player Load"].fillna(0),
            df_game["Player Load per 10min"].fillna(0),
            df_game["Energy (kcal)"].fillna(0),
            df_game["Impacts"].fillna(0),
            df_game["Power Score (w/kg)"].fillna(0),
            df_game["Work Ratio"].fillna(0),
            df_game["Mins played"].fillna(0),
        )
    ]

    fig = go.Figure(
        data=[
            go.Bar(
                x=df_game["Player Name"],
                y=df_game[y_col],
                marker_color="#1E90FF",
                hoverinfo="text",
                hovertext=hover_text,
            )
        ]
    )

    fig.update_layout(
        title={
            "text": chart_title,
            "x": 0.5,
            "y": 0.95,
            "xanchor": "center",
            "yanchor": "top",
            "font": {"size": 20, "family": BASE_FONT, "color": "white"},
        },
        xaxis_title="Player Name",
        yaxis_title=y_title,
        plot_bgcolor="black",
        paper_bgcolor="black",
        font=dict(color="white", size=14, family=BASE_FONT),
        xaxis=dict(
            showline=True,
            showgrid=False,
            linecolor="white",
            linewidth=2,
            tickfont=dict(family=BASE_FONT, size=14, color="white"),
            categoryorder="array",
            categoryarray=df_game["Player Name"].tolist(),
        ),
        yaxis=dict(
            showline=True,
            showgrid=False,
            zeroline=False,
            linecolor="white",
            linewidth=2,
            tickfont=dict(family=BASE_FONT, size=14, color="white"),
        ),
        hoverlabel=dict(font=dict(family=BASE_FONT)),
        margin=dict(l=20, r=20, t=60, b=20),
    )

    return fig

#=================================================
# TEAM GPS ---- HELPER ACCELERATIONS DECELERATIONS

def create_team_accel_decel_chart(df_filtered, round_to_analyze, view_mode="total"):
    df_game = df_filtered[df_filtered["Split Name"] == "game"].copy()

    acceleration_columns = [
        "Accelerations Zone Count: 3 - 4 m/s/s",
        "Accelerations Zone Count: > 4 m/s/s",
    ]
    deceleration_columns = [
        "Deceleration Zone Count: 3 - 4 m/s/s",
        "Deceleration Zone Count: > 4 m/s/s",
    ]

    keep_cols = ["Player Name", "Mins played"] + acceleration_columns + deceleration_columns
    df_game = df_game[keep_cols].copy()

    df_game["Mins played"] = pd.to_numeric(df_game["Mins played"], errors="coerce").fillna(0)

    for col in acceleration_columns + deceleration_columns:
        df_game[col] = pd.to_numeric(df_game[col], errors="coerce").fillna(0)

    df_game["Total Accelerations >3m/s/s"] = df_game[acceleration_columns].sum(axis=1)
    df_game["Total Decelerations >3m/s/s"] = df_game[deceleration_columns].sum(axis=1)

    df_game["Accelerations per 10min"] = (
        (df_game["Total Accelerations >3m/s/s"] / df_game["Mins played"].replace(0, pd.NA)) * 10
    ).fillna(0).round(1)

    df_game["Decelerations per 10min"] = (
        (df_game["Total Decelerations >3m/s/s"] / df_game["Mins played"].replace(0, pd.NA)) * 10
    ).fillna(0).round(1)

    if view_mode == "rate":
        df_game = df_game.sort_values("Accelerations per 10min", ascending=False)
        acc_y = "Accelerations per 10min"
        dec_y = "Decelerations per 10min"
        chart_title = f"Accelerations / Decelerations per 10 min - {round_to_analyze}"
        y_title = "Count per 10 min"
    else:
        df_game = df_game.sort_values("Total Accelerations >3m/s/s", ascending=False)
        acc_y = "Total Accelerations >3m/s/s"
        dec_y = "Total Decelerations >3m/s/s"
        chart_title = f"Accelerations / Decelerations >3m/s/s - {round_to_analyze}"
        y_title = "Count"

    acc_hover = [
        f"{player}<br>"
        f"Accelerations: {acc:.0f}<br>"
        f"Accelerations per 10 min: {acc_rate:.1f}<br>"
        f"Decelerations: {dec:.0f}<br>"
        f"Decelerations per 10 min: {dec_rate:.1f}<br>"
        f"Minutes: {mins:.0f}"
        for player, acc, acc_rate, dec, dec_rate, mins in zip(
            df_game["Player Name"],
            df_game["Total Accelerations >3m/s/s"],
            df_game["Accelerations per 10min"],
            df_game["Total Decelerations >3m/s/s"],
            df_game["Decelerations per 10min"],
            df_game["Mins played"],
        )
    ]

    dec_hover = [
        f"{player}<br>"
        f"Decelerations: {dec:.0f}<br>"
        f"Decelerations per 10 min: {dec_rate:.1f}<br>"
        f"Accelerations: {acc:.0f}<br>"
        f"Accelerations per 10 min: {acc_rate:.1f}<br>"
        f"Minutes: {mins:.0f}"
        for player, dec, dec_rate, acc, acc_rate, mins in zip(
            df_game["Player Name"],
            df_game["Total Decelerations >3m/s/s"],
            df_game["Decelerations per 10min"],
            df_game["Total Accelerations >3m/s/s"],
            df_game["Accelerations per 10min"],
            df_game["Mins played"],
        )
    ]

    fig = go.Figure(
        data=[
            go.Bar(
                name="Accelerations",
                x=df_game["Player Name"],
                y=df_game[acc_y],
                marker_color="#1E90FF",
                hoverinfo="text",
                hovertext=acc_hover,
            ),
            go.Bar(
                name="Decelerations",
                x=df_game["Player Name"],
                y=df_game[dec_y],
                marker_color="#6495ED",
                hoverinfo="text",
                hovertext=dec_hover,
            ),
        ]
    )

    fig.update_layout(
        barmode="group",
        title={
            "text": chart_title,
            "y": 0.95,
            "x": 0.5,
            "xanchor": "center",
            "yanchor": "top",
            "font": {"size": 20, "family": BASE_FONT, "color": "white"},
        },
        xaxis_title="Player Name",
        yaxis_title=y_title,
        plot_bgcolor="black",
        paper_bgcolor="black",
        font=dict(color="white", size=14, family=BASE_FONT),
        xaxis=dict(
            showline=True,
            showgrid=False,
            linecolor="white",
            linewidth=2,
            tickfont=dict(family=BASE_FONT, size=14, color="white"),
            categoryorder="array",
            categoryarray=df_game["Player Name"].tolist(),
        ),
        yaxis=dict(
            showgrid=False,
            zeroline=False,
            showline=True,
            linewidth=2,
            linecolor="white",
            tickfont=dict(family=BASE_FONT, size=14, color="white"),
        ),
        margin=dict(l=20, r=20, t=60, b=20),
        legend=dict(
            x=0.8,
            y=1.1,
            bgcolor="rgba(0, 0, 0, 0)",
            bordercolor="rgba(0, 0, 0, 0)",
            font=dict(family=BASE_FONT, size=14, color="white"),
        ),
        hoverlabel=dict(font=dict(family=BASE_FONT)),
    )

    return fig

# ============================
# I THINK THIS WILL BE LAYOUT AREA
# ============================

# ---------- DASH LAYOUT ----------
app.layout = html.Div(
    [
        # ---------- Banner Title ----------
        html.Div(
            style={
                "backgroundColor": "black",
                "padding": "30px 10px",
                "textAlign": "center",
                "marginBottom": "30px",
                "borderRadius": "8px",
            },
            children=[
                html.H1(
                    APP_TITLE,
                    style={
                        "color": "white",
                        "fontFamily": HEADER_FONT,
                        "fontWeight": "bold",
                        "fontSize": "40px",
                        "margin": "0",
                    },
                )
            ],
        ),

        html.Div(style={"height": "20px"}),

        # ---------- Intro Panel ----------
        html.Div(
            [
                html.P(
                    (
                        "Belco GPS insights across both player and team views. "
                        "Use the tabs below to switch between player-based analysis "
                        "and match-based team analysis."
                    ),
                    style={
                        "color": "white",
                        "fontFamily": BASE_FONT,
                        "fontSize": "13px",
                        "textAlign": "center",
                        "margin": "0",
                    },
                ),
            ],
            style=TAB_PANEL_STYLE,
        ),

        # ---------- Top Tabs ----------
        dcc.Tabs(
            id="main-tabs",
            value="player-tab",
            children=[
                dcc.Tab(
                    label="Player GPS",
                    value="player-tab",
                    className="custom-tab",
                    selected_className="custom-tab--selected",
                ),
                dcc.Tab(
                    label="Team GPS",
                    value="team-tab",
                    className="custom-tab",
                    selected_className="custom-tab--selected",
                ),
            ],
            className="custom-tabs",
            style={"color": "white"},
        ),

        html.Br(),

        # ---------- Tab Content ----------
        html.Div(id="tab-content")
    ],
        style={
        "backgroundColor": "black",
        "minHeight": "100vh",
        "padding": "20px",
        "fontFamily": "Segoe UI",
    }
)



# ============================
# TAB/CGART LAYOUT AREA in a callback
# ============================

@callback(
    Output("tab-content", "children"),
    Input("main-tabs", "value")
)
def render_tab_content(active_tab):

    if active_tab == "player-tab":
        return dbc.Container(
            [
                html.Div(
                    [
                        html.Div(
                            [
                                dcc.Dropdown(
                                    id="player-year-dropdown",
                                    options=[{"label": y, "value": y} for y in ["2026", "2025", "2024"]],
                                    value="2026",
                                    clearable=False,
                                    style={
                                        "width": "140px",
                                        "color": "black",
                                        "fontFamily": title_font["fontFamily"],
                                        "fontSize": "14px",
                                        "marginRight": "10px",
                                    },
                                ),

                                dcc.Dropdown(
                                    id="player-dropdown",
                                    options=[],  # will be populated by callback
                                    placeholder="Select a Player",
                                    clearable=True,
                                    style={
                                        "width": "260px",
                                        "color": "black",
                                        "fontFamily": title_font["fontFamily"],
                                        "fontSize": "14px",
                                    },
                                ),
                            ],
                            style={
                                "display": "flex",
                                "justifyContent": "center",
                                "marginBottom": "10px",
                            },
                        ),
                        html.P(
                            "Select a player to drive the player GPS charts.",
                            style={
                                "color": "white",
                                "fontFamily": base_font["fontFamily"],
                                "fontSize": "13px",
                                "textAlign": "center",
                                "margin": "0",
                            },
                        ),
                    ],
                    style=SECTION_CARD_STYLE,
                ),

                html.Div(
                    [
                        chart_header("Total Distance"),

                        html.Div(
                            [
                                html.Button("Round Order", id="player-distance-btn-date", n_clicks=0, style=button_style),
                                html.Button("Lowest to Highest", id="player-distance-btn-value", n_clicks=0, style=button_style),
                                html.Button("Form (Last 5 Rounds)", id="player-distance-btn-form", n_clicks=0, style=button_style),
                            ],
                            style=BUTTON_ROW_STYLE,
                        ),

                        dcc.Graph(
                            id="player-total-distance-chart",
                            style={"backgroundColor": "black"},
                        ),
                    ],
                    style=SECTION_CARD_STYLE,
                ),

                html.Div(
                    [
                        chart_header("High Speed Metres (>18km/h)"),
                        
                        html.Div(
                            [
                                html.Button("Round Order", id="sprint-btn-date", n_clicks=0, style=button_style),
                                html.Button("Lowest to Highest", id="sprint-btn-value", n_clicks=0, style=button_style),
                                html.Button("Form (Last 5 Rounds)", id="sprint-btn-form", n_clicks=0, style=button_style),
                            ],
                            style=BUTTON_ROW_STYLE,
                        ),

                        dcc.Graph(
                            id="sprint-distance-chart",
                            style={"backgroundColor": "black"},
                        ),
                    ],
                    style=SECTION_CARD_STYLE,
                ),


                html.Div(
                    [
                        chart_header("Very High Speed Metres (>25 km/h)"),

                        html.Div(
                            [
                                html.Button("Round Order", id="player-vhs-btn-date", n_clicks=0, style=button_style),
                                html.Button("Lowest to Highest", id="player-vhs-btn-value", n_clicks=0, style=button_style),
                                html.Button("Form (Last 5 Rounds)", id="player-vhs-btn-form", n_clicks=0, style=button_style),
                            ],
                            style=BUTTON_ROW_STYLE,
                        ),

                        dcc.Graph(
                            id="player-vhs-chart",
                            style={"backgroundColor": "black"},
                        ),
                    ],
                    style=SECTION_CARD_STYLE,
                ),

                html.Div(
                                    [
                                        chart_header("Top Speed"),

                                        html.Div(
                                            [
                                                html.Button("Round Order", id="top-speed-btn-date", n_clicks=0, style=button_style),
                                                html.Button("Lowest to Highest", id="top-speed-btn-value", n_clicks=0, style=button_style),
                                                html.Button("Form (Last 5 Rounds)", id="top-speed-btn-form", n_clicks=0, style=button_style),
                                            ],
                                            style=BUTTON_ROW_STYLE,
                                        ),

                                        dcc.Graph(
                                            id="top-speed-chart",
                                            style={"backgroundColor": "black"},
                                        ),
                                    ],
                                    style=SECTION_CARD_STYLE,
                                ),

                html.Div(
                    [
                        chart_header("Power Plays"),

                        html.Div(
                            [
                                html.Button("Round Order", id="pp-btn-date", n_clicks=0, style=button_style),
                                html.Button("Lowest to Highest", id="pp-btn-value", n_clicks=0, style=button_style),
                                html.Button("Form (Last 5 Rounds)", id="pp-btn-form", n_clicks=0, style=button_style),
                            ],
                            style=BUTTON_ROW_STYLE,
                        ),

                        dcc.Graph(
                            id="power-plays-chart",
                            style={"backgroundColor": "black"},
                        ),
                    ],
                    style=SECTION_CARD_STYLE,
                ),

                html.Div(
                    [
                        chart_header("Distance Per Minute"),

                        html.Div(
                            [
                                html.Button("Round Order", id="dpm-btn-date", n_clicks=0, style=button_style),
                                html.Button("Lowest to Highest", id="dpm-btn-value", n_clicks=0, style=button_style),
                                html.Button("Form (Last 5 Rounds)", id="dpm-btn-form", n_clicks=0, style=button_style),
                            ],
                            style=BUTTON_ROW_STYLE,
                        ),

                        dcc.Graph(
                            id="distance-per-min-chart",
                            style={"backgroundColor": "black"},
                        ),
                    ],
                    style=SECTION_CARD_STYLE,
                ),


                html.Div(
                    [
                        chart_header("Player Load"),

                        html.Div(
                            [
                                html.Button("Round Order", id="player-load-btn-date", n_clicks=0, style=button_style),
                                html.Button("Lowest to Highest", id="player-load-btn-value", n_clicks=0, style=button_style),
                                html.Button("Form (Last 5 Rounds)", id="player-load-btn-form", n_clicks=0, style=button_style),
                            ],
                            style=BUTTON_ROW_STYLE,
                        ),

                        dcc.Graph(
                            id="player-load-chart",
                            style={"backgroundColor": "black"},
                        ),
                    ],
                    style=SECTION_CARD_STYLE,
                ),


                html.Div(
                    [
                        chart_header("Accelerations / Decelerations"),

                        html.Div(
                            [
                                html.Button("Round Order", id="accel-btn-date", n_clicks=0, style=button_style),
                                html.Button("Lowest to Highest", id="accel-btn-value", n_clicks=0, style=button_style),
                                html.Button("Form (Last 5 Rounds)", id="accel-btn-form", n_clicks=0, style=button_style),
                            ],
                            style=BUTTON_ROW_STYLE,
                        ),

                        dcc.Graph(
                            id="accel-decel-chart",
                            style={"backgroundColor": "black"},
                        ),
                    ],
                    style=SECTION_CARD_STYLE,
                ),


            ],
            fluid=True,
        )

    if active_tab == "team-tab":
        return dbc.Container(
            [
                html.Div(
                    [
                        html.Div(
                            [
                                html.Div(
                                    [
                                        
                                        dcc.Dropdown(
                                            id="team-year-dropdown",
                                            options=[{"label": y, "value": y} for y in ["2026", "2025", "2024"]],
                                            value="2026",
                                            clearable=False,
                                            style={
                                                "width": "140px",
                                                "color": "black",
                                                "fontFamily": title_font["fontFamily"],
                                                "fontSize": "14px",
                                            },
                                        ),
                                    ],
                                    style={"marginRight": "20px"},
                                ),
                                
                                html.Div(
                                    [
                                        
                                        dcc.Dropdown(
                                            id="team-dropdown",
                                            options=[
                                                {"label": team, "value": team}
                                                for team in sorted(df["Team"].dropna().unique())
                                            ] if "Team" in df.columns else [],
                                            placeholder="Select a Team",
                                            clearable=False,
                                            style={
                                                "width": "220px",
                                                "color": "black",
                                                "fontFamily": title_font["fontFamily"],
                                                "fontSize": "14px",
                                            },
                                        ),
                                    ],
                                    style={"marginRight": "20px"},
                                ),

                                html.Div(
                                    [
                                        dcc.Dropdown(
                                            id="round-dropdown",
                                            options=[],
                                            placeholder="Select a Round",
                                            clearable=False,
                                            style={
                                                "width": "220px",
                                                "color": "black",
                                                "fontFamily": title_font["fontFamily"],
                                                "fontSize": "14px",
                                            },
                                        ),
                                    ],
                                    style={"marginRight": "20px"},
                                ),

                                html.Div(
                                    [
                                        
                                        html.Button(
                                            "Update Charts",
                                            id="update-team-tab",
                                            n_clicks=0,
                                            style=button_style,
                                        ),
                                    ]
                                ),
                            ],
                            style={
                                "display": "flex",
                                "justifyContent": "center",
                                "alignItems": "flex-end",
                                "flexWrap": "wrap",
                                "gap": "10px",
                            },
                        ),

                        html.P(
                            "Select a team and round to drive the team GPS charts.",
                            style={
                                "color": "white",
                                "fontFamily": base_font["fontFamily"],
                                "fontSize": "13px",
                                "textAlign": "center",
                                "marginTop": "15px",
                                "marginBottom": "0",
                            },
                        ),
                    ],
                    style=SECTION_CARD_STYLE,
                ),

                html.Div(
                    [
                        chart_header("Total Distance"),

                        html.Div(
                            [
                                html.Button("Total", id="team-distance-btn-total", n_clicks=0, style=button_style),
                                html.Button("Per 10 min", id="team-distance-btn-rate", n_clicks=0, style=button_style),
                                html.Button("Halves", id="team-distance-btn-halves", n_clicks=0, style=button_style),
                            ],
                            style=BUTTON_ROW_STYLE,
                        ),

                        dcc.Graph(
                            id="team-distance-chart",
                            style={"backgroundColor": "black"},
                        ),
                    ],
                    style=SECTION_CARD_STYLE,
                ),

                html.Div(
                    [
                        chart_header("High Speed Metres (>18km/h)"),

                        html.Div(
                            [
                                html.Button("Total", id="team-sprint-btn-total", n_clicks=0, style=button_style),
                                html.Button("Per 10 min", id="team-sprint-btn-rate", n_clicks=0, style=button_style),
                                html.Button("Halves", id="team-sprint-btn-halves", n_clicks=0, style=button_style),
                            ],
                            style=BUTTON_ROW_STYLE,
                        ),

                        dcc.Graph(
                            id="team-sprint-distance-chart",
                            style={"backgroundColor": "black"},
                        ),
                    ],
                    style=SECTION_CARD_STYLE,
                ),


                html.Div(
                    [
                        chart_header("Very High Speed Metres (>25 km/h)"),

                        html.Div(
                            [
                                html.Button("Total", id="team-vhs-btn-total", n_clicks=0, style=button_style),
                                html.Button("Per 10 min", id="team-vhs-btn-rate", n_clicks=0, style=button_style),
                                html.Button("Halves", id="team-vhs-btn-halves", n_clicks=0, style=button_style),
                            ],
                            style=BUTTON_ROW_STYLE,
                        ),

                        dcc.Graph(
                            id="team-vhs-chart",
                            style={"backgroundColor": "black"},
                        ),
                    ],
                    style=SECTION_CARD_STYLE,
                ),

                html.Div(
                    [
                        chart_header("Top Speed"),

                        html.Div(
                            [
                                html.Button("Halves", id="team-top-speed-btn-halves", n_clicks=0, style=button_style),
                                html.Button("Max", id="team-top-speed-btn-max", n_clicks=0, style=button_style),
                            ],
                            style=BUTTON_ROW_STYLE,
                        ),

                        dcc.Graph(
                            id="team-top-speed-chart",
                            style={"backgroundColor": "black"},
                        ),
                    ],
                    style=SECTION_CARD_STYLE,
                ),              
                
                html.Div(
                    [
                        chart_header("Power Plays"),

                        html.Div(
                            [
                                html.Button("Total", id="team-pp-btn-total", n_clicks=0, style=button_style),
                                html.Button("Per 10 min", id="team-pp-btn-rate", n_clicks=0, style=button_style),
                            ],
                            style=BUTTON_ROW_STYLE,
                        ),

                        dcc.Graph(
                            id="team-power-plays-chart",
                            style={"backgroundColor": "black"},
                        ),
                    ],
                    style=SECTION_CARD_STYLE,
                ),

                html.Div(
                    [
                        chart_header("Distance Per Minute"),

                        html.Div(
                            [
                                html.Button("Game", id="team-dpm-btn-total", n_clicks=0, style=button_style),
                                html.Button("Halves", id="team-dpm-btn-halves", n_clicks=0, style=button_style),
                            ],
                            style=BUTTON_ROW_STYLE,
                        ),

                        dcc.Graph(
                            id="team-distance-per-min-chart",
                            style={"backgroundColor": "black"},
                        ),
                    ],
                    style=SECTION_CARD_STYLE,
                ),

                html.Div(
                    [
                        chart_header("Player Load"),

                        html.Div(
                            [
                                html.Button("Total", id="team-player-load-btn-total", n_clicks=0, style=button_style),
                                html.Button("Per 10 min", id="team-player-load-btn-rate", n_clicks=0, style=button_style),
                            ],
                            style=BUTTON_ROW_STYLE,
                        ),

                        dcc.Graph(
                            id="team-player-load-chart",
                            style={"backgroundColor": "black"},
                        ),
                    ],
                    style=SECTION_CARD_STYLE,
                ),

                html.Div(
                    [
                        chart_header("Accelerations / Decelerations >3m/s"),

                        html.Div(
                            [
                                html.Button("Total", id="team-accel-btn-total", n_clicks=0, style=button_style),
                                html.Button("Per 10 min", id="team-accel-btn-rate", n_clicks=0, style=button_style),
                            ],
                            style=BUTTON_ROW_STYLE,
                        ),

                        dcc.Graph(
                            id="team-accel-decel-chart",
                            style={"backgroundColor": "black"},
                        ),
                    ],
                    style=SECTION_CARD_STYLE,
                ),


            ],
            fluid=True,
        )

    return html.Div("No tab selected.", style={"color": "white"})


#===========================
# REAL CALLBACKS START HERE
#============================

#----------------------
# - These are new for the year dropdowns

# Player dropdowns

@app.callback(
    Output("player-dropdown", "options"),
    Input("player-year-dropdown", "value")
)
def update_player_dropdown(selected_year):
    dff = df[df["Year"] == selected_year]

    players = sorted(dff["Player Name"].dropna().unique())

    return [{"label": p, "value": p} for p in players]


# Team dropdowns

@app.callback(
    Output("team-dropdown", "options"),
    Input("team-year-dropdown", "value")
)
def update_team_dropdown(selected_year):
    dff = df[df["Year"] == selected_year]

    teams = sorted(dff["Team"].dropna().unique())

    return [{"label": t, "value": t} for t in teams]


# ================================
# - Populates the Round dropdown

@app.callback(
    Output("round-dropdown", "options"),
    Input("team-year-dropdown", "value"),
    Input("team-dropdown", "value")
)
def update_round_dropdown(year, team):
    if not year or not team:
        return []

    dff = df[(df["Year"] == year) & (df["Team"] == team)]

    rounds = dff["Round"].dropna().astype(str).unique().tolist()

    def round_sort_key(x):
        x = str(x).strip().lower()

        if x.startswith("r") and x[1:].isdigit():
            return (0, int(x[1:]))

        if x.isdigit():
            return (0, int(x))

        return (1, x)

    rounds = sorted(rounds, key=round_sort_key)

    return [{"label": r, "value": r} for r in rounds]
        



# ========================================
# CALLBACK PLAYER GPS ---- TOTAL DISTANCE

@callback(
    Output("player-total-distance-chart", "figure"),
    [
        Input("player-year-dropdown", "value"),
        Input("player-dropdown", "value"),
        Input("player-distance-btn-date", "n_clicks"),
        Input("player-distance-btn-value", "n_clicks"),
        Input("player-distance-btn-form", "n_clicks"),
    ],
)
def update_player_total_distance_chart(selected_year, selected_player, btn_date, btn_value, btn_form):
    if not selected_year or not selected_player:
        return go.Figure()

    triggered = ctx.triggered_id

    if triggered == "player-distance-btn-value":
        sort_order = "value"
    elif triggered == "player-distance-btn-form":
        sort_order = "form"
    else:
        sort_order = "date"

    df_filtered = df[
        (df["Year"] == selected_year) &
        (df["Player Name"] == selected_player)
    ].copy()

    return create_player_total_distance_chart(df_filtered, selected_player, sort_order)

# =========================================
# CALLBACK PLAYER GPS ---- HIGH SPEED METRES

@callback(
    Output("sprint-distance-chart", "figure"),
    [
        Input("player-year-dropdown", "value"),
        Input("player-dropdown", "value"),
        Input("sprint-btn-date", "n_clicks"),
        Input("sprint-btn-value", "n_clicks"),
        Input("sprint-btn-form", "n_clicks"),
    ],
)
def update_sprint_chart(selected_year, selected_player, btn_date, btn_value, btn_form):
    if not selected_year or not selected_player:
        return go.Figure()

    triggered = ctx.triggered_id

    if triggered == "sprint-btn-value":
        sort_order = "value"
    elif triggered == "sprint-btn-form":
        sort_order = "form"
    else:
        sort_order = "date"

    df_filtered = df[
        (df["Year"] == selected_year) &
        (df["Player Name"] == selected_player)
    ].copy()

    return create_sprint_distance_chart(df_filtered, selected_player, sort_order)


# =========================================
# CALLBACK PLAYER GPS ---- VERY HIGH SPEED METRES

@callback(
    Output("player-vhs-chart", "figure"),
    [
        Input("player-year-dropdown", "value"),
        Input("player-dropdown", "value"),
        Input("player-vhs-btn-date", "n_clicks"),
        Input("player-vhs-btn-value", "n_clicks"),
        Input("player-vhs-btn-form", "n_clicks"),
    ],
)
def update_player_vhs_chart(selected_year, selected_player, btn_date, btn_value, btn_form):
    if not selected_year or not selected_player:
        return go.Figure()

    triggered = ctx.triggered_id

    if triggered == "player-vhs-btn-value":
        sort_order = "value"
    elif triggered == "player-vhs-btn-form":
        sort_order = "form"
    else:
        sort_order = "date"

    df_filtered = df[
        (df["Year"] == selected_year) &
        (df["Player Name"] == selected_player)
    ].copy()

    return create_player_vhs_chart(df_filtered, selected_player, sort_order)


# =========================
# CALLBACK PLAYER GPS ---- POWER PLAY

@callback(
    Output("power-plays-chart", "figure"),
    [
        Input("player-year-dropdown", "value"),
        Input("player-dropdown", "value"),
        Input("pp-btn-date", "n_clicks"),
        Input("pp-btn-value", "n_clicks"),
        Input("pp-btn-form", "n_clicks"),
    ],
)
def update_power_plays_chart(selected_year, selected_player, btn_date, btn_value, btn_form):
    if not selected_year or not selected_player:
        return go.Figure()

    triggered = ctx.triggered_id

    if triggered == "pp-btn-value":
        sort_order = "value"
    elif triggered == "pp-btn-form":
        sort_order = "form"
    else:
        sort_order = "date"

    df_filtered = df[
        (df["Year"] == selected_year) &
        (df["Player Name"] == selected_player)
    ].copy()

    return create_power_plays_chart(df_filtered, selected_player, sort_order)

# =========================
# CALLBACK PLAYER GPS ---- DISTANCE PER MINUTE

@callback(
    Output("distance-per-min-chart", "figure"),
    [
        Input("player-year-dropdown", "value"),
        Input("player-dropdown", "value"),
        Input("dpm-btn-date", "n_clicks"),
        Input("dpm-btn-value", "n_clicks"),
        Input("dpm-btn-form", "n_clicks"),
    ],
)
def update_distance_per_min_chart(selected_year, selected_player, btn_date, btn_value, btn_form):
    if not selected_year or not selected_player:
        return go.Figure()

    triggered = ctx.triggered_id

    if triggered == "dpm-btn-value":
        sort_order = "value"
    elif triggered == "dpm-btn-form":
        sort_order = "form"
    else:
        sort_order = "date"

    df_filtered = df[
        (df["Year"] == selected_year) &
        (df["Player Name"] == selected_player)
    ].copy()

    return create_distance_per_min_chart(df_filtered, selected_player, sort_order)

# =========================
# CALLBACK PLAYER GPS ---- TOP SPEED

@callback(
    Output("top-speed-chart", "figure"),
    [
        Input("player-year-dropdown", "value"),
        Input("top-speed-btn-date", "n_clicks"),
        Input("top-speed-btn-value", "n_clicks"),
        Input("top-speed-btn-form", "n_clicks"),
        Input("player-dropdown", "value"),
    ],
)
def update_top_speed_chart(selected_year, btn_date, btn_value, btn_form, selected_player):
    if not selected_year or not selected_player:
        return go.Figure()

    triggered = ctx.triggered_id

    if triggered == "top-speed-btn-value":
        sort_order = "value"
    elif triggered == "top-speed-btn-form":
        sort_order = "form"
    else:
        sort_order = "date"

    df_filtered = df[
        (df["Year"] == selected_year) &
        (df["Player Name"] == selected_player)
    ].copy()

    return create_top_speed_chart(df_filtered, selected_player, sort_order)

# =========================
# CALLBACK PLAYER GPS ---- PLAYER LOAD

@callback(
    Output("player-load-chart", "figure"),
    [
        Input("player-year-dropdown", "value"),
        Input("player-dropdown", "value"),
        Input("player-load-btn-date", "n_clicks"),
        Input("player-load-btn-value", "n_clicks"),
        Input("player-load-btn-form", "n_clicks"),
    ],
)
def update_player_load_chart(selected_year, selected_player, btn_date, btn_value, btn_form):
    if not selected_year or not selected_player:
        return go.Figure()

    triggered = ctx.triggered_id

    if triggered == "player-load-btn-value":
        sort_order = "value"
    elif triggered == "player-load-btn-form":
        sort_order = "form"
    else:
        sort_order = "date"

    df_filtered = df[
        (df["Year"] == selected_year) &
        (df["Player Name"] == selected_player)
    ].copy()

    return create_player_load_chart(df_filtered, selected_player, sort_order)


# ===================================
# CALLBACK PLAYER GPS ---- ACCELERATIONS DECELERATIONS

@callback(
    Output("accel-decel-chart", "figure"),
    [
        Input("player-year-dropdown", "value"),
        Input("accel-btn-date", "n_clicks"),
        Input("accel-btn-value", "n_clicks"),
        Input("accel-btn-form", "n_clicks"),
        Input("player-dropdown", "value"),
    ],
)
def update_accel_decel_chart(selected_year, btn_date, btn_value, btn_form, selected_player):
    if not selected_year or not selected_player:
        return go.Figure()

    triggered = ctx.triggered_id

    if triggered == "accel-btn-value":
        sort_order = "value"
    elif triggered == "accel-btn-form":
        sort_order = "form"
    else:
        sort_order = "date"

    df_filtered = df[
        (df["Year"] == selected_year) &
        (df["Player Name"] == selected_player)
    ].copy()

    return create_accel_decel_chart(df_filtered, selected_player, sort_order)

# =================================================
# CALLBACK TEAM GPS ---- TOTAL DISTANCE

@callback(
    Output("team-distance-chart", "figure"),
    Input("update-team-tab", "n_clicks"),
    Input("team-distance-btn-total", "n_clicks"),
    Input("team-distance-btn-rate", "n_clicks"),
    Input("team-distance-btn-halves", "n_clicks"),
    State("team-year-dropdown", "value"),
    State("team-dropdown", "value"),
    State("round-dropdown", "value"),
)
def update_team_distance_chart(n_update, btn_total, btn_rate, btn_halves, selected_year, selected_team, selected_round):
    if not selected_year or not selected_team or not selected_round:
        return go.Figure()

    triggered = ctx.triggered_id

    if triggered == "team-distance-btn-rate":
        view_mode = "rate"
    elif triggered == "team-distance-btn-halves":
        view_mode = "halves"
    else:
        view_mode = "total"

    df_filtered = df[
        (df["Year"] == selected_year) &
        (df["Team"] == selected_team) &
        (df["Round"].astype(str) == str(selected_round))
    ].copy()

    if df_filtered.empty:
        return go.Figure()

    return create_team_distance_chart(df_filtered, selected_round, view_mode)

# =================================================
# CALLBACK TEAM GPS ---- HIGH SPEED METRES

@callback(
    Output("team-sprint-distance-chart", "figure"),
    Input("update-team-tab", "n_clicks"),
    Input("team-sprint-btn-total", "n_clicks"),
    Input("team-sprint-btn-rate", "n_clicks"),
    Input("team-sprint-btn-halves", "n_clicks"),
    State("team-year-dropdown", "value"),
    State("team-dropdown", "value"),
    State("round-dropdown", "value"),
)
def update_team_sprint_chart(n_update, btn_total, btn_rate, btn_halves, selected_year, selected_team, selected_round):
    if not selected_year or not selected_team or not selected_round:
        return go.Figure()

    triggered = ctx.triggered_id

    if triggered == "team-sprint-btn-rate":
        view_mode = "rate"
    elif triggered == "team-sprint-btn-halves":
        view_mode = "halves"
    else:
        view_mode = "total"

    df_filtered = df[
        (df["Year"] == selected_year) &
        (df["Team"] == selected_team) &
        (df["Round"].astype(str) == str(selected_round))
    ].copy()

    if df_filtered.empty:
        return go.Figure()

    return create_team_sprint_distance_chart(df_filtered, selected_round, view_mode)


# =================================================
# CALLBACK TEAM GPS ---- VERY HIGH SPEED METRES

@callback(
    Output("team-vhs-chart", "figure"),
    Input("update-team-tab", "n_clicks"),
    Input("team-vhs-btn-total", "n_clicks"),
    Input("team-vhs-btn-rate", "n_clicks"),
    Input("team-vhs-btn-halves", "n_clicks"),
    State("team-year-dropdown", "value"),
    State("team-dropdown", "value"),
    State("round-dropdown", "value"),
)
def update_team_vhs_chart(n_update, btn_total, btn_rate, btn_halves, selected_year, selected_team, selected_round):
    if not selected_year or not selected_team or not selected_round:
        return go.Figure()

    triggered = ctx.triggered_id

    if triggered == "team-vhs-btn-rate":
        view_mode = "rate"
    elif triggered == "team-vhs-btn-halves":
        view_mode = "halves"
    else:
        view_mode = "total"

    df_filtered = df[
        (df["Year"] == selected_year) &
        (df["Team"] == selected_team) &
        (df["Round"].astype(str) == str(selected_round))
    ].copy()

    if df_filtered.empty:
        return go.Figure()

    return create_team_vhs_chart(df_filtered, selected_round, view_mode)


# =================================================
# CALLBACK TEAM GPS ---- TOP SPEED

@callback(
    Output("team-top-speed-chart", "figure"),
    Input("update-team-tab", "n_clicks"),
    Input("team-top-speed-btn-halves", "n_clicks"),
    Input("team-top-speed-btn-max", "n_clicks"),
    State("team-year-dropdown", "value"),
    State("team-dropdown", "value"),
    State("round-dropdown", "value"),
)
def update_team_top_speed_chart(n_update, btn_halves, btn_max, selected_year, selected_team, selected_round):
    if not selected_year or not selected_team or not selected_round:
        return go.Figure()

    triggered = ctx.triggered_id

    if triggered == "team-top-speed-btn-max":
        view_mode = "max"
    else:
        view_mode = "halves"

    df_filtered = df[
        (df["Year"] == selected_year) &
        (df["Team"] == selected_team) &
        (df["Round"].astype(str) == str(selected_round))
    ].copy()

    if df_filtered.empty:
        return go.Figure()

    return create_team_top_speed_chart(df_filtered, selected_round, view_mode)


# =================================================
# CALLBACK TEAM GPS ---- POWER PLAYS

@callback(
    Output("team-power-plays-chart", "figure"),
    Input("update-team-tab", "n_clicks"),
    Input("team-pp-btn-total", "n_clicks"),
    Input("team-pp-btn-rate", "n_clicks"),
    State("team-year-dropdown", "value"),
    State("team-dropdown", "value"),
    State("round-dropdown", "value"),
)
def update_team_power_plays_chart(n_update, btn_total, btn_rate, selected_year, selected_team, selected_round):
    if not selected_year or not selected_team or not selected_round:
        return go.Figure()

    triggered = ctx.triggered_id

    if triggered == "team-pp-btn-rate":
        view_mode = "rate"
    else:
        view_mode = "total"

    df_filtered = df[
        (df["Year"] == selected_year) &
        (df["Team"] == selected_team) &
        (df["Round"].astype(str) == str(selected_round))
    ].copy()

    if df_filtered.empty:
        return go.Figure(
            data=[],
            layout=go.Layout(
                title="No data available",
                plot_bgcolor="black",
                paper_bgcolor="black",
                font=dict(color="white", size=14, family=BASE_FONT),
            ),
        )

    return create_team_power_plays_chart(df_filtered, selected_round, view_mode)

# =================================================
# CALLBACK TEAM GPS ---- DISTANCE PER MINUTE

@callback(
    Output("team-distance-per-min-chart", "figure"),
    Input("update-team-tab", "n_clicks"),
    Input("team-dpm-btn-total", "n_clicks"),
    Input("team-dpm-btn-halves", "n_clicks"),
    State("team-year-dropdown", "value"),
    State("team-dropdown", "value"),
    State("round-dropdown", "value"),
)
def update_team_distance_per_min_chart(n_update, btn_total, btn_halves, selected_year, selected_team, selected_round):
    if not selected_year or not selected_team or not selected_round:
        return go.Figure()

    triggered = ctx.triggered_id

    if triggered == "team-dpm-btn-halves":
        view_mode = "halves"
    else:
        view_mode = "total"

    df_filtered = df[
        (df["Year"] == selected_year) &
        (df["Team"] == selected_team) &
        (df["Round"].astype(str) == str(selected_round))
    ].copy()

    if df_filtered.empty:
        return go.Figure()

    return create_team_distance_per_min_chart(df_filtered, selected_round, view_mode)


# =================================================
# CALLBACK TEAM GPS ---- PLAYER LOAD

@callback(
    Output("team-player-load-chart", "figure"),
    Input("update-team-tab", "n_clicks"),
    Input("team-player-load-btn-total", "n_clicks"),
    Input("team-player-load-btn-rate", "n_clicks"),
    State("team-year-dropdown", "value"),
    State("team-dropdown", "value"),
    State("round-dropdown", "value"),
)
def update_team_player_load_chart(n_update, btn_total, btn_rate, selected_year, selected_team, selected_round):
    if not selected_year or not selected_team or not selected_round:
        return go.Figure()

    triggered = ctx.triggered_id

    if triggered == "team-player-load-btn-rate":
        view_mode = "rate"
    else:
        view_mode = "total"

    df_filtered = df[
        (df["Year"] == selected_year) &
        (df["Team"] == selected_team) &
        (df["Round"].astype(str) == str(selected_round))
    ].copy()

    if df_filtered.empty:
        return go.Figure()

    return create_team_player_load_chart(df_filtered, selected_round, view_mode)

# =================================================
# CALLBACK TEAM GPS ---- ACCELERATIONS DECELERATIONS

@callback(
    Output("team-accel-decel-chart", "figure"),
    Input("update-team-tab", "n_clicks"),
    Input("team-accel-btn-total", "n_clicks"),
    Input("team-accel-btn-rate", "n_clicks"),
    State("team-year-dropdown", "value"),
    State("team-dropdown", "value"),
    State("round-dropdown", "value"),
)
def update_team_accel_decel_chart(n_update, btn_total, btn_rate, selected_year, selected_team, selected_round):
    if not selected_year or not selected_team or not selected_round:
        return go.Figure()

    triggered = ctx.triggered_id

    if triggered == "team-accel-btn-rate":
        view_mode = "rate"
    else:
        view_mode = "total"

    df_filtered = df[
        (df["Year"] == selected_year) &
        (df["Team"] == selected_team) &
        (df["Round"].astype(str) == str(selected_round))
    ].copy()

    if df_filtered.empty:
        return go.Figure()

    return create_team_accel_decel_chart(df_filtered, selected_round, view_mode)



# last block

# Local development entry point
if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 8050)),
        debug=True
    )

