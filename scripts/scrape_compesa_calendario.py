from __future__ import annotations

import argparse
import calendar
import csv
import json
import math
import statistics
import time
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests


SERVICE_ROOT = "https://geo.compesa.com.br:6443/arcgis/rest/services/Calendario/Calendario/MapServer"
SOURCE_PAGE = "https://servicos.compesa.com.br/calendario-de-abastecimento-da-compesa/"
AREA_QUERY_URL = f"{SERVICE_ROOT}/0/query"
SCHEDULE_QUERY_URL = f"{SERVICE_ROOT}/5/query"
PAGE_SIZE = 1000

AREA_FIELDS = [
    "OBJECTID",
    "ID",
    "MUNICIPIOS",
    "NOMECALEND",
    "NOMABAST",
    "BAIRROS",
    "localidade",
    "NOMSIS",
    "NOMSUBSIS",
    "NOMSETOPER",
    "NOMDIST",
    "HORASABAST",
    "AREA_CDSTATUS",
    "ATRASADA",
    "NEXT_MANOBRA",
    "LAST_MANOBRA",
    "Quantidade_de_Matriculas",
    "Quantidade_de_Economias",
]

SCHEDULE_FIELDS = ["OBJECTID", "ID", "Inicio", "Termino", "colapso"]

AREA_COLUMNS = [
    "mes_referencia",
    "municipios",
    "municipios_fonte",
    "id_area",
    "nome_calendario",
    "area_abastecimento",
    "bairros",
    "localidade",
    "sistema",
    "subsistema",
    "setor_operacional",
    "distrito",
    "matriculas",
    "economias",
    "horas_abastecimento_campo",
    "status_area",
    "calendario_atrasado",
    "proxima_manobra",
    "ultima_manobra",
    "intervalos_agua",
    "horas_com_agua",
    "cobertura_mes_pct",
    "duracao_mediana_com_agua_h",
    "intervalo_mediano_sem_agua_h",
    "maior_intervalo_sem_agua_h",
    "situacao_calendario",
    "tipo_rodizio",
    "fonte_url",
    "extraido_em",
]

INTERVAL_COLUMNS = [
    "mes_referencia",
    "id_intervalo",
    "id_area",
    "municipios",
    "inicio",
    "termino",
    "duracao_horas",
    "codigo_colapso",
    "situacao",
    "fonte_url",
    "extraido_em",
]

MUNICIPAL_COLUMNS = [
    "mes_referencia",
    "municipio",
    "areas_total",
    "areas_com_calendario",
    "areas_abastecimento_continuo",
    "areas_em_rodizio",
    "areas_em_colapso",
    "areas_mes_sem_agua",
    "areas_sem_calendario",
    "cobertura_media_ponderada_pct",
    "tipo_predominante",
    "situacao_mais_critica",
    "exemplos_de_rodizio",
    "fonte_url",
    "extraido_em",
]

MUNICIPALITY_ALIASES = {
    "BELEM DE SAO FRANCISCO": "BELEM DO SAO FRANCISCO",
    "CANAUBEIRA DA PENHA": "CARNAUBEIRA DA PENHA",
    "FREI MIGUELINO": "FREI MIGUELINHO",
    "GLORIA DO GOITA": "GLORIA DO GOITA",
    "IGUARACI": "IGUARACY",
    "LAGOA DO ITAENGA": "LAGOA DE ITAENGA",
    "SAO CAETANO": "SAO CAITANO",
}

SITUATION_PRIORITY = {
    "Area em colapso": 5,
    "Mes sem abastecimento": 4,
    "Rodizio": 3,
    "Sem calendario publicado": 2,
    "Abastecimento continuo": 1,
}


def normalize(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    return " ".join("".join(char for char in text if not unicodedata.combining(char)).upper().split())


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and math.isnan(value):
        return ""
    return " ".join(str(value).strip().split())


def arcgis_datetime(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    try:
        return datetime.fromtimestamp(float(value) / 1000, tz=timezone.utc).replace(tzinfo=None)
    except (TypeError, ValueError, OSError, OverflowError):
        return None


def iso_datetime(value: Any) -> str:
    parsed = arcgis_datetime(value)
    return parsed.isoformat(timespec="minutes") if parsed else ""


def parse_month(value: str) -> tuple[datetime, datetime, str]:
    try:
        start = datetime.strptime(value, "%Y-%m")
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Use o formato AAAA-MM para --month.") from exc
    last_day = calendar.monthrange(start.year, start.month)[1]
    if start.month == 12:
        end = datetime(start.year + 1, 1, 1)
    else:
        end = datetime(start.year, start.month + 1, 1)
    return start, end, f"{start.year:04d}-{start.month:02d}"


def fetch_all(
    session: requests.Session,
    url: str,
    where: str,
    fields: list[str],
    order_field: str = "OBJECTID",
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        response = session.get(
            url,
            params={
                "f": "json",
                "where": where,
                "outFields": ",".join(fields),
                "returnGeometry": "false",
                "orderByFields": order_field,
                "resultOffset": offset,
                "resultRecordCount": PAGE_SIZE,
            },
            timeout=90,
        )
        response.raise_for_status()
        payload = response.json()
        if payload.get("error"):
            raise RuntimeError(f"Erro do ArcGIS REST: {payload['error']}")
        page = [feature.get("attributes", {}) for feature in payload.get("features", [])]
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            break
        offset += len(page)
        time.sleep(0.08)
    return rows


def canonical_municipalities(dashboard_path: Path) -> dict[str, str]:
    if not dashboard_path.exists():
        return {}
    dashboard = json.loads(dashboard_path.read_text(encoding="utf-8"))
    names = {
        clean_text(feature.get("properties", {}).get("NM_MUN"))
        for feature in dashboard.get("rural", {}).get("features", [])
    }
    lookup = {normalize(name): name for name in names if name}
    for source_key, target_key in MUNICIPALITY_ALIASES.items():
        if target_key in lookup:
            lookup[source_key] = lookup[target_key]
    return lookup


def split_municipalities(value: Any, lookup: dict[str, str]) -> list[str]:
    raw_names = [clean_text(item) for item in clean_text(value).split(",") if clean_text(item)]
    names = []
    for raw_name in raw_names:
        key = normalize(raw_name)
        names.append(lookup.get(key, raw_name.title()))
    return sorted(set(names))


def merge_intervals(intervals: list[tuple[datetime, datetime]]) -> list[tuple[datetime, datetime]]:
    merged: list[tuple[datetime, datetime]] = []
    for start, end in sorted(intervals):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def duration_label(hours: float) -> str:
    if hours >= 24:
        days = hours / 24
        value = round(days) if abs(days - round(days)) < 0.15 else round(days, 1)
        return f"{value:g} dia" + ("s" if value != 1 else "")
    value = round(hours) if abs(hours - round(hours)) < 0.15 else round(hours, 1)
    return f"{value:g} h"


def classify_rotation(
    merged: list[tuple[datetime, datetime]],
    flags: set[int],
    month_start: datetime,
    month_end: datetime,
) -> tuple[str, str, dict[str, float]]:
    month_hours = (month_end - month_start).total_seconds() / 3600
    durations = [(end - start).total_seconds() / 3600 for start, end in merged]
    internal_gaps = [
        (merged[index][0] - merged[index - 1][1]).total_seconds() / 3600
        for index in range(1, len(merged))
    ]
    boundary_gaps = []
    if merged:
        boundary_gaps = [
            max(0.0, (merged[0][0] - month_start).total_seconds() / 3600),
            max(0.0, (month_end - merged[-1][1]).total_seconds() / 3600),
        ]
    water_hours = sum(durations)
    coverage = water_hours / month_hours if month_hours else 0
    metrics = {
        "water_hours": round(water_hours, 2),
        "coverage_pct": round(coverage * 100, 2),
        "median_water_hours": round(statistics.median(durations), 2) if durations else 0,
        "median_gap_hours": round(statistics.median(internal_gaps), 2) if internal_gaps else 0,
        "max_gap_hours": round(max(internal_gaps + boundary_gaps), 2) if internal_gaps or boundary_gaps else 0,
    }

    if 1 in flags:
        return "Area em colapso", "Area em colapso", metrics
    if 2 in flags:
        return "Mes sem abastecimento", "Mes sem abastecimento", metrics
    if not merged:
        return "Sem calendario publicado", "Sem calendario publicado no mes", metrics
    if coverage >= 0.95:
        return "Abastecimento continuo", "Abastecimento continuo", metrics

    median_water = metrics["median_water_hours"]
    median_gap = metrics["median_gap_hours"]
    if not internal_gaps:
        label = f"Abastecimento parcial: {duration_label(water_hours)} no mes"
    elif median_water < 24 and median_gap <= 36:
        label = f"Intermitente diario: {duration_label(median_water)} com agua / {duration_label(median_gap)} sem agua"
    else:
        label = f"Rodizio: {duration_label(median_water)} com agua / {duration_label(median_gap)} sem agua"
    return "Rodizio", label, metrics


def build_area_rows(
    areas: list[dict[str, Any]],
    schedules: list[dict[str, Any]],
    month_start: datetime,
    month_end: datetime,
    month_key: str,
    extracted_at: str,
    municipality_lookup: dict[str, str],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    schedules_by_area: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for schedule in schedules:
        schedules_by_area[clean_text(schedule.get("ID"))].append(schedule)

    municipalities_by_area: dict[str, set[str]] = defaultdict(set)
    for area in areas:
        municipalities_by_area[clean_text(area.get("ID"))].update(
            split_municipalities(area.get("MUNICIPIOS"), municipality_lookup)
        )

    area_rows: list[dict[str, Any]] = []
    for area in areas:
        area_id = clean_text(area.get("ID"))
        municipality_names = split_municipalities(area.get("MUNICIPIOS"), municipality_lookup)
        area_schedules = schedules_by_area.get(area_id, [])
        flags = {int(item.get("colapso") or 0) for item in area_schedules}
        intervals: list[tuple[datetime, datetime]] = []

        for schedule in area_schedules:
            start = arcgis_datetime(schedule.get("Inicio"))
            end = arcgis_datetime(schedule.get("Termino"))
            if not start or not end:
                continue
            clipped_start = max(month_start, start)
            clipped_end = min(month_end, end)
            flag = int(schedule.get("colapso") or 0)
            if flag == 0 and clipped_end > clipped_start:
                intervals.append((clipped_start, clipped_end))
        merged = merge_intervals(intervals)
        situation, rotation_type, metrics = classify_rotation(merged, flags, month_start, month_end)
        area_rows.append(
            {
                "mes_referencia": month_key,
                "municipios": "; ".join(municipality_names),
                "municipios_fonte": clean_text(area.get("MUNICIPIOS")),
                "id_area": area_id,
                "nome_calendario": clean_text(area.get("NOMECALEND")),
                "area_abastecimento": clean_text(area.get("NOMABAST")),
                "bairros": clean_text(area.get("BAIRROS")),
                "localidade": clean_text(area.get("localidade")),
                "sistema": clean_text(area.get("NOMSIS")),
                "subsistema": clean_text(area.get("NOMSUBSIS")),
                "setor_operacional": clean_text(area.get("NOMSETOPER")),
                "distrito": clean_text(area.get("NOMDIST")),
                "matriculas": area.get("Quantidade_de_Matriculas") or 0,
                "economias": area.get("Quantidade_de_Economias") or 0,
                "horas_abastecimento_campo": area.get("HORASABAST") or 0,
                "status_area": clean_text(area.get("AREA_CDSTATUS")),
                "calendario_atrasado": clean_text(area.get("ATRASADA")),
                "proxima_manobra": iso_datetime(area.get("NEXT_MANOBRA")),
                "ultima_manobra": iso_datetime(area.get("LAST_MANOBRA")),
                "intervalos_agua": len(merged),
                "horas_com_agua": metrics["water_hours"],
                "cobertura_mes_pct": metrics["coverage_pct"],
                "duracao_mediana_com_agua_h": metrics["median_water_hours"],
                "intervalo_mediano_sem_agua_h": metrics["median_gap_hours"],
                "maior_intervalo_sem_agua_h": metrics["max_gap_hours"],
                "situacao_calendario": situation,
                "tipo_rodizio": rotation_type,
                "fonte_url": AREA_QUERY_URL,
                "extraido_em": extracted_at,
            }
        )
    interval_rows: list[dict[str, Any]] = []
    for schedule in schedules:
        start = arcgis_datetime(schedule.get("Inicio"))
        end = arcgis_datetime(schedule.get("Termino"))
        if not start or not end:
            continue
        area_id = clean_text(schedule.get("ID"))
        flag = int(schedule.get("colapso") or 0)
        interval_rows.append(
            {
                "mes_referencia": month_key,
                "id_intervalo": schedule.get("OBJECTID"),
                "id_area": area_id,
                "municipios": "; ".join(sorted(municipalities_by_area.get(area_id, set()))),
                "inicio": start.isoformat(timespec="minutes"),
                "termino": end.isoformat(timespec="minutes"),
                "duracao_horas": round((end - start).total_seconds() / 3600, 2),
                "codigo_colapso": flag,
                "situacao": "Area em colapso" if flag == 1 else "Mes sem abastecimento" if flag == 2 else "Periodo com abastecimento",
                "fonte_url": SCHEDULE_QUERY_URL,
                "extraido_em": extracted_at,
            }
        )
    return area_rows, interval_rows


def build_municipal_rows(area_rows: list[dict[str, Any]], month_key: str, extracted_at: str) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in area_rows:
        municipalities = [item.strip() for item in row["municipios"].split(";") if item.strip()]
        for municipality in municipalities:
            grouped[municipality].append(row)

    result = []
    for municipality, rows in grouped.items():
        situations = Counter(row["situacao_calendario"] for row in rows)
        known = [row for row in rows if row["situacao_calendario"] != "Sem calendario publicado"]
        weighted_rows = []
        for row in known:
            weight = float(row.get("economias") or row.get("matriculas") or 1)
            weighted_rows.append((float(row["cobertura_mes_pct"]), weight))
        weighted_coverage = (
            sum(value * weight for value, weight in weighted_rows) / sum(weight for _, weight in weighted_rows)
            if weighted_rows
            else 0
        )
        predominant = situations.most_common(1)[0][0] if situations else "Sem calendario publicado"
        critical = max(situations, key=lambda value: SITUATION_PRIORITY.get(value, 0)) if situations else predominant
        examples = Counter(row["tipo_rodizio"] for row in rows if row["situacao_calendario"] == "Rodizio")
        result.append(
            {
                "mes_referencia": month_key,
                "municipio": municipality,
                "areas_total": len(rows),
                "areas_com_calendario": len(known),
                "areas_abastecimento_continuo": situations.get("Abastecimento continuo", 0),
                "areas_em_rodizio": situations.get("Rodizio", 0),
                "areas_em_colapso": situations.get("Area em colapso", 0),
                "areas_mes_sem_agua": situations.get("Mes sem abastecimento", 0),
                "areas_sem_calendario": situations.get("Sem calendario publicado", 0),
                "cobertura_media_ponderada_pct": round(weighted_coverage, 2),
                "tipo_predominante": predominant,
                "situacao_mais_critica": critical,
                "exemplos_de_rodizio": " | ".join(label for label, _ in examples.most_common(3)),
                "fonte_url": SOURCE_PAGE,
                "extraido_em": extracted_at,
            }
        )
    return sorted(result, key=lambda row: normalize(row["municipio"]))


def write_csv(path: Path, columns: list[str], rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Extrai o calendario mensal de abastecimento da Compesa.")
    parser.add_argument("--month", default=datetime.now().strftime("%Y-%m"), help="Mes no formato AAAA-MM.")
    parser.add_argument("--output-dir", default="outputs/compesa_calendario", help="Diretorio de saida.")
    parser.add_argument("--dashboard", default="public/data/dashboard.json", help="Base para nomes canonicos dos municipios.")
    args = parser.parse_args()

    month_start, month_end, month_key = parse_month(args.month)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    extracted_at = datetime.now().astimezone().isoformat(timespec="seconds")

    month = month_start.month
    year = month_start.year
    schedule_where = (
        f"((DATEPART(MONTH,Inicio)='{month:02d}' AND DATEPART(YEAR,Inicio)='{year}') OR "
        f"(DATEPART(MONTH,Termino)='{month:02d}' AND DATEPART(YEAR,Termino)='{year}'))"
    )

    session = requests.Session()
    session.headers.update({"User-Agent": "AguasPE-public-data-extractor/1.0"})
    areas = fetch_all(session, AREA_QUERY_URL, "1=1", AREA_FIELDS)
    schedules = fetch_all(session, SCHEDULE_QUERY_URL, schedule_where, SCHEDULE_FIELDS)
    municipality_lookup = canonical_municipalities(Path(args.dashboard))
    area_rows, interval_rows = build_area_rows(
        areas,
        schedules,
        month_start,
        month_end,
        month_key,
        extracted_at,
        municipality_lookup,
    )
    municipal_rows = build_municipal_rows(area_rows, month_key, extracted_at)

    base_name = f"compesa_calendario_{month_key}"
    area_path = output_dir / f"{base_name}_areas.csv"
    interval_path = output_dir / f"{base_name}_intervalos.csv"
    municipal_path = output_dir / f"{base_name}_municipios.csv"
    json_path = output_dir / f"{base_name}.json"
    write_csv(area_path, AREA_COLUMNS, area_rows)
    write_csv(interval_path, INTERVAL_COLUMNS, interval_rows)
    write_csv(municipal_path, MUNICIPAL_COLUMNS, municipal_rows)

    situation_counts = Counter(row["situacao_calendario"] for row in area_rows)
    payload = {
        "metadata": {
            "month": month_key,
            "extracted_at": extracted_at,
            "source_page": SOURCE_PAGE,
            "area_service": AREA_QUERY_URL,
            "schedule_service": SCHEDULE_QUERY_URL,
            "schedule_filter": schedule_where,
            "methodology": (
                "Intervalos com codigo de colapso 0 representam periodos programados com agua. "
                "Codigos 1 e 2 sao preservados como area em colapso e mes sem abastecimento. "
                "O tipo de rodizio e estimado pelas medianas de duracao dos periodos com agua e dos intervalos entre eles."
            ),
        },
        "summary": {
            "areas": len(area_rows),
            "intervals": len(interval_rows),
            "municipalities": len(municipal_rows),
            "situation_counts": dict(situation_counts),
        },
        "municipalities": municipal_rows,
        "areas": area_rows,
    }
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(
        json.dumps(
            {
                "outputs": [str(area_path), str(interval_path), str(municipal_path), str(json_path)],
                **payload["summary"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
