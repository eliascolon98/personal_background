import express from 'express';
import path from 'path';
import { config } from './config';
import { consultarAntecedentes, ConsultaResult } from './scraper';
import { consultarVehiculo, VehiculoResult } from './scraper-vehiculo';

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Endpoint para consultar antecedentes
app.post('/consultar', async (req, res) => {
  req.setTimeout(180000);
  res.setTimeout(180000);

  const { documento } = req.body;

  if (!documento) {
    res.status(400).json({ success: false, error: 'El campo "documento" es requerido' });
    return;
  }

  if (!/^\d+$/.test(documento)) {
    res.status(400).json({ success: false, error: 'El documento debe contener solo números' });
    return;
  }

  console.log(`\n=== Consulta ANTECEDENTES: ${documento} ===`);

  try {
    const resultado: ConsultaResult = await consultarAntecedentes(documento);
    res.status(resultado.success ? 200 : 500).json(resultado);
  } catch (error: any) {
    res.status(500).json({
      success: false, documento, tieneAntecedentes: false, mensaje: '',
      fechaConsulta: new Date().toISOString(), error: error.message,
    });
  }
});

// Endpoint para consultar vehículo
app.post('/consultar-vehiculo', async (req, res) => {
  req.setTimeout(180000);
  res.setTimeout(180000);

  const { placa, documento } = req.body;

  if (!placa || !documento) {
    res.status(400).json({ success: false, error: 'Los campos "placa" y "documento" son requeridos' });
    return;
  }

  if (!/^[a-zA-Z0-9]+$/.test(placa)) {
    res.status(400).json({ success: false, error: 'La placa debe contener solo letras y números' });
    return;
  }

  if (!/^\d+$/.test(documento)) {
    res.status(400).json({ success: false, error: 'El documento debe contener solo números' });
    return;
  }

  console.log(`\n=== Consulta VEHICULO: placa=${placa}, doc=${documento} ===`);

  try {
    const resultado: VehiculoResult = await consultarVehiculo(placa, documento);
    res.status(resultado.success ? 200 : 500).json(resultado);
  } catch (error: any) {
    res.status(500).json({
      success: false, placa, documento,
      fechaConsulta: new Date().toISOString(), error: error.message,
    });
  }
});

// Endpoint GET para consulta rápida de antecedentes
app.get('/consultar/:documento', async (req, res) => {
  const { documento } = req.params;
  if (!/^\d+$/.test(documento)) {
    res.status(400).json({ success: false, error: 'El documento debe contener solo números' });
    return;
  }
  console.log(`\n=== Consulta ANTECEDENTES (GET): ${documento} ===`);
  try {
    const resultado = await consultarAntecedentes(documento);
    res.status(resultado.success ? 200 : 500).json(resultado);
  } catch (error: any) {
    res.status(500).json({ success: false, documento, error: error.message });
  }
});

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    captchaConfigured: !!config.twoCaptchaApiKey,
    timestamp: new Date().toISOString(),
  });
});

const server = app.listen(config.port, () => {
  console.log(`\n🚀 Servidor corriendo en http://localhost:${config.port}`);
  console.log(`\n📋 Endpoints:`);
  console.log(`   POST /consultar            - Antecedentes { "documento": "..." }`);
  console.log(`   POST /consultar-vehiculo   - Vehículo { "placa": "...", "documento": "..." }`);
  console.log(`   GET  /health`);
  console.log(`\n⚙️  2Captcha: ${config.twoCaptchaApiKey ? '✓' : '✗'}`);
});

server.timeout = 180000;
server.keepAliveTimeout = 180000;
