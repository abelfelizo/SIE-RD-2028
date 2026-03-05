/**
 * SIE 2028 — core/padron.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Modelo de crecimiento del padrón electoral 2028.
 *
 * METODOLOGÍA:
 *   Proyecta el padrón 2028 usando la tasa de crecimiento histórica JCE 2004-2024,
 *   diferenciada por provincia (crecimiento urbano vs rural distinto).
 *
 * DATOS HISTÓRICOS NACIONALES (JCE — padrón electoral interior):
 *   2004:  5,020,703   (Fuente: JCE)
 *   2008:  5,998,472
 *   2010:  6,240,038   (elecciones congresuales)
 *   2012:  6,520,508
 *   2016:  6,651,966
 *   2020:  7,529,932   (results_2020.json → tot_inscritos)
 *   2024:  7,281,764   (padron_2024_meta.json → inscritos_interior)
 *   2024T: 8,145,548   (total incluyendo exterior: 863,784)
 *
 * NOTA 2024: El interior cayó de 7.53M (2020) a 7.28M (2024) porque se depuró
 *   el padrón (fallecidos y migrantes). La tasa se calcula como promedio
 *   suavizado excluyendo la depuración puntual.
 *
 * PROYECCIÓN 2028:
 *   - Crecimiento nacional estimado: +7.63% (dato JCE en padron_2024_unificado.json)
 *   - Diferencial provincial: provincias de alta migración interna (Santo Domingo,
 *     Santiago, La Altagracia) crecen más rápido que las rurales.
 *   - Exterior: +12% por expansión de comunidades en EE.UU., España, Italia.
 *
 * INTEGRACIÓN EN pipeline2028.js:
 *   import { proyectarPadron2028 } from './padron.js';
 *   const padron2028 = proyectarPadron2028(ctx);
 *   // padron2028.nacional.inscritos
 *   // padron2028.provincial[provId].inscritos
 *   // padron2028.exterior.inscritos
 */

'use strict';

// ─── Histórico nacional (padrón interior JCE) ────────────────────────────────
var HISTORICO_NACIONAL = [
  { year: 2004, inscritos: 5020703 },
  { year: 2008, inscritos: 5998472 },
  { year: 2010, inscritos: 6240038 },
  { year: 2012, inscritos: 6520508 },
  { year: 2016, inscritos: 6651966 },
  { year: 2020, inscritos: 7529932 },
  { year: 2024, inscritos: 7281764 }, // interior depurado
];

// Tasas de crecimiento inter-ciclo (electoral cada 4 años):
// 2004→2008: +19.49% / 2008→2012: +8.70% / 2012→2016: +2.01%
// 2016→2020: +13.19% / 2020→2024: −3.30% (depuración)
// Promedio excl. depuración: ~10.85% por ciclo de 4 años
// JCE proyecta +7.63% para 2024→2028 (más conservador, correcto)
var TASA_NACIONAL_2028 = 0.0763;

// ─── Factores de crecimiento diferencial por provincia ───────────────────────
// Basado en patrones de migración interna y crecimiento urbano JCE 2016-2024.
// Provincias de alta atracción migratoria reciben factor mayor al promedio.
// Provincias de alta emigración (rurales) reciben factor menor.
var FACTOR_PROVINCIAL = {
  '01': 1.04,  // Distrito Nacional      — crecimiento moderado (ya saturado)
  '02': 1.15,  // La Altagracia          — turismo/construcción boom
  '03': 0.95,  // Azua                   — emigración a SD
  '04': 0.90,  // Bahoruco               — rural emigración
  '05': 0.92,  // Barahona               — rural
  '06': 0.95,  // Dajabon                — frontera, estable
  '07': 0.97,  // Duarte                 — levemente por debajo
  '08': 0.93,  // El Seibo               — rural
  '09': 0.92,  // Elias Piña             — rural frontera
  '10': 0.98,  // Espaillat              — tabaco region, estable
  '11': 0.94,  // Hato Mayor             — rural
  '12': 0.91,  // Independencia          — rural frontera
  '13': 1.08,  // La Romana              — zona franca, creciente
  '14': 0.98,  // La Vega                — intermedio
  '15': 0.95,  // María Trinidad Sánchez — rural costero
  '16': 1.02,  // Monseñor Nouel         — industrial cercano SD
  '17': 0.94,  // Monte Cristi           — rural frontera
  '18': 0.96,  // Monte Plata            — conurbación SD
  '19': 0.90,  // Pedernales             — muy rural
  '20': 1.03,  // Peravia               — conurbación SD
  '21': 1.05,  // Puerto Plata           — turismo
  '22': 0.95,  // Hermanas Mirabal       — rural norte
  '23': 1.02,  // Samaná                 — turismo creciente
  '24': 1.12,  // San Cristóbal          — suburbanización SD
  '25': 0.93,  // San Juan               — rural oeste
  '26': 1.06,  // San Pedro de Macorís   — zona franca
  '27': 0.94,  // Sánchez Ramírez        — rural
  '28': 1.10,  // Santiago               — segunda ciudad, fuerte crecimiento
  '29': 0.91,  // Santiago Rodríguez     — rural noroeste
  '30': 0.97,  // Valverde               — agrícola estable
  '31': 0.93,  // San José de Ocoa       — rural montañoso
  '32': 1.18,  // Santo Domingo          — mayor crecimiento RD (suburbanización)
};

// Factor exterior (diáspora crece más rápido que el interior)
var TASA_EXTERIOR_2028 = 0.12;

// ─── Proyección nacional ──────────────────────────────────────────────────────

/**
 * Calcula la tasa de crecimiento compuesta anual (CAGR) del padrón
 * entre dos años usando el histórico disponible.
 *
 * @param {number} desde — año inicio
 * @param {number} hasta — año fin
 * @returns {number} CAGR (fracción)
 */
export function calcCAGR(desde, hasta) {
  var puntoDesde = HISTORICO_NACIONAL.find(function(p) { return p.year === desde; });
  var puntoHasta = HISTORICO_NACIONAL.find(function(p) { return p.year === hasta; });
  if (!puntoDesde || !puntoHasta) return TASA_NACIONAL_2028 / 4;
  var n = hasta - desde;
  return Math.pow(puntoHasta.inscritos / puntoDesde.inscritos, 1 / n) - 1;
}

/**
 * Proyecta el padrón nacional para un año objetivo.
 * Usa TASA_NACIONAL_2028 para 2024→2028 (dato oficial JCE).
 *
 * @param {number} [inscritosBase]  — inscritos base (default: 7,281,764 de 2024)
 * @param {number} [año]            — año destino (default: 2028)
 * @returns {{ inscritos, tasa, fuente }}
 */
export function proyectarNacional(inscritosBase, año) {
  var base = inscritosBase || 7281764;
  var targetYear = año || 2028;
  var ciclos = (targetYear - 2024) / 4; // ciclos electorales de 4 años
  var tasa = TASA_NACIONAL_2028;
  var proyectado = Math.round(base * Math.pow(1 + tasa, ciclos));
  return {
    inscritos: proyectado,
    tasa:      tasa,
    ciclos:    ciclos,
    fuente:    'JCE_proy2028_tasa_' + (tasa * 100).toFixed(2) + 'pct',
  };
}

// ─── Proyección provincial ────────────────────────────────────────────────────

/**
 * Proyecta el padrón de cada provincia para 2028.
 *
 * @param {object[]} rowsPadronProv — rows de padron_2024_unificado.json
 * @param {number}   [año]          — año destino (default 2028)
 * @returns {object} { [provId]: { inscritos, inscritosBefore, factor, tasa } }
 */
export function proyectarProvincial(rowsPadronProv, año) {
  var targetYear = año || 2028;
  var ciclos = (targetYear - 2024) / 4;
  var result = {};

  (rowsPadronProv || []).forEach(function(row) {
    var pid = String(row.provincia_id).padStart(2, '0');
    var factorDif = FACTOR_PROVINCIAL[pid] || 1.0;
    var tasaLocal = TASA_NACIONAL_2028 * factorDif;
    var inscritos2028 = Math.round(row.inscritos * Math.pow(1 + tasaLocal, ciclos));

    result[pid] = {
      provincia_id:    row.provincia_id,
      provincia:       row.provincia,
      inscritos:       inscritos2028,
      inscritosBase:   row.inscritos,
      factorDiferencial: factorDif,
      tasaLocal:       tasaLocal,
      participacionBase: row.participacion_pres,
      abstencionBase:  row.abstencion_pres,
    };
  });

  return result;
}

// ─── Proyección exterior ──────────────────────────────────────────────────────

/**
 * Proyecta el padrón exterior para 2028.
 * Los circuitos de ultramar (C1, C2, C3) crecen a tasa diferenciada.
 *
 * @param {object}   exteriorData — data de padron_2024_exterior.json
 * @param {number}   [año]
 * @returns {{ inscritos, porCirc: { C1, C2, C3 }, tasa }}
 */
export function proyectarExterior(exteriorData, año) {
  var targetYear = año || 2028;
  var ciclos = (targetYear - 2024) / 4;
  var base2024 = 863784; // padron_2024_meta.json

  // Distribución por circuito exterior (JCE 2024)
  // C1: Norteamérica (549,553 inscritos) — mayor comunidad
  // C2: Europa       (164,795)
  // C3: América del Sur/Central (149,436)
  var distrib = { C1: 549553, C2: 164795, C3: 149436 };
  var tasas   = { C1: 0.14, C2: 0.10, C3: 0.08 }; // norteamérica crece más rápido

  if (exteriorData && exteriorData.rows) {
    var totByCirc = { 1: 0, 2: 0, 3: 0 };
    exteriorData.rows.forEach(function(r) {
      totByCirc[r.circ] = (totByCirc[r.circ] || 0) + r.inscritos;
    });
    if (totByCirc[1]) distrib.C1 = totByCirc[1];
    if (totByCirc[2]) distrib.C2 = totByCirc[2];
    if (totByCirc[3]) distrib.C3 = totByCirc[3];
  }

  var porCirc = {};
  var totalExterior = 0;
  ['C1', 'C2', 'C3'].forEach(function(c) {
    var num = parseInt(c.slice(1));
    var t = tasas[c] || TASA_EXTERIOR_2028;
    var proy = Math.round(distrib[c] * Math.pow(1 + t, ciclos));
    porCirc[c] = { inscritos: proy, inscritosBase: distrib[c], tasa: t };
    totalExterior += proy;
  });

  return {
    inscritos: totalExterior,
    inscritosBase: base2024,
    porCirc:   porCirc,
    tasa:      TASA_EXTERIOR_2028,
  };
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Proyecta el padrón completo 2028 (nacional + provincial + exterior).
 * Se llama desde pipeline2028.js.
 *
 * @param {object} ctx — contexto SIE con ctx._padronData (cargado por data.js)
 * @param {number} [año] — default 2028
 * @returns {PadronProyectado}
 */
export function proyectarPadron2028(ctx, año) {
  var targetYear = año || 2028;

  // Obtener datos provinciales desde ctx o fallback a hardcoded
  var rowsProv = [];
  var exteriorData = null;

  if (ctx && ctx._padronUnificado && ctx._padronUnificado.mayo2024) {
    rowsProv = (ctx._padronUnificado.mayo2024.provincial || {}).rows || [];
  }
  if (ctx && ctx._padronExterior) {
    exteriorData = ctx._padronExterior;
  }

  var nacional   = proyectarNacional(null, targetYear);
  var provincial = proyectarProvincial(rowsProv, targetYear);
  var exterior   = proyectarExterior(exteriorData, targetYear);

  // Suma de inscritos provinciales
  var sumaProvincias = Object.values(provincial).reduce(function(a, p) {
    return a + p.inscritos;
  }, 0);

  // Recalibrar nacional para que coincida con suma de provincias + exterior
  var totalCalibrado = sumaProvincias + exterior.inscritos;

  return {
    año:         targetYear,
    nacional:    {
      inscritos:        totalCalibrado,
      inscritosInterior: sumaProvincias,
      inscritosExterior: exterior.inscritos,
      tasa:             nacional.tasa,
      fuente:           nacional.fuente,
    },
    provincial:  provincial,
    exterior:    exterior,
    historico:   HISTORICO_NACIONAL,
    trazabilidad: {
      tasaNacional:     TASA_NACIONAL_2028,
      tasaExterior:     TASA_EXTERIOR_2028,
      sumaProvincias:   sumaProvincias,
      factoresDiferencial: FACTOR_PROVINCIAL,
    },
  };
}

/**
 * @typedef {Object} PadronProyectado
 * @property {number} año
 * @property {{ inscritos, inscritosInterior, inscritosExterior, tasa }} nacional
 * @property {{ [provId]: { provincia, inscritos, factorDiferencial, tasaLocal } }} provincial
 * @property {{ inscritos, porCirc }} exterior
 */

// ─── Utilidades ──────────────────────────────────────────────────────────────

/**
 * Retorna el histórico nacional completo.
 * Útil para visualización de tendencia.
 */
export function getHistoricoNacional() {
  return HISTORICO_NACIONAL.slice();
}

/**
 * Calcula la tasa de participación proyectada para 2028
 * basada en la tendencia histórica de la provincia dada.
 *
 * @param {string}  provId           — '01'–'32'
 * @param {object}  padronProv2024   — row de padron provincial 2024
 * @param {number}  [ajuste]         — ajuste manual (−0.05 a +0.05)
 * @returns {number} tasa de participación proyectada (0-1)
 */
export function proyectarParticipacion(provId, padronProv2024, ajuste) {
  // Participación 2020 vs 2024 — la tendencia nacional fue ligeramente hacia arriba
  // Pero varía mucho por provincia. Usamos la tasa 2024 como base + ajuste.
  var tasaBase = padronProv2024 ? (padronProv2024.participacion_pres || 0.62) : 0.62;

  // Ajuste histórico: 2020→2024 participación nacional subió de 55.1% a 58.5%
  // Proyección conservadora: mantener o +1pp
  var tendencia = 0.01;
  var resultado = tasaBase + tendencia + (ajuste || 0);
  return Math.max(0.30, Math.min(0.85, resultado));
}

export { HISTORICO_NACIONAL, TASA_NACIONAL_2028, FACTOR_PROVINCIAL, TASA_EXTERIOR_2028 };
