/**
 * SIE 2028  core/potencial.js  v8.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Motor de Score de Potencial Electoral
 * Modelo: Competitiveness-Opportunity Index
 * Ref: MIT Election Lab, LAPOP Electoral Competitiveness Index, Pacheco-Vega 2020
 *
 * CORRECCIÓN FP/NUEVOS ACTORES:
 *   La Fuerza del Pueblo (FP) creció ~200% entre 2020 y 2024 como efecto
 *   de la escisión del PLD. En 2020 obtuvo ~7%; en 2024 ~22%.
 *   Usar la tendencia 2020→2024 para proyectar 2028 sobreestima el potencial
 *   de crecimiento porque ya no hay el mismo "shock de fundación".
 *   El PLD en 2020 era la suma de FP+PLD actuales (~34%), pero ese bloque
 *   se dividió. La referencia correcta para FP en 2028 es:
 *     - Base 2024 como punto de partida (no 2020)
 *     - Tendencia local = desempeño local relativo a su promedio nacional 2024
 *     - NO usar ratio pct_2024/pct_2020 como predictor
 *
 * CRITERIO DE PP EN ESTE MOTOR:
 *   Tendencia = pct_2024 − pct_2020 (diferencia aritmética, en pp)
 *   Si pct_2020 no es confiable (nuevo actor), se usa comparación
 *   local vs nacional en 2024 (mayor que media = territorio favorable).
 *
 * COMPONENTES (pesos calibrados con análisis JCE 2004-2024):
 *   Margen competitivo (35): posición relativa al rival directo
 *   Reserva de abstención (25): pool de votos no activados
 *   Potencial de conversión (20): base × reserva (territorio con base Y pool)
 *   Tamaño del territorio (10): eficiencia de recursos de campaña
 *   Tendencia ajustada (10): histórico confiable o arraigo relativo
 */
import { rankVotes } from "./utils.js";

export var WEIGHTS_DEFAULT = {
  margen:      35,
  abstencion:  25,
  conversion:  20,
  padron:      10,
  tendencia:   10,
};

export var CATEGORIAS = [
  { min: 70, label: "Fortaleza",      cls: "cat-green"  },
  { min: 55, label: "Oportunidad",    cls: "cat-lgreen" },
  { min: 45, label: "Disputa",        cls: "cat-yellow" },
  { min: 35, label: "Crecimiento",    cls: "cat-blue"   },
  { min: 20, label: "Adverso",        cls: "cat-red"    },
  { min:  0, label: "Baja prioridad", cls: "cat-gray"   },
];

export function getCategoria(score) {
  for (var i = 0; i < CATEGORIAS.length; i++) {
    if (score >= CATEGORIAS[i].min) return CATEGORIAS[i];
  }
  return CATEGORIAS[CATEGORIAS.length - 1];
}

function clampN(x, a, b) { return Math.max(a, Math.min(b, x)); }

/**
 * Detecta si un partido es "nuevo actor" (crecimiento >80% en un ciclo).
 * Para FP: pasó de ~7% a ~22% = +214% → es nuevo actor.
 * En ese caso, la tendencia 2020→2024 NO es predictor válido para 2028.
 */
function isNewActor(pct24, pct20) {
  if (pct20 === null || pct20 === 0) return true;
  var growth = (pct24 - pct20) / pct20;
  return growth > 0.80;
}

function scoreOne(t24, t20, lider, maxPadron, weights, natPct24, natPct20) {
  var ins24   = t24.inscritos || 0;
  var em24    = t24.emitidos  || 0;
  var votes24 = t24.votes     || {};
  var votes20 = t20 ? (t20.votes || {}) : {};
  var em20    = t20 ? (t20.emitidos || 0) : 0;

  var ranked24 = rankVotes(votes24, em24 || 1);
  var ranked20 = rankVotes(votes20, em20 || 1);
  var e24  = ranked24.filter(function(r) { return r.p === lider; })[0];
  var e20  = ranked20.filter(function(r) { return r.p === lider; })[0];
  var pct24 = e24 ? e24.pct : 0;
  var pct20 = (e20 && em20 > 0) ? e20.pct : null;

  // Detección de nuevo actor a nivel nacional
  var natIsNewActor = (natPct20 !== null && natPct20 > 0)
    ? isNewActor(natPct24 || 0, natPct20 || 0)
    : (natPct20 === 0 || natPct20 === null);

  var tend = 0;
  if (!natIsNewActor && pct20 !== null) {
    // Partido establecido: tendencia en pp (aritmética directa)
    tend = pct24 - pct20;
  } else {
    // Nuevo actor (ej: FP): diferencia local vs media nacional 2024
    // Positivo = este territorio está por encima de su media → señal de arraigo
    tend = natPct24 > 0 ? (pct24 - natPct24) : 0;
  }

  // 1. Margen competitivo
  var margen = 0;
  if (ranked24.length >= 2) {
    var lEntry = ranked24.filter(function(r) { return r.p === lider; })[0];
    var top1   = ranked24[0];
    if (lEntry) {
      var opponentPct = (lider === top1.p) ? ranked24[1].pct : top1.pct;
      margen = lEntry.pct - opponentPct;
    } else {
      margen = -top1.pct;
    }
  }

  // 2. Reserva de abstención
  var abst24 = ins24 > 0 ? 1 - em24 / ins24 : 0;

  // 3. Potencial de conversión (nuevo) — base × reserva
  var conversion = pct24 * abst24;

  // Scores 0-1
  var margenScore    = clampN(0.5 + margen * 2.5, 0, 1);
  var abstScore      = clampN(abst24 / 0.55, 0, 1);
  var conversionScore = clampN(conversion / 0.16, 0, 1);
  var padronScore    = maxPadron > 0 ? ins24 / maxPadron : 0;
  var tendScore      = clampN(0.5 + tend * (natIsNewActor ? 3 : 4), 0, 1);

  var w      = weights || WEIGHTS_DEFAULT;
  var maxRaw = w.margen + w.abstencion + w.conversion + w.padron + w.tendencia;
  var raw    =
    margenScore     * w.margen     +
    abstScore       * w.abstencion +
    conversionScore * w.conversion +
    padronScore     * w.padron     +
    tendScore       * w.tendencia;

  var score    = clampN(Math.round((raw / maxRaw) * 100), 0, 100);
  var segundo  = ranked24[0] && ranked24[0].p === lider
    ? (ranked24[1] ? ranked24[1] : null)
    : (ranked24[0] ? ranked24[0] : null);

  return {
    score: score, tendencia: tend,
    tendConfiable: !natIsNewActor, natIsNewActor: natIsNewActor,
    abst: abst24, margen: margen, conversion: conversion, padron: ins24,
    pct24: pct24, pct20: pct20,
    segundo: segundo ? segundo.p : null, pctSegundo: segundo ? segundo.pct : 0,
    categoria: getCategoria(score),
  };
}

export function calcPotencial(ctx, nivel, lider, weights) {
  if (!ctx || !ctx.r || !ctx.r[2024]) return [];
  var lv24 = (ctx.r[2024] && ctx.r[2024][nivel]) ? ctx.r[2024][nivel] : {};
  var lv20 = (ctx.r[2020] && ctx.r[2020][nivel]) ? ctx.r[2020][nivel] : {};

  var nat24 = lv24.nacional || {};
  var nat20 = lv20.nacional || {};
  var natVotes24 = nat24.votes || {};
  var natVotes20 = nat20.votes || {};
  var natEm24    = nat24.emitidos || 1;
  var natEm20    = nat20.emitidos || 1;
  var natPct24   = natVotes24[lider] ? natVotes24[lider] / natEm24 : 0;
  var natPct20   = natVotes20[lider] !== undefined ? natVotes20[lider] / natEm20 : null;

  var terr24, terr20;
  if (nivel === "mun") { terr24 = lv24.mun || {}; terr20 = lv20.mun || {}; }
  else if (nivel === "dm") { terr24 = lv24.dm || {}; terr20 = lv20.dm || {}; }
  else {
    terr24 = lv24.prov || {};
    terr20 = lv20.prov || {};
    if (nivel === "pres") {
      var sen24prov = (ctx.r[2024] && ctx.r[2024].sen) ? (ctx.r[2024].sen.prov || {}) : {};
      var enriched  = {};
      Object.keys(terr24).forEach(function(id) {
        var t = Object.assign({}, terr24[id]);
        if (!t.inscritos && sen24prov[id]) t.inscritos = sen24prov[id].inscritos;
        enriched[id] = t;
      });
      terr24 = enriched;
    }
  }

  if (!Object.keys(terr24).length) return [];
  var maxPadron = Math.max.apply(null,
    Object.values(terr24).map(function(t) { return t.inscritos || 0; }).concat([1])
  );

  return Object.keys(terr24)
    .filter(function(id) {
      if (nivel === "pres" || nivel === "sen" || nivel === "dip") {
        var n = parseInt(id, 10);
        return n >= 1 && n <= 32;
      }
      return true;
    })
    .map(function(id) {
      var t24 = terr24[id];
      var t20 = terr20 ? terr20[id] : null;
      if (!t24 || !t24.votes || Object.keys(t24.votes).length === 0) return null;
      var s = scoreOne(t24, t20, lider, maxPadron, weights, natPct24, natPct20);
      return Object.assign({ id: id, nombre: t24.nombre || id }, s);
    })
    .filter(Boolean)
    .sort(function(a, b) { return b.score - a.score; });
}
