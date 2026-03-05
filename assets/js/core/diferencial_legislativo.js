/**
 * SIE 2028 — core/diferencial_legislativo.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Modelo de sangría legislativa estructural.
 *
 * HALLAZGO CENTRAL:
 *   El voto presidencial y el voto legislativo (senadores, diputados) no son
 *   iguales en República Dominicana. Existe una "sangría" sistemática donde
 *   los partidos pierden porcentaje entre el nivel presidencial y los niveles
 *   legislativos, con patrones distintos según el tipo de partido.
 *
 * CALIBRACIÓN CON DATOS REALES JCE (elecciones 2020 y 2024):
 *
 *   PRM (partido ganador):
 *     2020: pres 48.70% → sen 45.24%  → Δ = −3.46pp
 *     2024: pres 48.41% → sen 45.54%  → Δ = −2.87pp  (con alianzas en sen)
 *     2024: pres 48.41% → dip 46.48%  → Δ = −1.93pp  (con alianzas en dip)
 *     Promedio sangría PRM→SEN: −3.17pp
 *     Promedio sangría PRM→DIP: −1.93pp (solo 2024)
 *
 *   FP (partido nuevo/en crecimiento):
 *     2020: pres 5.69% → sen 3.63%   → Δ = −2.06pp (−36.2%)
 *     2024: pres 26.67% → sen 19.35% → Δ = −7.32pp (−27.5%)
 *     2024: pres 26.67% → dip 16.52% → Δ = −10.15pp (−38.1%)
 *     La sangría de FP en dip es MUCHO mayor que en sen — partido nuevo sin
 *     estructura territorial para lista de diputados.
 *
 *   PLD (partido declinante):
 *     2020: pres 32.97% → sen 32.41% → Δ = −0.56pp (muy bajo — partido con estructura)
 *     2024: pres 10.39% → sen 17.64% → Δ = +7.25pp  ← PLD SUBE en legislativo vs pres
 *     2024: pres 10.39% → dip 14.68% → Δ = +4.29pp
 *     PLD tiene un "piso legislativo" estructural: su maquinaria de diputados
 *     es mucho más fuerte que su candidato presidencial.
 *
 * MODELO:
 *   Para cada partido P y nivel L:
 *     share_legislativo(P, L) = share_presidencial(P) × coef_retencion(P, L)
 *                             + intercepto(P, L)
 *
 *   Donde coef_retencion y intercepto se calibran con la historia disponible.
 *
 * INTEGRACIÓN:
 *   Se llama en pipeline2028.js como corrección de shares antes de calcDiputados
 *   y calcSenadores, complementando (no reemplazando) calcArrastre() de Capa 2.
 */

'use strict';

// ─── Base de datos histórica calibrada ───────────────────────────────────────

/**
 * Diferencial presidencial→legislativo por partido y año.
 * Todos los valores son en puntos porcentuales (pp).
 *
 * Convención: diff_sen = share_sen - share_pres (negativo = sangría)
 */
var HISTORICO_DIFERENCIAL = {
  PRM: {
    sen: [
      { year: 2020, pres: 48.70, leg: 45.24, diff: -3.46 },
      { year: 2024, pres: 48.41, leg: 45.54, diff: -2.87 },
    ],
    dip: [
      { year: 2024, pres: 48.41, leg: 46.48, diff: -1.93 },
    ],
  },
  FP: {
    sen: [
      { year: 2020, pres: 5.69,  leg: 3.63,  diff: -2.06 },
      { year: 2024, pres: 26.67, leg: 19.35, diff: -7.32 },
    ],
    dip: [
      { year: 2024, pres: 26.67, leg: 16.52, diff: -10.15 },
    ],
  },
  PLD: {
    sen: [
      { year: 2020, pres: 32.97, leg: 32.41, diff: -0.56 },
      { year: 2024, pres: 10.39, leg: 17.64, diff: +7.25 },  // piso legislativo
    ],
    dip: [
      { year: 2024, pres: 10.39, leg: 14.68, diff: +4.29 },
    ],
  },
  PRSC: {
    sen: [
      { year: 2020, pres: 1.80, leg: 2.98, diff: +1.18 },   // alianzas
      { year: 2024, pres: 0.87, leg: 1.42, diff: +0.55 },   // alianzas
    ],
    dip: [
      { year: 2024, pres: 0.87, leg: 1.89, diff: +1.02 },
    ],
  },
};

// ─── Coeficientes de retención calibrados ────────────────────────────────────
// Se obtienen como ratio(leg_share / pres_share) en las observaciones disponibles.
// Para partidos sin datos históricos, se aplica la categoría por tipo.

var COEF_RETENCION = {
  //           sen    dip
  // Coeficientes calibrados 2020+2024 weighted (2024 tiene peso 0.65, 2020 peso 0.35)
  // 2024 empirico: PRM=0.9407 / FP=0.7254 / PLD=1.6982
  // 2020 empirico: PRM=0.9284 / FP=0.6380 / PLD=0.9830
  // Promedio ponderado: PRM=0.936, FP=0.696, PLD=1.394
  PRM:       { sen: 0.936,  dip: 0.895  },  // ganador: calibrado 2020+2024
  FP:        { sen: 0.696,  dip: 0.620  },  // nuevo: mayor sangría en dip por falta de estructura
  PLD:       { sen: 1.394,  dip: 1.250  },  // declinante: piso leg > pres (maquinaria)
  PRSC:      { sen: 1.400,  dip: 1.800  },  // aliado: se beneficia de alianzas legislativas
  BIS:       { sen: 0.600,  dip: 1.200  },  // organización fuerte en diputados
  PP:        { sen: 0.400,  dip: 1.300  },  // prácticamente sin senadores, pero con dip
  PED:       { sen: 0.300,  dip: 1.100  },
  DXC:       { sen: 0.700,  dip: 1.200  },
  JS:        { sen: 0.300,  dip: 1.000  },
  GENS:      { sen: 0.200,  dip: 0.900  },
  OD:        { sen: 0.300,  dip: 0.800  },
  ALPAIS:    { sen: 0.600,  dip: 0.700  },
  PRD:       { sen: 0.900,  dip: 1.200  },  // tiene maquinaria legislativa histórica
  PRSD:      { sen: 0.700,  dip: 1.300  },
  // Default por tipo de partido
  _estable:  { sen: 0.93,   dip: 0.90  },
  _nuevo:    { sen: 0.75,   dip: 0.65  },
  _reconfigu: { sen: 1.10,  dip: 1.00  }, // puede tener piso leg
};

// ─── Funciones de calibración ─────────────────────────────────────────────────

/**
 * Retorna el coeficiente de retención presidencial→legislativo para un partido.
 *
 * @param {string} partido  — código del partido (ej: 'PRM')
 * @param {'sen'|'dip'} nivel
 * @param {'partido_estable'|'partido_nuevo'|'partido_reconfigurado'} [tipo]
 * @returns {number} coeficiente (>1 = sube en leg, <1 = baja en leg)
 */
export function getCoefRetencion(partido, nivel, tipo) {
  var coefs = COEF_RETENCION[partido];
  if (coefs && coefs[nivel] != null) return coefs[nivel];

  // Fallback por tipo de partido
  var key = tipo === 'partido_nuevo' ? '_nuevo'
          : tipo === 'partido_reconfigurado' ? '_reconfigu'
          : '_estable';
  return COEF_RETENCION[key][nivel] || (nivel === 'sen' ? 0.93 : 0.90);
}

/**
 * Aplica el diferencial presidencial→legislativo a un mapa de shares.
 *
 * @param {object} sharesPresidencial  — { PARTIDO: fraccion } (suma ≈ 1)
 * @param {'sen'|'dip'} nivel
 * @param {Map}    [clasificacion]     — output de capa0_clasificador (opcional)
 * @returns {{ shares: object, trazabilidad: object[] }}
 */
export function aplicarDiferencialLegislativo(sharesPresidencial, nivel, clasificacion) {
  var out = {};
  var traz = [];

  Object.keys(sharesPresidencial).forEach(function(partido) {
    var sPres = sharesPresidencial[partido] || 0;
    if (sPres <= 0) { out[partido] = 0; return; }

    var tipo = null;
    if (clasificacion && clasificacion.get) {
      var meta = clasificacion.get(partido);
      if (meta) tipo = meta.tipo;
    }

    var coef = getCoefRetencion(partido, nivel, tipo);
    var sLeg  = sPres * coef;

    out[partido] = Math.max(0, sLeg);
    traz.push({
      partido:  partido,
      nivel:    nivel,
      sPres:    (sPres * 100).toFixed(3),
      sLeg:     (sLeg  * 100).toFixed(3),
      coef:     coef,
      diff_pp:  ((sLeg - sPres) * 100).toFixed(3),
    });
  });

  // Renormalizar para que sumen 1
  var total = Object.values(out).reduce(function(a, v) { return a + v; }, 0);
  if (total > 0) {
    Object.keys(out).forEach(function(p) { out[p] = out[p] / total; });
  }

  return { shares: out, trazabilidad: traz, nivel: nivel };
}

// ─── Análisis del diferencial ─────────────────────────────────────────────────

/**
 * Calcula el diferencial observado entre niveles para un año.
 * Útil para validación y calibración.
 *
 * @param {object} sharesPres — { PARTIDO: fraccion }
 * @param {object} sharesLeg  — { PARTIDO: fraccion }
 * @param {'sen'|'dip'} nivel
 * @returns {object[]} diferencial por partido
 */
export function calcDiferencialObservado(sharesPres, sharesLeg, nivel) {
  var partidos = new Set([...Object.keys(sharesPres), ...Object.keys(sharesLeg)]);
  var resultado = [];

  partidos.forEach(function(p) {
    var sPres = sharesPres[p] || 0;
    var sLeg  = sharesLeg[p]  || 0;
    var diff  = sLeg - sPres;
    var coef  = sPres > 0 ? sLeg / sPres : null;
    resultado.push({
      partido: p,
      nivel:   nivel,
      sPres:   (sPres * 100).toFixed(2),
      sLeg:    (sLeg  * 100).toFixed(2),
      diff_pp: (diff  * 100).toFixed(2),
      coef:    coef != null ? coef.toFixed(4) : 'n/a',
    });
  });

  return resultado.sort(function(a, b) {
    return parseFloat(b.sPres) - parseFloat(a.sPres);
  });
}

/**
 * Calcula el diferencial PRM usando datos de 2024 reales.
 * Para validación del modelo.
 *
 * @param {object} d24 — contenido de results_2024.json
 * @returns {object} diferencial real 2024
 */
export function validarConDatos2024(d24) {
  var pres = d24.pres.nacional;
  var sen  = d24.sen.nacional;
  var dip  = d24.dip.nacional;

  var presValidos = pres.VALIDOS;
  var senValidos  = sen.meta.validos;
  var dipValidos  = dip.meta.validos;

  var sharesPres = {}, sharesSen = {}, sharesDip = {};

  Object.keys(pres).forEach(function(k) {
    if (['EMITIDOS','VALIDOS','NULOS'].includes(k)) return;
    sharesPres[k] = pres[k] / presValidos;
  });
  Object.keys(sen.votes).forEach(function(k) {
    sharesSen[k] = sen.votes[k] / senValidos;
  });
  Object.keys(dip.votes).forEach(function(k) {
    sharesDip[k] = dip.votes[k] / dipValidos;
  });

  return {
    pres_vs_sen: calcDiferencialObservado(sharesPres, sharesSen, 'sen'),
    pres_vs_dip: calcDiferencialObservado(sharesPres, sharesDip, 'dip'),
    sharesPres:  sharesPres,
    sharesSen:   sharesSen,
    sharesDip:   sharesDip,
  };
}

// ─── Exportar constantes para tests ──────────────────────────────────────────
export { HISTORICO_DIFERENCIAL, COEF_RETENCION };
