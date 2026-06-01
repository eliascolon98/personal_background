# Consulta de Antecedentes Judiciales - Policía Nacional de Colombia

Servicio automatizado que consulta antecedentes judiciales en la página de la Policía Nacional de Colombia usando Puppeteer y 2Captcha.

## Requisitos

- Node.js 18+
- API Key de [2Captcha](https://2captcha.com/) (para resolver el CAPTCHA automáticamente)

## Instalación

```bash
npm install
```

## Configuración

1. Copia el archivo `.env.example` a `.env`:

```bash
copy .env.example .env
```

2. Edita `.env` y agrega tu API key de 2Captcha:

```
TWOCAPTCHA_API_KEY=tu_api_key_real_aqui
PORT=3000
```

## Uso

### Modo desarrollo

```bash
npm run dev
```

### Compilar y ejecutar

```bash
npm run build
npm start
```

## Endpoints

### POST /consultar

Consulta antecedentes por número de documento.

**Request:**
```json
{
  "documento": "123456789"
}
```

**Response exitosa:**
```json
{
  "success": true,
  "documento": "123456789",
  "fechaConsulta": "2024-01-15T10:30:00.000Z",
  "antecedentes": "NO TIENE ASUNTOS PENDIENTES CON LAS AUTORIDADES JUDICIALES",
  "mensaje": "Consulta realizada exitosamente"
}
```

### GET /consultar/:documento

Consulta rápida por URL.

```
GET http://localhost:3000/consultar/123456789
```

### GET /health

Verifica el estado del servidor.

```json
{
  "status": "ok",
  "captchaConfigured": true,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## Flujo del proceso

1. Navega a `https://antecedentes.policia.gov.co:7005/WebJudicial/index.xhtml`
2. Hace scroll en los términos y condiciones
3. Acepta los términos
4. Redirige a la página de consulta
5. Ingresa el número de documento (Cédula viene seleccionada por defecto)
6. Captura la imagen del CAPTCHA y la envía a 2Captcha para resolución
7. Ingresa la respuesta del CAPTCHA
8. Hace clic en "Consultar"
9. Extrae el resultado y lo retorna como JSON

## Notas

- El servicio usa `puppeteer` en modo headless para automatizar la navegación.
- El CAPTCHA se resuelve mediante el servicio de pago [2Captcha](https://2captcha.com/).
- Cada consulta puede tomar entre 15-45 segundos dependiendo del tiempo de resolución del CAPTCHA.
- Se ignoran errores de certificado SSL ya que el sitio de la policía puede tener certificados auto-firmados.
