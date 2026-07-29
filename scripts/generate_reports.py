from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import (
    Image as ReportImage,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "public" / "data" / "dashboard.json"
REPORT_DIR = ROOT / "public" / "reports"
MANIFEST_PATH = REPORT_DIR / "report-manifest.json"
ASSET_DIR = ROOT / "public" / "assets"
TMP_MAP_DIR = ROOT / "tmp" / "report-maps"
LOGO_IGPE = ASSET_DIR / "igpe.png"
LOGO_SEGES = ASSET_DIR / "seges-seplag-pe.jpeg"
LOGO_SEPLAG = ASSET_DIR / "logo-seplag-gov-report.png"
LOGO_IGPE_SMALL = ASSET_DIR / "igpe-report-small.png"
LOGO_SEGES_SMALL = ASSET_DIR / "seges-seplag-pe-report-small.jpg"
LOGO_SEPLAG_SMALL = ASSET_DIR / "logo-seplag-gov-report-small.jpg"

LAYER_LABELS = {
    "pocos": "Pocos comunitarios",
    "dessalinizadores": "Dessalinizadores",
    "sisar": "SAA / SISAR",
    "barragens": "Barragens",
    "outorgas_subterraneas": "Outorgas subterraneas",
    "outorgas_superficiais": "Outorgas superficiais",
    "sda_pad": "PAD / SDA",
    "sda_pisf": "PISF / SDA",
    "ipa_pocos": "Pocos IPA",
    "ipa_barreiros": "Barreiros IPA georreferenciados",
}

DIRECT_LAYERS = {"pocos", "dessalinizadores", "sisar", "outorgas_subterraneas", "sda_pad", "sda_pisf", "ipa_pocos"}
SDA_LAYERS = {"sda_pad", "sda_pisf"}
IPA_LAYERS = {"ipa_pocos", "ipa_barreiros"}
SRHS_LAYERS = [layer for layer in LAYER_LABELS if layer not in SDA_LAYERS | IPA_LAYERS]
LAYER_COLORS = {
    "pocos": "#006591",
    "dessalinizadores": "#16a34a",
    "sisar": "#7c3aed",
    "barragens": "#f97316",
    "outorgas_subterraneas": "#0f766e",
    "outorgas_superficiais": "#dc2626",
    "sda_pad": "#0d9488",
    "sda_pisf": "#2563eb",
    "ipa_pocos": "#7c2d12",
    "ipa_barreiros": "#a16207",
}


def normalize(value: Any) -> str:
    import unicodedata

    text = str(value or "").strip().lower()
    text = unicodedata.normalize("NFD", text)
    return "".join(ch for ch in text if unicodedata.category(ch) != "Mn")


def title(value: Any) -> str:
    return str(value or "-").strip().title()


def slug(value: str) -> str:
    value = normalize(value)
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value or "relatorio"


def n(value: Any) -> int:
    try:
        return int(round(float(value or 0)))
    except Exception:
        return 0


def money(value: Any) -> str:
    value = float(value or 0)
    if abs(value) >= 1_000_000_000:
        return f"R$ {value / 1_000_000_000:.1f} bi".replace(".", ",")
    if abs(value) >= 1_000_000:
        return f"R$ {value / 1_000_000:.1f} mi".replace(".", ",")
    return f"R$ {value:,.0f}".replace(",", "X").replace(".", ",").replace("X", ".")


def num(value: Any) -> str:
    return f"{n(value):,}".replace(",", ".")


def pct(value: Any) -> str:
    return f"{float(value or 0) * 100:.0f}%".replace(".", ",")


def load_data() -> dict[str, Any]:
    return json.loads(DATA_PATH.read_text(encoding="utf-8"))


def all_points(data: dict[str, Any]) -> list[dict[str, Any]]:
    points: list[dict[str, Any]] = []
    for key in LAYER_LABELS:
        points.extend(data.get("layers", {}).get(key, []))
    return points


def geometry_rings(geometry: dict[str, Any]) -> list[list[tuple[float, float]]]:
    if not geometry:
        return []
    rings: list[list[tuple[float, float]]] = []
    if geometry.get("type") == "Polygon":
        polygons = [geometry.get("coordinates", [])]
    elif geometry.get("type") == "MultiPolygon":
        polygons = geometry.get("coordinates", [])
    else:
        return rings
    for polygon in polygons:
        if polygon:
            rings.append([(float(lon), float(lat)) for lon, lat, *_ in polygon[0]])
    return rings


def point_on_segment(
    point: tuple[float, float],
    start: tuple[float, float],
    end: tuple[float, float],
    tolerance: float = 1e-10,
) -> bool:
    px, py = point
    ax, ay = start
    bx, by = end
    cross = (px - ax) * (by - ay) - (py - ay) * (bx - ax)
    if abs(cross) > tolerance:
        return False
    return (
        min(ax, bx) - tolerance <= px <= max(ax, bx) + tolerance
        and min(ay, by) - tolerance <= py <= max(ay, by) + tolerance
    )


def point_in_ring(point: tuple[float, float], ring: list[list[float]]) -> bool:
    if len(ring) < 3:
        return False
    inside = False
    px, py = point
    previous = (float(ring[-1][0]), float(ring[-1][1]))
    for coordinate in ring:
        current = (float(coordinate[0]), float(coordinate[1]))
        if point_on_segment(point, previous, current):
            return True
        ax, ay = previous
        bx, by = current
        if (ay > py) != (by > py):
            intersection_x = (bx - ax) * (py - ay) / (by - ay) + ax
            if px < intersection_x:
                inside = not inside
        previous = current
    return inside


def geometry_contains_point(geometry: dict[str, Any], lng: float, lat: float) -> bool:
    geometry_type = geometry.get("type")
    if geometry_type == "Polygon":
        polygons = [geometry.get("coordinates", [])]
    elif geometry_type == "MultiPolygon":
        polygons = geometry.get("coordinates", [])
    else:
        return False

    point = (lng, lat)
    for polygon in polygons:
        if not polygon or not point_in_ring(point, polygon[0]):
            continue
        if not any(point_in_ring(point, hole) for hole in polygon[1:]):
            return True
    return False


def municipal_map_path(data: dict[str, Any], key: str, municipality: str) -> Path | None:
    from PIL import Image, ImageDraw, ImageFont

    rural_features = [
        feature
        for feature in data.get("rural", {}).get("features", [])
        if normalize(feature.get("properties", {}).get("NM_MUN")) == key
    ]
    boundary_collections = [
        data.get("compesa_works", {}).get("map"),
        data.get("drought_municipalities"),
        data.get("sda_actions", {}).get("aguadas_map"),
        data.get("sda_actions", {}).get("cisternas_map"),
        data.get("ipa_actions", {}).get("barreiros_map"),
        data.get("ipa_actions", {}).get("bpp_map"),
    ]
    boundary_features = []
    for collection in boundary_collections:
        for feature in (collection or {}).get("features", []):
            if normalize(feature.get("properties", {}).get("NM_MUN")) == key:
                boundary_features.append(feature)
    features = boundary_features or rural_features
    georeferenced_points = [
        point
        for point in all_points(data)
        if point.get("lat") is not None and point.get("lng") is not None
    ]
    if boundary_features:
        points = [
            point
            for point in georeferenced_points
            if any(
                geometry_contains_point(
                    feature.get("geometry", {}),
                    float(point["lng"]),
                    float(point["lat"]),
                )
                for feature in boundary_features
            )
        ]
    else:
        points = [
            point
            for point in georeferenced_points
            if normalize(point.get("municipality")) == key
        ]
    if not features and not points:
        return None

    rings = [ring for feature in features for ring in geometry_rings(feature.get("geometry", {}))]
    coords = [coord for ring in rings for coord in ring]
    coords += [(float(point["lng"]), float(point["lat"])) for point in points]
    if not coords:
        return None

    min_lng = min(lng for lng, _ in coords)
    max_lng = max(lng for lng, _ in coords)
    min_lat = min(lat for _, lat in coords)
    max_lat = max(lat for _, lat in coords)
    if min_lng == max_lng:
        min_lng -= 0.04
        max_lng += 0.04
    if min_lat == max_lat:
        min_lat -= 0.04
        max_lat += 0.04

    width, height = 1200, 560
    margin = 36
    legend_width = 300
    map_width = width - legend_width - margin * 2
    map_height = height - margin * 2
    scale = min(map_width / (max_lng - min_lng), map_height / (max_lat - min_lat))
    draw_width = (max_lng - min_lng) * scale
    draw_height = (max_lat - min_lat) * scale
    offset_x = margin + (map_width - draw_width) / 2
    offset_y = margin + (map_height - draw_height) / 2

    def project(lng: float, lat: float) -> tuple[int, int]:
        x = offset_x + (lng - min_lng) * scale
        y = offset_y + (max_lat - lat) * scale
        return int(round(x)), int(round(y))

    image = Image.new("RGB", (width, height), "#f8fafc")
    draw = ImageDraw.Draw(image, "RGBA")
    font = ImageFont.load_default()
    bold = ImageFont.load_default()

    draw.rectangle([0, 0, width - 1, height - 1], outline="#d8e1ea", width=2)
    draw.rectangle([18, 18, width - 18, height - 18], fill=(255, 255, 255, 210), outline="#e2e8f0", width=1)

    for ring in rings:
        projected = [project(lng, lat) for lng, lat in ring]
        if len(projected) >= 3:
            draw.polygon(projected, fill=(232, 243, 231, 165), outline=(124, 151, 120, 135))

    radius = 5 if len(points) <= 80 else 4 if len(points) <= 180 else 3
    for point in points:
        color = LAYER_COLORS.get(point.get("layer"), "#334155")
        x, y = project(float(point["lng"]), float(point["lat"]))
        draw.ellipse([x - radius - 1, y - radius - 1, x + radius + 1, y + radius + 1], fill=(255, 255, 255, 230))
        draw.ellipse([x - radius, y - radius, x + radius, y + radius], fill=color)

    legend_x = width - legend_width + 16
    draw.text((legend_x, 34), "Camadas no municipio", fill="#08243a", font=bold)
    y = 62
    counts = Counter(point.get("layer") for point in points)
    for layer, label in LAYER_LABELS.items():
        count = counts.get(layer, 0)
        if not count:
            continue
        color = LAYER_COLORS.get(layer, "#334155")
        draw.ellipse([legend_x, y + 2, legend_x + 13, y + 15], fill=color, outline="#ffffff", width=2)
        draw.text((legend_x + 20, y), f"{label}: {num(count)}", fill="#334155", font=font)
        y += 24
    if not points:
        draw.text((legend_x, y), "Sem pontos georreferenciados.", fill="#64748b", font=font)
        y += 24

    draw.line([legend_x, y + 6, width - 34, y + 6], fill="#e2e8f0", width=1)
    draw.text((legend_x, y + 20), f"Total de pontos: {num(len(points))}", fill="#08243a", font=bold)
    base_note = "Base cartografica: poligonos municipais do painel." if boundary_features else "Base cartografica: setores rurais IBGE."
    draw.text((legend_x, y + 44), base_note, fill="#64748b", font=font)
    if boundary_features:
        draw.text((legend_x, y + 62), "Pontos atribuidos pela coordenada.", fill="#64748b", font=font)

    draw.text((36, height - 30), municipality, fill="#006591", font=bold)
    TMP_MAP_DIR.mkdir(parents=True, exist_ok=True)
    path = TMP_MAP_DIR / f"mapa-{slug(municipality)}-{slug(key)}.png"
    image.save(path, optimize=True)
    return path


def coverage_rows(data: dict[str, Any]) -> list[dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    drought = {
        normalize(feature.get("properties", {}).get("NM_MUN"))
        for feature in data.get("drought_municipalities", {}).get("features", [])
    }

    def ensure(municipality: str) -> dict[str, Any]:
        key = normalize(municipality) or "sem municipio"
        if key not in rows:
            rows[key] = {
                "municipality": municipality or "Sem municipio",
                "counts": Counter(),
                "total": 0,
                "agglomerates": 0,
                "population": 0,
                "rural_area": 0.0,
                "direct": 0,
                "drought": key in drought,
                "need": 0,
            }
        return rows[key]

    for feature in data.get("rural", {}).get("features", []):
        props = feature.get("properties", {})
        row = ensure(props.get("NM_MUN", ""))
        code = str(props.get("CD_SITUACAO", ""))
        if code in {"5", "6", "7"}:
            row["agglomerates"] += 1
            row["population"] += n(props.get("population"))
        row["rural_area"] += float(props.get("AREA_KM2") or 0)

    for point in all_points(data):
        row = ensure(point.get("municipality", ""))
        layer = point.get("layer")
        row["total"] += 1
        row["counts"][layer] += 1
        status = normalize(point.get("status"))
        if layer in {"sda_pad", "sda_pisf"}:
            if "entregue" in status:
                row["direct"] += 1
        elif layer == "ipa_pocos":
            continue
        elif layer in DIRECT_LAYERS:
            row["direct"] += 1

    for record in data.get("ipa_actions", {}).get("pocos", []):
        if "instalado" in normalize(record.get("status")):
            ensure(record.get("municipality", ""))["direct"] += 1

    for row in rows.values():
        gap = max(0, row["agglomerates"] - row["direct"])
        penalty = 25 if row["direct"] == 0 else round((gap / max(1, row["agglomerates"])) * 20)
        bonus = 35 if row["drought"] else 0
        row["gap"] = gap
        row["need"] = max(0, round(row["population"] / 180 + row["agglomerates"] * 1.2 + gap * 2 + penalty + bonus))
    return sorted(rows.values(), key=lambda row: (row["need"], row["agglomerates"]), reverse=True)


def municipality_lookup(data: dict[str, Any]) -> dict[str, dict[str, Any]]:
    rows = {normalize(row["municipality"]): row for row in coverage_rows(data)}
    compesa = {normalize(row["municipality"]): row for row in data["compesa_works"]["municipalities"]}
    sda = {normalize(row["municipality"]): row for row in data["sda_actions"]["municipalities"]}
    ipa = {normalize(row["municipality"]): row for row in data["ipa_actions"]["municipalities"]}
    compesa_kml: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for project in data.get("compesa_works", {}).get("georeferenced", {}).get("projects", []):
        for municipality in project.get("municipalities", []):
            compesa_kml[normalize(municipality)].append(project)
    keys = sorted(set(rows) | set(compesa) | set(sda) | set(ipa) | set(compesa_kml))
    return {
        key: {
            "coverage": rows.get(key),
            "compesa": compesa.get(key),
            "compesa_kml": compesa_kml.get(key, []),
            "sda": sda.get(key),
            "ipa": ipa.get(key),
        }
        for key in keys
    }


styles = getSampleStyleSheet()
styles.add(ParagraphStyle("ReportTitle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=20, leading=24, textColor=colors.HexColor("#08243a"), spaceAfter=12))
styles.add(ParagraphStyle("ReportSubtitle", parent=styles["BodyText"], fontSize=10.5, leading=15, textColor=colors.HexColor("#475569"), spaceAfter=12))
styles.add(ParagraphStyle("Section", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=13, leading=17, textColor=colors.HexColor("#006591"), spaceBefore=10, spaceAfter=7))
styles.add(ParagraphStyle("Small", parent=styles["BodyText"], fontSize=8.5, leading=11.5, textColor=colors.HexColor("#334155")))
styles.add(ParagraphStyle("Cell", parent=styles["BodyText"], fontSize=7.2, leading=9.2, textColor=colors.HexColor("#1f2937")))
styles.add(ParagraphStyle("CellBold", parent=styles["Cell"], fontName="Helvetica-Bold"))
styles.add(ParagraphStyle("Right", parent=styles["Cell"], alignment=TA_RIGHT))
styles.add(ParagraphStyle("Center", parent=styles["Cell"], alignment=TA_CENTER))


def p(text: Any, style: str = "Small") -> Paragraph:
    safe = str(text if text is not None else "-")
    safe = safe.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return Paragraph(safe, styles[style])


def table(rows: list[list[Any]], widths: list[float] | None = None, repeat: int = 1) -> Table:
    converted = [[value if hasattr(value, "wrap") else p(value, "CellBold" if index == 0 else "Cell") for index, value in enumerate(row)] for row in rows]
    t = Table(converted, colWidths=widths, repeatRows=repeat, hAlign="LEFT")
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eef6fb")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#08243a")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#d8e1ea")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return t


def kpi_table(items: list[tuple[str, Any, str]]) -> Table:
    rows = [[p(label, "CellBold"), p(value, "CellBold"), p(detail, "Cell")] for label, value, detail in items]
    t = Table(rows, colWidths=[4.4 * cm, 3.0 * cm, 8.2 * cm], hAlign="LEFT")
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#d8e1ea")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    return t


def draw_page_chrome(canvas, doc):
    canvas.saveState()
    width, height = doc.pagesize
    y = height - 2.05 * cm
    center_y = y + 0.75 * cm
    logo_igpe = LOGO_IGPE_SMALL if LOGO_IGPE_SMALL.exists() else LOGO_IGPE
    logo_seges = LOGO_SEGES_SMALL if LOGO_SEGES_SMALL.exists() else LOGO_SEGES
    logo_seplag = LOGO_SEPLAG_SMALL if LOGO_SEPLAG_SMALL.exists() else LOGO_SEPLAG

    if logo_igpe.exists():
        canvas.drawImage(
            ImageReader(str(logo_igpe)),
            1.45 * cm,
            center_y - 0.65 * cm,
            width=1.3 * cm,
            height=1.3 * cm,
            mask="auto",
            preserveAspectRatio=True,
            anchor="c",
        )
    if logo_seges.exists():
        canvas.drawImage(
            ImageReader(str(logo_seges)),
            (width - 3.8 * cm) / 2,
            center_y - 0.76 * cm,
            width=3.8 * cm,
            height=1.52 * cm,
            preserveAspectRatio=True,
            anchor="c",
        )
    if logo_seplag.exists():
        canvas.drawImage(
            ImageReader(str(logo_seplag)),
            width - 7.0 * cm,
            center_y - 0.82 * cm,
            width=5.6 * cm,
            height=1.64 * cm,
            mask="auto",
            preserveAspectRatio=True,
            anchor="c",
        )
    canvas.setStrokeColor(colors.HexColor("#d8e1ea"))
    canvas.setLineWidth(0.5)
    canvas.line(1.4 * cm, height - 2.55 * cm, width - 1.4 * cm, height - 2.55 * cm)

    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(colors.HexColor("#64748b"))
    canvas.drawString(1.5 * cm, 1.0 * cm, "Aguas PE - painel territorial")
    canvas.drawRightString(doc.pagesize[0] - 1.5 * cm, 1.0 * cm, f"Pagina {doc.page}")
    canvas.restoreState()


def make_pdf(filename: str, title_text: str, subtitle: str, story: list[Any], orientation=A4) -> dict[str, Any]:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORT_DIR / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(path),
        pagesize=orientation,
        leftMargin=1.4 * cm,
        rightMargin=1.4 * cm,
        topMargin=3.1 * cm,
        bottomMargin=1.4 * cm,
        title=title_text,
    )
    content = [Paragraph(title_text, styles["ReportTitle"]), Paragraph(subtitle, styles["ReportSubtitle"])] + story
    doc.build(content, onFirstPage=draw_page_chrome, onLaterPages=draw_page_chrome)
    return {"title": title_text, "file": f"/reports/{filename}", "filename": filename}


def top_rows(rows: list[dict[str, Any]], count: int = 20) -> list[dict[str, Any]]:
    return rows[:count]


def priority_table(rows: list[dict[str, Any]], count: int = 20) -> Table:
    data = [["Municipio", "Indice", "Pop. aglom.", "Aglomerados", "Infra direta", "Lacuna", "Estiagem"]]
    for row in top_rows(rows, count):
        data.append([title(row["municipality"]), num(row["need"]), num(row["population"]), num(row["agglomerates"]), num(row["direct"]), num(row["gap"]), "Sim" if row["drought"] else "Nao"])
    return table(data, [5.2 * cm, 1.7 * cm, 2.2 * cm, 2.1 * cm, 2.0 * cm, 1.6 * cm, 1.6 * cm])


def build_reports(data: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    generated = datetime.now().strftime("%d/%m/%Y %H:%M")
    rows = coverage_rows(data)
    compesa = data["compesa_works"]
    sda = data["sda_actions"]
    ipa = data["ipa_actions"]
    rural = data["rural_summary"]
    reports: list[dict[str, Any]] = []

    subtitle = f"Gerado em {generated}. Fonte: bases consolidadas do painel Aguas PE."

    reports.append(
        make_pdf(
            "01-resumo-executivo-estadual.pdf",
            "Resumo Executivo Estadual",
            subtitle,
            [
                Paragraph("Indicadores de abertura", styles["Section"]),
                kpi_table(
                    [
                        ("Municipios em estiagem", num(rural.get("drought_municipalities")), "Municipios destacados para acompanhamento conjuntural."),
                        ("Populacao em aglomerados", num(rural.get("rural_agglomerate_population")), "Setores rurais IBGE 5, 6 e 7."),
                        ("Obras Compesa", num(compesa["totals"]["works"]), money(compesa["totals"]["value"]) + " em valor divulgado."),
                        ("Acoes SDA", num(sda["totals"]["pad"] + sda["totals"]["pisf_points"] + sda["totals"]["aguadas"] + sda["totals"]["cisternas"]), "PAD, PISF, aguadas e cisternas."),
                        ("Acoes IPA", num(ipa["totals"]["pocos"] + ipa["totals"]["bar_executed"] + ipa["totals"]["bpp_executed"]), "Pocos, barreiros e barragens de pequeno porte."),
                    ]
                ),
                Paragraph("Top prioridades territoriais", styles["Section"]),
                priority_table(rows, 18),
            ],
        )
    )

    reports.append(
        make_pdf(
            "02-mapa-prioridade-hidrica-rural.pdf",
            "Mapa Executivo de Prioridades Hidricas Rurais",
            subtitle,
            [
                Paragraph("Leitura estrategica", styles["Section"]),
                Paragraph("Ranking calculado a partir de populacao em aglomerados rurais, quantidade de aglomerados, lacuna de infraestrutura direta e presenca em decreto de estiagem. Pocos IPA contam como infraestrutura apenas quando instalados; registros perfurados indicam obra ainda nao instalada. O indice orienta priorizacao territorial e nao representa vazao medida.", styles["Small"]),
                Spacer(1, 0.25 * cm),
                priority_table(rows, 30),
            ],
            landscape(A4),
        )
    )

    drought_rows = [row for row in rows if row["drought"]]
    reports.append(
        make_pdf(
            "03-municipios-em-estiagem.pdf",
            "Municipios em Decreto de Estiagem",
            subtitle,
            [
                Paragraph("Municipios em estiagem por prioridade", styles["Section"]),
                priority_table(drought_rows, 40),
            ],
            landscape(A4),
        )
    )

    gap_rows = sorted([row for row in rows if row["agglomerates"] > 0], key=lambda row: (row["gap"], row["population"]), reverse=True)
    reports.append(
        make_pdf(
            "04-cobertura-rural-e-lacunas.pdf",
            "Cobertura Rural e Lacunas de Infraestrutura",
            subtitle,
            [
                Paragraph("Maiores lacunas entre aglomerados rurais e infraestrutura direta", styles["Section"]),
                priority_table(gap_rows, 35),
            ],
            landscape(A4),
        )
    )

    top_compesa = sorted(compesa["municipalities"], key=lambda row: row.get("allocated_value", 0), reverse=True)[:30]
    reports.append(
        make_pdf(
            "05-investimentos-e-obras.pdf",
            "Investimentos e Obras por Municipio",
            subtitle,
            [
                Paragraph("Compesa - maiores valores alocados", styles["Section"]),
                table(
                    [["Municipio", "Obras", "Valor alocado", "Populacao alocada", "Execucao media", "Fase predominante"]]
                    + [[title(row["municipality"]), num(row["works_count"]), money(row["allocated_value"]), num(row["allocated_population"]), pct(row["avg_execution"]), row["dominant_phase"]] for row in top_compesa],
                    [5.0 * cm, 1.6 * cm, 2.6 * cm, 2.5 * cm, 2.2 * cm, 4.0 * cm],
                ),
                Paragraph("Status geral das obras Compesa", styles["Section"]),
                table([["Status", "Quantidade"]] + [[key, num(value)] for key, value in compesa["totals"]["status_counts"].items()], [7 * cm, 3 * cm]),
            ],
            landscape(A4),
        )
    )

    next_rows = [row for row in rows if row["need"] >= 100][:30]
    reports.append(
        make_pdf(
            "06-proximas-entregas-prioritarias.pdf",
            "Proximas Entregas Prioritarias",
            subtitle,
            [
                Paragraph("Lista curta para decisao", styles["Section"]),
                Paragraph("Municipios com maior necessidade estimada devem ser avaliados com vistoria local, status das obras e capacidade de entrega por instituicao.", styles["Small"]),
                Spacer(1, 0.25 * cm),
                priority_table(next_rows, 30),
            ],
            landscape(A4),
        )
    )

    reports.append(
        make_pdf(
            "07-qualificacao-das-bases.pdf",
            "Qualificacao das Bases e Proximos Passos",
            subtitle,
            [
                Paragraph("Pontos de qualificacao cadastral", styles["Section"]),
                kpi_table(
                    [
                        ("Pocos IPA sem coordenada", num(ipa["totals"]["pocos_unmapped"]), "Registros preservados na tabela, mas ainda nao entram como ponto no mapa."),
                        ("KML IPA nao mapeado", num(ipa["totals"]["kml_placemarks"] - ipa["totals"]["kml_mapped"]), "Placemark fora do padrao pontual/poligonal aproveitado automaticamente."),
                        ("Municipios Compesa sem cruzamento", num(len(compesa.get("unmatched_municipality_texts", []))), "Textos que exigem validacao municipal/manual."),
                        ("KML Compesa sem vinculo", num(compesa.get("georeferenced", {}).get("totals", {}).get("unmatched_files", 0)), "Projetos exibidos no mapa sem associacao automatica a uma obra da planilha."),
                        ("Registros sem municipio", num(sum(1 for point in all_points(data) if not point.get("municipality"))), "Pontos que precisam enriquecimento territorial."),
                    ]
                ),
                Paragraph("Recomendacao", styles["Section"]),
                Paragraph("Priorizar padronizacao de nomes municipais, coordenadas obrigatorias para obras locais, status harmonizado entre instituicoes e revisao das acoes sem georreferenciamento.", styles["Small"]),
            ],
        )
    )

    reports.append(
        make_pdf(
            "08-sala-de-situacao-hidrica-rural.pdf",
            "Sala de Situacao Hidrica Rural",
            subtitle,
            [
                Paragraph("Visao integrada para reuniao executiva", styles["Section"]),
                kpi_table(
                    [
                        ("Maior prioridade", title(rows[0]["municipality"]), num(rows[0]["need"]) + " pontos no indice."),
                        ("Municipios em estiagem", num(rural.get("drought_municipalities")), "Recorte conjuntural para resposta rapida."),
                        ("Populacao aglomerada", num(rural.get("rural_agglomerate_population")), "Publico rural mais concentrado nos setores IBGE."),
                        ("Bases pontuais", num(sum(data["totals"].values())), "Registros com coordenada no mapa geral."),
                    ]
                ),
                Paragraph("Top 15 para despacho", styles["Section"]),
                priority_table(rows, 15),
            ],
        )
    )

    reports.extend(build_institution_reports(data, rows, generated))
    reports.append(build_municipal_extract(data, rows, generated))
    municipal_reports = build_individual_municipal_extracts(data, rows, generated)
    return reports, municipal_reports


def build_institution_reports(data: dict[str, Any], rows: list[dict[str, Any]], generated: str) -> list[dict[str, Any]]:
    compesa = data["compesa_works"]
    compesa_kml = compesa.get("georeferenced", {"totals": {}})
    compesa_kml_totals = compesa_kml.get("totals", {})
    sda = data["sda_actions"]
    ipa = data["ipa_actions"]
    subtitle = f"Gerado em {generated}. Recorte por instituicao."
    reports = []

    reports.append(
        make_pdf(
            "instituicao-compesa.pdf",
            "Relatorio Institucional - Compesa",
            subtitle,
            [
                kpi_table(
                    [
                        ("Obras", num(compesa["totals"]["works"]), "Total de registros na base."),
                        ("Municipios", num(compesa["totals"]["municipalities"]), "Municipios cruzados com a malha."),
                        ("Valor divulgado", money(compesa["totals"]["value"]), "Soma das obras na planilha."),
                        ("Populacao informada", num(compesa["totals"]["population"]), "Soma nao deduplicada informada na base."),
                    ]
                ),
                Paragraph("Georreferenciamento KML", styles["Section"]),
                kpi_table(
                    [
                        ("Projetos mapeados", num(compesa_kml_totals.get("mapped_files")), "Arquivos com geometria valida em Pernambuco."),
                        ("Vinculados a planilha", num(compesa_kml_totals.get("matched_files")), "Correspondencia automatica conservadora ou vinculo confirmado em conferencia manual."),
                        ("Sem vinculo", num(compesa_kml_totals.get("unmatched_files")), "Permanecem visiveis sem receber status da planilha."),
                        ("Sem geometria valida", num(compesa_kml_totals.get("empty_files")), "Arquivos vazios ou com coordenadas fora do recorte estadual."),
                    ]
                ),
                Paragraph("Top municipios por valor", styles["Section"]),
                table(
                    [["Municipio", "Obras", "Valor", "Execucao media", "Fase predominante"]]
                    + [[title(row["municipality"]), num(row["works_count"]), money(row["allocated_value"]), pct(row["avg_execution"]), row["dominant_phase"]] for row in sorted(compesa["municipalities"], key=lambda row: row.get("allocated_value", 0), reverse=True)[:35]],
                    [5.2 * cm, 1.6 * cm, 2.7 * cm, 2.4 * cm, 4.2 * cm],
                ),
            ],
            landscape(A4),
        )
    )

    reports.append(
        make_pdf(
            "instituicao-sda.pdf",
            "Relatorio Institucional - SDA",
            subtitle,
            [
                kpi_table(
                    [
                        ("PAD", num(sda["totals"]["pad"]), f"{num(sda['totals']['pad_records'])} registros."),
                        ("PISF", num(sda["totals"]["pisf_points"]), f"{num(sda['totals']['pisf_records'])} registros."),
                        ("Aguadas", num(sda["totals"]["aguadas"]), "Pequenas barragens/acudes previstos."),
                        ("Cisternas", num(sda["totals"]["cisternas"]), f"{num(sda['totals']['cisternas_1_agua'])} de 1a agua e {num(sda['totals']['cisternas_2_agua'])} de 2a agua."),
                    ]
                ),
                Paragraph("Municipios com maior volume de acoes", styles["Section"]),
                table(
                    [["Municipio", "PAD", "PISF", "Aguadas", "Cisternas", "Total"]]
                    + [[title(row["municipality"]), num(row["pad"]), num(row["pisf"]), num(row["aguadas"]), num(row["cisternas_total"]), num(row["total_actions"])] for row in sda["municipalities"][:40]],
                    [5.2 * cm, 1.5 * cm, 1.5 * cm, 1.8 * cm, 2.0 * cm, 1.8 * cm],
                ),
            ],
            landscape(A4),
        )
    )

    reports.append(
        make_pdf(
            "instituicao-ipa.pdf",
            "Relatorio Institucional - IPA",
            subtitle,
            [
                kpi_table(
                    [
                        ("Pocos", num(ipa["totals"]["pocos"]), f"{num(ipa['totals']['pocos_mapped'])} com coordenada valida."),
                        ("Pocos instalados", num(ipa["totals"]["status_counts"].get("Instalado", 0)), f"{num(ipa['totals']['status_counts'].get('Perfurado', 0))} perfurados."),
                        ("Barreiros executados", num(ipa["totals"]["bar_executed"]), f"{num(ipa['totals']['kml_mapped'])} pontos KML mapeados."),
                        ("Barragens PP executadas", num(ipa["totals"]["bpp_executed"]), "Barragens de pequeno porte."),
                    ]
                ),
                Paragraph("Municipios com maior volume IPA", styles["Section"]),
                table(
                    [["Municipio", "Pocos", "Instalados", "Perfurados", "Barreiros", "BPP", "Total"]]
                    + [[title(row["municipality"]), num(row["pocos"]), num(row["pocos_instalados"]), num(row["pocos_perfurados"]), num(row["barreiros_executed"]), num(row["bpp_executed"]), num(row["total_actions"])] for row in ipa["municipalities"][:40]],
                    [5.0 * cm, 1.5 * cm, 1.8 * cm, 1.8 * cm, 1.9 * cm, 1.4 * cm, 1.7 * cm],
                ),
            ],
            landscape(A4),
        )
    )
    return reports


def compesa_work_lookup(data: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    compesa_works = defaultdict(list)
    for work in data["compesa_works"]["works"]:
        for municipality in work.get("municipalities", []):
            compesa_works[normalize(municipality)].append(work)
    return compesa_works


def ordered_municipality_keys(data: dict[str, Any], rows: list[dict[str, Any]]) -> list[str]:
    lookup = municipality_lookup(data)
    ordered_keys = [normalize(row["municipality"]) for row in rows if normalize(row["municipality"]) in lookup]
    ordered_keys += [key for key in lookup if key not in set(ordered_keys)]
    return ordered_keys


def srhs_summary(layer_counts: Counter) -> str:
    parts = [f"{num(layer_counts.get(layer, 0))} {LAYER_LABELS[layer]}" for layer in SRHS_LAYERS if layer_counts.get(layer, 0)]
    return "; ".join(parts) if parts else "Sem registros SRHS nas bases pontuais."


def municipal_extract_story(
    key: str,
    item: dict[str, Any],
    compesa_works: dict[str, list[dict[str, Any]]],
    include_all_compesa: bool,
    map_path: Path | None = None,
) -> list[Any]:
    cov = item.get("coverage") or {"municipality": key, "counts": Counter(), "population": 0, "agglomerates": 0, "direct": 0, "gap": 0, "drought": False}
    municipality = title(cov.get("municipality") or key)
    comp = item.get("compesa") or {}
    compesa_kml = item.get("compesa_kml") or []
    sda = item.get("sda") or {}
    ipa = item.get("ipa") or {}
    layer_counts = cov.get("counts", Counter())

    story: list[Any] = [Paragraph(municipality, styles["Section"])]
    if map_path and map_path.exists():
        story.extend(
            [
                Paragraph("Mapa do municipio", styles["Small"]),
                ReportImage(str(map_path), width=15.6 * cm, height=7.28 * cm),
                Spacer(1, 0.18 * cm),
            ]
        )

    story.extend(
        [
            kpi_table(
            [
                ("Populacao aglomerada", num(cov.get("population")), f"{num(cov.get('agglomerates'))} aglomerados rurais."),
                ("Infraestrutura direta", num(cov.get("direct")), f"Lacuna estimada: {num(cov.get('gap'))}. Pocos IPA contam apenas quando instalados; perfurados indicam obra ainda nao instalada."),
                ("Decreto de estiagem", "Sim" if cov.get("drought") else "Nao", "Recorte informado na base de estiagem."),
            ]
        ),
        table(
            [["Base", "Quantidade"]]
            + [[label, num(layer_counts.get(layer, 0))] for layer, label in LAYER_LABELS.items()],
            [8 * cm, 3 * cm],
        ),
        Spacer(1, 0.15 * cm),
        table(
            [["Instituicao", "Resumo"]]
            + [
                ["Compesa", f"{num(comp.get('works_count', 0))} obras; {num(len(compesa_kml))} projetos KML; {money(comp.get('allocated_value', 0))}; fase predominante: {comp.get('dominant_phase', '-')}"],
                ["SDA", f"{num(sda.get('pad', 0))} PAD; {num(sda.get('pisf', 0))} PISF; {num(sda.get('aguadas', 0))} aguadas; {num(sda.get('cisternas_total', 0))} cisternas"],
                ["IPA", f"{num(ipa.get('pocos', 0))} pocos; {num(ipa.get('pocos_instalados', 0))} instalados; {num(ipa.get('barreiros_executed', 0))} barreiros; {num(ipa.get('bpp_executed', 0))} BPP"],
                ["SRHS", srhs_summary(layer_counts)],
            ],
            [4 * cm, 12 * cm],
        ),
        ]
    )

    works = sorted(compesa_works.get(key, []), key=lambda work: work.get("value", 0), reverse=True)
    if not include_all_compesa:
        works = works[:5]
    if works:
        story.append(Paragraph("Todas as obras Compesa" if include_all_compesa else "Principais obras Compesa", styles["Small"]))
        story.append(
            table(
                [["Obra", "Status", "Valor", "Exec."]]
                + [[work.get("name", "-")[:95], work.get("status", "-"), money(work.get("value", 0)), pct(work.get("execution", 0))] for work in works],
                [10 * cm, 2.5 * cm, 2.2 * cm, 1.6 * cm],
            )
        )
    return story


def build_municipal_extract(data: dict[str, Any], rows: list[dict[str, Any]], generated: str) -> dict[str, Any]:
    lookup = municipality_lookup(data)
    compesa_works = compesa_work_lookup(data)
    story: list[Any] = []
    ordered_keys = ordered_municipality_keys(data, rows)
    for index, key in enumerate(ordered_keys):
        story.extend(municipal_extract_story(key, lookup[key], compesa_works, include_all_compesa=False))
        if index < len(ordered_keys) - 1:
            story.append(PageBreak())

    return make_pdf(
        "extrato-detalhado-por-municipio.pdf",
        "Extrato Detalhado por Municipio",
        f"Gerado em {generated}. Um bloco por municipio, consolidando prioridade, bases pontuais e acoes institucionais.",
        story,
    )


def build_individual_municipal_extracts(data: dict[str, Any], rows: list[dict[str, Any]], generated: str) -> list[dict[str, Any]]:
    lookup = municipality_lookup(data)
    compesa_works = compesa_work_lookup(data)
    municipal_dir = REPORT_DIR / "municipios"
    municipal_dir.mkdir(parents=True, exist_ok=True)
    for old_pdf in municipal_dir.glob("*.pdf"):
        old_pdf.unlink()

    reports: list[dict[str, Any]] = []
    used_slugs: Counter = Counter()
    for key in ordered_municipality_keys(data, rows):
        item = lookup[key]
        cov = item.get("coverage") or {"municipality": key}
        municipality = title(cov.get("municipality") or key)
        base_slug = slug(municipality)
        used_slugs[base_slug] += 1
        unique_slug = base_slug if used_slugs[base_slug] == 1 else f"{base_slug}-{used_slugs[base_slug]}"
        filename = f"municipios/extrato-municipal-{unique_slug}.pdf"
        map_path = municipal_map_path(data, key, municipality)
        report = make_pdf(
            filename,
            f"Extrato Municipal - {municipality}",
            f"Gerado em {generated}. Extrato individual com todas as obras Compesa vinculadas ao municipio.",
            municipal_extract_story(key, item, compesa_works, include_all_compesa=True, map_path=map_path),
        )
        report["municipality"] = municipality
        reports.append(report)
    return reports


def main() -> None:
    data = load_data()
    reports, municipal_reports = build_reports(data)
    manifest = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "reports": reports,
        "municipal_reports": municipal_reports,
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
