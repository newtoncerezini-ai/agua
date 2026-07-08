import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Activity,
  BadgeInfo,
  ChevronDown,
  Database,
  Droplets,
  Filter,
  Layers,
  MapPinned,
  Search,
  SlidersHorizontal,
  Waves,
} from "lucide-react";
import "./styles.css";

type LayerKey =
  | "pocos"
  | "dessalinizadores"
  | "sisar"
  | "barragens"
  | "outorgas_subterraneas"
  | "outorgas_superficiais";

type Point = {
  layer: LayerKey;
  name: string;
  municipality: string;
  lat: number;
  lng: number;
  status: string;
  extra: Record<string, string>;
};

type MunicipalityRow = {
  municipality: string;
  total: number;
  counts: Partial<Record<LayerKey, number>>;
};

type DashboardData = {
  generated_at: string;
  layers: Record<LayerKey, Point[]>;
  rural: GeoJSON.FeatureCollection;
  rural_summary: {
    total_setores: number;
    rural_setores: number;
    rural_area_km2: number;
    detail_counts: Record<string, number>;
  };
  municipalities: MunicipalityRow[];
  totals: Record<LayerKey, number>;
  source_files: string[];
};

const LAYER_META: Record<
  LayerKey,
  { label: string; short: string; color: string; icon: React.ReactNode }
> = {
  pocos: { label: "Poços comunitários", short: "Poços", color: "#006591", icon: <Droplets size={18} /> },
  dessalinizadores: { label: "Dessalinizadores", short: "Dessal.", color: "#16a34a", icon: <Waves size={18} /> },
  sisar: { label: "SAA / SISAR", short: "SISAR", color: "#7c3aed", icon: <Activity size={18} /> },
  barragens: { label: "Barragens", short: "Barragens", color: "#f97316", icon: <Layers size={18} /> },
  outorgas_subterraneas: { label: "Outorgas subterrâneas", short: "Subterr.", color: "#0f766e", icon: <Database size={18} /> },
  outorgas_superficiais: { label: "Outorgas superficiais", short: "Superf.", color: "#dc2626", icon: <BadgeInfo size={18} /> },
};

const RURAL_LABELS: Record<string, string> = {
  "5": "Aglomerado rural - Povoado",
  "6": "Aglomerado rural - Núcleo rural",
  "7": "Aglomerado rural - Lugarejo",
  "8": "Área rural exclusive aglomerados",
};

const DEFAULT_ACTIVE: Record<LayerKey, boolean> = {
  pocos: true,
  dessalinizadores: true,
  sisar: true,
  barragens: true,
  outorgas_subterraneas: true,
  outorgas_superficiais: true,
};

function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [activeLayers, setActiveLayers] = useState(DEFAULT_ACTIVE);
  const [showRural, setShowRural] = useState(true);
  const [ruralMode, setRuralMode] = useState("agglomerates");
  const [query, setQuery] = useState("");
  const [selectedPoint, setSelectedPoint] = useState<Point | null>(null);

  useEffect(() => {
    fetch("/data/dashboard.json")
      .then((response) => response.json())
      .then(setData)
      .catch((error) => console.error("Falha ao carregar dashboard.json", error));
  }, []);

  const filteredPoints = useMemo(() => {
    if (!data) return [];
    const normalized = normalize(query);
    return Object.entries(data.layers).flatMap(([layer, rows]) => {
      if (!activeLayers[layer as LayerKey]) return [];
      return rows.filter((item) => {
        if (!normalized) return true;
        return [item.name, item.municipality, item.status, ...Object.values(item.extra)]
          .some((value) => normalize(value).includes(normalized));
      });
    });
  }, [activeLayers, data, query]);

  const ruralGeoJson = useMemo(() => {
    if (!data || !showRural) return null;
    if (ruralMode === "all") return data.rural;
    if (ruralMode === "agglomerates") {
      return {
        ...data.rural,
        features: data.rural.features.filter((feature) => ["5", "6", "7"].includes(String(feature.properties?.CD_SITUACAO))),
      };
    }
    return {
      ...data.rural,
      features: data.rural.features.filter((feature) => String(feature.properties?.CD_SITUACAO) === ruralMode),
    };
  }, [data, ruralMode, showRural]);

  const activeTotal = filteredPoints.length;
  const topMunicipalities = useMemo(() => {
    if (!data) return [];
    const counts = new Map<string, MunicipalityRow>();
    filteredPoints.forEach((item) => {
      const municipality = item.municipality || "Sem município";
      const current = counts.get(municipality) ?? { municipality, total: 0, counts: {} };
      current.total += 1;
      current.counts[item.layer] = (current.counts[item.layer] ?? 0) + 1;
      counts.set(municipality, current);
    });
    return [...counts.values()].sort((a, b) => b.total - a.total).slice(0, 12);
  }, [data, filteredPoints]);

  if (!data) return <div className="loading">Carregando painel...</div>;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <MapPinned size={30} />
          </div>
          <div>
            <strong>Águas PE</strong>
            <span>Painel territorial</span>
          </div>
        </div>

        <nav className="nav-list">
          <button className="nav-item active">
            <MapPinned size={20} />
            Mapa integrado
          </button>
          <button className="nav-item">
            <SlidersHorizontal size={20} />
            Camadas
          </button>
          <button className="nav-item">
            <Database size={20} />
            Bases
          </button>
        </nav>

        <section className="sidebar-note">
          <span>Fontes</span>
          <p>Planilhas locais, SNISB/APAC/CNARH e Malha de Setores Censitários 2022 do IBGE.</p>
        </section>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="breadcrumb">Pernambuco · Infraestrutura hídrica · Áreas rurais IBGE</p>
            <h1>Painel de Poços, Dessalinizadores e Outorgas</h1>
          </div>
          <div className="top-actions">
            <div className="search-box">
              <Search size={18} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar município, localidade ou status"
              />
            </div>
          </div>
        </header>

        <section className="metric-grid">
          <Metric label="Pontos visíveis" value={formatNumber(activeTotal)} detail="Após filtros ativos" />
          <Metric label="Setores rurais IBGE" value={formatNumber(data.rural_summary.rural_setores)} detail={`${formatNumber(data.rural_summary.rural_area_km2)} km²`} />
          <Metric label="Municípios com registros" value={formatNumber(data.municipalities.length)} detail="Bases locais consolidadas" />
        </section>

        <section className="map-layer-bar">
          <div className="bar-title">
            <Filter size={18} />
            <strong>Camadas</strong>
          </div>
          <div className="layer-chip-list">
            {(Object.keys(LAYER_META) as LayerKey[]).map((key) => (
              <label key={key} className="layer-chip">
                <input
                  type="checkbox"
                  checked={activeLayers[key]}
                  onChange={() => setActiveLayers((current) => ({ ...current, [key]: !current[key] }))}
                />
                <span style={{ background: LAYER_META[key].color }}>{LAYER_META[key].icon}</span>
                <strong>{LAYER_META[key].short}</strong>
                <em>{formatNumber(data.totals[key])}</em>
              </label>
            ))}
          </div>
        </section>

        <section className="workspace">
          <div className="map-column">
            <MapView
              points={filteredPoints}
              ruralGeoJson={ruralGeoJson}
              onSelectPoint={setSelectedPoint}
            />
          </div>

          <aside className="control-column">
            <section className="panel selected-panel">
              <PanelTitle icon={<BadgeInfo size={18} />} title="Registro selecionado" />
              <PointDetails point={selectedPoint} />
            </section>

            <section className="panel">
              <PanelTitle icon={<Layers size={18} />} title="Áreas rurais IBGE" />
              <label className="rural-switch">
                <input type="checkbox" checked={showRural} onChange={() => setShowRural(!showRural)} />
                <span>Exibir setores rurais</span>
              </label>
              <div className="select-wrap">
                <span>Tipo rural</span>
                <div>
                  <select value={ruralMode} onChange={(event) => setRuralMode(event.target.value)}>
                    <option value="agglomerates">Aglomerados rurais</option>
                    <option value="all">Toda a área rural</option>
                    {Object.entries(RURAL_LABELS).map(([code, label]) => (
                      <option key={code} value={code}>{label}</option>
                    ))}
                  </select>
                  <ChevronDown size={16} />
                </div>
              </div>
              <div className="rural-breakdown">
                {Object.entries(RURAL_LABELS).map(([code, label]) => (
                  <div key={code}>
                    <span>{code}</span>
                    <p>{label}</p>
                    <strong>{formatNumber(data.rural_summary.detail_counts[code] ?? 0)}</strong>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </section>

        <section className="content-grid">
          <div className="panel">
            <PanelTitle icon={<Database size={18} />} title="Resumo por base" />
            <div className="source-grid">
              {(Object.keys(LAYER_META) as LayerKey[]).map((key) => (
                <article key={key} className="source-card">
                  <span style={{ color: LAYER_META[key].color }}>{LAYER_META[key].short}</span>
                  <strong>{formatNumber(data.totals[key])}</strong>
                  <p>{LAYER_META[key].label}</p>
                </article>
              ))}
            </div>
          </div>

          <div className="panel">
            <PanelTitle icon={<MapPinned size={18} />} title="Municípios em destaque" />
            <div className="rank-list">
              {topMunicipalities.map((row, index) => (
                <article key={row.municipality}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{titleCase(row.municipality)}</strong>
                    <p>{layerSentence(row.counts)}</p>
                  </div>
                  <em>{formatNumber(row.total)}</em>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function MapView({
  points,
  ruralGeoJson,
  onSelectPoint,
}: {
  points: Point[];
  ruralGeoJson: GeoJSON.FeatureCollection | null;
  onSelectPoint: (point: Point) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const ruralLayerRef = useRef<L.GeoJSON | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: false,
      preferCanvas: true,
    }).setView([-8.35, -37.85], 8);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);
    markerLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 100);
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (ruralLayerRef.current) {
      ruralLayerRef.current.removeFrom(map);
      ruralLayerRef.current = null;
    }
    if (ruralGeoJson) {
      ruralLayerRef.current = L.geoJSON(ruralGeoJson, {
        style: (feature) => ({
          color: "#4d3b00",
          weight: 0.55,
          fillColor: ruralColor(String(feature?.properties?.CD_SITUACAO ?? "")),
          fillOpacity: 0.28,
        }),
        onEachFeature: (feature, layer) => {
          const props = feature.properties ?? {};
          layer.bindTooltip(
            `<strong>${props.NM_MUN ?? "Setor rural"}</strong><br/>${RURAL_LABELS[String(props.CD_SITUACAO)] ?? "Rural"}<br/>${props.AREA_KM2 ?? ""} km²`,
            { sticky: true }
          );
        },
      }).addTo(map);
      ruralLayerRef.current.bringToBack();
    }
  }, [ruralGeoJson]);

  useEffect(() => {
    const group = markerLayerRef.current;
    if (!group) return;
    group.clearLayers();
    const bounds: L.LatLngTuple[] = [];
    points.forEach((item) => {
      const color = LAYER_META[item.layer].color;
      const marker = L.circleMarker([item.lat, item.lng], {
        radius: item.layer === "barragens" ? 5 : 6,
        color: "#ffffff",
        weight: 1.5,
        fillColor: color,
        fillOpacity: 0.86,
      });
      marker.bindTooltip(`<strong>${escapeHtml(item.name)}</strong><br/>${escapeHtml(titleCase(item.municipality || LAYER_META[item.layer].label))}`, { sticky: true });
      marker.on("click", () => onSelectPoint(item));
      marker.addTo(group);
      bounds.push([item.lat, item.lng]);
    });
    if (bounds.length && mapRef.current) {
      const currentZoom = mapRef.current.getZoom();
      if (currentZoom < 7 || currentZoom > 11) {
        mapRef.current.fitBounds(bounds, { padding: [24, 24], maxZoom: 9 });
      }
    }
  }, [onSelectPoint, points]);

  return <div ref={containerRef} className="map-canvas" />;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function PanelTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="panel-title">
      {icon}
      <h2>{title}</h2>
    </div>
  );
}

function PointDetails({ point }: { point: Point | null }) {
  if (!point) {
    return <p className="empty-state">Clique em um ponto do mapa para ver detalhes da base, status e atributos disponíveis.</p>;
  }
  return (
    <div className="point-detail">
      <span style={{ color: LAYER_META[point.layer].color }}>{LAYER_META[point.layer].label}</span>
      <strong>{point.name}</strong>
      <p>{titleCase(point.municipality) || "Município não informado"}</p>
      {point.status && <em>{point.status}</em>}
      <dl>
        <div>
          <dt>Latitude</dt>
          <dd>{point.lat.toFixed(6)}</dd>
        </div>
        <div>
          <dt>Longitude</dt>
          <dd>{point.lng.toFixed(6)}</dd>
        </div>
        {Object.entries(point.extra).map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function normalize(value: string) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function titleCase(value: string) {
  return String(value ?? "")
    .toLocaleLowerCase("pt-BR")
    .replace(/(^|\s|[-'])\S/g, (letter) => letter.toLocaleUpperCase("pt-BR"));
}

function layerSentence(counts: Partial<Record<LayerKey, number>>) {
  return (Object.keys(LAYER_META) as LayerKey[])
    .filter((key) => counts[key])
    .map((key) => `${counts[key]} ${LAYER_META[key].short}`)
    .join(" · ");
}

function ruralColor(code: string) {
  if (code === "5") return "#f59e0b";
  if (code === "6") return "#d97706";
  if (code === "7") return "#ca8a04";
  if (code === "8") return "#fde047";
  return "#facc15";
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[char];
  });
}

createRoot(document.getElementById("root")!).render(<App />);
