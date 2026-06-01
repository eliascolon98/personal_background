# Consultas Colombia

Servicio automatizado para consultar **antecedentes judiciales** (Policía Nacional) y **datos de vehículos** (RUNT) en Colombia.

Incluye una interfaz web interactiva con animaciones para visualizar el progreso de cada consulta.

## Tecnologías

- **Node.js + TypeScript**
- **Puppeteer** — Automatización del navegador
- **2Captcha** — Resolución de CAPTCHA (reCAPTCHA v2 + imagen)
- **Express** — Servidor HTTP y API REST

## Requisitos

- Node.js 18+
- API Key de [2Captcha](https://2captcha.com/)

## Instalación

```bash
npm install
```

## Configuración

Copia el archivo de ejemplo y agrega tu API key:

```bash
copy .env.example .env
```

Edita `.env`:

```
TWOCAPTCHA_API_KEY=tu_api_key_aqui
PORT=3000
```

## Uso

### Desarrollo (hot-reload)

```bash
npm run start:dev
```

### Producción

```bash
npm run build
npm start
```

Abre el navegador en `http://localhost:3000`

## Endpoints

### POST /consultar

Consulta antecedentes judiciales.

**Request:**
```json
{
  "documento": "1002491594"
}
```

**Response:**
```json
{
  "success": true,
  "documento": "1002491594",
  "nombre": "COLON MUÑOZ ELIAS ENRIQUE",
  "tieneAntecedentes": false,
  "mensaje": "NO TIENE ASUNTOS PENDIENTES CON LAS AUTORIDADES JUDICIALES",
  "fechaConsulta": "2026-06-01T21:08:11.930Z",
  "horaConsulta": "04:12:47 PM"
}
```

### POST /consultar-vehiculo

Consulta información del vehículo en el RUNT.

**Request:**
```json
{
  "placa": "SLV41H",
  "documento": "1002491594"
}
```

**Response:**
```json
{
  "success": true,
  "placa": "SLV41H",
  "documento": "1002491594",
  "fechaConsulta": "2026-06-01T22:30:00.000Z",
  "vehiculo": {
    "placa": "SLV41H",
    "nroLicenciaTransito": "10035576963",
    "estadoVehiculo": "ACTIVO",
    "tipoServicio": "Particular",
    "claseVehiculo": "MOTOCICLETA",
    "marca": "YAMAHA",
    "linea": "MTN155-A",
    "modelo": "2026",
    "color": "NEGRO",
    "numeroMotor": "G3T5E0022122",
    "numeroChasis": "9FKRG8125T2022122",
    "numeroVIN": "9FKRG8125T2022122",
    "cilindraje": "155",
    "tipoCarroceria": "SIN CARROCERIA",
    "tipoCombustible": "GASOLINA",
    "fechaMatriculaInicial": "30/07/2025",
    "autoridadTransito": "STRIA TTOyTTE MCPAL SABANETA",
    "gravamenesPropiedad": "NO"
  }
}
```

### GET /consultar/:documento

Consulta rápida de antecedentes por URL.

### GET /health

Estado del servidor.

## Flujo de cada consulta

### Antecedentes (Policía Nacional)

1. Navega a la página de términos y condiciones
2. Acepta los términos (radio + botón)
3. Redirige a la página de consulta
4. Ingresa el número de documento
5. Resuelve el reCAPTCHA v2 con 2Captcha
6. Hace clic en "Consultar"
7. Extrae y retorna el resultado

### Vehículo (RUNT)

1. Navega al portal público del RUNT
2. Llena placa y documento del propietario
3. Resuelve el captcha de imagen con 2Captcha
4. Hace clic en "Consultar Información"
5. Extrae toda la información del vehículo y la retorna

## Costos de 2Captcha

- **reCAPTCHA v2** (antecedentes): ~$2.99 por 1000 consultas
- **Captcha de imagen** (vehículo): ~$1.00 por 1000 consultas

Con $3 USD tienes aproximadamente 1000 consultas de antecedentes o 3000 de vehículo.

## Notas

- Cada consulta toma entre 15-60 segundos dependiendo del CAPTCHA.
- Se ignoran errores de certificado SSL (el sitio de la policía usa certificados auto-firmados).
- El scraper de vehículos usa Puppeteer para renderizar la app Angular del RUNT.
