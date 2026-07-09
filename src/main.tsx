import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Activity,
  AlertTriangle,
  BadgeInfo,
  ChevronDown,
  Database,
  Droplets,
  Filter,
  Layers,
  MapPinned,
  Search,
  Table2,
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

type View = "map" | "coverage" | "needs" | "municipalities" | "alerts";

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
  drought_municipalities: GeoJSON.FeatureCollection;
  unmatched_drought_municipalities?: string[];
    rural_summary: {
    total_setores: number;
    rural_setores: number;
    rural_area_km2: number;
    rural_population?: number;
    rural_agglomerate_population?: number;
    detail_counts: Record<string, number>;
    detail_population?: Record<string, number>;
    drought_municipalities?: number;
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

const DIRECT_WATER_LAYERS: LayerKey[] = ["pocos", "dessalinizadores", "sisar", "outorgas_subterraneas"];

const VIEW_META: Record<View, { title: string; breadcrumb: string; icon: React.ReactNode }> = {
  map: {
    title: "Painel de Poços, Dessalinizadores e Outorgas",
    breadcrumb: "Pernambuco · Infraestrutura hídrica · Áreas rurais IBGE",
    icon: <MapPinned size={20} />,
  },
  coverage: {
    title: "Cobertura Rural",
    breadcrumb: "Pernambuco · Aglomerados rurais · Infraestrutura próxima",
    icon: <Layers size={20} />,
  },
  needs: {
    title: "Necessidade de Água",
    breadcrumb: "Pernambuco · Aglomerados rurais · Necessidade estimada",
    icon: <Droplets size={20} />,
  },
  municipalities: {
    title: "Municípios",
    breadcrumb: "Pernambuco · Leitura municipal · Consolidação das bases",
    icon: <Table2 size={20} />,
  },
  alerts: {
    title: "Alertas e Prioridades",
    breadcrumb: "Pernambuco · Priorização territorial · Riscos e lacunas",
    icon: <AlertTriangle size={20} />,
  },
};

function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [view, setView] = useState<View>("map");
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

  const allPointRows = useMemo(() => (data ? allPoints(data) : []), [data]);
  const filteredPoints = useMemo(() => {
    if (!data) return [];
    const normalized = normalize(query);
    return allPointRows.filter((item) => {
      if (!activeLayers[item.layer]) return false;
      if (!normalized) return true;
      return [item.name, item.municipality, item.status, ...Object.values(item.extra)].some((value) =>
        normalize(value).includes(normalized),
      );
    });
  }, [activeLayers, allPointRows, data, query]);

  const ruralGeoJson = useMemo(() => {
    if (!data || !showRural) return null;
    return filterRuralGeoJson(data.rural, ruralMode);
  }, [data, ruralMode, showRural]);

  if (!data) return <div className="loading">Carregando painel...</div>;

  const activeMeta = VIEW_META[view];

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
          {(Object.keys(VIEW_META) as View[]).map((key) => (
            <button key={key} className={`nav-item ${view === key ? "active" : ""}`} onClick={() => setView(key)}>
              {VIEW_META[key].icon}
              {VIEW_META[key].title}
            </button>
          ))}
        </nav>

        <section className="sidebar-note">
          <span>Fontes</span>
          <p>Planilhas locais, SNISB/APAC/CNARH e Malha de Setores Censitários 2022 do IBGE.</p>
        </section>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="breadcrumb">{activeMeta.breadcrumb}</p>
            <h1>{activeMeta.title}</h1>
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

        {view === "map" && (
          <MapDashboard
            data={data}
            filteredPoints={filteredPoints}
            activeLayers={activeLayers}
            setActiveLayers={setActiveLayers}
            ruralGeoJson={ruralGeoJson}
            showRural={showRural}
            setShowRural={setShowRural}
            ruralMode={ruralMode}
            setRuralMode={setRuralMode}
            selectedPoint={selectedPoint}
            setSelectedPoint={setSelectedPoint}
          />
        )}

        {view === "coverage" && (
          <CoveragePage data={data} query={query} onSelectPoint={setSelectedPoint} />
        )}

        {view === "needs" && <WaterNeedsPage data={data} query={query} />}

        {view === "municipalities" && <MunicipalitiesPage data={data} query={query} />}

        {view === "alerts" && <AlertsPage data={data} />}
      </main>
    </div>
  );
}

function MapDashboard({
  data,
  filteredPoints,
  activeLayers,
  setActiveLayers,
  ruralGeoJson,
  showRural,
  setShowRural,
  ruralMode,
  setRuralMode,
  selectedPoint,
  setSelectedPoint,
}: {
  data: DashboardData;
  filteredPoints: Point[];
  activeLayers: Record<LayerKey, boolean>;
  setActiveLayers: React.Dispatch<React.SetStateAction<Record<LayerKey, boolean>>>;
  ruralGeoJson: GeoJSON.FeatureCollection | null;
  showRural: boolean;
  setShowRural: (value: boolean) => void;
  ruralMode: string;
  setRuralMode: (value: string) => void;
  selectedPoint: Point | null;
  setSelectedPoint: (point: Point) => void;
}) {
  const topMunicipalities = useMemo(() => topByMunicipality(filteredPoints).slice(0, 12), [filteredPoints]);

  return (
    <>
      <section className="metric-grid">
        <Metric label="Pontos visíveis" value={formatNumber(filteredPoints.length)} detail="Após filtros ativos" />
        <Metric label="Setores rurais IBGE" value={formatNumber(data.rural_summary.rural_setores)} detail={`${formatNumber(data.rural_summary.rural_area_km2)} km²`} />
        <Metric label="Municípios com registros" value={formatNumber(data.municipalities.length)} detail="Bases locais consolidadas" />
      </section>

      <LayerBar data={data} activeLayers={activeLayers} setActiveLayers={setActiveLayers} />

      <section className="workspace">
        <div className="map-column">
          <MapFrame>
            <MapView
              points={filteredPoints}
              ruralGeoJson={ruralGeoJson}
              droughtGeoJson={data.drought_municipalities}
              onSelectPoint={setSelectedPoint}
            />
            <MapLegend
              layerKeys={(Object.keys(LAYER_META) as LayerKey[]).filter((key) => activeLayers[key])}
              ruralLabel={showRural ? "Setores rurais IBGE" : undefined}
              droughtLabel="Municípios em decreto de estiagem"
            />
          </MapFrame>
        </div>

        <aside className="control-column">
          <section className="panel selected-panel">
            <PanelTitle icon={<BadgeInfo size={18} />} title="Registro selecionado" />
            <PointDetails point={selectedPoint} />
          </section>

          <RuralControls
            data={data}
            showRural={showRural}
            setShowRural={setShowRural}
            ruralMode={ruralMode}
            setRuralMode={setRuralMode}
          />
        </aside>
      </section>

      <section className="content-grid">
        <div className="panel">
          <PanelTitle icon={<Database size={18} />} title="Resumo por base" />
          <SourceGrid data={data} />
        </div>

        <div className="panel">
          <PanelTitle icon={<MapPinned size={18} />} title="Municípios em destaque" />
          <RankList rows={topMunicipalities} />
        </div>
      </section>
    </>
  );
}

function CoveragePage({ data, query, onSelectPoint }: { data: DashboardData; query: string; onSelectPoint: (point: Point) => void }) {
  const ruralAgg = useMemo(() => filterRuralGeoJson(data.rural, "agglomerates"), [data]);
  const directPoints = useMemo(() => allPoints(data).filter((item) => DIRECT_WATER_LAYERS.includes(item.layer)), [data]);
  const visibleDirectPoints = useMemo(() => {
    const normalized = normalize(query);
    if (!normalized) return directPoints;
    return directPoints.filter((item) => [item.name, item.municipality, item.status, ...Object.values(item.extra)].some((value) => normalize(value).includes(normalized)));
  }, [directPoints, query]);
  const rows = useMemo(() => coverageRows(data), [data]);
  const priorityRows = rows.filter((row) => row.agglomerates > 0).slice(0, 14);
  const coverageTableRows = rows.filter((row) => row.agglomerates > 0 || row.total > 0);
  const noDirectInfra = rows.filter((row) => row.agglomerates > 0 && row.directInfra === 0).length;

  return (
    <div className="page-stack">
      <section className="metric-grid">
        <Metric label="População em aglomerados" value={formatNumber(data.rural_summary.rural_agglomerate_population ?? 0)} detail="Censo 2022, setores 5, 6 e 7" />
        <Metric label="Infraestrutura direta" value={formatNumber(directPoints.length)} detail="Poços, dessalinizadores, SISAR e outorgas subterrâneas" />
        <Metric label="Sem infraestrutura direta" value={formatNumber(noDirectInfra)} detail="Municípios com aglomerado rural e sem ponto direto na base" />
      </section>

      <section className="coverage-grid">
        <div className="map-column">
          <MapFrame>
            <MapView
              points={visibleDirectPoints}
              ruralGeoJson={ruralAgg}
              droughtGeoJson={data.drought_municipalities}
              onSelectPoint={onSelectPoint}
              compact
            />
            <MapLegend
              layerKeys={DIRECT_WATER_LAYERS}
              ruralLabel="Aglomerados rurais IBGE"
              droughtLabel="Municípios em decreto de estiagem"
            />
          </MapFrame>
        </div>
        <aside className="panel">
          <PanelTitle icon={<Layers size={18} />} title="Prioridade territorial" />
          <p className="panel-copy">Ranking combina quantidade de aglomerados rurais do IBGE com a presença de infraestrutura hídrica direta nas bases carregadas.</p>
          <div className="priority-list">
            {priorityRows.map((row, index) => (
              <article key={row.municipality}>
                <span>{index + 1}</span>
                <div>
                  <strong>{titleCase(row.municipality)}</strong>
                  <p>{formatNumber(row.agglomerates)} aglomerados · {formatNumber(row.directInfra)} infra direta</p>
                </div>
                <em>{row.directInfra === 0 ? "Prioridade" : ratioLabel(row.directInfra, row.agglomerates)}</em>
              </article>
            ))}
          </div>
        </aside>
      </section>

      <section className="panel">
        <PanelTitle icon={<Table2 size={18} />} title="Cobertura rural por município" />
        <DataTable rows={coverageTableRows} mode="coverage" />
      </section>
    </div>
  );
}

function WaterNeedsPage({ data, query }: { data: DashboardData; query: string }) {
  const rows = useMemo(() => {
    const normalized = normalize(query);
    const base = coverageRows(data)
      .filter((row) => row.agglomerates > 0)
      .sort((a, b) => b.needScore - a.needScore);
    if (!normalized) return base;
    return base.filter((row) => normalize(row.municipality).includes(normalized));
  }, [data, query]);
  const topRows = rows.slice(0, 14);
  const criticalRows = rows.filter((row) => row.needScore >= 100);
  const top = rows[0];

  return (
    <div className="page-stack">
      <section className="metric-grid">
        <Metric label="Maior necessidade estimada" value={titleCase(top?.municipality ?? "-")} detail={`${formatNumber(top?.needScore ?? 0)} pontos no índice`} />
        <Metric label="Municípios críticos" value={formatNumber(criticalRows.length)} detail="Índice estimado igual ou acima de 100" />
        <Metric label="População no top 14" value={formatNumber(topRows.reduce((sum, row) => sum + row.population, 0))} detail="Pessoas em aglomerados rurais" />
      </section>

      <section className="needs-grid">
        <div className="panel">
          <PanelTitle icon={<Droplets size={18} />} title="Maiores necessidades por aglomerados rurais" />
          <p className="panel-copy">
            Índice estimado: combina população dos aglomerados rurais no Censo 2022, lacuna entre aglomerados e infraestrutura direta, e presença no decreto de estiagem. Não representa vazão medida.
          </p>
          <WaterNeedsTable rows={rows} />
        </div>

        <aside className="panel">
          <PanelTitle icon={<AlertTriangle size={18} />} title="Top 14 prioridades" />
          <div className="need-rank-list">
            {topRows.map((row, index) => (
              <article key={row.municipality}>
                <span>{index + 1}</span>
                <div>
                  <strong>{titleCase(row.municipality)}</strong>
                  <p>
                    {formatNumber(row.population)} pessoas · {formatNumber(row.agglomerates)} aglomerados
                    {row.drought ? " · decreto" : ""}
                  </p>
                </div>
                <em>{formatNumber(row.needScore)}</em>
              </article>
            ))}
          </div>
        </aside>
      </section>
    </div>
  );
}

function MunicipalitiesPage({ data, query }: { data: DashboardData; query: string }) {
  const rows = useMemo(() => coverageRows(data), [data]);
  const visibleRows = useMemo(() => {
    const normalized = normalize(query);
    if (!normalized) return rows;
    return rows.filter((row) => normalize(row.municipality).includes(normalized));
  }, [query, rows]);
  const topTotal = visibleRows.slice().sort((a, b) => b.total - a.total).slice(0, 8);

  return (
    <div className="page-stack">
      <section className="metric-grid">
        <Metric label="Municípios listados" value={formatNumber(visibleRows.length)} detail="Com rural ou registros nas bases" />
        <Metric label="Maior concentração" value={titleCase(topTotal[0]?.municipality ?? "-")} detail={`${formatNumber(topTotal[0]?.total ?? 0)} registros`} />
        <Metric label="Bases integradas" value={formatNumber(Object.keys(LAYER_META).length)} detail="Camadas pontuais consolidadas" />
      </section>

      <section className="content-grid">
        <div className="panel">
          <PanelTitle icon={<Table2 size={18} />} title="Tabela municipal" />
          <DataTable rows={visibleRows} mode="municipalities" />
        </div>
        <div className="panel">
          <PanelTitle icon={<MapPinned size={18} />} title="Maiores volumes" />
          <RankList rows={topTotal.map((row) => ({ municipality: row.municipality, total: row.total, counts: row.counts }))} />
        </div>
      </section>
    </div>
  );
}

function AlertsPage({ data }: { data: DashboardData }) {
  const rows = useMemo(() => coverageRows(data), [data]);
  const highRiskDams = data.layers.barragens.filter((item) => {
    const risk = normalize(`${item.extra.risco} ${item.extra["dano potencial"]}`);
    return risk.includes("alto");
  });
  const noMunicipality = allPoints(data).filter((item) => !item.municipality);
  const noDirectInfra = rows.filter((row) => row.agglomerates > 0 && row.directInfra === 0).slice(0, 12);
  const lowDirectInfra = rows.filter((row) => row.agglomerates >= 10 && row.directInfra > 0).sort((a, b) => a.directInfra / a.agglomerates - b.directInfra / b.agglomerates).slice(0, 12);

  return (
    <div className="page-stack">
      <section className="metric-grid">
        <Metric label="Barragens alto risco/dano" value={formatNumber(highRiskDams.length)} detail="Campo risco ou dano potencial" />
        <Metric label="Municípios sem infra direta" value={formatNumber(noDirectInfra.length)} detail="Com aglomerados rurais" />
        <Metric label="Registros sem município" value={formatNumber(noMunicipality.length)} detail="Precisam enriquecimento cadastral" />
      </section>

      <section className="alert-grid">
        <AlertPanel title="Lacunas rurais" rows={noDirectInfra.map((row) => ({ title: titleCase(row.municipality), detail: `${formatNumber(row.agglomerates)} aglomerados rurais sem ponto direto`, tone: "red" }))} />
        <AlertPanel title="Baixa densidade" rows={lowDirectInfra.map((row) => ({ title: titleCase(row.municipality), detail: `${formatNumber(row.directInfra)} infra direta para ${formatNumber(row.agglomerates)} aglomerados`, tone: "yellow" }))} />
        <AlertPanel title="Barragens críticas" rows={highRiskDams.slice(0, 12).map((item) => ({ title: item.name, detail: `${titleCase(item.municipality)} · ${item.extra.risco || "risco n/i"} · ${item.extra["dano potencial"] || "dano n/i"}`, tone: "orange" }))} />
        <AlertPanel title="Cadastro incompleto" rows={noMunicipality.slice(0, 12).map((item) => ({ title: item.name, detail: LAYER_META[item.layer].label, tone: "blue" }))} />
      </section>
    </div>
  );
}

function LayerBar({
  data,
  activeLayers,
  setActiveLayers,
}: {
  data: DashboardData;
  activeLayers: Record<LayerKey, boolean>;
  setActiveLayers: React.Dispatch<React.SetStateAction<Record<LayerKey, boolean>>>;
}) {
  return (
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
  );
}

function RuralControls({
  data,
  showRural,
  setShowRural,
  ruralMode,
  setRuralMode,
}: {
  data: DashboardData;
  showRural: boolean;
  setShowRural: (value: boolean) => void;
  ruralMode: string;
  setRuralMode: (value: string) => void;
}) {
  return (
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
  );
}

function MapFrame({ children }: { children: React.ReactNode }) {
  return <div className="map-frame">{children}</div>;
}

function MapLegend({ layerKeys, ruralLabel, droughtLabel }: { layerKeys: LayerKey[]; ruralLabel?: string; droughtLabel?: string }) {
  return (
    <aside className="map-floating-legend">
      <strong>Legenda</strong>
      <div className="legend-items">
        {layerKeys.map((key) => (
          <div key={key}>
            <span className="legend-dot-point" style={{ background: LAYER_META[key].color }} />
            <p>{LAYER_META[key].label}</p>
          </div>
        ))}
        {ruralLabel && (
          <div>
            <span className="legend-polygon" />
            <p>{ruralLabel}</p>
          </div>
        )}
        {droughtLabel && (
          <div>
            <span className="legend-drought" />
            <p>{droughtLabel}</p>
          </div>
        )}
      </div>
    </aside>
  );
}

function MapView({
  points,
  ruralGeoJson,
  droughtGeoJson,
  onSelectPoint,
  compact = false,
}: {
  points: Point[];
  ruralGeoJson: GeoJSON.FeatureCollection | null;
  droughtGeoJson?: GeoJSON.FeatureCollection | null;
  onSelectPoint: (point: Point) => void;
  compact?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const ruralLayerRef = useRef<L.GeoJSON | null>(null);
  const droughtLayerRef = useRef<L.GeoJSON | null>(null);

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
            { sticky: true },
          );
        },
      }).addTo(map);
      ruralLayerRef.current.bringToBack();
    }
  }, [ruralGeoJson]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (droughtLayerRef.current) {
      droughtLayerRef.current.removeFrom(map);
      droughtLayerRef.current = null;
    }
    if (droughtGeoJson) {
      droughtLayerRef.current = L.geoJSON(droughtGeoJson, {
        style: {
          color: "#9f1239",
          weight: 1.2,
          fillColor: "#fb7185",
          fillOpacity: 0.18,
        },
        onEachFeature: (feature, layer) => {
          const props = feature.properties ?? {};
          layer.bindTooltip(
            `<strong>${props.NM_MUN ?? "Município"}</strong><br/>Município em decreto de estiagem`,
            { sticky: true },
          );
        },
      }).addTo(map);
      droughtLayerRef.current.bringToBack();
      ruralLayerRef.current?.bringToBack();
    }
  }, [droughtGeoJson]);

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
      mapRef.current.fitBounds(bounds, { padding: [24, 24], maxZoom: compact ? 9 : 8 });
    }
  }, [compact, onSelectPoint, points]);

  return <div ref={containerRef} className={`map-canvas ${compact ? "compact-map" : ""}`} />;
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

function SourceGrid({ data }: { data: DashboardData }) {
  return (
    <div className="source-grid">
      {(Object.keys(LAYER_META) as LayerKey[]).map((key) => (
        <article key={key} className="source-card">
          <span style={{ color: LAYER_META[key].color }}>{LAYER_META[key].short}</span>
          <strong>{formatNumber(data.totals[key])}</strong>
          <p>{LAYER_META[key].label}</p>
        </article>
      ))}
    </div>
  );
}

function RankList({ rows }: { rows: MunicipalityRow[] }) {
  return (
    <div className="rank-list">
      {rows.map((row, index) => (
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
  );
}

function DataTable({ rows, mode }: { rows: CoverageRow[]; mode: "coverage" | "municipalities" }) {
  const visibleRows = mode === "coverage" ? rows : rows.slice(0, 80);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Município</th>
            <th>Aglomerados</th>
            <th>População</th>
            <th>Infra direta</th>
            <th>Poços</th>
            <th>Dessal.</th>
            <th>SISAR</th>
            <th>Barragens</th>
            <th>Outorgas</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => (
            <tr key={row.municipality}>
              <td><strong>{titleCase(row.municipality)}</strong></td>
              <td>{formatNumber(row.agglomerates)}</td>
              <td>{formatNumber(row.population)}</td>
              <td>{formatNumber(row.directInfra)}</td>
              <td>{formatNumber(row.counts.pocos ?? 0)}</td>
              <td>{formatNumber(row.counts.dessalinizadores ?? 0)}</td>
              <td>{formatNumber(row.counts.sisar ?? 0)}</td>
              <td>{formatNumber(row.counts.barragens ?? 0)}</td>
              <td>{formatNumber((row.counts.outorgas_subterraneas ?? 0) + (row.counts.outorgas_superficiais ?? 0))}</td>
              <td className="score-cell">{formatNumber(row.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WaterNeedsTable({ rows }: { rows: CoverageRow[] }) {
  return (
    <div className="table-wrap">
      <table className="needs-table">
        <thead>
          <tr>
            <th>Município</th>
            <th>Índice</th>
            <th>Classificação</th>
            <th>População</th>
            <th>Aglomerados</th>
            <th>Infra direta</th>
            <th>Lacuna</th>
            <th>Decreto</th>
            <th>Poços</th>
            <th>Dessal.</th>
            <th>SISAR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.municipality}>
              <td><strong>{titleCase(row.municipality)}</strong></td>
              <td className="score-cell">{formatNumber(row.needScore)}</td>
              <td><span className={`need-pill ${needTone(row.needScore)}`}>{needLabel(row.needScore)}</span></td>
              <td>{formatNumber(row.population)}</td>
              <td>{formatNumber(row.agglomerates)}</td>
              <td>{formatNumber(row.directInfra)}</td>
              <td>{formatNumber(Math.max(0, row.agglomerates - row.directInfra))}</td>
              <td>{row.drought ? "Sim" : "Não"}</td>
              <td>{formatNumber(row.counts.pocos ?? 0)}</td>
              <td>{formatNumber(row.counts.dessalinizadores ?? 0)}</td>
              <td>{formatNumber(row.counts.sisar ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AlertPanel({ title, rows }: { title: string; rows: { title: string; detail: string; tone: string }[] }) {
  return (
    <section className="panel">
      <PanelTitle icon={<AlertTriangle size={18} />} title={title} />
      <div className="alert-list">
        {rows.length ? rows.map((row) => (
          <article key={`${row.title}-${row.detail}`}>
            <i className={`status-dot ${row.tone}`} />
            <div>
              <strong>{row.title}</strong>
              <p>{row.detail}</p>
            </div>
          </article>
        )) : <p className="empty-state">Nenhum alerta encontrado para este recorte.</p>}
      </div>
    </section>
  );
}

type CoverageRow = MunicipalityRow & {
  agglomerates: number;
  ruralArea: number;
  population: number;
  directInfra: number;
  drought: boolean;
  needScore: number;
};

function allPoints(data: DashboardData) {
  return (Object.keys(LAYER_META) as LayerKey[]).flatMap((key) => data.layers[key]);
}

function filterRuralGeoJson(geojson: GeoJSON.FeatureCollection, mode: string): GeoJSON.FeatureCollection {
  if (mode === "all") return geojson;
  const allowed = mode === "agglomerates" ? ["5", "6", "7"] : [mode];
  return {
    ...geojson,
    features: geojson.features.filter((feature) => allowed.includes(String(feature.properties?.CD_SITUACAO))),
  };
}

function coverageRows(data: DashboardData): CoverageRow[] {
  const byMunicipality = new Map<string, CoverageRow>();
  const droughtKeys = new Set(
    data.drought_municipalities.features.map((feature) => normalize(String(feature.properties?.NM_MUN ?? ""))),
  );
  const ensure = (municipality: string) => {
    const key = normalize(municipality) || "sem municipio";
    const current = byMunicipality.get(key);
    if (current) return current;
    const row: CoverageRow = {
      municipality: municipality || "Sem município",
      total: 0,
      counts: {},
      agglomerates: 0,
      ruralArea: 0,
      population: 0,
      directInfra: 0,
      drought: droughtKeys.has(key),
      needScore: 0,
    };
    byMunicipality.set(key, row);
    return row;
  };

  data.rural.features.forEach((feature) => {
    const municipality = String(feature.properties?.NM_MUN ?? "");
    const code = String(feature.properties?.CD_SITUACAO ?? "");
    const row = ensure(municipality);
    if (["5", "6", "7"].includes(code)) {
      row.agglomerates += 1;
      row.population += Number(feature.properties?.population ?? 0);
    }
    row.ruralArea += Number(feature.properties?.AREA_KM2 ?? 0);
  });

  allPoints(data).forEach((point) => {
    const row = ensure(point.municipality);
    row.total += 1;
    row.counts[point.layer] = (row.counts[point.layer] ?? 0) + 1;
    if (DIRECT_WATER_LAYERS.includes(point.layer)) row.directInfra += 1;
  });

  byMunicipality.forEach((row) => {
    row.drought = droughtKeys.has(normalize(row.municipality));
    row.needScore = waterNeedScore(row);
  });

  return [...byMunicipality.values()].sort((a, b) => {
    const aPriority = a.agglomerates * 3 - a.directInfra;
    const bPriority = b.agglomerates * 3 - b.directInfra;
    return bPriority - aPriority;
  });
}

function topByMunicipality(points: Point[]): MunicipalityRow[] {
  const counts = new Map<string, MunicipalityRow>();
  points.forEach((item) => {
    const municipality = item.municipality || "Sem município";
    const current = counts.get(municipality) ?? { municipality, total: 0, counts: {} };
    current.total += 1;
    current.counts[item.layer] = (current.counts[item.layer] ?? 0) + 1;
    counts.set(municipality, current);
  });
  return [...counts.values()].sort((a, b) => b.total - a.total);
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

function ratioLabel(directInfra: number, agglomerates: number) {
  if (!agglomerates) return "-";
  return `${(directInfra / agglomerates).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} por aglom.`;
}

function waterNeedScore(row: CoverageRow) {
  const gap = Math.max(0, row.agglomerates - row.directInfra);
  const populationWeight = row.population / 180;
  const coveragePenalty = row.directInfra === 0 ? 25 : Math.round((gap / Math.max(1, row.agglomerates)) * 20);
  const droughtBonus = row.drought ? 35 : 0;
  return Math.max(0, Math.round(populationWeight + row.agglomerates * 1.2 + gap * 2 + coveragePenalty + droughtBonus));
}

function needLabel(score: number) {
  if (score >= 180) return "Muito alta";
  if (score >= 100) return "Alta";
  if (score >= 50) return "Média";
  return "Baixa";
}

function needTone(score: number) {
  if (score >= 180) return "red";
  if (score >= 100) return "orange";
  if (score >= 50) return "yellow";
  return "blue";
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
