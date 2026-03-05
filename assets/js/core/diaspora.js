/**
 * SIE 2028 — core/diaspora.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Modelo de voto diáspora (exterior).
 *
 * CONTEXTO:
 *   La República Dominicana tiene 3 circunscripciones de diputados en el exterior
 *   y voto presidencial en el exterior. En 2024:
 *
 *   PADRÓN EXTERIOR 2024:
 *     C1 (Norteamérica):   549,553 inscritos  — 99,140 emitidos (18.0%)
 *     C2 (Europa):         164,795 inscritos  — 31,415 emitidos (19.1%)
 *     C3 (Latinoamérica):  149,436 inscritos  — 37,079 emitidos (24.8%)
 *     Total:               863,784 inscritos  — 167,634 emitidos (19.4%)
 *
 *   DISTRIBUCIÓN PRESIDENCIAL EXTERIOR 2024 (cálculo desde provincias 61-72):
 *     PRM:  57.60%  FP: 17.67%  PLD: 6.75%  PED: 6.08%
 *
 *   NOTA: La participación exterior (~19%) es MUCHO menor que la interior (~58%).
 *   El voto exterior es desproporcionadamente favorable a PRM.
 *
 *   DIPUTADOS EXTERIOR: Los datos de votos por partido están VACÍOS en el JSON
 *   (votes: {} en C1, C2, C3). Se construye un modelo basado en las tendencias
 *   presidenciales con diferencial legislativo aplicado.
 *
 * PROYECCIÓN 2028:
 *   - Padrón crece ~12% (diáspora en expansión)
 *   - Participación puede subir levemente si hay voto electrónico
 *   - PRM sigue dominando exterior pero FP crece (comunidades más jóvenes)
 */

'use strict';

// ─── Constantes calibradas con datos JCE 2024 ────────────────────────────────

var EXTERIOR_2024 = {
  C1: {
    nombre:        'Norteamérica (EEUU, Canadá)',
    inscritos:     549553,
    emitidos:      99140,
    participacion: 0.1804,
    diputados:     3,
  },
  C2: {
    nombre:        'Europa (España, Italia, etc.)',
    inscritos:     164795,
    emitidos:      31415,
    participacion: 0.1906,
    diputados:     2,
  },
  C3: {
    nombre:        'América Latina y otros',
    inscritos:     149436,
    emitidos:      37079,
    participacion: 0.2481,
    diputados:     2,
  },
};

// Distribución del voto presidencial exterior 2024 (calculado de provincias 61-72)
var PRES_EXTERIOR_2024 = {
  PRM:    0.5760,
  FP:     0.1767,
  PLD:    0.0675,
  PED:    0.0608,
  BIS:    0.0123,
  PRSC:   0.0077,
  DXC:    0.0060,
  otros:  0.0930,
};

// Total diputados exterior: 7 (3+2+2)
var DIPUTADOS_EXTERIOR_TOTAL = 7;

// ─── Diferencial presidencial→diputados exterior ─────────────────────────────
// El exterior tiene características especiales:
// - Mayor concentración PRM (emigración histórica peledeísta/reformista)
// - FP fuerte en C1 (comunidades jóvenes NY/NJ)
// - PLD más fuerte en C2 (migración de clase media profesional)
// Coeficientes diferencial pres→dip exterior (calibrados por analogía con interior)
var COEF_EXTERIOR_DIP = {
  PRM:  0.88,   // ligeramente menor (aliados no transfieren igual en exterior)
  FP:   0.90,   // relativamente fuerte en C1
  PLD:  1.30,   // piso legislativo fuerte — emigración clase media peledeísta
  PED:  0.60,   // sin estructura exterior
  BIS:  0.50,
  PRSC: 1.20,   // aliado histórico exterior
  DXC:  0.80,
  _default: 0.75,
};

// Distribución por circuito (C1/C2/C3) del voto de cada partido
// PRM más fuerte en C1 (NYC/NJ comunidad consolidada)
// FP más fuerte en C1 (generación joven)
// PLD más fuerte en C2 (migración española profesional)
var DISTRIB_POR_CIRC = {
  PRM: { C1: 0.65, C2: 0.18, C3: 0.17 },
  FP:  { C1: 0.68, C2: 0.17, C3: 0.15 },
  PLD: { C1: 0.45, C2: 0.35, C3: 0.20 },
  PED: { C1: 0.60, C2: 0.20, C3: 0.20 },
  _default: { C1: 0.60, C2: 0.22, C3: 0.18 },
};

// ─── Proyección padrón exterior 2028 ─────────────────────────────────────────

/**
 * Proyecta padrón y participación exterior para 2028.
 *
 * @param {object} [exteriorData] — datos de padron_2024_exterior.json (opcional)
 * @param {object} [params]
 * @param {number}  params.tasaCrecimiento — default +12% por ciclo (4 años)
 * @param {number}  params.ajusteParticipacion — ajuste manual (−0.05 a +0.05)
 * @returns {object} proyección por circuito
 */
export function proyectarPadronExterior(exteriorData, params) {
  var p = params || {};
  var tasa = p.tasaCrecimiento != null ? p.tasaCrecimiento : 0.12;
  var ajPart = p.ajusteParticipacion || 0;

  var circs = {};
  var totalInscritos = 0;
  var totalEmitidos  = 0;

  ['C1', 'C2', 'C3'].forEach(function(c) {
    var base = EXTERIOR_2024[c];
    var inscr = Math.round(base.inscritos * (1 + tasa));
    var partBase = base.participacion;

    // C1 puede subir más si hay vote-by-mail expandido
    var tendPart = c === 'C1' ? 0.02 : 0.01;
    var part = Math.max(0.15, Math.min(0.50, partBase + tendPart + ajPart));
    var emit = Math.round(inscr * part);

    circs[c] = {
      nombre:          base.nombre,
      inscritos:       inscr,
      inscritosBase:   base.inscritos,
      participacion:   part,
      participacionBase: base.participacion,
      emitidos:        emit,
      diputados:       base.diputados,
    };
    totalInscritos += inscr;
    totalEmitidos  += emit;
  });

  return {
    circs:         circs,
    inscritos:     totalInscritos,
    emitidos:      totalEmitidos,
    participacion: totalEmitidos / totalInscritos,
    diputados:     DIPUTADOS_EXTERIOR_TOTAL,
  };
}

// ─── Proyección del voto exterior 2028 ───────────────────────────────────────

/**
 * Proyecta las shares del voto presidencial en el exterior para 2028.
 * Se basa en la tendencia 2024 con ajustes de crecimiento por partido.
 *
 * @param {object} sharesPresNacional — shares presidenciales nacionales 2028
 * @param {object} [params]
 * @param {number}  params.factorConvergencia — cuánto converge exterior hacia interior (0-1)
 * @returns {object} shares proyectadas exterior
 */
export function proyectarVotoExteriorPres(sharesPresNacional, params) {
  var p = params || {};
  // El exterior tiende a converger hacia el interior lentamente
  var conv = p.factorConvergencia != null ? p.factorConvergencia : 0.30;

  var sharesExt = {};
  var partidos = new Set([
    ...Object.keys(PRES_EXTERIOR_2024),
    ...Object.keys(sharesPresNacional || {}),
  ]);

  partidos.forEach(function(partido) {
    if (partido === 'otros') return;
    var base2024 = PRES_EXTERIOR_2024[partido] || 0;
    var interior  = sharesPresNacional ? (sharesPresNacional[partido] || 0) : 0;
    // Convergencia parcial hacia interior
    sharesExt[partido] = base2024 * (1 - conv) + interior * conv;
  });

  // Renormalizar
  var total = Object.values(sharesExt).reduce(function(a, v) { return a + v; }, 0);
  if (total > 0) {
    Object.keys(sharesExt).forEach(function(p2) {
      sharesExt[p2] = sharesExt[p2] / total;
    });
  }

  return sharesExt;
}

/**
 * Calcula los votos presidenciales del exterior para 2028.
 *
 * @param {object} sharesExt   — shares proyectadas exterior
 * @param {number} emitidos    — total emitidos exterior proyectados
 * @returns {object} { PARTIDO: votos }
 */
export function calcVotosExteriorPres(sharesExt, emitidos) {
  var out = {};
  Object.keys(sharesExt).forEach(function(p) {
    out[p] = Math.round(sharesExt[p] * emitidos);
  });
  return out;
}

// ─── Modelo diputados exterior (D'Hondt) ─────────────────────────────────────

/**
 * Proyecta los votos por partido para cada circuito de diputados exterior.
 * Aplica coeficiente diferencial pres→dip sobre las shares presidenciales.
 *
 * @param {object} sharesPresExt — shares presidenciales en exterior
 * @param {object} padronExt     — output de proyectarPadronExterior()
 * @returns {object} { C1: {votes}, C2: {votes}, C3: {votes} }
 */
export function proyectarDiputadosExterior(sharesPresExt, padronExt) {
  var out = {};

  ['C1', 'C2', 'C3'].forEach(function(c) {
    var circData = padronExt.circs[c];
    var emitidos = circData.emitidos;
    var circFrac = circData.inscritos / padronExt.inscritos;

    var votes = {};
    var total = 0;

    Object.keys(sharesPresExt).forEach(function(partido) {
      var sPres = sharesPresExt[partido] || 0;
      if (sPres <= 0) return;

      // Coeficiente diferencial pres→dip
      var coefDip = COEF_EXTERIOR_DIP[partido] || COEF_EXTERIOR_DIP._default;

      // Distribución por circuito
      var distribCirc = DISTRIB_POR_CIRC[partido] || DISTRIB_POR_CIRC._default;
      var fracCirc = distribCirc[c] || (1 / 3);

      // Ajuste: los votos de este partido en este circuito
      var sCirc = sPres * coefDip * (fracCirc / circFrac);
      votes[partido] = Math.max(0, sCirc);
      total += votes[partido];
    });

    // Convertir a votos absolutos
    if (total > 0) {
      Object.keys(votes).forEach(function(p) {
        votes[p] = Math.round((votes[p] / total) * emitidos);
      });
    }

    out[c] = {
      nombre:   circData.nombre,
      emitidos: emitidos,
      seats:    circData.diputados,
      votes:    votes,
    };
  });

  return out;
}

// ─── Análisis del voto exterior ───────────────────────────────────────────────

/**
 * Compara el voto exterior vs interior para un partido.
 * Muestra el "bono exterior" que tiene PRM.
 *
 * @param {object} sharesInterior — shares presidenciales interior
 * @param {object} [sharesExt]    — shares exterior (default 2024)
 * @returns {object[]} análisis por partido
 */
export function analizarBonoExterior(sharesInterior, sharesExt) {
  var ext = sharesExt || PRES_EXTERIOR_2024;
  var partidos = new Set([...Object.keys(sharesInterior), ...Object.keys(ext)]);
  var resultado = [];

  partidos.forEach(function(p) {
    if (p === 'otros') return;
    var sInt = sharesInterior[p] || 0;
    var sExt = ext[p] || 0;
    resultado.push({
      partido:       p,
      interior_pct:  (sInt * 100).toFixed(2),
      exterior_pct:  (sExt * 100).toFixed(2),
      bono_pp:       ((sExt - sInt) * 100).toFixed(2),
      ratio:         sInt > 0 ? (sExt / sInt).toFixed(3) : 'n/a',
    });
  });

  return resultado.sort(function(a, b) {
    return parseFloat(b.interior_pct) - parseFloat(a.interior_pct);
  });
}

/**
 * Calcula el impacto del voto exterior sobre el resultado nacional.
 * Cuántos pp aporta el exterior al total presidencial de cada partido.
 *
 * @param {object} votosInterior — { PARTIDO: votos } interior
 * @param {object} votosExterior — { PARTIDO: votos } exterior
 * @returns {object[]} impacto por partido
 */
export function calcImpactoExterior(votosInterior, votosExterior) {
  var totalInt = Object.values(votosInterior).reduce(function(a,v){return a+v;},0);
  var totalExt = Object.values(votosExterior).reduce(function(a,v){return a+v;},0);
  var totalNac = totalInt + totalExt;
  var resultado = [];

  var partidos = new Set([...Object.keys(votosInterior), ...Object.keys(votosExterior)]);
  partidos.forEach(function(p) {
    var vInt = votosInterior[p] || 0;
    var vExt = votosExterior[p] || 0;
    var vNac = vInt + vExt;
    resultado.push({
      partido:       p,
      votos_int:     vInt,
      votos_ext:     vExt,
      votos_nac:     vNac,
      share_int:     totalInt > 0 ? (vInt/totalInt*100).toFixed(2) : '0',
      share_ext:     totalExt > 0 ? (vExt/totalExt*100).toFixed(2) : '0',
      share_nac:     totalNac > 0 ? (vNac/totalNac*100).toFixed(2) : '0',
      aporte_ext_pp: totalNac > 0 ? (vExt/totalNac*100).toFixed(3) : '0',
    });
  });

  return resultado.sort(function(a,b) {
    return parseFloat(b.share_nac) - parseFloat(a.share_nac);
  });
}

// ─── Exportar constantes ──────────────────────────────────────────────────────
export {
  EXTERIOR_2024,
  PRES_EXTERIOR_2024,
  DIPUTADOS_EXTERIOR_TOTAL,
  COEF_EXTERIOR_DIP,
};
