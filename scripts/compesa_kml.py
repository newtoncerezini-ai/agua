from __future__ import annotations

import difflib
import re
import unicodedata
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path
from typing import Any

import geopandas as gpd
from shapely.geometry import LineString, MultiPoint, Point, Polygon, mapping
from shapely.ops import linemerge, unary_union


KML_DIRECTORY = "mapas_kml_compesa_28.07.2026"
MAX_LINES_PER_PROJECT = 1200
MAX_POLYGONS_PER_PROJECT = 250
LINE_MIN_LENGTH = 0.0003
LINE_SIMPLIFY_TOLERANCE = 0.00012
POLYGON_SIMPLIFY_TOLERANCE = 0.00008


def find_compesa_kml_directory(root: Path) -> Path | None:
    candidates = [
        root / KML_DIRECTORY,
        Path.home() / "Downloads" / KML_DIRECTORY,
    ]
    return next((path for path in candidates if path.is_dir()), None)


def repair_archive_name(value: str) -> str:
    try:
        value = value.encode("cp437").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass
    return unicodedata.normalize("NFC", value)


def normalize_match(value: Any) -> str:
    text = repair_archive_name(str(value or ""))
    text = unicodedata.normalize("NFD", text)
    text = "".join(character for character in text if unicodedata.category(character) != "Mn")
    text = re.sub(r"[^A-Za-z0-9]+", " ", text).upper()
    return re.sub(r"\s+", " ", text).strip()


GENERIC_TOKENS = {
    "A",
    "AMPLIACAO",
    "DA",
    "DAS",
    "DE",
    "DO",
    "DOS",
    "E",
    "EM",
    "IMPLANTACAO",
    "MELHORIA",
    "OBRA",
    "OBRAS",
    "PARA",
    "RECUPERACAO",
    "REFORCO",
    "SISTEMA",
}

# Vínculos confirmados na conferência manual de 29/07/2026. Projetos não
# listados continuam sujeitos apenas ao pareamento automático conservador.
MANUAL_WORK_IDS_BY_PROJECT = {
    "IMPLANTACAO DE ADUTORA ESTACAO ELEVATORIA E OBRAS COMPLEMENTARES PARA IMPLANTACAO DE ETA UF E ETEF PARQUE CAPIBARIBE SAO LOURENCO DA MATA": [71],
    "IMPLANTACAO DE ETA UF BONANCA": [69],
    "IMPLANTACAO DE ETA UF CABROBO": [63],
    "IMPLANTACAO DE ETA UF IZACOLANDIA LAGOA GRANDE": [197],
    "IMPLANTACAO DE ETA UF MORENO": [68],
    "IMPLANTACAO DE ETA UF SAO CAETANO": [70],
    "PERFURACAO E OBRAS CIVIS DE 1 POCO P18 03 RE EM RECIFE JACYARA 2": [90],
    "PERFURACAO E OBRAS CIVIS DE 2 POCOS P05 07 PL E P05 08 PL AREA 1 JANGA": [91, 92],
    "PERFURACAO E OBRAS CIVIS DE 2 POCOS P05 09 PL E P05 10 PL AREA 2 JANGA": [93, 94],
    "PERFURACAO E OBRAS CIVIS DE 3 POCOS P01 22 OL P01 23 OL E P05 16 OL AREA 1 OLINDA": [96, 97, 101],
    "PERFURACAO E OBRAS CIVIS DE 3 POCOS P04 15 OL P04 16 OL E P03 10 OL AREA 2 OLINDA": [98, 99, 100],
}


def match_tokens(value: Any) -> set[str]:
    return {
        token
        for token in normalize_match(value).split()
        if token not in GENERIC_TOKENS and len(token) > 1
    }


def text_match_score(left: Any, right: Any) -> float:
    left_text = normalize_match(left)
    right_text = normalize_match(right)
    if not left_text or not right_text:
        return 0.0
    left_tokens = match_tokens(left)
    right_tokens = match_tokens(right)
    intersection = left_tokens & right_tokens
    union = left_tokens | right_tokens
    sequence = difflib.SequenceMatcher(None, left_text, right_text).ratio()
    coverage = len(intersection) / max(1, min(len(left_tokens), len(right_tokens)))
    jaccard = len(intersection) / max(1, len(union))
    score = sequence * 0.45 + coverage * 0.35 + jaccard * 0.20
    if left_text in right_text or right_text in left_text:
        score = max(score, 0.78)
    return score


def coordinate_pairs(text: str | None) -> list[tuple[float, float]]:
    coordinates: list[tuple[float, float]] = []
    for token in (text or "").split():
        parts = token.split(",")
        if len(parts) < 2:
            continue
        try:
            lng = float(parts[0])
            lat = float(parts[1])
        except ValueError:
            continue
        if -42.5 <= lng <= -34.0 and -10.2 <= lat <= -6.5:
            coordinates.append((lng, lat))
    return coordinates


def first_child_text(element: ET.Element, tag_name: str) -> str:
    for child in element.iter():
        if child.tag.rsplit("}", 1)[-1] == tag_name:
            return child.text or ""
    return ""


def parse_kml_geometries(path: Path) -> tuple[list[Point], list[LineString], list[Polygon], Counter[str]]:
    root = ET.parse(path).getroot()
    points: list[Point] = []
    lines: list[LineString] = []
    polygons: list[Polygon] = []
    raw_counts: Counter[str] = Counter()

    for element in root.iter():
        tag = element.tag.rsplit("}", 1)[-1]
        if tag == "Placemark":
            raw_counts["placemarks"] += 1
        elif tag == "Point":
            raw_counts["points"] += 1
            coordinates = coordinate_pairs(first_child_text(element, "coordinates"))
            if coordinates:
                points.append(Point(coordinates[0]))
        elif tag == "LineString":
            raw_counts["lines"] += 1
            coordinates = coordinate_pairs(first_child_text(element, "coordinates"))
            if len(coordinates) >= 2:
                geometry = LineString(coordinates)
                if not geometry.is_empty and geometry.length > 0:
                    lines.append(geometry)
        elif tag == "Polygon":
            raw_counts["polygons"] += 1
            rings: list[list[tuple[float, float]]] = []
            for ring_element in element.iter():
                if ring_element.tag.rsplit("}", 1)[-1] != "LinearRing":
                    continue
                coordinates = coordinate_pairs(first_child_text(ring_element, "coordinates"))
                if len(coordinates) >= 4:
                    rings.append(coordinates)
            if rings:
                geometry = Polygon(rings[0], rings[1:])
                if not geometry.is_valid:
                    geometry = geometry.buffer(0)
                if not geometry.is_empty and geometry.geom_type in {"Polygon", "MultiPolygon"}:
                    polygons.append(geometry)
    return points, lines, polygons, raw_counts


def condensed_lines(lines: list[LineString]):
    if not lines:
        return None, 0
    selected = [line for line in lines if line.length >= LINE_MIN_LENGTH]
    if not selected:
        selected = sorted(lines, key=lambda line: line.length, reverse=True)[:80]
    elif len(selected) > MAX_LINES_PER_PROJECT:
        selected = sorted(selected, key=lambda line: line.length, reverse=True)[:MAX_LINES_PER_PROJECT]
    geometry = unary_union(selected)
    try:
        geometry = linemerge(geometry)
    except ValueError:
        pass
    geometry = geometry.simplify(LINE_SIMPLIFY_TOLERANCE, preserve_topology=False)
    return (None, 0) if geometry.is_empty else (geometry, len(selected))


def condensed_polygons(polygons: list[Polygon]):
    if not polygons:
        return None, 0
    selected = sorted(polygons, key=lambda polygon: polygon.area, reverse=True)[:MAX_POLYGONS_PER_PROJECT]
    geometry = unary_union(selected).simplify(POLYGON_SIMPLIFY_TOLERANCE, preserve_topology=True)
    return (None, 0) if geometry.is_empty else (geometry, len(selected))


def condensed_points(points: list[Point]):
    unique = {
        (round(point.x, 6), round(point.y, 6))
        for point in points
        if not point.is_empty
    }
    if not unique:
        return None, 0
    sorted_points = sorted(unique)
    geometry = Point(sorted_points[0]) if len(sorted_points) == 1 else MultiPoint(sorted_points)
    return geometry, len(sorted_points)


def project_municipalities(geometry, municipal_polygons: gpd.GeoDataFrame) -> list[str]:
    if geometry is None or geometry.is_empty:
        return []
    candidates = municipal_polygons.iloc[list(municipal_polygons.sindex.query(geometry, predicate="intersects"))]
    return sorted(
        {
            str(row["NM_MUN"]).strip()
            for _, row in candidates.iterrows()
            if row.geometry.intersects(geometry)
        }
    )


def match_work(
    project_name: str,
    municipalities: list[str],
    works: list[dict[str, Any]],
) -> tuple[dict[str, Any] | None, float]:
    if "PROJETO TESTE" in normalize_match(project_name):
        return None, 0.0
    municipality_keys = {normalize_match(name) for name in municipalities}
    project_text = normalize_match(project_name)
    project_tokens = set(project_text.split())
    project_actions = project_tokens & {"AMPLIACAO", "IMPLANTACAO", "RECUPERACAO", "REFORCO", "REQUALIFICACAO", "RETROFIT"}
    project_stage = re.search(r"\b([1-9])\s*(?:A|O)?\s*ETAPA\b", project_text)
    ranked: list[tuple[float, dict[str, Any]]] = []
    for work in works:
        work_text = normalize_match(work.get("name"))
        work_tokens = set(work_text.split())
        score = text_match_score(project_name, work.get("name"))
        work_actions = work_tokens & {"AMPLIACAO", "IMPLANTACAO", "RECUPERACAO", "REFORCO", "REQUALIFICACAO", "RETROFIT"}
        if project_actions and work_actions and not project_actions & work_actions:
            score -= 0.16
        work_stage = re.search(r"\b([1-9])\s*(?:A|O)?\s*ETAPA\b", work_text)
        if project_stage and work_stage and project_stage.group(1) != work_stage.group(1):
            score -= 0.30
        if "BARRAGEM" in project_tokens and "BARRAGEM" in work_tokens:
            ignored = {
                "AMPLIACAO",
                "BARRAGEM",
                "DA",
                "DE",
                "DO",
                "IMPLANTACAO",
                "RECUPERACAO",
                "REQUALIFICACAO",
            }
            project_target = project_tokens - ignored
            work_target = work_tokens - ignored
            if project_target and work_target and not project_target & work_target:
                score -= 0.24
        work_municipalities = {normalize_match(name) for name in work.get("municipalities", [])}
        if municipality_keys and municipality_keys & work_municipalities:
            score = min(1.0, score + 0.08)
        ranked.append((score, work))
    if not ranked:
        return None, 0.0
    score, work = max(ranked, key=lambda item: item[0])
    return (work, score) if score >= 0.58 else (None, score)


def feature_properties(
    project: dict[str, Any],
    geometry_kind: str,
) -> dict[str, Any]:
    return {
        "project_id": project["id"],
        "name": project["name"],
        "filename": project["filename"],
        "geometry_kind": geometry_kind,
        "work_id": project["work_id"],
        "work_ids": project["work_ids"],
        "work_name": project["work_name"],
        "work_names": project["work_names"],
        "match_score": project["match_score"],
        "match_quality": project["match_quality"],
        "municipalities": project["municipalities"],
        "status": project["status"],
        "phase": project["phase"],
        "type": project["type"],
        "eixo": project["eixo"],
        "subeixo": project["subeixo"],
    }


def empty_result(directory: Path | None = None) -> dict[str, Any]:
    return {
        "projects": [],
        "map": {"type": "FeatureCollection", "features": []},
        "unmatched_files": [],
        "empty_files": [],
        "totals": {
            "files": 0,
            "mapped_files": 0,
            "matched_files": 0,
            "unmatched_files": 0,
            "empty_files": 0,
            "features": 0,
            "raw_points": 0,
            "raw_lines": 0,
            "raw_polygons": 0,
            "source_directory": str(directory) if directory else "",
        },
    }


def build_compesa_kml(
    root: Path,
    works: list[dict[str, Any]],
    municipal_polygons: gpd.GeoDataFrame,
) -> dict[str, Any]:
    directory = find_compesa_kml_directory(root)
    if not directory:
        return empty_result()

    projects: list[dict[str, Any]] = []
    features: list[dict[str, Any]] = []
    unmatched_files: list[str] = []
    empty_files: list[str] = []
    raw_totals: Counter[str] = Counter()
    works_by_id = {int(work["id"]): work for work in works if work.get("id") is not None}

    for index, path in enumerate(sorted(directory.glob("*.kml")), start=1):
        project_name = repair_archive_name(path.stem)
        filename = repair_archive_name(path.name)
        points, lines, polygons, raw_counts = parse_kml_geometries(path)
        raw_totals.update(raw_counts)
        point_geometry, rendered_points = condensed_points(points)
        line_geometry, rendered_lines = condensed_lines(lines)
        polygon_geometry, rendered_polygons = condensed_polygons(polygons)
        geometries = [
            geometry
            for geometry in (point_geometry, line_geometry, polygon_geometry)
            if geometry is not None and not geometry.is_empty
        ]
        if not geometries:
            empty_files.append(filename)
            continue

        project_geometry = unary_union(geometries)
        municipalities = project_municipalities(project_geometry, municipal_polygons)
        manual_work_ids = MANUAL_WORK_IDS_BY_PROJECT.get(normalize_match(project_name), [])
        matched_works = [works_by_id[work_id] for work_id in manual_work_ids if work_id in works_by_id]
        if manual_work_ids and len(matched_works) != len(manual_work_ids):
            missing_ids = sorted(set(manual_work_ids) - works_by_id.keys())
            raise ValueError(f"IDs Compesa ausentes no catálogo para {project_name}: {missing_ids}")

        if matched_works:
            work = matched_works[0]
            score = 1.0
            quality = "Vinculo manual confirmado"
        else:
            work, score = match_work(project_name, municipalities, works)
            matched_works = [work] if work else []
            quality = "Sem vinculo"
            if work and score >= 0.78:
                quality = "Vinculo forte"
            elif work:
                quality = "Vinculo provavel"

        if not matched_works:
            unmatched_files.append(filename)

        def joined_value(key: str, default: str = "") -> str:
            values = list(dict.fromkeys(str(item.get(key) or "").strip() for item in matched_works))
            values = [value for value in values if value]
            return " / ".join(values) if values else default

        work_ids = [int(item["id"]) for item in matched_works]
        work_names = [str(item.get("name") or "") for item in matched_works]
        project = {
            "id": f"compesa-kml-{index}",
            "name": project_name,
            "filename": filename,
            "municipalities": municipalities,
            "work_id": work.get("id") if work else None,
            "work_ids": work_ids,
            "work_name": " | ".join(work_names),
            "work_names": work_names,
            "match_score": round(score, 3),
            "match_quality": quality,
            "status": joined_value("status", "Sem vinculo na planilha"),
            "phase": joined_value("phase", "Georreferenciado"),
            "type": joined_value("type"),
            "eixo": joined_value("eixo"),
            "subeixo": joined_value("subeixo"),
            "raw_points": raw_counts["points"],
            "raw_lines": raw_counts["lines"],
            "raw_polygons": raw_counts["polygons"],
            "rendered_points": rendered_points,
            "rendered_lines": rendered_lines,
            "rendered_polygons": rendered_polygons,
        }
        projects.append(project)

        anchor = project_geometry.representative_point()
        features.append(
            {
                "type": "Feature",
                "properties": {**feature_properties(project, "Localizacao"), "anchor": True},
                "geometry": mapping(anchor),
            }
        )
        for geometry_kind, geometry in [
            ("Pontos", point_geometry),
            ("Tracado", line_geometry),
            ("Area", polygon_geometry),
        ]:
            if geometry is None or geometry.is_empty:
                continue
            features.append(
                {
                    "type": "Feature",
                    "properties": {**feature_properties(project, geometry_kind), "anchor": False},
                    "geometry": mapping(geometry),
                }
            )

    return {
        "projects": projects,
        "map": {"type": "FeatureCollection", "features": features},
        "unmatched_files": unmatched_files,
        "empty_files": empty_files,
        "totals": {
            "files": len(list(directory.glob("*.kml"))),
            "mapped_files": len(projects),
            "matched_files": sum(bool(project["work_ids"]) for project in projects),
            "unmatched_files": len(unmatched_files),
            "empty_files": len(empty_files),
            "features": len(features),
            "raw_points": raw_totals["points"],
            "raw_lines": raw_totals["lines"],
            "raw_polygons": raw_totals["polygons"],
            "source_directory": directory.name,
        },
    }
