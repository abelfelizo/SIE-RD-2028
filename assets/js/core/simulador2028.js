/**
 * SIE 2028 — core/simulador2028.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Motor de simulación estratégica 2028.
 *
 * RESPONSABILIDAD:
 *   Permite modificar alianzas, abstención y swing territorial y recalcular
 *   resultados electorales completos en tiempo real.
 *
 * ARQUITECTURA:
 *   Recibe un "escenario" con modificaciones sobre el baseline 2028 y devuelve
 *   resultados para presidencial, senado y cámara de diputados.
 *
 * USO:
 *   import { simular } from './simulador2028.js';
 *
 *   const resultado = simular(ctx, {
 *     alianzas: [
 *       { nivel: 'sen', territorio: '28', lider: 'FP', aliados: ['PLD','BIS'] }
 *     ],
 *     abstención: { global: +0.05, provincias: { '01': -0.03 } },
 *     swing: { FP: +0.03, PLD: -0.02 },
 *   });
 */

'use strict';

import { construirAlianza, aplicarAlianzas, aplicarBloques } from './alianzas.js';
import { aplicarDiferencialLegislativo }                     from './diferencial_legislativo.js';
import { dhondtFull }                                        from './dhondt_engine.js';
import { renormalizarCtx }                                   from './renormalizar_votos.js';

// ─── Constantes baseline ─────────────────────────────────────────────────────

var RETENCION = { sen: 0.9254, dip: 0.8955 };

// ─── Aplicar swing territorial ────────────────────────────────────────────────

/**
 * Aplica ajustes de swing a shares por partido.
 * swing = { PARTIDO: delta_fracción } (positivo = crece, negativo = cae)
 * Los ajustes se compensan entre los demás partidos proporcionalmente.
 *
 * @param {object} shares  — { PARTIDO: fraccion }
 * @param {object} swing   — { PARTIDO: delta }
 * @returns {object} shares ajustadas y renormalizadas
 */
export function aplicarSwing(shares, swing) {
  if (!swing || !Object.keys(swing).length) return Object.assign({}, shares);

  var out = Object.assign({}, shares);

  // Aplicar deltas directamente
  Object.keys(swing).forEach(function(p) {
    var delta = swing[p] || 0;
    out[p] = Math.max(0, (out[p] || 0) + delta);
  });

  // Renormalizar
  var total = Object.values(out).reduce(function(a, v) { return a + v; }, 0);
  if (total > 0) {
    Object.keys(out).forEach(function(p) { out[p] = out[p] / total; });
  }
  return out;
}

/**
 * Aplica swing diferencial por provincia.
 *
 * @param {object} swingProv — { provId: { PARTIDO: delta } }
 * @param {object} sharesProv — { provId: { PARTIDO: fraccion } }
 * @returns {object} shares por provincia con swing aplicado
 */
export function aplicarSwingTerritorial(swingProv, sharesProv) {
  if (!swingProv || !sharesProv) return sharesProv || {};
  var out = {};
  Object.keys(sharesProv).forEach(function(pid) {
    var swLocal = swingProv[pid] || swingProv['global'] || {};
    out[pid] = aplicarSwing(sharesProv[pid] || {}, swLocal);
  });
  return out;
}

// ─── Ajuste de abstención ─────────────────────────────────────────────────────

/**
 * Ajusta el número de emitidos según cambio de abstención.
 * Un aumento de participación amplifica los votos de todos los partidos.
 * El ajuste de participación puede beneficiar diferencialmente a PRM
 * (movilización GOTV) o a FP (voto joven) según el parámetro beneficiario.
 *
 * @param {object} votes        — { PARTIDO: votos }
 * @param {number} participacion — tasa actual (0-1)
 * @param {number} delta        — cambio de participación (+0.05 = +5pp)
 * @param {object} [favoreceA]  — { PARTIDO: fraccion_extra } de los nuevos votos
 * @returns {{ votes, emitidosNuevos, delta }}
 */
export function ajustarAbstencion(votes, participacion, inscritos, delta, favoreceA) {
  if (!delta || !inscritos) return { votes: Object.assign({}, votes), emitidosNuevos: 0 };

  var emitidosActual = Math.round(inscritos * participacion);
  var partNueva      = Math.max(0.15, Math.min(0.90, participacion + delta));
  var emitidosNuevos = Math.round(inscritos * partNueva) - emitidosActual;

  if (emitidosNuevos === 0) return { votes: Object.assign({}, votes), emitidosNuevos: 0 };

  var out = Object.assign({}, votes);

  if (emitidosNuevos > 0 && favoreceA && Object.keys(favoreceA).length) {
    // Los nuevos votantes se distribuyen según favoreceA
    var totalFav = Object.values(favoreceA).reduce(function(a, v) { return a + v; }, 0);
    Object.keys(favoreceA).forEach(function(p) {
      var extra = Math.round(emitidosNuevos * (favoreceA[p] / totalFav));
      out[p] = (out[p] || 0) + extra;
    });
  } else {
    // Los nuevos votos se distribuyen proporcionalmente
    var totalVotos = Object.values(out).reduce(function(a, v) { return a + v; }, 0);
    if (totalVotos > 0) {
      Object.keys(out).forEach(function(p) {
        out[p] = Math.round(out[p] * (1 + emitidosNuevos / totalVotos));
      });
    }
  }

  return { votes: out, emitidosNuevos: emitidosNuevos, participacionNueva: partNueva };
}

// ─── Función principal de simulación ──────────────────────────────────────────

/**
 * Ejecuta una simulación estratégica completa.
 *
 * @param {object} baselineShares — shares base del pipeline 2028
 *   {
 *     pres: { nacional: { shares, votos, validos } },
 *     sen:  { nacional: { shares }, prov: { [id]: { shares, votes, inscritos } } },
 *     dip:  { circ: { [key]: { votes, seats } }, nacionales: { votes, seats } },
 *   }
 * @param {object} escenario
 *   {
 *     alianzas: [ { nivel, territorio, lider, aliados, transferPct } ],
 *     swing:    { PARTIDO: delta } | { global: {...}, territorial: { provId: {...} } },
 *     abstencion: { global: delta, provincias: { provId: delta }, favoreceA: {...} },
 *     padron:   { [provId]: inscritos }   — padrón proyectado
 *   }
 * @returns {SimulacionResult}
 */
export function simular(baselineShares, escenario) {
  var esc = escenario || {};
  var cfg = {};

  // 1. Construir config de alianzas
  if (esc.alianzas && esc.alianzas.length) {
    cfg.alianzas = construirAlianza(esc.alianzas);
  }

  // 2. Swing global
  var swingGlobal = {};
  var swingTerr   = {};
  if (esc.swing) {
    if (esc.swing.global) {
      swingGlobal = esc.swing.global;
    } else if (esc.swing.territorial) {
      swingTerr = esc.swing.territorial;
    } else {
      // Objeto plano = swing global
      swingGlobal = esc.swing;
    }
  }

  var resultado = {
    escenario: esc,
    pres:      null,
    sen:       null,
    dip:       null,
    trazabilidad: [],
  };

  // ── PRESIDENCIAL ──
  var sharesPres = Object.assign({}, baselineShares.pres && baselineShares.pres.shares || {});

  // Aplicar alianzas presidenciales
  if (cfg.alianzas && cfg.alianzas.pres) {
    sharesPres = aplicarBloques(sharesPres, cfg.alianzas.pres);
  }

  // Aplicar swing presidencial
  if (Object.keys(swingGlobal).length) {
    sharesPres = aplicarSwing(sharesPres, swingGlobal);
  }

  var validosPres = (baselineShares.pres && baselineShares.pres.validos) || 4500000;
  var votosPres   = {};
  Object.keys(sharesPres).forEach(function(p) {
    votosPres[p] = Math.round(sharesPres[p] * validosPres);
  });

  var prmPct    = sharesPres.PRM || 0;
  var maxNosPRM = Math.max.apply(null,
    Object.entries(sharesPres).filter(function(e) { return e[0] !== 'PRM'; }).map(function(e) { return e[1]; })
  );

  resultado.pres = {
    shares:       sharesPres,
    votos:        votosPres,
    ganador:      Object.entries(sharesPres).sort(function(a,b){return b[1]-a[1];})[0][0],
    primeraVuelta: prmPct > 0.50,
    margen12:     ((prmPct - maxNosPRM) * 100).toFixed(2) + 'pp',
  };

  // ── SENADORES ──
  var senResultados = {};
  var senByParty    = {};
  var provSen       = (baselineShares.sen && baselineShares.sen.prov) || {};

  Object.keys(provSen).forEach(function(pid) {
    var provData = provSen[pid] || {};
    var votes    = Object.assign({}, provData.votes || {});

    // Aplicar alianzas senatoriales por provincia
    if (cfg.alianzas) {
      votes = aplicarAlianzas(votes, 'sen', pid, cfg.alianzas);
    }

    // Aplicar swing territorial si hay
    var swLocal = swingTerr[pid] || swingGlobal;
    if (Object.keys(swLocal).length) {
      var total = Object.values(votes).reduce(function(a,v){return a+v;},0);
      if (total > 0) {
        var sharesTmp = {};
        Object.keys(votes).forEach(function(p){ sharesTmp[p] = votes[p]/total; });
        sharesTmp = aplicarSwing(sharesTmp, swLocal);
        Object.keys(votes).forEach(function(p){ votes[p] = Math.round(sharesTmp[p] * total); });
      }
    }

    // Ajustar abstención si aplica
    if (esc.abstencion) {
      var deltaAbs = (esc.abstencion.provincias && esc.abstencion.provincias[pid]) ||
                     esc.abstencion.global || 0;
      if (deltaAbs) {
        var ins = (provData.inscritos) || 200000;
        var part = (provData.participacion) || 0.60;
        var adjResult = ajustarAbstencion(votes, part, ins, deltaAbs, esc.abstencion.favoreceA);
        votes = adjResult.votes;
      }
    }

    // Ganador por pluralidad
    var sorted = Object.entries(votes).sort(function(a,b){return b[1]-a[1];});
    var ganador = sorted[0] ? sorted[0][0] : null;
    if (ganador) {
      senByParty[ganador] = (senByParty[ganador] || 0) + 1;
    }
    var totalSen = Object.values(votes).reduce(function(a,v){return a+v;},0);
    senResultados[pid] = {
      ganador:      ganador,
      votos_ganador: sorted[0] ? sorted[0][1] : 0,
      margen:       sorted[0] && sorted[1] && totalSen > 0
        ? ((sorted[0][1] - sorted[1][1]) / totalSen * 100).toFixed(2) + 'pp' : 'n/a',
      votes:        votes,
    };
  });

  resultado.sen = {
    byParty:   senByParty,
    provincias: senResultados,
    total:     Object.values(senByParty).reduce(function(a,v){return a+v;},0),
  };

  // ── DIPUTADOS ──
  var dipByParty  = {};
  var dipCirculos = {};
  var circData    = (baselineShares.dip && baselineShares.dip.circ) || {};

  Object.keys(circData).forEach(function(key) {
    var circ  = circData[key] || {};
    var votes = Object.assign({}, circ.votes || {});
    var seats = circ.seats || 0;
    if (!seats) return;

    // Aplicar alianzas dip
    if (cfg.alianzas) {
      votes = aplicarAlianzas(votes, 'dip', key, cfg.alianzas);
    }

    // Aplicar swing
    var pid    = key.split('-')[0];
    var swLocal = swingTerr[pid] || swingGlobal;
    if (Object.keys(swLocal).length) {
      var total = Object.values(votes).reduce(function(a,v){return a+v;},0);
      if (total > 0) {
        var sharesTmp = {};
        Object.keys(votes).forEach(function(p){ sharesTmp[p] = votes[p]/total; });
        sharesTmp = aplicarSwing(sharesTmp, swLocal);
        Object.keys(votes).forEach(function(p){ votes[p] = Math.round(sharesTmp[p] * total); });
      }
    }

    var r = dhondtFull(votes, seats);
    Object.entries(r.byParty).forEach(function(e) {
      if (e[1] > 0) dipByParty[e[0]] = (dipByParty[e[0]] || 0) + e[1];
    });
    dipCirculos[key] = { seats: seats, byParty: r.byParty, cocienteCorte: r.cocienteCorte };
  });

  var totalDip = Object.values(dipByParty).reduce(function(a,v){return a+v;},0);

  resultado.dip = {
    byParty:   dipByParty,
    circulos:  dipCirculos,
    total:     totalDip,
    mayoria:   Object.entries(dipByParty).sort(function(a,b){return b[1]-a[1];})[0] ?
               Object.entries(dipByParty).sort(function(a,b){return b[1]-a[1];})[0][0] : null,
    mayoriaAbs: Object.entries(dipByParty).some(function(e){ return e[1] >= 96; }),
  };

  return resultado;
}

/**
 * @typedef {Object} SimulacionResult
 * @property {object} escenario — escenario de entrada
 * @property {{ shares, votos, ganador, primeraVuelta, margen12 }} pres
 * @property {{ byParty, provincias, total }} sen
 * @property {{ byParty, circulos, total, mayoria, mayoriaAbs }} dip
 */

// ─── Escenarios predefinidos ──────────────────────────────────────────────────

/**
 * Retorna escenarios de referencia para simulación rápida.
 */
export var ESCENARIOS_REFERENCIA = {
  baseline: {
    nombre:   'Baseline 2028 (proyección pura)',
    alianzas: [],
    swing:    {},
    abstencion: { global: 0 },
  },
  gran_alianza_oposicion: {
    nombre:   'Gran Alianza Opositora FP+PLD+BIS',
    alianzas: [
      { nivel: 'pres', lider: 'FP', aliados: ['PLD','BIS','PP','PED'], transferPct: 0.85 },
      { nivel: 'sen',  lider: 'FP', aliados: ['PLD','BIS'], transferPct: 0.90 },
      { nivel: 'dip',  lider: 'FP', aliados: ['PLD','BIS'], transferPct: 0.85 },
    ],
    swing:    {},
    abstencion: { global: 0 },
  },
  movilizacion_prm: {
    nombre:   'Movilización PRM +5pp participación',
    alianzas: [],
    swing:    {},
    abstencion: {
      global: 0.05,
      favoreceA: { PRM: 0.55, FP: 0.25, PLD: 0.10, otros: 0.10 },
    },
  },
  escenario_fp_surgen: {
    nombre:   'FP sube +5pp, PRM baja −3pp',
    alianzas: [],
    swing:    { FP: 0.05, PRM: -0.03 },
    abstencion: { global: 0 },
  },
};
