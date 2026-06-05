# CLAUDE.md — personal_background

## Project overview

A Node.js/TypeScript REST API that automates background checks against two Colombian government portals:

1. **Antecedentes judiciales** — Policía Nacional de Colombia (`antecedentes.policia.gov.co:7005`)
2. **Datos de vehículo** — RUNT portal público (`portalpublico.runt.gov.co`)

Both scrapers use Puppeteer (headless Chromium) and resolve CAPTCHAs via the 2Captcha paid service.

## Stack

- **Runtime**: Node.js 18+, TypeScript 5 (compiled to `dist/`, target ES2020, commonjs)
- **Server**: Express 4
- **Scraping**: Puppeteer 22
- **CAPTCHA solving**: `2captcha-ts` — wraps the 2Captcha REST API
- **Dev tooling**: `ts-node`, `ts-node-dev`

## Source files

| File | Responsibility |
|---|---|
| `src/config.ts` | Loads `.env` manually (no dotenv dep), exports `config` with API key, port, and Policía URLs |
| `src/index.ts` | Express server — registers all endpoints, 180 s timeouts on every route |
| `src/scraper.ts` | `consultarAntecedentes(documento)` — full Puppeteer flow for Policía site |
| `src/scraper-vehiculo.ts` | `consultarVehiculo(placa, documento)` — full Puppeteer flow for RUNT portal |
| `src/scraper-simit.ts` | `consultarSimit(documento)` — full Puppeteer flow for SIMIT public portal, no CAPTCHA |

## API endpoints

| Method | Path | Body / Params | Returns |
|---|---|---|---|
| `POST` | `/consultar` | `{ documento }` | `ConsultaResult` |
| `GET` | `/consultar/:documento` | URL param | `ConsultaResult` |
| `POST` | `/consultar-vehiculo` | `{ placa, documento }` | `VehiculoResult` |
| `POST` | `/consultar-simit` | `{ documento }` | `SimitResult` |
| `GET` | `/health` | — | `{ status, captchaConfigured, timestamp }` |

Validation: `documento` must be digits only; `placa` must be alphanumeric only.

## Key interfaces

```ts
// scraper.ts
interface ConsultaResult {
  success: boolean;
  documento: string;
  nombre?: string;
  tieneAntecedentes: boolean;
  mensaje: string;
  fechaConsulta: string;
  horaConsulta?: string;
  error?: string;
}

// scraper-vehiculo.ts
interface VehiculoResult {
  success: boolean;
  placa: string;
  documento: string;
  fechaConsulta: string;
  vehiculo?: VehiculoInfo;  // ~30 fields scraped from RUNT
  error?: string;
}

// scraper-simit.ts
interface SimitResult {
  success: boolean;
  documento: string;
  fechaConsulta: string;
  comparendos: Comparendo[];
  totalComparendos: number;
  error?: string;
}
interface Comparendo {
  tipo: string;
  notificacion: string;
  placa: string;
  secretaria: string;
  infraccion: string;
  estado: string;
  valorAPagar: string;
}
```

## Frontend — vehicle result UI

After a successful vehicle query, the result card shows two `<details>` accordion elements:

1. **"Datos del Vehículo"** — open by default; renders all `VehiculoInfo` fields as label/value rows.
2. **"Comparendos SIMIT"** — closed by default; on first open triggers a `POST /consultar-simit` with the stored document number, shows a loading spinner, then renders the comparendos in a scrollable table (`Tipo | Notificación | Placa | Secretaría | Infracción | Estado | Valor a pagar`). Estado column is styled with colored badges (green=paid/cancelled, red=active/pending, yellow=agreement, gray=other).

The SIMIT fetch is lazy — it only fires once, on first open of the accordion.

## Scraper flows

### Antecedentes (Policía)

1. Navigate to `index.xhtml` (terms & conditions page — PrimeFaces JSF app)
2. Scroll the terms panel (`#j_idt19`)
3. Check `input[id="aceptaOption:0"]`, force-enable `#continuarBtn`, click → navigate to `antecedentes.xhtml`
4. Fill `#cedulaInput` with the document number
5. Resolve reCAPTCHA v2 via 2Captcha (known sitekey: `6LcsIwQaAAAAAFCsaI-dkR6hgKsZwwJRsmE0tIJH`)
6. Inject token into `#g-recaptcha-response`, click `#j_idt17`
7. Wait for `[id="form:mensajeCiudadano"]`, parse result text
8. Retry up to 2 times on CAPTCHA failure

### Vehículo (RUNT)

1. Navigate to RUNT Angular SPA
2. Fill `#mat-input-6` (placa) and `#mat-input-7` (documento)
3. Resolve image CAPTCHA via 2Captcha `imageCaptcha` — captures base64 inline PNG from DOM
4. Write answer into `#mat-input-8`, submit
5. Check for `cyrconsultavehiculo-info-vehiculo-detallada` component
6. Extract ~30 vehicle fields via `getText(label)` helper scraping `mat-card p` elements
7. Retry up to 3 times on CAPTCHA failure

## Environment variables

```
TWOCAPTCHA_API_KEY=   # required — 2Captcha account key
PORT=3000             # optional, defaults to 3000
```

Config is loaded by `src/config.ts` by reading `.env` manually (no `dotenv` package).

## Dev commands

```bash
npm run dev          # ts-node-dev with --respawn --transpile-only
npm run build        # tsc → dist/
npm start            # node dist/index.js
```

### Comparendos (SIMIT)

1. Navigate to `https://www.fcm.org.co/simit/#/home-public` (Angular SPA, no CAPTCHA)
2. Wait for Angular to hydrate; try multiple selector strategies to find the document input
3. Fill the document number; submit via button click or Enter fallback
4. Wait for `networkidle2`; extract rows from `mat-row/mat-cell` (Material table) or `tbody tr/td` (HTML table)
5. Handle pagination via `button[aria-label="Next page"]` / "siguiente" links
6. Route timeout is 120 s (no CAPTCHA solving needed)

## Important constraints

- Puppeteer launches with `--no-sandbox`, `--ignore-certificate-errors`, `--disable-web-security` — required because the Policía site uses a self-signed SSL cert and the RUNT site has security headers.
- Each request can take 15–90 s (mostly CAPTCHA solve time). The Express server and each route have a 180 s timeout.
- The Policía site is a PrimeFaces/JSF app; button state is managed by PrimeFaces AJAX — the scraper force-enables the button via DOM manipulation when PrimeFaces doesn't fire.
- The RUNT site is an Angular app; selectors are Material component IDs (`#mat-input-*`).
- A new browser instance is launched per request and closed in `finally` — no browser reuse.
