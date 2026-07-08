from __future__ import annotations

import json
import math
import re
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import geopandas as gpd
import pandas as pd
from openpyxl import load_workbook


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DATA = ROOT / "public" / "data"
PUBLIC_DATA.mkdir(parents=True, exist_ok=True)

PE_BOUNDS = {
    "min_lat": -9.7,
    "max_lat": -7.1,
    "min_lng": -42.0,
    "max_lng": -34.7,
}


def parse_coord(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    text = str(value).strip()
    if not text:
        return None
    text = text.replace("#", "").replace("−", "-").replace(",", ".")
    match = re.search(r"-?\d+(?:\.\d+)?", text)
    if not match:
        return None
    try:
        return float(match.group(0))
    except ValueError:
        return None


def in_pernambuco(lat: float | None, lng: float | None) -> bool:
    if lat is None or lng is None:
        return False
    return (
        PE_BOUNDS["min_lat"] <= lat <= PE_BOUNDS["max_lat"]
        and PE_BOUNDS["min_lng"] <= lng <= PE_BOUNDS["max_lng"]
    )


def clean_text(value: Any) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    return str(value).strip()


def point(
    layer: str,
    name: Any,
    lat: Any,
    lng: Any,
    municipality: Any = "",
    status: Any = "",
    extra: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    parsed_lat = parse_coord(lat)
    parsed_lng = parse_coord(lng)
    if not in_pernambuco(parsed_lat, parsed_lng):
        return None
    return {
        "layer": layer,
        "name": clean_text(name) or "Sem nome informado",
        "municipality": clean_text(municipality),
        "lat": parsed_lat,
        "lng": parsed_lng,
        "status": clean_text(status),
        "extra": {k: clean_text(v) for k, v in (extra or {}).items() if clean_text(v)},
    }


def read_dessalinizadores() -> list[dict[str, Any]]:
    path = ROOT / "DESSALINIZADORES_COMUNIDADES_COORDENADAS.xlsx"
    df = pd.read_excel(path, header=3)
    rows = []
    for _, row in df.dropna(how="all").iterrows():
        item = point(
            "dessalinizadores",
            row.get("LOCALIDADE"),
            row.get("LATITUDE"),
            row.get("LONGITUDE"),
            row.get("MUNICÍPIO"),
            row.get("DESSALINIZADOR"),
        )
        if item:
            rows.append(item)
    return rows


def read_pocos() -> list[dict[str, Any]]:
    path = ROOT / "POCOS_COMUNIDADES_COORDENADAS.xlsx"
    df = pd.read_excel(path, sheet_name="Plan1", header=1)
    rows = []
    for _, row in df.dropna(how="all").iterrows():
        item = point(
            "pocos",
            row.get("Localidade"),
            row.get("Latitude"),
            row.get("Longitude"),
            row.get("Municipio "),
            row.get("STATUS"),
            {"empresa": row.get("Empresa")},
        )
        if item:
            rows.append(item)
    return rows


def read_sisar() -> list[dict[str, Any]]:
    path = ROOT / "SAA__SISAR_coordenadas.xlsx"
    rows = []
    for sheet in ["Moxotó", "Alto Pajeú"]:
        df = pd.read_excel(path, sheet_name=sheet, header=1)
        for _, row in df.dropna(how="all").iterrows():
            coord = clean_text(row.get("coordenadas"))
            parts = [part.strip() for part in coord.split(",")]
            if len(parts) < 2:
                continue
            item = point(
                "sisar",
                row.get("SISTEMA DE ABASTECIMENTO DE ÁGUA"),
                parts[0],
                parts[1],
                "",
                sheet,
                {"observação": row.get("obs")},
            )
            if item:
                rows.append(item)
    return rows


def read_barragens() -> list[dict[str, Any]]:
    path = ROOT / "LISTA_BARRAGENS_SRHS_SNISB_2026.04.29.csv"
    df = pd.read_csv(path, sep=";", encoding="latin1", header=2)
    rows = []
    for _, row in df.dropna(how="all").iterrows():
        item = point(
            "barragens",
            row.get("Nome_da_Barragem"),
            row.get("Latitude"),
            row.get("Longitude"),
            row.get("Município "),
            row.get("Nível_de_Perigo_Global "),
            {
                "uso": row.get("Uso_Principal"),
                "risco": row.get("Categoria_de_Risco"),
                "dano potencial": row.get("Dano_Potencial_Associado"),
                "capacidade hm3": row.get("Capacidade_hm³ "),
            },
        )
        if item:
            rows.append(item)
    return rows


def read_outorgas(path: Path, layer: str) -> list[dict[str, Any]]:
    wb = load_workbook(path, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    headers = [cell.value for cell in next(ws.iter_rows(min_row=1, max_row=1))]
    idx = {name: pos for pos, name in enumerate(headers) if name}
    needed = [
        "INT_NU_LATITUDE",
        "INT_NU_LONGITUDE",
        "ING_SG_UFMUNICIPIO",
        "ING_NM_MUNICIPIO",
        "EMP_NM_EMPREENDIMENTO",
        "EMP_NM_USUARIO",
        "INT_TSU_DS",
        "INT_TCH_DS",
        "FIN_TFN_DS",
        "OUT_TP_SITUACAOOUTORGA",
        "INT_QT_VAZAOMEDIA",
    ]
    positions = {name: idx[name] for name in needed if name in idx}
    rows = []
    for values in ws.iter_rows(min_row=2, values_only=True):
        uf = clean_text(values[positions["ING_SG_UFMUNICIPIO"]]) if "ING_SG_UFMUNICIPIO" in positions else ""
        lat = values[positions["INT_NU_LATITUDE"]]
        lng = values[positions["INT_NU_LONGITUDE"]]
        if uf and uf != "PE":
            continue
        item = point(
            layer,
            values[positions.get("EMP_NM_EMPREENDIMENTO", positions.get("EMP_NM_USUARIO", 0))],
            lat,
            lng,
            values[positions.get("ING_NM_MUNICIPIO", 0)],
            values[positions.get("OUT_TP_SITUACAOOUTORGA", 0)],
            {
                "tipo": values[positions.get("INT_TSU_DS", 0)],
                "condição": values[positions.get("INT_TCH_DS", 0)],
                "finalidade": values[positions.get("FIN_TFN_DS", 0)],
                "vazão média": values[positions.get("INT_QT_VAZAOMEDIA", 0)],
            },
        )
        if item:
            rows.append(item)
    wb.close()
    return rows


def build_rural_geojson() -> tuple[dict[str, Any], dict[str, Any]]:
    zip_path = ROOT / "PE_setores_CD2022.zip"
    extract_dir = ROOT / ".cache" / "ibge_setores"
    shp_path = extract_dir / "PE_setores_CD2022.shp"
    if not shp_path.exists():
        extract_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(extract_dir)

    gdf = gpd.read_file(shp_path)
    rural = gdf[gdf["SITUACAO"].astype(str).str.lower() == "rural"].copy()
    situacao_code_col = "CD_SITUACAO" if "CD_SITUACAO" in rural.columns else "CD_SIT"
    rural["CD_SITUACAO"] = rural[situacao_code_col].astype(str)
    detail_counts = rural["CD_SITUACAO"].value_counts().to_dict()
    rural = rural[
        [
            "CD_SETOR",
            "SITUACAO",
            "CD_SITUACAO",
            "NM_MUN",
            "AREA_KM2",
            "geometry",
        ]
    ]
    rural["geometry"] = rural.geometry.simplify(0.0015, preserve_topology=True)
    geojson = json.loads(rural.to_json())
    summary = {
        "total_setores": int(len(gdf)),
        "rural_setores": int(len(rural)),
        "rural_area_km2": round(float(rural["AREA_KM2"].fillna(0).sum()), 2),
        "detail_counts": {str(k): int(v) for k, v in detail_counts.items()},
    }
    return geojson, summary


def aggregate_by_municipality(points: list[dict[str, Any]]) -> list[dict[str, Any]]:
    counter: dict[str, Counter[str]] = defaultdict(Counter)
    for item in points:
        municipality = item.get("municipality") or "Sem município"
        counter[municipality][item["layer"]] += 1
    rows = []
    for municipality, counts in sorted(counter.items()):
        total = sum(counts.values())
        rows.append({"municipality": municipality, "total": total, "counts": dict(counts)})
    return sorted(rows, key=lambda row: row["total"], reverse=True)


def main() -> None:
    layers = {
        "pocos": read_pocos(),
        "dessalinizadores": read_dessalinizadores(),
        "sisar": read_sisar(),
        "barragens": read_barragens(),
        "outorgas_subterraneas": read_outorgas(
            ROOT / "Outorgas_validas_de_abastecimento_publico___Aguas_subterraneas_17_04_2026_CNAR.xlsx",
            "outorgas_subterraneas",
        ),
        "outorgas_superficiais": read_outorgas(
            ROOT / "Outorgas_validas_de_abastecimento_publico___Aguas_superficiais_17_04_2026_CNARH.xlsx",
            "outorgas_superficiais",
        ),
    }
    rural_geojson, rural_summary = build_rural_geojson()
    all_points = [item for rows in layers.values() for item in rows]
    data = {
        "generated_at": pd.Timestamp.now().isoformat(),
        "bounds": PE_BOUNDS,
        "layers": layers,
        "rural": rural_geojson,
        "rural_summary": rural_summary,
        "municipalities": aggregate_by_municipality(all_points),
        "totals": {name: len(rows) for name, rows in layers.items()},
        "source_files": [
            "POCOS_COMUNIDADES_COORDENADAS.xlsx",
            "DESSALINIZADORES_COMUNIDADES_COORDENADAS.xlsx",
            "SAA__SISAR_coordenadas.xlsx",
            "LISTA_BARRAGENS_SRHS_SNISB_2026.04.29.csv",
            "Outorgas_validas_de_abastecimento_publico___Aguas_subterraneas_17_04_2026_CNAR.xlsx",
            "Outorgas_validas_de_abastecimento_publico___Aguas_superficiais_17_04_2026_CNARH.xlsx",
            "PE_setores_CD2022.zip",
        ],
    }
    output = PUBLIC_DATA / "dashboard.json"
    output.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {output}")
    print(json.dumps(data["totals"], ensure_ascii=False, indent=2))
    print(json.dumps(rural_summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
