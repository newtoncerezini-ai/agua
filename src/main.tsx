import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Activity,
  AlertTriangle,
  BadgeInfo,
  BookOpenText,
  ChevronDown,
  ClipboardList,
  Database,
  Droplets,
  Filter,
  HardHat,
  Layers,
  MapPinned,
  FileDown,
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
  | "outorgas_superficiais"
  | "sda_pad"
  | "sda_pisf"
  | "ipa_pocos"
  | "ipa_barreiros";

type View = "map" | "coverage" | "needs" | "methodology" | "compesa" | "sda" | "ipa" | "municipalities" | "alerts" | "reports";

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

type CompesaWork = {
  id: number;
  name: string;
  description: string;
  type: string;
  municipalities_original: string;
  municipalities: string[];
  status: string;
  phase: string;
  source: string;
  population: number;
  value: number;
  execution: number;
  start_date: string;
  end_date: string;
  eixo: string;
  subeixo: string;
};

type CompesaMunicipality = {
  municipality: string;
  works_count: number;
  allocated_value: number;
  allocated_population: number;
  avg_execution: number;
  status_counts: Record<string, number>;
  phase_counts: Record<string, number>;
  eixo_counts: Record<string, number>;
  dominant_phase: string;
};

type CompesaData = {
  works: CompesaWork[];
  municipalities: CompesaMunicipality[];
  map: GeoJSON.FeatureCollection;
  unmatched_municipality_texts: string[];
  totals: {
    works: number;
    municipalities: number;
    value: number;
    population: number;
    status_counts: Record<string, number>;
    phase_counts: Record<string, number>;
    eixo_counts: Record<string, number>;
    subeixo_counts: Record<string, number>;
  };
};

type SdaRecord = {
  id: string;
  program: string;
  type: string;
  municipality: string;
  locality: string;
  status: string;
  quantity: number;
  population: number;
  lat?: number | null;
  lng?: number | null;
  detail?: string;
  first_water?: number;
  second_water?: number;
};

type SdaMunicipality = {
  municipality: string;
  pad: number;
  pad_entregue: number;
  pad_andamento: number;
  pisf: number;
  pisf_entregue: number;
  pisf_andamento: number;
  aguadas: number;
  cisternas_total: number;
  cisternas_1_agua: number;
  cisternas_2_agua: number;
  population: number;
  total_actions: number;
};

type SdaData = {
  records: SdaRecord[];
  municipalities: SdaMunicipality[];
  aguadas_map: GeoJSON.FeatureCollection;
  cisternas_map: GeoJSON.FeatureCollection;
  totals: {
    pad: number;
    pad_records: number;
    pisf_points: number;
    pisf_records: number;
    aguadas: number;
    cisternas: number;
    cisternas_1_agua: number;
    cisternas_2_agua: number;
    population: number;
    municipalities: number;
    status_counts: Record<string, number>;
    program_counts: Record<string, number>;
  };
};

type IpaPocoRecord = {
  id: string;
  program: string;
  sheet: string;
  municipality: string;
  locality: string;
  status: string;
  lat?: number | null;
  lng?: number | null;
  flow?: number;
  std?: number;
  owner?: string;
  observation?: string;
};

type IpaBarreiroRecord = {
  municipality: string;
  region: string;
  bar_authorized: number;
  bar_located: number;
  bar_executed: number;
  bpp_authorized: number;
  bpp_located: number;
  bpp_executed: number;
};

type IpaMunicipality = {
  municipality: string;
  pocos: number;
  pocos_instalados: number;
  pocos_perfurados: number;
  barreiros_executed: number;
  bpp_executed: number;
  total_actions: number;
};

type IpaData = {
  pocos: IpaPocoRecord[];
  barreiros: IpaBarreiroRecord[];
  municipalities: IpaMunicipality[];
  barreiros_map: GeoJSON.FeatureCollection;
  bpp_map: GeoJSON.FeatureCollection;
  totals: {
    pocos: number;
    pocos_mapped: number;
    pocos_unmapped: number;
    status_counts: Record<string, number>;
    sheet_counts: Record<string, number>;
    bar_authorized: number;
    bar_located: number;
    bar_executed: number;
    bpp_authorized: number;
    bpp_located: number;
    bpp_executed: number;
    municipalities: number;
    kml_placemarks: number;
    kml_mapped: number;
    kml_polygons: number;
  };
};

type DashboardData = {
  generated_at: string;
  layers: Record<LayerKey, Point[]>;
  rural: GeoJSON.FeatureCollection;
  drought_municipalities: GeoJSON.FeatureCollection;
  compesa_works: CompesaData;
  sda_actions: SdaData;
  ipa_actions: IpaData;
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

type ReportManifest = {
  generated_at: string;
  reports: {
    title: string;
    file: string;
    filename: string;
  }[];
  municipal_reports?: {
    title: string;
    file: string;
    filename: string;
    municipality: string;
  }[];
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
  sda_pad: { label: "PAD / SDA", short: "PAD", color: "#0d9488", icon: <Droplets size={18} /> },
  sda_pisf: { label: "PISF / SDA", short: "PISF", color: "#2563eb", icon: <Waves size={18} /> },
  ipa_pocos: { label: "Poços IPA", short: "Poços IPA", color: "#7c2d12", icon: <Droplets size={18} /> },
  ipa_barreiros: { label: "Barreiros IPA georreferenciados", short: "Barr. IPA", color: "#a16207", icon: <Layers size={18} /> },
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
  sda_pad: true,
  sda_pisf: true,
  ipa_pocos: true,
  ipa_barreiros: false,
};

const DIRECT_WATER_LAYERS: LayerKey[] = ["pocos", "dessalinizadores", "sisar", "outorgas_subterraneas", "sda_pad", "sda_pisf", "ipa_pocos"];

const VIEW_META: Record<View, { title: string; breadcrumb: string; icon: React.ReactNode }> = {
  map: {
    title: "Mapa Geral",
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
  methodology: {
    title: "Metodologia do Índice",
    breadcrumb: "Pernambuco · Necessidade de água · Cálculo e interpretação",
    icon: <BookOpenText size={20} />,
  },
  compesa: {
    title: "Obras Compesa",
    breadcrumb: "Pernambuco Â· Investimentos Â· Obras por municÃ­pio",
    icon: <HardHat size={20} />,
  },
  sda: {
    title: "Ações SDA",
    breadcrumb: "Pernambuco · Secretaria de Agricultura · PAD, PISF, Aguadas e Cisternas",
    icon: <ClipboardList size={20} />,
  },
  ipa: {
    title: "Acoes IPA",
    breadcrumb: "Pernambuco - IPA - Pocos, barreiros e barragens de pequeno porte",
    icon: <Database size={20} />,
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
  reports: {
    title: "Relatorios",
    breadcrumb: "Pernambuco - Saidas executivas - PDFs",
    icon: <FileDown size={20} />,
  },
};

function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [reportManifest, setReportManifest] = useState<ReportManifest | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(() => localStorage.getItem("aguas-pe-auth") === "ok");
  const [view, setView] = useState<View>("map");
  const [activeLayers, setActiveLayers] = useState(DEFAULT_ACTIVE);
  const [showRural, setShowRural] = useState(true);
  const [showCompesaWorks, setShowCompesaWorks] = useState(true);
  const [showSdaAguadas, setShowSdaAguadas] = useState(false);
  const [showSdaCisternas, setShowSdaCisternas] = useState(false);
  const [showIpaBarreiros, setShowIpaBarreiros] = useState(false);
  const [showIpaBpp, setShowIpaBpp] = useState(false);
  const [showDroughtMunicipalities, setShowDroughtMunicipalities] = useState(true);
  const [ruralMode, setRuralMode] = useState("agglomerates");
  const [query, setQuery] = useState("");
  const [selectedPoint, setSelectedPoint] = useState<Point | null>(null);
  const [selectedMunicipality, setSelectedMunicipality] = useState<string>("");

  useEffect(() => {
    fetch("/data/dashboard.json")
      .then((response) => response.json())
      .then(setData)
      .catch((error) => console.error("Falha ao carregar dashboard.json", error));
    fetch("/reports/report-manifest.json")
      .then((response) => (response.ok ? response.json() : null))
      .then(setReportManifest)
      .catch((error) => console.error("Falha ao carregar report-manifest.json", error));
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

  if (!isAuthenticated) {
    return <LoginScreen onLogin={() => setIsAuthenticated(true)} />;
  }

  if (!data) return <div className="loading">Carregando painel...</div>;

  const activeMeta = VIEW_META[view];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-logo" src="/assets/igpe.ico" alt="IGPE" />
          <div>
            <strong>Águas PE</strong>
            <span>Painel territorial</span>
          </div>
        </div>

        <div className="institutional-logo-card">
          <img src="/assets/logo-seplag-gov-cropped.png" alt="Secretaria de Planejamento, Gestao e Desenvolvimento Regional" />
        </div>

        <nav className="nav-list">
          {(Object.keys(VIEW_META) as View[]).map((key) => (
            <button key={key} className={`nav-item ${view === key ? "active" : ""}`} onClick={() => setView(key)}>
              {VIEW_META[key].icon}
              {VIEW_META[key].title}
            </button>
          ))}
        </nav>

        <button
          className="logout-button"
          onClick={() => {
            localStorage.removeItem("aguas-pe-auth");
            setIsAuthenticated(false);
          }}
        >
          Sair
        </button>

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
            showCompesaWorks={showCompesaWorks}
            setShowCompesaWorks={setShowCompesaWorks}
            showSdaAguadas={showSdaAguadas}
            setShowSdaAguadas={setShowSdaAguadas}
            showSdaCisternas={showSdaCisternas}
            setShowSdaCisternas={setShowSdaCisternas}
            showIpaBarreiros={showIpaBarreiros}
            setShowIpaBarreiros={setShowIpaBarreiros}
            showIpaBpp={showIpaBpp}
            setShowIpaBpp={setShowIpaBpp}
            showDroughtMunicipalities={showDroughtMunicipalities}
            setShowDroughtMunicipalities={setShowDroughtMunicipalities}
            selectedPoint={selectedPoint}
            setSelectedPoint={setSelectedPoint}
            selectedMunicipality={selectedMunicipality}
            setSelectedMunicipality={setSelectedMunicipality}
          />
        )}

        {view === "coverage" && (
          <CoveragePage data={data} query={query} onSelectPoint={setSelectedPoint} />
        )}

        {view === "needs" && <WaterNeedsPage data={data} query={query} />}

        {view === "methodology" && <MethodologyPage data={data} />}

        {view === "compesa" && <CompesaWorksPage data={data} query={query} />}

        {view === "sda" && <SdaActionsPage data={data} query={query} />}

        {view === "ipa" && <IpaActionsPage data={data} query={query} />}

        {view === "municipalities" && <MunicipalitiesPage data={data} query={query} />}

        {view === "alerts" && <AlertsPage data={data} />}

        {view === "reports" && <ReportsPage manifest={reportManifest} />}
      </main>
    </div>
  );
}

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (username === "seplag" && password === "123@mudar") {
      localStorage.setItem("aguas-pe-auth", "ok");
      onLogin();
      return;
    }
    setError("Usuario ou senha invalidos.");
  };

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand">
          <div className="brand-mark">
            <MapPinned size={30} />
          </div>
          <div>
            <strong>Aguas PE</strong>
            <span>Painel territorial</span>
          </div>
        </div>
        <form onSubmit={submit} className="login-form">
          <label>
            <span>Usuario</span>
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoFocus />
          </label>
          <label>
            <span>Senha</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
          </label>
          {error && <p className="login-error">{error}</p>}
          <button type="submit">Entrar</button>
        </form>
      </section>
    </main>
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
  showCompesaWorks,
  setShowCompesaWorks,
  showSdaAguadas,
  setShowSdaAguadas,
  showSdaCisternas,
  setShowSdaCisternas,
  showIpaBarreiros,
  setShowIpaBarreiros,
  showIpaBpp,
  setShowIpaBpp,
  showDroughtMunicipalities,
  setShowDroughtMunicipalities,
  selectedPoint,
  setSelectedPoint,
  selectedMunicipality,
  setSelectedMunicipality,
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
  showCompesaWorks: boolean;
  setShowCompesaWorks: (value: boolean) => void;
  showSdaAguadas: boolean;
  setShowSdaAguadas: (value: boolean) => void;
  showSdaCisternas: boolean;
  setShowSdaCisternas: (value: boolean) => void;
  showIpaBarreiros: boolean;
  setShowIpaBarreiros: (value: boolean) => void;
  showIpaBpp: boolean;
  setShowIpaBpp: (value: boolean) => void;
  showDroughtMunicipalities: boolean;
  setShowDroughtMunicipalities: (value: boolean) => void;
  selectedPoint: Point | null;
  setSelectedPoint: (point: Point | null) => void;
  selectedMunicipality: string;
  setSelectedMunicipality: (municipality: string) => void;
}) {
  const topMunicipalities = useMemo(() => topByMunicipality(filteredPoints).slice(0, 12), [filteredPoints]);

  return (
    <>
      <section className="metric-grid">
        <Metric label="Pontos visíveis" value={formatNumber(filteredPoints.length)} detail="Após filtros ativos" />
        <Metric label="Setores rurais IBGE" value={formatNumber(data.rural_summary.rural_setores)} detail={`${formatNumber(data.rural_summary.rural_area_km2)} km²`} />
        <Metric label="Municípios com registros" value={formatNumber(data.municipalities.length)} detail="Bases locais consolidadas" />
      </section>

      <LayerBar
        data={data}
        activeLayers={activeLayers}
        setActiveLayers={setActiveLayers}
        showCompesaWorks={showCompesaWorks}
        setShowCompesaWorks={setShowCompesaWorks}
        showSdaAguadas={showSdaAguadas}
        setShowSdaAguadas={setShowSdaAguadas}
        showSdaCisternas={showSdaCisternas}
        setShowSdaCisternas={setShowSdaCisternas}
        showIpaBarreiros={showIpaBarreiros}
        setShowIpaBarreiros={setShowIpaBarreiros}
        showIpaBpp={showIpaBpp}
        setShowIpaBpp={setShowIpaBpp}
        showDroughtMunicipalities={showDroughtMunicipalities}
        setShowDroughtMunicipalities={setShowDroughtMunicipalities}
      />

      <section className="workspace">
        <div className="map-column">
          <MapFrame>
            <MapView
              points={filteredPoints}
              ruralGeoJson={ruralGeoJson}
              droughtGeoJson={showDroughtMunicipalities ? data.drought_municipalities : null}
              compesaGeoJson={showCompesaWorks ? data.compesa_works.map : null}
              sdaAguadasGeoJson={showSdaAguadas ? data.sda_actions.aguadas_map : null}
              sdaCisternasGeoJson={showSdaCisternas ? data.sda_actions.cisternas_map : null}
              ipaBarreirosGeoJson={showIpaBarreiros ? data.ipa_actions.barreiros_map : null}
              ipaBppGeoJson={showIpaBpp ? data.ipa_actions.bpp_map : null}
              onSelectPoint={(point) => {
                setSelectedMunicipality("");
                setSelectedPoint(point);
              }}
              onSelectMunicipality={(municipality) => {
                setSelectedPoint(null);
                setSelectedMunicipality(municipality);
              }}
            />
            <MapLegend
              layerKeys={(Object.keys(LAYER_META) as LayerKey[]).filter((key) => activeLayers[key])}
              ruralLabel={showRural ? "Setores rurais IBGE" : undefined}
              droughtLabel={showDroughtMunicipalities ? "Municípios em decreto de estiagem" : undefined}
              showCompesaStatus={showCompesaWorks}
              sdaAguadasLabel={showSdaAguadas ? "Aguadas SDA por município" : undefined}
              sdaCisternasLabel={showSdaCisternas ? "Cisternas SDA por município" : undefined}
              ipaBarreirosLabel={showIpaBarreiros ? "Barreiros IPA executados por municipio" : undefined}
              ipaBppLabel={showIpaBpp ? "Barragens PP IPA executadas por municipio" : undefined}
            />
          </MapFrame>
        </div>

        <aside className="control-column">
          <section className="panel selected-panel">
            <PanelTitle icon={<BadgeInfo size={18} />} title={selectedMunicipality ? "Município selecionado" : "Registro selecionado"} />
            {selectedMunicipality ? (
              <MunicipalityMapDetails data={data} municipality={selectedMunicipality} />
            ) : (
              <PointDetails point={selectedPoint} />
            )}
          </section>

          <RuralControls
            data={data}
            showRural={showRural}
            setShowRural={setShowRural}
            ruralMode={ruralMode}
            setRuralMode={setRuralMode}
          />

          <section className="panel">
            <PanelTitle icon={<HardHat size={18} />} title="Obras Compesa" />
            <label className="rural-switch">
              <input type="checkbox" checked={showCompesaWorks} onChange={() => setShowCompesaWorks(!showCompesaWorks)} />
              <span>Exibir municípios com obras</span>
            </label>
            <div className="mini-kpi-list">
              <div>
                <span>Obras</span>
                <strong>{formatNumber(data.compesa_works.totals.works)}</strong>
              </div>
              <div>
                <span>Municípios</span>
                <strong>{formatNumber(data.compesa_works.totals.municipalities)}</strong>
              </div>
              <div>
                <span>Valor divulgado</span>
                <strong>{formatMoneyCompact(data.compesa_works.totals.value)}</strong>
              </div>
            </div>
          </section>
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
  const directPoints = useMemo(() => allPoints(data).filter(isDirectInfrastructurePoint), [data]);
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
        <Metric label="Infraestrutura direta" value={formatNumber(directPoints.length)} detail="Pontos entregues/instalados no mapa; IPA perfurado não conta como instalado" />
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
          <p className="panel-copy">Ranking combina quantidade de aglomerados rurais do IBGE com infraestrutura hídrica direta. Poços IPA só contam quando estão instalados; registros apenas perfurados indicam obra ainda não instalada.</p>
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
          <IndexMethodology />
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

function MethodologyPage({ data }: { data: DashboardData }) {
  const rows = useMemo(
    () => coverageRows(data).filter((row) => row.agglomerates > 0).sort((a, b) => b.needScore - a.needScore),
    [data],
  );
  const top = rows[0];
  const droughtCount = rows.filter((row) => row.drought).length;

  return (
    <div className="page-stack methodology-page">
      <section className="method-hero panel">
        <div>
          <span>Índice de necessidade de água</span>
          <h2>Como o painel estima prioridade nos aglomerados rurais</h2>
          <p>
            O índice organiza municípios para priorização territorial. Ele combina população em aglomerados rurais,
            quantidade de aglomerados, lacuna de infraestrutura direta e presença no decreto de estiagem.
          </p>
        </div>
        <div className="method-score-example">
          <span>Maior prioridade atual</span>
          <strong>{titleCase(top?.municipality ?? "-")}</strong>
          <p>{formatNumber(top?.needScore ?? 0)} pontos no índice</p>
        </div>
      </section>

      <section className="formula-panel panel">
        <PanelTitle icon={<BookOpenText size={18} />} title="Fórmula" />
        <div className="formula-box">
          <span>Índice =</span>
          <strong>população/180 + aglomerados x 1,2 + lacuna x 2 + penalidade + estiagem</strong>
        </div>
        <div className="formula-notes">
          <article>
            <strong>Lacuna</strong>
            <p>max(0, aglomerados rurais - infraestrutura direta). Poços IPA entram apenas quando estão instalados.</p>
          </article>
          <article>
            <strong>Penalidade</strong>
            <p>25 se o município não tem infraestrutura direta; caso contrário, lacuna/aglomerações x 20.</p>
          </article>
          <article>
            <strong>Estiagem</strong>
            <p>35 pontos adicionais para municípios presentes no decreto de estiagem.</p>
          </article>
        </div>
      </section>

      <section className="method-detail-grid">
        <article className="panel method-detail-card">
          <span>População</span>
          <strong>{formatNumber(data.rural_summary.rural_agglomerate_population ?? 0)}</strong>
          <p>Pessoas residentes nos setores rurais classificados como povoado, núcleo rural ou lugarejo no Censo 2022.</p>
        </article>
        <article className="panel method-detail-card">
          <span>Aglomerados</span>
          <strong>{formatNumber(data.rural_summary.detail_counts["5"] + data.rural_summary.detail_counts["6"] + data.rural_summary.detail_counts["7"])}</strong>
          <p>Setores IBGE 5, 6 e 7 usados como proxy de comunidades rurais concentradas.</p>
        </article>
        <article className="panel method-detail-card">
          <span>Estiagem</span>
          <strong>{formatNumber(droughtCount)}</strong>
          <p>Municípios com aglomerados rurais que também estão no decreto de estiagem.</p>
        </article>
      </section>

      <section className="panel">
        <PanelTitle icon={<Table2 size={18} />} title="Componentes usados no cálculo" />
        <div className="table-wrap">
          <table className="method-table">
            <thead>
              <tr>
                <th>Componente</th>
                <th>Como entra no índice</th>
                <th>Fonte no painel</th>
                <th>Interpretação</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>População</strong></td>
                <td>população dos aglomerados / 180</td>
                <td>Censo 2022, variável v0001 por CD_SETOR</td>
                <td>Mais pessoas elevam a prioridade.</td>
              </tr>
              <tr>
                <td><strong>Aglomerados</strong></td>
                <td>quantidade de aglomerados x 1,2</td>
                <td>Malha de setores IBGE, CD_SITUACAO 5, 6 e 7</td>
                <td>Mais localidades rurais elevam a complexidade territorial.</td>
              </tr>
              <tr>
                <td><strong>Lacuna</strong></td>
                <td>max(0, aglomerados - infraestrutura direta) x 2</td>
                <td>Poços, dessalinizadores, SISAR, outorgas subterrâneas e Poços IPA instalados, mesmo sem coordenada.</td>
                <td>Quanto maior a diferença, maior a prioridade estimada.</td>
              </tr>
              <tr>
                <td><strong>Penalidade</strong></td>
                <td>25 sem infraestrutura direta; senão, lacuna/aglomerações x 20</td>
                <td>Camadas de infraestrutura direta; Poços IPA apenas perfurados não contam como instalados.</td>
                <td>Evita tratar igualmente municípios com e sem qualquer ponto conhecido.</td>
              </tr>
              <tr>
                <td><strong>Estiagem</strong></td>
                <td>+35 pontos quando está no decreto</td>
                <td>Lista de municípios no decreto de estiagem</td>
                <td>Adiciona criticidade conjuntural ao ranking.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="method-reading panel">
        <PanelTitle icon={<BadgeInfo size={18} />} title="Como ler o resultado" />
        <div>
          <p><strong>Muito alta:</strong> municípios com maior combinação de população rural aglomerada, lacuna e estiagem.</p>
          <p><strong>Alta:</strong> municípios com pressão relevante e baixa cobertura relativa.</p>
          <p><strong>Média ou baixa:</strong> municípios com menor população aglomerada, menor lacuna ou presença de infraestrutura direta.</p>
        </div>
        <em>O índice é um instrumento de priorização. Ele não substitui vistoria, diagnóstico técnico local, vazão disponível ou qualidade da água.</em>
      </section>
    </div>
  );
}

function CompesaWorksPage({ data, query }: { data: DashboardData; query: string }) {
  const compesa = data.compesa_works;
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedEixos, setSelectedEixos] = useState<string[]>([]);
  const [selectedSubeixos, setSelectedSubeixos] = useState<string[]>([]);
  const [selectedMunicipalities, setSelectedMunicipalities] = useState<string[]>([]);
  const [showDroughtLayer, setShowDroughtLayer] = useState(true);
  const statusOptions = useMemo(() => Object.keys(compesa.totals.status_counts).sort(), [compesa]);
  const eixoOptions = useMemo(() => Object.keys(compesa.totals.eixo_counts).sort(), [compesa]);
  const subeixoOptions = useMemo(() => Object.keys(compesa.totals.subeixo_counts).sort(), [compesa]);
  const municipalityOptions = useMemo(
    () => compesa.municipalities.map((item) => item.municipality).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [compesa],
  );
  const municipalityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    compesa.works.forEach((work) => {
      work.municipalities.forEach((name) => {
        counts[name] = (counts[name] ?? 0) + 1;
      });
    });
    return counts;
  }, [compesa.works]);

  const filteredWorks = useMemo(() => {
    const normalized = normalize(query);
    return compesa.works.filter((work) => {
      if (selectedStatuses.length && !selectedStatuses.includes(work.status)) return false;
      if (selectedEixos.length && !selectedEixos.includes(work.eixo)) return false;
      if (selectedSubeixos.length && !selectedSubeixos.includes(work.subeixo)) return false;
      if (selectedMunicipalities.length && !work.municipalities.some((name) => selectedMunicipalities.includes(name))) return false;
      if (!normalized) return true;
      return [
        work.name,
        work.description,
        work.status,
        work.phase,
        work.source,
        work.eixo,
        work.subeixo,
        work.municipalities_original,
        ...work.municipalities,
      ].some((value) => normalize(value).includes(normalized));
    });
  }, [compesa, query, selectedEixos, selectedMunicipalities, selectedStatuses, selectedSubeixos]);

  const filteredMunicipalityNames = useMemo(() => {
    const names = new Set<string>();
    filteredWorks.forEach((work) => work.municipalities.forEach((name) => names.add(normalize(name))));
    return names;
  }, [filteredWorks]);
  const filteredMap = useMemo<GeoJSON.FeatureCollection>(() => ({
    ...compesa.map,
    features: compesa.map.features.filter((feature) => filteredMunicipalityNames.has(normalize(String(feature.properties?.NM_MUN ?? "")))),
  }), [compesa.map, filteredMunicipalityNames]);
  const ranking = useMemo(() => {
    const allowed = new Set(filteredWorks.flatMap((work) => work.municipalities));
    return compesa.municipalities
      .filter((item) => allowed.has(item.municipality))
      .sort((a, b) => b.allocated_value - a.allocated_value)
      .slice(0, 14);
  }, [compesa.municipalities, filteredWorks]);
  const statusRows = Object.entries(compesa.totals.phase_counts).sort((a, b) => b[1] - a[1]);
  const filteredValue = filteredWorks.reduce((sum, work) => sum + work.value, 0);
  const activeFilters = selectedStatuses.length + selectedEixos.length + selectedSubeixos.length + selectedMunicipalities.length;

  return (
    <div className="page-stack">
      <section className="metric-grid compesa-metrics">
        <Metric label="Obras na base" value={formatNumber(filteredWorks.length)} detail={`${formatNumber(compesa.totals.works)} ações no arquivo`} />
        <Metric label="Valor divulgado" value={formatMoneyCompact(filteredValue)} detail="Soma original das obras filtradas" />
        <Metric label="Municípios alcançados" value={formatNumber(filteredMunicipalityNames.size)} detail="Cruzamento com malha municipal IBGE" />
        <Metric label="População informada" value={formatNumber(filteredWorks.reduce((sum, work) => sum + work.population, 0))} detail="Soma não deduplicada da planilha" />
      </section>

      <section className="panel compesa-filter-panel">
        <PanelTitle icon={<Filter size={18} />} title="Filtros das obras" />
        <MultiSelectDropdown
          label="Status"
          values={selectedStatuses}
          options={statusOptions}
          counts={compesa.totals.status_counts}
          onChange={setSelectedStatuses}
        />
        <MultiSelectDropdown
          label="Eixo"
          values={selectedEixos}
          options={eixoOptions}
          counts={compesa.totals.eixo_counts}
          onChange={setSelectedEixos}
        />
        <MultiSelectDropdown
          label="Subeixo"
          values={selectedSubeixos}
          options={subeixoOptions}
          counts={compesa.totals.subeixo_counts}
          onChange={setSelectedSubeixos}
        />
        <MultiSelectDropdown
          label="Município"
          values={selectedMunicipalities}
          options={municipalityOptions}
          counts={municipalityCounts}
          onChange={setSelectedMunicipalities}
        />
        <div className="filter-row">
          <label className="map-toggle-chip">
            <input type="checkbox" checked={showDroughtLayer} onChange={() => setShowDroughtLayer(!showDroughtLayer)} />
            <span>Exibir municípios no decreto de estiagem no mapa</span>
          </label>
          <button
            className="clear-filters"
            type="button"
            onClick={() => {
              setSelectedStatuses([]);
              setSelectedEixos([]);
              setSelectedSubeixos([]);
              setSelectedMunicipalities([]);
            }}
          >
            Limpar
          </button>
        </div>
        <p className="filter-note">{activeFilters ? `${activeFilters} filtro(s) ativo(s).` : "Sem filtros específicos além da busca textual."}</p>
      </section>

      <section className="compesa-map-grid">
        <div className="map-column">
          <MapFrame>
            <MapView
              points={[]}
              ruralGeoJson={null}
              droughtGeoJson={showDroughtLayer ? data.drought_municipalities : null}
              compesaGeoJson={filteredMap}
              onSelectPoint={() => undefined}
              compact
            />
            <MapLegend layerKeys={[]} droughtLabel={showDroughtLayer ? "Municípios em decreto de estiagem" : undefined} showCompesaStatus />
          </MapFrame>
        </div>

        <aside className="panel">
          <PanelTitle icon={<ClipboardList size={18} />} title="Status das obras" />
          <div className="phase-summary">
            {statusRows.map(([label, count]) => (
              <article key={label}>
                <span style={{ background: compesaPhaseColor(label) }} />
                <div>
                  <strong>{label}</strong>
                  <p>{formatNumber(count)} obras</p>
                </div>
              </article>
            ))}
          </div>

          <PanelTitle icon={<MapPinned size={18} />} title="Top municípios por valor" />
          <div className="compesa-rank-list">
            {ranking.map((item, index) => (
              <article key={item.municipality}>
                <span>{index + 1}</span>
                <div>
                  <strong>{titleCase(item.municipality)}</strong>
                  <p>{formatNumber(item.works_count)} obras · {item.dominant_phase}</p>
                </div>
                <em>{formatMoneyCompact(item.allocated_value)}</em>
              </article>
            ))}
          </div>
          {!!compesa.unmatched_municipality_texts.length && (
            <p className="filter-note">
              Sem alocação municipal: {compesa.unmatched_municipality_texts.join(", ")}.
            </p>
          )}
        </aside>
      </section>

      <section className="panel">
        <PanelTitle icon={<Table2 size={18} />} title="Lista de obras Compesa" />
        <CompesaWorksTable rows={filteredWorks} />
      </section>
    </div>
  );
}

function SdaActionsPage({ data, query }: { data: DashboardData; query: string }) {
  const sda = data.sda_actions;
  const [programs, setPrograms] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [municipalities, setMunicipalities] = useState<string[]>([]);
  const programOptions = useMemo(() => Object.keys(sda.totals.program_counts).sort(), [sda]);
  const statusOptions = useMemo(() => Object.keys(sda.totals.status_counts).sort(), [sda]);
  const municipalityOptions = useMemo(
    () => sda.municipalities.map((item) => item.municipality).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [sda],
  );
  const municipalityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    sda.records.forEach((record) => {
      counts[record.municipality] = (counts[record.municipality] ?? 0) + Math.max(1, record.quantity ?? 1);
    });
    return counts;
  }, [sda.records]);
  const filteredRecords = useMemo(() => {
    const normalized = normalize(query);
    return sda.records.filter((record) => {
      if (programs.length && !programs.includes(record.program)) return false;
      if (statuses.length && !statuses.includes(record.status)) return false;
      if (municipalities.length && !municipalities.includes(record.municipality)) return false;
      if (!normalized) return true;
      return [record.program, record.type, record.municipality, record.locality, record.status, record.detail ?? ""].some((value) =>
        normalize(value).includes(normalized),
      );
    });
  }, [municipalities, programs, query, sda.records, statuses]);
  const filteredMunicipalityKeys = useMemo(() => new Set(filteredRecords.map((record) => normalize(record.municipality))), [filteredRecords]);
  const showAguadas = !programs.length || programs.includes("Aguadas");
  const showCisternas = !programs.length || programs.includes("Cisternas");
  const filteredAguadasMap = useMemo<GeoJSON.FeatureCollection>(() => ({
    ...sda.aguadas_map,
    features: sda.aguadas_map.features.filter((feature) => filteredMunicipalityKeys.has(normalize(String(feature.properties?.NM_MUN ?? "")))),
  }), [filteredMunicipalityKeys, sda.aguadas_map]);
  const filteredCisternasMap = useMemo<GeoJSON.FeatureCollection>(() => ({
    ...sda.cisternas_map,
    features: sda.cisternas_map.features.filter((feature) => filteredMunicipalityKeys.has(normalize(String(feature.properties?.NM_MUN ?? "")))),
  }), [filteredMunicipalityKeys, sda.cisternas_map]);
  const sdaPoints = useMemo(() => {
    const wanted = new Set(filteredRecords.filter((record) => record.lat && record.lng).map((record) => `${record.program}-${normalize(record.locality)}-${normalize(record.municipality)}`));
    return [...data.layers.sda_pad, ...data.layers.sda_pisf].filter((point) => wanted.has(`${point.layer === "sda_pad" ? "PAD" : "PISF"}-${normalize(point.name)}-${normalize(point.municipality)}`));
  }, [data.layers.sda_pad, data.layers.sda_pisf, filteredRecords]);
  const topMunicipalities = useMemo(
    () => sda.municipalities.filter((item) => filteredMunicipalityKeys.has(normalize(item.municipality))).slice(0, 12),
    [filteredMunicipalityKeys, sda.municipalities],
  );

  return (
    <div className="page-stack">
      <section className="metric-grid sda-metrics">
        <Metric label="PAD / SDA" value={formatNumber(sda.totals.pad_records)} detail={`${formatNumber(sda.totals.pad)} pontos mapeados`} />
        <Metric label="PISF" value={formatNumber(sda.totals.pisf_records)} detail="Sistemas simplificados" />
        <Metric label="Aguadas previstas" value={formatNumber(sda.totals.aguadas)} detail="Pequenas barragens/açudes" />
        <Metric label="Cisternas previstas" value={formatNumber(sda.totals.cisternas)} detail={`${formatNumber(sda.totals.cisternas_1_agua)} 1ª água · ${formatNumber(sda.totals.cisternas_2_agua)} 2ª água`} />
      </section>

      <section className="panel sda-filter-panel">
        <PanelTitle icon={<Filter size={18} />} title="Filtros SDA" />
        <MultiSelectDropdown label="Programa" values={programs} options={programOptions} counts={sda.totals.program_counts} onChange={setPrograms} />
        <MultiSelectDropdown label="Status" values={statuses} options={statusOptions} counts={sda.totals.status_counts} onChange={setStatuses} />
        <MultiSelectDropdown label="Município" values={municipalities} options={municipalityOptions} counts={municipalityCounts} onChange={setMunicipalities} />
        <button
          className="clear-filters"
          type="button"
          onClick={() => {
            setPrograms([]);
            setStatuses([]);
            setMunicipalities([]);
          }}
        >
          Limpar
        </button>
      </section>

      <section className="sda-map-grid">
        <div className="map-column">
          <MapFrame>
            <MapView
              points={sdaPoints}
              ruralGeoJson={null}
              droughtGeoJson={data.drought_municipalities}
              sdaAguadasGeoJson={showAguadas ? filteredAguadasMap : null}
              sdaCisternasGeoJson={showCisternas ? filteredCisternasMap : null}
              onSelectPoint={() => undefined}
              compact
            />
            <MapLegend
              layerKeys={["sda_pad", "sda_pisf"].filter((key) => !programs.length || (key === "sda_pad" ? programs.includes("PAD") : programs.includes("PISF"))) as LayerKey[]}
              droughtLabel="Municípios em decreto de estiagem"
              sdaAguadasLabel={showAguadas ? "Aguadas SDA por município" : undefined}
              sdaCisternasLabel={showCisternas ? "Cisternas SDA por município" : undefined}
            />
          </MapFrame>
        </div>
        <aside className="panel">
          <PanelTitle icon={<MapPinned size={18} />} title="Municípios em destaque" />
          <div className="sda-rank-list">
            {topMunicipalities.map((item, index) => (
              <article key={item.municipality}>
                <span>{index + 1}</span>
                <div>
                  <strong>{titleCase(item.municipality)}</strong>
                  <p>{formatNumber(item.pad)} PAD · {formatNumber(item.pisf)} PISF · {formatNumber(item.cisternas_total)} cisternas</p>
                </div>
                <em>{formatNumber(item.total_actions)}</em>
              </article>
            ))}
          </div>
        </aside>
      </section>

      <section className="panel">
        <PanelTitle icon={<Table2 size={18} />} title="Lista consolidada SDA" />
        <SdaRecordsTable rows={filteredRecords} />
      </section>
    </div>
  );
}

function IpaActionsPage({ data, query }: { data: DashboardData; query: string }) {
  const ipa = data.ipa_actions;
  const [types, setTypes] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [sheets, setSheets] = useState<string[]>([]);
  const [municipalities, setMunicipalities] = useState<string[]>([]);
  const typeOptions = ["Poços IPA", "Barreiros KML", "Barreiros municipais", "Barragens PP"];
  const typeCounts = {
    "Poços IPA": ipa.totals.pocos,
    "Barreiros KML": ipa.totals.kml_mapped,
    "Barreiros municipais": ipa.totals.bar_executed,
    "Barragens PP": ipa.totals.bpp_executed,
  };
  const statusOptions = useMemo(() => Object.keys(ipa.totals.status_counts).sort(), [ipa]);
  const sheetOptions = useMemo(() => Object.keys(ipa.totals.sheet_counts).sort(), [ipa]);
  const municipalityOptions = useMemo(
    () => ipa.municipalities.map((item) => item.municipality).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [ipa],
  );
  const municipalityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    ipa.municipalities.forEach((item) => {
      counts[item.municipality] = item.total_actions;
    });
    return counts;
  }, [ipa.municipalities]);
  const filteredPocos = useMemo(() => {
    const normalized = normalize(query);
    return ipa.pocos.filter((record) => {
      if (types.length && !types.includes("Poços IPA")) return false;
      if (statuses.length && !statuses.includes(record.status)) return false;
      if (sheets.length && !sheets.includes(record.sheet)) return false;
      if (municipalities.length && !municipalities.includes(record.municipality)) return false;
      if (!normalized) return true;
      return [record.sheet, record.municipality, record.locality, record.status, record.owner ?? "", record.observation ?? ""].some((value) =>
        normalize(value).includes(normalized),
      );
    });
  }, [ipa.pocos, municipalities, query, sheets, statuses, types]);
  const filteredMunicipalityKeys = useMemo(() => {
    const keys = new Set<string>();
    filteredPocos.forEach((record) => keys.add(normalize(record.municipality)));
    if (!types.length || types.includes("Barreiros municipais") || types.includes("Barragens PP") || types.includes("Barreiros KML")) {
      ipa.barreiros.forEach((record) => {
        if (municipalities.length && !municipalities.includes(record.municipality)) return;
        if (record.bar_executed || record.bpp_executed) keys.add(normalize(record.municipality));
      });
    }
    return keys;
  }, [filteredPocos, ipa.barreiros, municipalities, types]);
  const showPocos = !types.length || types.includes("Poços IPA");
  const showKmlBarreiros = !types.length || types.includes("Barreiros KML");
  const showBarreiros = !types.length || types.includes("Barreiros municipais");
  const showBpp = !types.length || types.includes("Barragens PP");
  const ipaPoints = useMemo(() => {
    const pocos = showPocos ? data.layers.ipa_pocos.filter((point) => filteredPocos.some((record) => record.lat === point.lat && record.lng === point.lng && normalize(record.locality) === normalize(point.name))) : [];
    const barreiros = showKmlBarreiros
      ? data.layers.ipa_barreiros.filter((point) => {
          if (municipalities.length && !municipalities.includes(point.municipality)) return false;
          return !normalize(query) || [point.name, point.municipality, point.status, ...Object.values(point.extra)].some((value) => normalize(value).includes(normalize(query)));
        })
      : [];
    return [...pocos, ...barreiros];
  }, [data.layers.ipa_barreiros, data.layers.ipa_pocos, filteredPocos, municipalities, query, showKmlBarreiros, showPocos]);
  const filteredBarreirosMap = useMemo<GeoJSON.FeatureCollection>(() => ({
    ...ipa.barreiros_map,
    features: ipa.barreiros_map.features.filter((feature) => filteredMunicipalityKeys.has(normalize(String(feature.properties?.NM_MUN ?? "")))),
  }), [filteredMunicipalityKeys, ipa.barreiros_map]);
  const filteredBppMap = useMemo<GeoJSON.FeatureCollection>(() => ({
    ...ipa.bpp_map,
    features: ipa.bpp_map.features.filter((feature) => filteredMunicipalityKeys.has(normalize(String(feature.properties?.NM_MUN ?? "")))),
  }), [filteredMunicipalityKeys, ipa.bpp_map]);
  const ranking = useMemo(
    () => ipa.municipalities.filter((item) => filteredMunicipalityKeys.has(normalize(item.municipality))).slice(0, 14),
    [filteredMunicipalityKeys, ipa.municipalities],
  );
  const activeFilters = types.length + statuses.length + sheets.length + municipalities.length;

  return (
    <div className="page-stack">
      <section className="metric-grid ipa-metrics">
        <Metric label="Poços IPA" value={formatNumber(ipa.totals.pocos)} detail={`${formatNumber(ipa.totals.pocos_mapped)} georreferenciados`} />
        <Metric label="Poços instalados" value={formatNumber(ipa.totals.status_counts.Instalado ?? 0)} detail={`${formatNumber(ipa.totals.status_counts.Perfurado ?? 0)} perfurados`} />
        <Metric label="Barreiros executados" value={formatNumber(ipa.totals.bar_executed)} detail={`${formatNumber(ipa.totals.kml_mapped)} pontos KML mapeados`} />
        <Metric label="Barragens PP" value={formatNumber(ipa.totals.bpp_executed)} detail="Executadas na base municipal" />
      </section>

      <section className="panel ipa-filter-panel">
        <PanelTitle icon={<Filter size={18} />} title="Filtros IPA" />
        <MultiSelectDropdown label="Tipo" values={types} options={typeOptions} counts={typeCounts} onChange={setTypes} />
        <MultiSelectDropdown label="Status dos poços" values={statuses} options={statusOptions} counts={ipa.totals.status_counts} onChange={setStatuses} />
        <MultiSelectDropdown label="Aba/lote" values={sheets} options={sheetOptions} counts={ipa.totals.sheet_counts} onChange={setSheets} />
        <MultiSelectDropdown label="Município" values={municipalities} options={municipalityOptions} counts={municipalityCounts} onChange={setMunicipalities} />
        <div className="filter-row">
          <p className="filter-note">{activeFilters ? `${activeFilters} filtro(s) ativo(s).` : "Sem filtros específicos além da busca textual."}</p>
          <button
            className="clear-filters"
            type="button"
            onClick={() => {
              setTypes([]);
              setStatuses([]);
              setSheets([]);
              setMunicipalities([]);
            }}
          >
            Limpar
          </button>
        </div>
      </section>

      <section className="ipa-map-grid">
        <div className="map-column">
          <MapFrame>
            <MapView
              points={ipaPoints}
              ruralGeoJson={null}
              ipaBarreirosGeoJson={showBarreiros ? filteredBarreirosMap : null}
              ipaBppGeoJson={showBpp ? filteredBppMap : null}
              onSelectPoint={() => undefined}
              compact
            />
            <MapLegend
              layerKeys={["ipa_pocos", "ipa_barreiros"].filter((key) => (key === "ipa_pocos" ? showPocos : showKmlBarreiros)) as LayerKey[]}
              ipaBarreirosLabel={showBarreiros ? "Barreiros IPA executados por municipio" : undefined}
              ipaBppLabel={showBpp ? "Barragens PP IPA executadas por municipio" : undefined}
            />
          </MapFrame>
        </div>
        <aside className="panel">
          <PanelTitle icon={<MapPinned size={18} />} title="Municípios em destaque" />
          <div className="ipa-rank-list">
            {ranking.map((item, index) => (
              <article key={item.municipality}>
                <span>{index + 1}</span>
                <div>
                  <strong>{titleCase(item.municipality)}</strong>
                  <p>{formatNumber(item.pocos)} poços · {formatNumber(item.barreiros_executed)} barreiros · {formatNumber(item.bpp_executed)} BPP</p>
                </div>
                <em>{formatNumber(item.total_actions)}</em>
              </article>
            ))}
          </div>
        </aside>
      </section>

      <section className="panel">
        <PanelTitle icon={<Table2 size={18} />} title="Poços IPA" />
        <IpaPocosTable rows={filteredPocos} />
      </section>

      <section className="panel">
        <PanelTitle icon={<Layers size={18} />} title="Barreiros e barragens por município" />
        <IpaBarreirosTable rows={ipa.barreiros.filter((row) => !municipalities.length || municipalities.includes(row.municipality))} />
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
  const [selectedMunicipality, setSelectedMunicipality] = useState("");
  const selectedRow = useMemo(() => {
    const selectedKey = normalize(selectedMunicipality);
    return visibleRows.find((row) => normalize(row.municipality) === selectedKey) ?? visibleRows[0] ?? rows[0];
  }, [rows, selectedMunicipality, visibleRows]);

  useEffect(() => {
    if (!visibleRows.length) return;
    const selectedStillVisible = visibleRows.some((row) => normalize(row.municipality) === normalize(selectedMunicipality));
    if (!selectedStillVisible) setSelectedMunicipality(visibleRows[0].municipality);
  }, [selectedMunicipality, visibleRows]);

  return (
    <div className="page-stack">
      <section className="metric-grid">
        <Metric label="Municípios listados" value={formatNumber(visibleRows.length)} detail="Com rural ou registros nas bases" />
        <Metric label="Maior concentração" value={titleCase(topTotal[0]?.municipality ?? "-")} detail={`${formatNumber(topTotal[0]?.total ?? 0)} registros`} />
        <Metric label="Bases integradas" value={formatNumber(Object.keys(LAYER_META).length)} detail="Camadas pontuais consolidadas" />
      </section>

      {selectedRow && <MunicipalitySummary data={data} row={selectedRow} />}

      <section className="municipality-page-grid">
        <div className="panel">
          <PanelTitle icon={<Table2 size={18} />} title="Tabela municipal" />
          <MunicipalityTable
            rows={visibleRows}
            selectedMunicipality={selectedRow?.municipality ?? ""}
            onSelect={setSelectedMunicipality}
          />
        </div>
        <div className="panel">
          <PanelTitle icon={<MapPinned size={18} />} title="Maiores volumes" />
          <RankList rows={topTotal.map((row) => ({ municipality: row.municipality, total: row.total, counts: row.counts }))} />
        </div>
      </section>
    </div>
  );
}

function MunicipalitySummary({ data, row }: { data: DashboardData; row: CoverageRow }) {
  const key = normalize(row.municipality);
  const points = useMemo(() => allPoints(data).filter((point) => normalize(point.municipality) === key), [data, key]);
  const compesaMunicipality = useMemo(
    () => data.compesa_works.municipalities.find((item) => normalize(item.municipality) === key),
    [data, key],
  );
  const compesaWorks = useMemo(
    () => data.compesa_works.works.filter((work) => work.municipalities.some((name) => normalize(name) === key)),
    [data, key],
  );
  const sdaMunicipality = useMemo(
    () => data.sda_actions.municipalities.find((item) => normalize(item.municipality) === key),
    [data, key],
  );
  const ipaMunicipality = useMemo(
    () => data.ipa_actions.municipalities.find((item) => normalize(item.municipality) === key),
    [data, key],
  );
  const statusCounts = compesaMunicipality?.phase_counts ?? {};
  const topCompesaWorks = compesaWorks.slice().sort((a, b) => b.value - a.value).slice(0, 6);
  const layerRows = (Object.keys(LAYER_META) as LayerKey[]).map((layer) => ({
    layer,
    count: row.counts[layer] ?? 0,
  }));

  return (
    <section className="panel municipality-summary">
      <div className="municipality-summary-head">
        <div>
          <span>Resumo municipal</span>
          <h2>{titleCase(row.municipality)}</h2>
          <p>
            {row.drought ? "Município presente no decreto de estiagem" : "Município fora da lista do decreto de estiagem"} · {needLabel(row.needScore)} necessidade estimada
          </p>
        </div>
        <strong>{formatNumber(row.needScore)}</strong>
      </div>

      <div className="municipality-kpi-grid">
        <MunicipalityKpi label="População em aglomerados" value={formatNumber(row.population)} detail="Censo 2022, setores 5, 6 e 7" />
        <MunicipalityKpi label="Aglomerados rurais" value={formatNumber(row.agglomerates)} detail={`${formatNumber(Math.round(row.ruralArea))} km² rurais na malha`} />
        <MunicipalityKpi label="Infraestrutura direta" value={formatNumber(row.directInfra)} detail="Inclui Poços IPA instalados; perfurados não contam como instalados" />
        <MunicipalityKpi label="Obras Compesa" value={formatNumber(compesaWorks.length)} detail={formatMoneyCompact(compesaMunicipality?.allocated_value ?? 0)} />
        <MunicipalityKpi label="Ações SDA" value={formatNumber(sdaMunicipality?.total_actions ?? 0)} detail={`${formatNumber(sdaMunicipality?.pad ?? 0)} PAD · ${formatNumber(sdaMunicipality?.pisf ?? 0)} PISF`} />
        <MunicipalityKpi label="Ações IPA" value={formatNumber(ipaMunicipality?.total_actions ?? 0)} detail={`${formatNumber(ipaMunicipality?.pocos ?? 0)} poços · ${formatNumber(ipaMunicipality?.barreiros_executed ?? 0)} barreiros`} />
      </div>

      <div className="municipality-detail-grid">
        <article>
          <h3>Camadas do painel</h3>
          <div className="layer-breakdown-list">
            {layerRows.map(({ layer, count }) => (
              <div key={layer}>
                <span style={{ background: LAYER_META[layer].color }}>{LAYER_META[layer].icon}</span>
                <p>{LAYER_META[layer].label}</p>
                <strong>{formatNumber(count)}</strong>
              </div>
            ))}
          </div>
        </article>

        <article>
          <h3>Obras Compesa por fase</h3>
          {compesaMunicipality ? (
            <div className="phase-summary compact">
              {["Concluídas", "Em execução", "Planejadas"].map((phase) => (
                <article key={phase}>
                  <span style={{ background: compesaPhaseColor(phase) }} />
                  <div>
                    <strong>{phase}</strong>
                    <p>{formatNumber(statusCounts[phase] ?? 0)} obras</p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-state">Nenhuma obra Compesa cruzada para este município.</p>
          )}
        </article>

        <article>
          <h3>Principais obras Compesa</h3>
          {topCompesaWorks.length ? (
            <div className="municipality-work-list">
              {topCompesaWorks.map((work) => (
                <div key={work.id}>
                  <strong>{work.name}</strong>
                  <p>{work.status} · {work.eixo} · {formatMoneyCompact(work.value)}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-state">Sem obras Compesa associadas.</p>
          )}
        </article>

        <article>
          <h3>Ações SDA</h3>
          {sdaMunicipality ? (
            <div className="sda-mini-list">
              <div><span>PAD</span><strong>{formatNumber(sdaMunicipality.pad)}</strong><p>{formatNumber(sdaMunicipality.pad_entregue)} entregues · {formatNumber(sdaMunicipality.pad_andamento)} em andamento</p></div>
              <div><span>PISF</span><strong>{formatNumber(sdaMunicipality.pisf)}</strong><p>{formatNumber(sdaMunicipality.pisf_entregue)} entregues · {formatNumber(sdaMunicipality.pisf_andamento)} em andamento</p></div>
              <div><span>Aguadas</span><strong>{formatNumber(sdaMunicipality.aguadas)}</strong><p>Pequenas barragens/açudes previstos</p></div>
              <div><span>Cisternas</span><strong>{formatNumber(sdaMunicipality.cisternas_total)}</strong><p>{formatNumber(sdaMunicipality.cisternas_1_agua)} 1ª água · {formatNumber(sdaMunicipality.cisternas_2_agua)} 2ª água</p></div>
            </div>
          ) : (
            <p className="empty-state">Sem ações SDA associadas.</p>
          )}
        </article>

        <article>
          <h3>Ações IPA</h3>
          {ipaMunicipality ? (
            <div className="sda-mini-list">
              <div><span>Poços</span><strong>{formatNumber(ipaMunicipality.pocos)}</strong><p>{formatNumber(ipaMunicipality.pocos_instalados)} instalados · {formatNumber(ipaMunicipality.pocos_perfurados)} perfurados</p></div>
              <div><span>Barreiros</span><strong>{formatNumber(ipaMunicipality.barreiros_executed)}</strong><p>Executados na base municipal IPA</p></div>
              <div><span>BPP</span><strong>{formatNumber(ipaMunicipality.bpp_executed)}</strong><p>Barragens de pequeno porte executadas</p></div>
              <div><span>Total IPA</span><strong>{formatNumber(ipaMunicipality.total_actions)}</strong><p>Soma de poços, barreiros e BPP</p></div>
            </div>
          ) : (
            <p className="empty-state">Sem ações IPA associadas.</p>
          )}
        </article>
      </div>

      <div className="municipality-footnote">
        <span>{formatNumber(points.length)} registros pontuais encontrados no município.</span>
        <span>Valores Compesa em rankings municipais são alocados proporcionalmente quando a obra beneficia mais de um município.</span>
      </div>
    </section>
  );
}

function MunicipalityKpi({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="municipality-kpi">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
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
        <AlertPanel title="Lacunas rurais" rows={noDirectInfra.map((row) => ({ title: titleCase(row.municipality), detail: `${formatNumber(row.agglomerates)} aglomerados rurais sem infraestrutura direta`, tone: "red" }))} />
        <AlertPanel title="Baixa densidade" rows={lowDirectInfra.map((row) => ({ title: titleCase(row.municipality), detail: `${formatNumber(row.directInfra)} infra direta para ${formatNumber(row.agglomerates)} aglomerados`, tone: "yellow" }))} />
        <AlertPanel title="Barragens críticas" rows={highRiskDams.slice(0, 12).map((item) => ({ title: item.name, detail: `${titleCase(item.municipality)} · ${item.extra.risco || "risco n/i"} · ${item.extra["dano potencial"] || "dano n/i"}`, tone: "orange" }))} />
        <AlertPanel title="Cadastro incompleto" rows={noMunicipality.slice(0, 12).map((item) => ({ title: item.name, detail: LAYER_META[item.layer].label, tone: "blue" }))} />
      </section>
    </div>
  );
}

function ReportsPage({ manifest }: { manifest: ReportManifest | null }) {
  const reports = manifest?.reports ?? [];
  const municipalReports = manifest?.municipal_reports ?? [];
  const [selectedMunicipalityReport, setSelectedMunicipalityReport] = useState("");
  const executive = reports.filter((report) => /^\d{2}-/.test(report.filename));
  const institutions = reports.filter((report) => report.filename.startsWith("instituicao-"));
  const municipal = reports.filter((report) => report.filename.includes("extrato"));
  const selectedReport =
    municipalReports.find((report) => report.municipality === selectedMunicipalityReport) ?? municipalReports[0];

  useEffect(() => {
    if (!municipalReports.length) return;
    const stillAvailable = municipalReports.some((report) => report.municipality === selectedMunicipalityReport);
    if (!stillAvailable) setSelectedMunicipalityReport(municipalReports[0].municipality);
  }, [municipalReports, selectedMunicipalityReport]);

  return (
    <div className="page-stack reports-page">
      <section className="metric-grid reports-metrics">
        <Metric label="Relatórios executivos" value={formatNumber(executive.length)} detail="Pacote para apresentação e despacho" />
        <Metric label="Relatórios institucionais" value={formatNumber(institutions.length)} detail="Compesa, SDA e IPA" />
        <Metric label="Extrato municipal" value={formatNumber(municipalReports.length)} detail="Consolidado e seleção individual" />
      </section>

      <section className="panel reports-hero">
        <PanelTitle icon={<FileDown size={18} />} title="Saídas em PDF" />
        <p className="panel-copy">
          Relatórios gerados automaticamente a partir das bases consolidadas no painel. O extrato municipal traz um bloco detalhado por município, com índice, cobertura, obras e ações institucionais.
        </p>
        {manifest?.generated_at && <p className="filter-note">Última geração: {formatDateTime(manifest.generated_at)}</p>}
      </section>

      <ReportGroup title="Relatórios estratégicos" reports={executive} />
      <ReportGroup title="Relatórios por instituição" reports={institutions} />
      <ReportGroup title="Extrato detalhado por município" reports={municipal} />
      <section className="panel">
        <PanelTitle icon={<FileDown size={18} />} title="Extrato individual por município" />
        {selectedReport ? (
          <div className="municipal-report-picker">
            <SelectField
              label="Município"
              value={selectedReport.municipality}
              options={municipalReports.map((report) => report.municipality)}
              onChange={setSelectedMunicipalityReport}
            />
            <a className="report-card municipal-report-download" href={selectedReport.file} target="_blank" rel="noreferrer">
              <span><FileDown size={20} /></span>
              <div>
                <strong>{selectedReport.title}</strong>
                <p>{selectedReport.filename}</p>
              </div>
            </a>
          </div>
        ) : (
          <p className="panel-copy">Nenhum extrato individual foi gerado ainda.</p>
        )}
      </section>
    </div>
  );
}

function ReportGroup({ title, reports }: { title: string; reports: ReportManifest["reports"] }) {
  return (
    <section className="panel">
      <PanelTitle icon={<FileDown size={18} />} title={title} />
      {reports.length ? (
        <div className="report-card-grid">
          {reports.map((report) => (
            <a key={report.filename} className="report-card" href={report.file} target="_blank" rel="noreferrer">
              <span><FileDown size={20} /></span>
              <div>
                <strong>{report.title}</strong>
                <p>{report.filename}</p>
              </div>
            </a>
          ))}
        </div>
      ) : (
        <p className="empty-state">Nenhum PDF encontrado. Rode npm run reports para gerar as saídas.</p>
      )}
    </section>
  );
}

function LayerBar({
  data,
  activeLayers,
  setActiveLayers,
  showCompesaWorks,
  setShowCompesaWorks,
  showSdaAguadas,
  setShowSdaAguadas,
  showSdaCisternas,
  setShowSdaCisternas,
  showIpaBarreiros,
  setShowIpaBarreiros,
  showIpaBpp,
  setShowIpaBpp,
  showDroughtMunicipalities,
  setShowDroughtMunicipalities,
}: {
  data: DashboardData;
  activeLayers: Record<LayerKey, boolean>;
  setActiveLayers: React.Dispatch<React.SetStateAction<Record<LayerKey, boolean>>>;
  showCompesaWorks: boolean;
  setShowCompesaWorks: (value: boolean) => void;
  showSdaAguadas: boolean;
  setShowSdaAguadas: (value: boolean) => void;
  showSdaCisternas: boolean;
  setShowSdaCisternas: (value: boolean) => void;
  showIpaBarreiros: boolean;
  setShowIpaBarreiros: (value: boolean) => void;
  showIpaBpp: boolean;
  setShowIpaBpp: (value: boolean) => void;
  showDroughtMunicipalities: boolean;
  setShowDroughtMunicipalities: (value: boolean) => void;
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
        <label className="layer-chip compesa-layer-chip">
          <input
            type="checkbox"
            checked={showCompesaWorks}
            onChange={() => setShowCompesaWorks(!showCompesaWorks)}
          />
          <span style={{ background: "#0284c7" }}><HardHat size={18} /></span>
          <strong>Obras Compesa</strong>
          <em>{formatNumber(data.compesa_works.totals.works)}</em>
        </label>
        <label className="layer-chip sda-layer-chip">
          <input type="checkbox" checked={showSdaAguadas} onChange={() => setShowSdaAguadas(!showSdaAguadas)} />
          <span style={{ background: "#a16207" }}><Layers size={18} /></span>
          <strong>Aguadas SDA</strong>
          <em>{formatNumber(data.sda_actions.totals.aguadas)}</em>
        </label>
        <label className="layer-chip sda-layer-chip">
          <input type="checkbox" checked={showSdaCisternas} onChange={() => setShowSdaCisternas(!showSdaCisternas)} />
          <span style={{ background: "#0369a1" }}><Droplets size={18} /></span>
          <strong>Cisternas SDA</strong>
          <em>{formatNumber(data.sda_actions.totals.cisternas)}</em>
        </label>
        <label className="layer-chip ipa-layer-chip">
          <input type="checkbox" checked={showIpaBarreiros} onChange={() => setShowIpaBarreiros(!showIpaBarreiros)} />
          <span style={{ background: "#92400e" }}><Layers size={18} /></span>
          <strong>Barreiros IPA</strong>
          <em>{formatNumber(data.ipa_actions.totals.bar_executed)}</em>
        </label>
        <label className="layer-chip ipa-layer-chip">
          <input type="checkbox" checked={showIpaBpp} onChange={() => setShowIpaBpp(!showIpaBpp)} />
          <span style={{ background: "#7f1d1d" }}><Layers size={18} /></span>
          <strong>Barragens PP IPA</strong>
          <em>{formatNumber(data.ipa_actions.totals.bpp_executed)}</em>
        </label>
        <label className="layer-chip drought-layer-chip">
          <input
            type="checkbox"
            checked={showDroughtMunicipalities}
            onChange={() => setShowDroughtMunicipalities(!showDroughtMunicipalities)}
          />
          <span style={{ background: "#be123c" }}><AlertTriangle size={18} /></span>
          <strong>Decreto estiagem</strong>
          <em>{formatNumber(data.rural_summary.drought_municipalities ?? 0)}</em>
        </label>
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

function MapLegend({
  layerKeys,
  ruralLabel,
  droughtLabel,
  showCompesaStatus,
  sdaAguadasLabel,
  sdaCisternasLabel,
  ipaBarreirosLabel,
  ipaBppLabel,
}: {
  layerKeys: LayerKey[];
  ruralLabel?: string;
  droughtLabel?: string;
  showCompesaStatus?: boolean;
  sdaAguadasLabel?: string;
  sdaCisternasLabel?: string;
  ipaBarreirosLabel?: string;
  ipaBppLabel?: string;
}) {
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
        {showCompesaStatus && (
          <>
            <div className="legend-section-title">
              <span />
              <p>Obras Compesa por fase predominante</p>
            </div>
            {["Concluídas", "Em execução", "Planejadas"].map((phase) => (
              <div key={phase}>
                <span className="legend-compesa" style={{ background: compesaPhaseColor(phase), borderColor: compesaPhaseColor(phase) }} />
                <p>{phase}</p>
              </div>
            ))}
          </>
        )}
        {sdaAguadasLabel && (
          <div>
            <span className="legend-sda-aguadas" />
            <p>{sdaAguadasLabel}</p>
          </div>
        )}
        {sdaCisternasLabel && (
          <div>
            <span className="legend-sda-cisternas" />
            <p>{sdaCisternasLabel}</p>
          </div>
        )}
        {ipaBarreirosLabel && (
          <div>
            <span className="legend-ipa-barreiros" />
            <p>{ipaBarreirosLabel}</p>
          </div>
        )}
        {ipaBppLabel && (
          <div>
            <span className="legend-ipa-bpp" />
            <p>{ipaBppLabel}</p>
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
  compesaGeoJson,
  sdaAguadasGeoJson,
  sdaCisternasGeoJson,
  ipaBarreirosGeoJson,
  ipaBppGeoJson,
  onSelectPoint,
  onSelectMunicipality,
  compact = false,
}: {
  points: Point[];
  ruralGeoJson: GeoJSON.FeatureCollection | null;
  droughtGeoJson?: GeoJSON.FeatureCollection | null;
  compesaGeoJson?: GeoJSON.FeatureCollection | null;
  sdaAguadasGeoJson?: GeoJSON.FeatureCollection | null;
  sdaCisternasGeoJson?: GeoJSON.FeatureCollection | null;
  ipaBarreirosGeoJson?: GeoJSON.FeatureCollection | null;
  ipaBppGeoJson?: GeoJSON.FeatureCollection | null;
  onSelectPoint: (point: Point) => void;
  onSelectMunicipality?: (municipality: string) => void;
  compact?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const ruralLayerRef = useRef<L.GeoJSON | null>(null);
  const droughtLayerRef = useRef<L.GeoJSON | null>(null);
  const compesaLayerRef = useRef<L.GeoJSON | null>(null);
  const sdaAguadasLayerRef = useRef<L.GeoJSON | null>(null);
  const sdaCisternasLayerRef = useRef<L.GeoJSON | null>(null);
  const ipaBarreirosLayerRef = useRef<L.GeoJSON | null>(null);
  const ipaBppLayerRef = useRef<L.GeoJSON | null>(null);

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
          layer.on("click", () => onSelectMunicipality?.(String(props.NM_MUN ?? "")));
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
          layer.on("click", () => onSelectMunicipality?.(String(props.NM_MUN ?? "")));
        },
      }).addTo(map);
      droughtLayerRef.current.bringToBack();
      ruralLayerRef.current?.bringToBack();
    }
  }, [droughtGeoJson]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (compesaLayerRef.current) {
      compesaLayerRef.current.removeFrom(map);
      compesaLayerRef.current = null;
    }
    if (compesaGeoJson) {
      compesaLayerRef.current = L.geoJSON(compesaGeoJson, {
        style: (feature) => {
          const props = feature?.properties ?? {};
          return {
            color: compesaPhaseColor(String(props.dominant_phase ?? "")),
            weight: 1.4,
            fillColor: compesaPhaseColor(String(props.dominant_phase ?? "")),
            fillOpacity: 0.2 + Math.min(0.22, Number(props.works_count ?? 0) / 120),
          };
        },
        onEachFeature: (feature, layer) => {
          const props = feature.properties ?? {};
          layer.bindTooltip(
            `<strong>${props.NM_MUN ?? "Município"}</strong><br/>${formatNumber(Number(props.works_count ?? 0))} obras Compesa<br/>${formatMoneyCompact(Number(props.allocated_value ?? 0))} em valor alocado<br/>Fase predominante: ${props.dominant_phase ?? "n/i"}`,
            { sticky: true },
          );
          layer.on("click", () => onSelectMunicipality?.(String(props.NM_MUN ?? "")));
        },
      }).addTo(map);
      const bounds = compesaLayerRef.current.getBounds();
      if (!bounds.isValid() && !points.length) return;
      if (!points.length && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [24, 24], maxZoom: compact ? 9 : 8 });
      }
      compesaLayerRef.current.bringToBack();
      droughtLayerRef.current?.bringToBack();
      ruralLayerRef.current?.bringToBack();
    }
  }, [compact, compesaGeoJson, points.length]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (sdaAguadasLayerRef.current) {
      sdaAguadasLayerRef.current.removeFrom(map);
      sdaAguadasLayerRef.current = null;
    }
    if (sdaAguadasGeoJson) {
      sdaAguadasLayerRef.current = L.geoJSON(sdaAguadasGeoJson, {
        style: (feature) => ({
          color: "#854d0e",
          weight: 1.2,
          fillColor: "#a16207",
          fillOpacity: 0.14 + Math.min(0.22, Number(feature?.properties?.quantity ?? 0) / 160),
        }),
        onEachFeature: (feature, layer) => {
          const props = feature.properties ?? {};
          layer.bindTooltip(`<strong>${props.NM_MUN ?? "Município"}</strong><br/>${formatNumber(Number(props.quantity ?? 0))} aguadas previstas`, { sticky: true });
          layer.on("click", () => onSelectMunicipality?.(String(props.NM_MUN ?? "")));
        },
      }).addTo(map);
      sdaAguadasLayerRef.current.bringToBack();
      compesaLayerRef.current?.bringToBack();
      droughtLayerRef.current?.bringToBack();
      ruralLayerRef.current?.bringToBack();
    }
  }, [sdaAguadasGeoJson]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (sdaCisternasLayerRef.current) {
      sdaCisternasLayerRef.current.removeFrom(map);
      sdaCisternasLayerRef.current = null;
    }
    if (sdaCisternasGeoJson) {
      sdaCisternasLayerRef.current = L.geoJSON(sdaCisternasGeoJson, {
        style: (feature) => ({
          color: "#075985",
          weight: 1.2,
          fillColor: "#0369a1",
          fillOpacity: 0.12 + Math.min(0.24, Number(feature?.properties?.quantity ?? 0) / 900),
        }),
        onEachFeature: (feature, layer) => {
          const props = feature.properties ?? {};
          layer.bindTooltip(`<strong>${props.NM_MUN ?? "Município"}</strong><br/>${formatNumber(Number(props.quantity ?? 0))} cisternas previstas`, { sticky: true });
          layer.on("click", () => onSelectMunicipality?.(String(props.NM_MUN ?? "")));
        },
      }).addTo(map);
      sdaCisternasLayerRef.current.bringToBack();
      sdaAguadasLayerRef.current?.bringToBack();
      compesaLayerRef.current?.bringToBack();
      droughtLayerRef.current?.bringToBack();
      ruralLayerRef.current?.bringToBack();
    }
  }, [sdaCisternasGeoJson]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (ipaBarreirosLayerRef.current) {
      ipaBarreirosLayerRef.current.removeFrom(map);
      ipaBarreirosLayerRef.current = null;
    }
    if (ipaBarreirosGeoJson) {
      ipaBarreirosLayerRef.current = L.geoJSON(ipaBarreirosGeoJson, {
        style: (feature) => ({
          color: "#78350f",
          weight: 1.2,
          fillColor: "#92400e",
          fillOpacity: 0.12 + Math.min(0.26, Number(feature?.properties?.quantity ?? 0) / 90),
        }),
        onEachFeature: (feature, layer) => {
          const props = feature.properties ?? {};
          layer.bindTooltip(`<strong>${props.NM_MUN ?? "Municipio"}</strong><br/>${formatNumber(Number(props.quantity ?? 0))} barreiros IPA executados`, { sticky: true });
          layer.on("click", () => onSelectMunicipality?.(String(props.NM_MUN ?? "")));
        },
      }).addTo(map);
      ipaBarreirosLayerRef.current.bringToBack();
      sdaCisternasLayerRef.current?.bringToBack();
      sdaAguadasLayerRef.current?.bringToBack();
      compesaLayerRef.current?.bringToBack();
      droughtLayerRef.current?.bringToBack();
      ruralLayerRef.current?.bringToBack();
    }
  }, [ipaBarreirosGeoJson]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (ipaBppLayerRef.current) {
      ipaBppLayerRef.current.removeFrom(map);
      ipaBppLayerRef.current = null;
    }
    if (ipaBppGeoJson) {
      ipaBppLayerRef.current = L.geoJSON(ipaBppGeoJson, {
        style: (feature) => ({
          color: "#7f1d1d",
          weight: 1.2,
          fillColor: "#ef4444",
          fillOpacity: 0.16 + Math.min(0.28, Number(feature?.properties?.quantity ?? 0) / 12),
        }),
        onEachFeature: (feature, layer) => {
          const props = feature.properties ?? {};
          layer.bindTooltip(`<strong>${props.NM_MUN ?? "Municipio"}</strong><br/>${formatNumber(Number(props.quantity ?? 0))} barragens PP IPA executadas`, { sticky: true });
          layer.on("click", () => onSelectMunicipality?.(String(props.NM_MUN ?? "")));
        },
      }).addTo(map);
      ipaBppLayerRef.current.bringToBack();
      ipaBarreirosLayerRef.current?.bringToBack();
      sdaCisternasLayerRef.current?.bringToBack();
      sdaAguadasLayerRef.current?.bringToBack();
      compesaLayerRef.current?.bringToBack();
      droughtLayerRef.current?.bringToBack();
      ruralLayerRef.current?.bringToBack();
    }
  }, [ipaBppGeoJson]);

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

function MunicipalityMapDetails({ data, municipality }: { data: DashboardData; municipality: string }) {
  const key = normalize(municipality);
  const row = useMemo(() => coverageRows(data).find((item) => normalize(item.municipality) === key), [data, key]);
  const compesaMunicipality = data.compesa_works.municipalities.find((item) => normalize(item.municipality) === key);
  const compesaWorks = data.compesa_works.works.filter((work) => work.municipalities.some((name) => normalize(name) === key));
  const sdaMunicipality = data.sda_actions.municipalities.find((item) => normalize(item.municipality) === key);
  const ipaMunicipality = data.ipa_actions.municipalities.find((item) => normalize(item.municipality) === key);
  const topCompesaWorks = compesaWorks.slice().sort((a, b) => b.value - a.value).slice(0, 3);

  return (
    <div className="municipality-map-detail">
      <span>Resumo municipal</span>
      <strong>{titleCase(municipality)}</strong>
      <p>
        {row?.drought ? "No decreto de estiagem" : "Fora do decreto de estiagem"}
        {row ? ` · índice ${formatNumber(row.needScore)}` : ""}
      </p>

      <div className="map-detail-kpis">
        <div>
          <small>Infra direta</small>
          <b>{formatNumber(row?.directInfra ?? 0)}</b>
        </div>
        <div>
          <small>Aglomerados</small>
          <b>{formatNumber(row?.agglomerates ?? 0)}</b>
        </div>
        <div>
          <small>Pop. aglom.</small>
          <b>{formatNumber(row?.population ?? 0)}</b>
        </div>
      </div>

      <section>
        <h3>Obras Compesa</h3>
        <div className="map-detail-kpis two">
          <div>
            <small>Obras</small>
            <b>{formatNumber(compesaWorks.length)}</b>
          </div>
          <div>
            <small>Valor alocado</small>
            <b>{formatMoneyCompact(compesaMunicipality?.allocated_value ?? 0)}</b>
          </div>
        </div>
        {topCompesaWorks.length ? (
          <div className="map-detail-list">
            {topCompesaWorks.map((work) => (
              <article key={work.id}>
                <strong>{work.name}</strong>
                <p>{work.status} · {formatMoneyCompact(work.value)}</p>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-state">Sem obras Compesa associadas.</p>
        )}
      </section>

      <section>
        <h3>Ações SDA</h3>
        {sdaMunicipality ? (
          <div className="sda-side-grid">
            <div><span>PAD</span><strong>{formatNumber(sdaMunicipality.pad)}</strong></div>
            <div><span>PISF</span><strong>{formatNumber(sdaMunicipality.pisf)}</strong></div>
            <div><span>Aguadas</span><strong>{formatNumber(sdaMunicipality.aguadas)}</strong></div>
            <div><span>Cisternas</span><strong>{formatNumber(sdaMunicipality.cisternas_total)}</strong></div>
          </div>
        ) : (
          <p className="empty-state">Sem ações SDA associadas.</p>
        )}
      </section>

      <section>
        <h3>Ações IPA</h3>
        {ipaMunicipality ? (
          <div className="sda-side-grid">
            <div><span>Poços</span><strong>{formatNumber(ipaMunicipality.pocos)}</strong></div>
            <div><span>Instalados</span><strong>{formatNumber(ipaMunicipality.pocos_instalados)}</strong></div>
            <div><span>Barreiros</span><strong>{formatNumber(ipaMunicipality.barreiros_executed)}</strong></div>
            <div><span>BPP</span><strong>{formatNumber(ipaMunicipality.bpp_executed)}</strong></div>
          </div>
        ) : (
          <p className="empty-state">Sem ações IPA associadas.</p>
        )}
      </section>
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

function MunicipalityTable({
  rows,
  selectedMunicipality,
  onSelect,
}: {
  rows: CoverageRow[];
  selectedMunicipality: string;
  onSelect: (municipality: string) => void;
}) {
  const visibleRows = rows.slice(0, 120);
  return (
    <>
      <div className="table-wrap">
        <table className="municipality-table">
          <thead>
            <tr>
              <th>Município</th>
              <th>Índice</th>
              <th>População</th>
              <th>Aglomerados</th>
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
            {visibleRows.map((row) => {
              const selected = normalize(row.municipality) === normalize(selectedMunicipality);
              return (
                <tr key={row.municipality} className={selected ? "selected-row" : ""}>
                  <td>
                    <button type="button" className="municipality-link-button" onClick={() => onSelect(row.municipality)}>
                      {titleCase(row.municipality)}
                    </button>
                  </td>
                  <td className="score-cell">{formatNumber(row.needScore)}</td>
                  <td>{formatNumber(row.population)}</td>
                  <td>{formatNumber(row.agglomerates)}</td>
                  <td>{formatNumber(row.directInfra)}</td>
                  <td>{formatNumber(row.counts.pocos ?? 0)}</td>
                  <td>{formatNumber(row.counts.dessalinizadores ?? 0)}</td>
                  <td>{formatNumber(row.counts.sisar ?? 0)}</td>
                  <td>{formatNumber(row.counts.barragens ?? 0)}</td>
                  <td>{formatNumber((row.counts.outorgas_subterraneas ?? 0) + (row.counts.outorgas_superficiais ?? 0))}</td>
                  <td className="score-cell">{formatNumber(row.total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > visibleRows.length && (
        <p className="table-note">Exibindo {formatNumber(visibleRows.length)} de {formatNumber(rows.length)} municípios. Use a busca para refinar.</p>
      )}
    </>
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

function IndexMethodology() {
  return (
    <section className="method-card">
      <span>Metodologia do índice</span>
      <strong>população/180 + aglomerados x 1,2 + lacuna x 2 + penalidade + estiagem</strong>
      <div className="method-grid">
        <p><b>População</b> Pessoas nos aglomerados rurais do Censo 2022.</p>
        <p><b>Aglomerados</b> Setores IBGE 5, 6 e 7: povoado, núcleo rural e lugarejo.</p>
        <p><b>Lacuna</b> Aglomerados menos infraestrutura direta, limitada a zero. Poços IPA só entram quando instalados.</p>
        <p><b>Penalidade</b> 25 sem infraestrutura direta; senão, lacuna/aglomerações x 20. Registros perfurados indicam obra ainda não instalada.</p>
        <p><b>Estiagem</b> Bônus de 35 para municípios no decreto.</p>
        <p><b>Leitura</b> Quanto maior o valor, maior a prioridade estimada.</p>
      </div>
      <em>O índice orienta priorização territorial e não representa vazão medida.</em>
    </section>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="select-wrap">
      <span>{label}</span>
      <div>
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <ChevronDown size={16} />
      </div>
    </label>
  );
}

function MultiSelectDropdown({
  label,
  values,
  options,
  counts,
  onChange,
}: {
  label: string;
  values: string[];
  options: string[];
  counts: Record<string, number>;
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const summary = values.length ? (values.length === 1 ? values[0] : `${values.length} selecionados`) : "Todos";
  const toggle = (option: string) => {
    if (values.includes(option)) {
      onChange(values.filter((value) => value !== option));
      return;
    }
    onChange([...values, option]);
  };

  return (
    <div className="multi-select-field">
      <div className="multi-select-header">
        <span>{label}</span>
      </div>
      <button type="button" className={`multi-select-trigger ${open ? "open" : ""}`} onClick={() => setOpen(!open)}>
        <strong>{summary}</strong>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="multi-select-menu">
          <button type="button" className="multi-select-clear" onClick={() => onChange([])} disabled={!values.length}>
            Selecionar todos
          </button>
          <div className="multi-select-options">
            {options.map((option) => {
              const selected = values.includes(option);
              return (
                <label key={option} className="multi-select-option">
                  <input type="checkbox" checked={selected} onChange={() => toggle(option)} />
                  <span>{option}</span>
                  <em>{formatNumber(counts[option] ?? 0)}</em>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function CompesaWorksTable({ rows }: { rows: CompesaWork[] }) {
  const visibleRows = rows.slice(0, 180);
  return (
    <>
      <div className="table-wrap">
        <table className="compesa-table">
          <thead>
            <tr>
              <th>Obra</th>
              <th>Status</th>
              <th>Municípios</th>
              <th>Eixo</th>
              <th>Subeixo</th>
              <th>Valor</th>
              <th>Exec.</th>
              <th>Previsão</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((work) => (
              <tr key={work.id}>
                <td>
                  <strong>{work.name}</strong>
                  {work.type && <p>{work.type}</p>}
                </td>
                <td><span className={`compesa-status ${phaseClass(work.phase)}`}>{work.status}</span></td>
                <td>{work.municipalities.length ? work.municipalities.map(titleCase).join(", ") : work.municipalities_original}</td>
                <td>{work.eixo}</td>
                <td>{work.subeixo}</td>
                <td className="score-cell">{formatMoneyCompact(work.value)}</td>
                <td>{formatPercent(work.execution)}</td>
                <td>{formatDate(work.end_date) || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > visibleRows.length && (
        <p className="table-note">Exibindo {formatNumber(visibleRows.length)} de {formatNumber(rows.length)} obras. Use busca ou filtros para refinar.</p>
      )}
    </>
  );
}

function SdaRecordsTable({ rows }: { rows: SdaRecord[] }) {
  const visibleRows = rows.slice(0, 180);
  return (
    <>
      <div className="table-wrap">
        <table className="sda-table">
          <thead>
            <tr>
              <th>Programa</th>
              <th>Tipo</th>
              <th>Município</th>
              <th>Localidade</th>
              <th>Status</th>
              <th>Quantidade</th>
              <th>População</th>
              <th>Detalhe</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((record) => (
              <tr key={record.id}>
                <td><strong>{record.program}</strong></td>
                <td>{record.type}</td>
                <td>{titleCase(record.municipality)}</td>
                <td>{record.locality || "-"}</td>
                <td><span className={`compesa-status ${phaseClass(record.status)}`}>{record.status}</span></td>
                <td className="score-cell">{formatNumber(record.quantity ?? 0)}</td>
                <td>{formatNumber(record.population ?? 0)}</td>
                <td>{record.detail || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > visibleRows.length && (
        <p className="table-note">Exibindo {formatNumber(visibleRows.length)} de {formatNumber(rows.length)} ações. Use busca ou filtros para refinar.</p>
      )}
    </>
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

function IpaPocosTable({ rows }: { rows: IpaPocoRecord[] }) {
  const visibleRows = rows.slice(0, 180);
  return (
    <>
      <div className="table-wrap">
        <table className="ipa-table">
          <thead>
            <tr>
              <th>Aba/lote</th>
              <th>Município</th>
              <th>Localidade</th>
              <th>Status</th>
              <th>Vazão l/h</th>
              <th>STD mg/l</th>
              <th>Coordenada</th>
              <th>Proprietário/contato</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((record) => (
              <tr key={record.id}>
                <td><strong>{record.sheet}</strong></td>
                <td>{titleCase(record.municipality)}</td>
                <td>{record.locality || "-"}</td>
                <td><span className={`compesa-status ${phaseClass(record.status)}`}>{record.status || "Sem status"}</span></td>
                <td className="score-cell">{formatNumber(record.flow ?? 0)}</td>
                <td>{formatNumber(record.std ?? 0)}</td>
                <td>{record.lat && record.lng ? "Mapeado" : "Sem coordenada"}</td>
                <td>{record.owner || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > visibleRows.length && (
        <p className="table-note">Exibindo {formatNumber(visibleRows.length)} de {formatNumber(rows.length)} poços. Use busca ou filtros para refinar.</p>
      )}
    </>
  );
}

function IpaBarreirosTable({ rows }: { rows: IpaBarreiroRecord[] }) {
  const visibleRows = rows.slice(0, 180);
  return (
    <>
      <div className="table-wrap">
        <table className="ipa-table">
          <thead>
            <tr>
              <th>Município</th>
              <th>Região</th>
              <th>Barreiros autorizados</th>
              <th>Barreiros locados</th>
              <th>Barreiros executados</th>
              <th>BPP autorizadas</th>
              <th>BPP locadas</th>
              <th>BPP executadas</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((record) => (
              <tr key={record.municipality}>
                <td><strong>{titleCase(record.municipality)}</strong></td>
                <td>{record.region || "-"}</td>
                <td>{formatNumber(record.bar_authorized)}</td>
                <td>{formatNumber(record.bar_located)}</td>
                <td className="score-cell">{formatNumber(record.bar_executed)}</td>
                <td>{formatNumber(record.bpp_authorized)}</td>
                <td>{formatNumber(record.bpp_located)}</td>
                <td className="score-cell">{formatNumber(record.bpp_executed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > visibleRows.length && (
        <p className="table-note">Exibindo {formatNumber(visibleRows.length)} de {formatNumber(rows.length)} municípios. Use busca ou filtros para refinar.</p>
      )}
    </>
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

function isDirectInfrastructurePoint(point: Point) {
  const status = normalize(point.status);
  if (["sda_pad", "sda_pisf"].includes(point.layer)) return status.includes("entregue");
  if (point.layer === "ipa_pocos") return status.includes("instalado");
  return DIRECT_WATER_LAYERS.includes(point.layer);
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
    if (["sda_pad", "sda_pisf"].includes(point.layer)) {
      if (normalize(point.status).includes("entregue")) row.directInfra += 1;
    } else if (point.layer === "ipa_pocos") {
      return;
    } else if (DIRECT_WATER_LAYERS.includes(point.layer)) {
      row.directInfra += 1;
    }
  });

  data.ipa_actions.pocos.forEach((record) => {
    if (normalize(record.status).includes("instalado")) ensure(record.municipality).directInfra += 1;
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

function formatMoneyCompact(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value || 0);
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatDate(value: string) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pt-BR");
}

function formatDateTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
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

function compesaPhaseColor(phase: string) {
  const normalized = normalize(phase);
  if (normalized.includes("concluidas") || normalized.includes("concluido") || normalized.includes("entregue")) return "#16a34a";
  if (normalized.includes("execucao") || normalized.includes("andamento") || normalized.includes("retomar")) return "#0284c7";
  if (normalized.includes("planejada") || normalized.includes("licitar") || normalized.includes("iniciar") || normalized.includes("projeto")) return "#f59e0b";
  return "#64748b";
}

function phaseClass(phase: string) {
  const normalized = normalize(phase);
  if (normalized.includes("concluidas") || normalized.includes("concluido") || normalized.includes("entregue")) return "done";
  if (normalized.includes("execucao") || normalized.includes("andamento") || normalized.includes("retomar")) return "active";
  return "planned";
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
