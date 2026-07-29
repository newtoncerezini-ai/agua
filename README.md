# Painel de Infraestrutura Hídrica de Pernambuco

Painel em React/Vite para visualização territorial de poços, dessalinizadores, SAA/SISAR, barragens, outorgas e setores rurais do IBGE em Pernambuco.

## Desenvolvimento

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

Os dados já consolidados ficam em `public/data/dashboard.json`. As planilhas, o shapefile e os KML brutos ficam fora do git por tamanho e por serem fontes locais.

Para regenerar a base:

```bash
npm run prepare:data
```

Os KML da Compesa são lidos da pasta `mapas_kml_compesa_28.07.2026`, localizada na raiz do projeto ou em `Downloads`. O processamento corrige os nomes dos arquivos, simplifica geometrias muito detalhadas e vincula cada projeto à planilha de investimentos somente quando a correspondência é suficientemente segura. Vínculos confirmados por conferência manual ficam registrados em `scripts/compesa_kml.py`, inclusive quando um único KML representa várias obras.
