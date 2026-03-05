/**
 * SIE 2028 — core/pipeline2028.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Orquestador del pipeline completo — 9 capas secuenciales.
 *
 * RESPONSABILIDADES:
 *   - Punto de entrada único: runPipeline2028(ctx, params)
 *   - Conecta todos los módulos en orden estricto
 *   - Output compatible con el shape que consumen las views existentes
 *   - Compatibilidad total con tests 122/122
 *
 * ARQUITECTURA:
 *
 *   ctx (cargado por data.loadCTX)
 *    │
 *    ├─► Capa 0: clasificarPartidos()
 *    │           → ctx._clasificacion  (tipo: estable / nuevo / reconfigurado)
 *    │
 *    ├─► Capa 1: proyectarConBlindaje()
 *    │           → shares 2028 con guardrails anti-exponencial
 *    │           (o encuestas ponderadas si polls disponibles)
 *    │
 *    ├─► Capa 2: calcArrastre()
 *    │           → corrección ticket-split presidencial→legislativo
 *    │           coeficientes empíricos calibrados 2020+2024
 *    │
 *    ├─► Capa 3: proyectarPadron2028()            [padron.js]
 *    │           → padrón diferencial por provincia (+7.63% nacional,
 *    │              factores 0.90–1.18× por dinámica migratoria)
 *    │           → exterior +12% (C1/C2/C3)
 *    │
 *    ├─► Capa 4: aplicarDiferencialLegislativo()  [diferencial_legislativo.js]
 *    │           → ajusta shares sen/dip usando coeficientes calibrados
 *    │              (PRM: 0.936 sen / 0.895 dip; FP: 0.696 / 0.620; PLD: 1.394 / 1.250)
 *    │
 *    ├─► Capa 5: parsearAlianzasJCE() + aplicarAlianzasNivel()  [alianzas.js]
 *    │           → agrega votos aliados antes de calcular curules
 *    │              sólo si params.aplicarAlianzas === true (default: false)
 *    │
 *    ├─► Capa 6: renormalizarCtx()
 *    │           → coherencia sum(prov) = nacional en todos los niveles
 *    │
 *    ├─► Capa 7: calcResultados2028()             [capa3_resultados.js]
 *    │           ├─ calcPresidencial()            → ganador / segunda vuelta
 *    │           ├─ calcSenadores()               → 32 senadores (pluralidad)
 *    │           ├─ calcDiputados()               → 190 dip (D'Hondt)
 *    │           ├─ calcGanadoresPluralidad(mun)  → alcaldes
 *    │           └─ calcGanadoresPluralidad(dm)   → directores DM
 *    │
 *    ├─► Capa 8: simular()                        [simulador2028.js]
 *    │           → aplica escenario (alianzas / swing / abstención) sobre baseline
 *    │              sólo si params.escenario está presente
 *    │
 *    └─► Capa 9: generarInformeMov()              [movilizacion.js]
 *                → ranking territorial ROI para movilización
 *                   sólo si params.calcularMov === true (default: false)
 *
 * USO DESDE views/simulador.js o app.js:
 *
 *   import { runPipeline2028 } from './core/pipeline2028.js';
 *
 *   // Pipeline básico (Capas 0-7, igual que antes)
 *   const result = await runPipeline2028(ctx, {
 *     ajusteParticipacion: 0,
 *     ajustesPP:           { PRM: +2 },
 *     aplicarArrastre:     true,
 *     ganadorPres:         'PRM',
 *   });
 *
 *   // Pipeline con alianzas 2024 activadas (Capa 5)
 *   const result = await runPipeline2028(ctx, {
 *     aplicarAlianzas: true,          // usa alianzas_2024.json del ctx
 *   });
 *
 *   // Pipeline con escenario estratégico (Capa 8)
 *   const result = await runPipeline2028(ctx, {
 *     escenario: {
 *       alianzas:   [{ nivel: 'sen', territorio: '28', lider: 'FP', aliados: ['PLD'] }],
 *       swing:      { FP: +0.03, PRM: -0.02 },
 *       abstencion: { global: +0.05 },
 *     },
 *   });
 *
 *   // Pipeline completo con movilización (Capa 9)
 *   const result = await runPipeline2028(ctx, { calcularMov: true, partido: 'PRM' });
 *
 *   // result.pres, result.sen, result.dip, result.mun, result.dm
 *   // result.simulacion    (si params.escenario)
 *   // result.movilizacion  (si params.calcularMov)
 *   // result.alertas, result.trazabilidad
 *
 * COMPATIBILIDAD:
 *   - No modifica ningún módulo existente
 *   - Las Capas 3-5 y 8-9 son opt-in para no romper comportamiento actual
 *   - Si ctx._clasificacion ya existe, Capa 0 no recalcula
 */

import { clasificarPartidos }                                  from './capa0_clasificador.js';
import { proyectarConBlindaje,
         calcArrastre }                                        from './capa1_proyeccion.js';
import { buildCtx2028, proyectarPadron,
         proyectarResultados }                                 from './proyeccion2028.js';
import { renormalizarCtx }                                     from './renormalizar_votos.js';
import { calcResultados2028 }                                  from './capa3_resultados.js';
import { proyectarPadron2028 }                                 from './padron.js';
import { aplicarDiferencialLegislativo }                      from './diferencial_legislativo.js';
import { parsearAlianzasJCE, aplicarAlianzasNivel }            from './alianzas.js';
import { simular }                                             from './simulador2028.js';
import { generarInformeMov }                                   from './movilizacion.js';
import { getLevel }                                            from './data.js';
import { clamp, rankVotes }                                    from './utils.js';

// Coeficientes de retención empíricos (calibrados 2020+2024, error 0.08pp)
var RETENCION = { sen: 0.9254, dip: 0.8955, mun: 0.88, dm: 0.87 };

/**
 * Ejecuta el pipeline completo 9 capas para 2028.
 *
 * @param {object} ctx
 * @param {object} [params]
 * @param {number}  params.ajusteParticipacion  slider ±0.05 (default 0)
 * @param {object}  params.ajustesPP            { partido: pp } ajustes manuales
 * @param {boolean} params.aplicarArrastre      activar Capa 2 (default true)
 * @param {string}  params.ganadorPres          partido que arrastra (si aplicarArrastre)
 * @param {boolean} params.forzarReclasificar   recalcular Capa 0 aunque ya exista
 * @param {boolean} params.aplicarAlianzas      activar Capa 5 con alianzas del ctx (default false)
 * @param {object}  params.alianzasOverride     ConfigAlianzas manual (omite ctx.alianzas)
 * @param {object}  params.escenario            activa Capa 8: { alianzas, swing, abstencion }
 * @param {boolean} params.calcularMov          activar Capa 9 (default false)
 * @param {string}  params.partido              partido para Capa 9 (default 'PRM')
 * @returns {ElectoralResult2028 & { ctx2028, simulacion?, movilizacion? }}
 */
export function runPipeline2028(ctx, params) {
  params = params || {};
  var ajusteParticipacion = typeof params.ajusteParticipacion === 'number'
    ? clamp(params.ajusteParticipacion, -0.05, 0.05) : 0;
  var ajustesPP     = params.ajustesPP     || {};
  var aplicarArr    = params.aplicarArrastre !== false;  // default true
  var ganadorPres   = params.ganadorPres   || _detectGanador(ctx);

  // ── Capa 0: Clasificación ────────────────────────────────────────────────
  if (!ctx._clasificacion || params.forzarReclasificar) {
    ctx._clasificacion = clasificarPartidos();
  }
  var clasificacion = ctx._clasificacion;

  // ── Capa 1: Proyección 2028 con blindaje ─────────────────────────────────
  var padronLegacy = proyectarPadron(ctx, ajusteParticipacion);
  var em2028       = padronLegacy.emitidosProyectados;

  var ctx2028 = Object.assign({}, ctx, {
    padron2028:     padronLegacy,
    r:              Object.assign({}, ctx.r),
    _clasificacion: clasificacion,
  });
  ctx2028.r[2028] = {};

  var niveles   = ['pres', 'sen', 'dip', 'mun', 'dm'];
  var trazCapas = {};

  niveles.forEach(function(nivel) {
    var lv24  = getLevel(ctx, 2024, nivel);
    var nat24 = lv24.nacional;
    var em24  = nat24.emitidos || 1;
    var v24   = nat24.votes    || {};

    var polls = (ctx.polls || []).filter(function(p) { return !p._ejemplo; });
    var proj;
    if (polls.length) {
      proj = _proyectarDesdeEncuestas(polls, clasificacion);
      proj.fuente = 'encuestas';
    } else {
      proj = proyectarConBlindaje(ctx, clasificacion, nivel);
    }

    if (Object.keys(ajustesPP).length) {
      proj = _aplicarAjustesPP(proj, ajustesPP, em2028);
    }

    var votes2028 = {};
    Object.keys(proj.votes2028).forEach(function(p) {
      votes2028[p] = Math.round((proj.votes2028[p] || 0) * em2028);
    });

    var prov24 = lv24.prov || {};
    var prov28 = _scaleProvVotes(prov24, v24, proj.votes2028, em24, em2028, padronLegacy);

    var circ28 = {};
    if (nivel === 'dip') {
      var circ24 = lv24.circ || {};
      circ28 = _scaleCircVotes(circ24, v24, proj.votes2028, em24, em2028);
    }

    ctx2028.r[2028][nivel] = Object.assign({}, lv24, {
      nacional: Object.assign({}, nat24, {
        votes:    votes2028,
        emitidos: em2028,
        validos:  Math.round(em2028 * 0.985),
        inscritos: padronLegacy.total,
      }),
      prov: prov28,
      circ: circ28,
      _proyeccion: proj,
    });

    trazCapas[nivel] = { fuente: proj.fuente, trazabilidad: proj.trazabilidad };
  });

  // ── Capa 2: Arrastre presidencial ────────────────────────────────────────
  if (aplicarArr && ganadorPres) {
    var preNat    = ctx2028.r[2028].pres.nacional;
    var presVts   = preNat.votes;
    var presEm    = preNat.emitidos;
    var margenPres = _calcMargenPres(presVts, preNat.validos);

    ['sen', 'dip', 'mun', 'dm'].forEach(function(nivel) {
      var lv2028 = ctx2028.r[2028][nivel];
      if (!lv2028 || !lv2028.nacional) return;
      var emNivel = lv2028.nacional.emitidos || 0;
      var arrastre = calcArrastre(
        presVts, presEm, nivel, emNivel, ganadorPres, margenPres, clasificacion
      );
      lv2028.nacional.votes = arrastre.votes;
      lv2028.nacional._arrastre = arrastre.trazabilidad;

      if (lv2028.prov && Object.keys(lv2028.prov).length) {
        lv2028.prov = _scaleProvFromNat(lv2028.prov, presVts, arrastre.votes, emNivel);
      }
    });
  }

  // ── Capa 3: Padrón diferencial 2028 ─────────────────────────────────────
  // Usa padron.js con tasas diferenciales por provincia (factores 0.90–1.18×)
  // y proyección de exterior (+12%). Resultado expuesto en resultado.padronDiferencial.
  var padronDiferencial = proyectarPadron2028(ctx);

  // Propagar inscritos diferenciados a ctx2028 por provincia
  if (padronDiferencial && padronDiferencial.provincial) {
    var provInscritos = padronDiferencial.provincial;
    niveles.forEach(function(nivel) {
      var lv = ctx2028.r[2028][nivel];
      if (!lv || !lv.prov) return;
      Object.keys(lv.prov).forEach(function(pid) {
        if (provInscritos[pid]) {
          lv.prov[pid] = Object.assign({}, lv.prov[pid], {
            inscritos: provInscritos[pid].inscritos,
          });
        }
      });
    });
    // Actualizar inscrito nacional con total diferencial
    ctx2028.r[2028].pres.nacional.inscritos = padronDiferencial.nacional.inscritos;
  }

  // ── Capa 4: Diferencial legislativo ─────────────────────────────────────
  // Ajusta shares nacionales de sen/dip usando coeficientes calibrados
  // (PRM 0.936 sen / 0.895 dip; FP 0.696/0.620; PLD 1.394/1.250 etc.)
  var sharesPres2028 = {};
  var presNacVotes   = ctx2028.r[2028].pres.nacional.votes;
  var presNacTotal   = Object.values(presNacVotes).reduce(function(a,v){return a+v;},0) || 1;
  Object.keys(presNacVotes).forEach(function(p) {
    sharesPres2028[p] = presNacVotes[p] / presNacTotal;
  });

  ['sen', 'dip'].forEach(function(nivel) {
    var lv = ctx2028.r[2028][nivel];
    if (!lv || !lv.nacional) return;

    var difResult = aplicarDiferencialLegislativo(sharesPres2028, nivel, clasificacion);
    var emNivel   = lv.nacional.emitidos || 0;

    // Convertir shares diferenciadas a votos absolutos
    var newVotes = {};
    Object.keys(difResult.shares).forEach(function(p) {
      newVotes[p] = Math.round(difResult.shares[p] * emNivel);
    });
    lv.nacional.votes        = newVotes;
    lv.nacional._diferencial = difResult.trazabilidad;

    // Propagar swing diferencial a provincias
    if (lv.prov && Object.keys(lv.prov).length) {
      lv.prov = _scaleProvFromNat(lv.prov, presNacVotes, newVotes, emNivel);
    }
    if (nivel === 'dip' && lv.circ && Object.keys(lv.circ).length) {
      lv.circ = _scaleCircFromNat(lv.circ, presNacVotes, newVotes);
    }
  });

  // ── Capa 5: Alianzas electorales ────────────────────────────────────────
  // Opt-in: sólo activa si params.aplicarAlianzas === true o params.alianzasOverride
  var cfgAlianzas = null;
  if (params.aplicarAlianzas || params.alianzasOverride) {
    var alianzasJSON = params.alianzasOverride || ctx.alianzas;
    if (alianzasJSON) {
      cfgAlianzas = parsearAlianzasJCE(alianzasJSON);
    }
  }

  if (cfgAlianzas) {
    ['pres', 'sen', 'dip'].forEach(function(nivel) {
      var lv = aplicarAlianzasNivel(ctx2028, 2028, nivel, cfgAlianzas);
      if (lv && Object.keys(lv).length) {
        ctx2028.r[2028][nivel] = Object.assign({}, ctx2028.r[2028][nivel], lv);
      }
    });
    trazCapas._alianzas = { aplicadas: true, fuente: params.alianzasOverride ? 'override' : 'alianzas_2024.json' };
  }

  // ── Capa 6: Renormalización territorial ──────────────────────────────────
  var ctxNorm = renormalizarCtx(ctx2028);

  // ── Capa 7: Cálculo de resultados ────────────────────────────────────────
  var resultado = calcResultados2028(ctxNorm);

  resultado.ctx2028           = ctxNorm;
  resultado.padron2028        = padronLegacy;
  resultado.padronDiferencial = padronDiferencial;
  resultado._trazCapas        = trazCapas;

  // ── Capa 8: Simulación estratégica ───────────────────────────────────────
  // Opt-in: sólo activa si params.escenario está presente
  if (params.escenario) {
    var baselineShares = _buildBaselineShares(ctxNorm, resultado);
    resultado.simulacion = simular(baselineShares, params.escenario);
  }

  // ── Capa 9: Motor de movilización ────────────────────────────────────────
  // Opt-in: sólo activa si params.calcularMov === true
  if (params.calcularMov) {
    var padronRows = _getPadronRows(ctx);
    if (padronRows.length) {
      var senProvMov = resultado.sen && resultado.sen.provincias ? resultado.sen.provincias : {};
      var dipFlips   = _collectDipFlips(resultado.dip);
      resultado.movilizacion = generarInformeMov({
        padronRows:  padronRows,
        sharesPres:  sharesPres2028,
        senProv:     senProvMov,
        dipFlips:    dipFlips,
        partido:     params.partido || 'PRM',
      });
    }
  }

  return resultado;
}

// ─── Helpers internos ────────────────────────────────────────────────────────

function _detectGanador(ctx) {
  var lv24 = getLevel(ctx, 2024, 'pres');
  var ranked = rankVotes(lv24.nacional.votes || {}, lv24.nacional.validos);
  return ranked.length ? ranked[0].p : 'PRM';
}

function _calcMargenPres(votes, validos) {
  var ranked = rankVotes(votes, validos);
  if (ranked.length < 2) return ranked.length ? ranked[0].pct : 0;
  return ranked[0].pct - ranked[1].pct;
}

function _proyectarDesdeEncuestas(polls, clasificacion) {
  var pesos = polls.map(function(p) {
    return 1 / (1 + Math.max(0, _mesesDesde(p.fecha)));
  });
  var sumP = pesos.reduce(function(a, v) { return a + v; }, 0) || 1;
  var acc  = {};
  polls.forEach(function(p, i) {
    var w   = pesos[i] / sumP;
    var res = p.resultados || {};
    Object.keys(res).forEach(function(partido) {
      acc[partido] = (acc[partido] || 0) + (res[partido] / 100) * w;
    });
  });
  var tot = Object.values(acc).reduce(function(a, v) { return a + v; }, 0) || 1;
  var out = {};
  Object.keys(acc).forEach(function(p) { out[p] = acc[p] / tot; });
  return { votes2028: out, fuente: 'encuestas', trazabilidad: [] };
}

function _mesesDesde(fechaStr) {
  if (!fechaStr) return 12;
  var d = new Date(fechaStr);
  var now = new Date();
  return Math.max(0, (now - d) / (1000 * 60 * 60 * 24 * 30));
}

function _aplicarAjustesPP(proj, ajustesPP, em2028) {
  var shares = Object.assign({}, proj.votes2028);
  Object.entries(ajustesPP).forEach(function(e) {
    var p = e[0]; var pp = e[1] / 100;
    shares[p] = Math.max(0, (shares[p] || 0) + pp);
  });
  var tot = Object.values(shares).reduce(function(a, v) { return a + v; }, 0) || 1;
  var norm = {};
  Object.keys(shares).forEach(function(p) { norm[p] = shares[p] / tot; });
  return Object.assign({}, proj, { votes2028: norm });
}

function _scaleProvVotes(prov24, baseNatVotes, projShares, em24, em2028, padron) {
  var out   = {};
  var scale = em24 > 0 ? em2028 / em24 : 1;
  var tot24 = Object.values(baseNatVotes).reduce(function(a, v) { return a + v; }, 0) || 1;

  Object.entries(prov24).forEach(function(e) {
    var id  = e[0];
    var p24 = e[1];
    var newVotes = {};
    Object.keys(p24.votes || {}).forEach(function(par) {
      var baseShare = (baseNatVotes[par] || 0) / tot24;
      var projShare = projShares[par] || 0;
      var ratio     = baseShare > 0 ? projShare / baseShare : 1;
      newVotes[par] = Math.round((p24.votes[par] || 0) * ratio);
    });
    var newEm = Math.round((p24.emitidos || 0) * scale);
    out[id] = Object.assign({}, p24, {
      votes:    newVotes,
      emitidos: newEm,
      validos:  Math.round(newEm * 0.985),
      inscritos: p24.inscritos ? Math.round(p24.inscritos * (padron.total / padron.total2024)) : null,
    });
  });
  return out;
}

function _scaleCircVotes(circ24, baseNatVotes, projShares, em24, em2028) {
  var out = {};
  var scale = em24 > 0 ? em2028 / em24 : 1;
  var tot24 = Object.values(baseNatVotes).reduce(function(a, v) { return a + v; }, 0) || 1;

  Object.entries(circ24).forEach(function(e) {
    var id   = e[0];
    var c24  = e[1];
    var newVotes = {};
    Object.keys(c24.votes || {}).forEach(function(par) {
      var baseShare = (baseNatVotes[par] || 0) / tot24;
      var projShare = projShares[par] || 0;
      var ratio     = baseShare > 0 ? projShare / baseShare : 1;
      newVotes[par] = Math.round((c24.votes[par] || 0) * ratio);
    });
    out[id] = Object.assign({}, c24, {
      votes: newVotes,
      meta: Object.assign({}, c24.meta, {
        emitidos: Math.round((c24.meta && c24.meta.emitidos || 0) * scale),
      }),
    });
  });
  return out;
}

function _scaleProvFromNat(prov, baseNatVotes, simNatVotes, emNivel) {
  var out    = {};
  var baseTot = Object.values(baseNatVotes).reduce(function(a, v) { return a + v; }, 0) || 1;
  var simTot  = Object.values(simNatVotes).reduce(function(a, v) { return a + v; }, 0) || 1;

  Object.entries(prov).forEach(function(e) {
    var id   = e[0];
    var terr = e[1];
    var newVotes = {};
    Object.keys(terr.votes || {}).forEach(function(par) {
      var baseS = (baseNatVotes[par] || 0) / baseTot;
      var simS  = (simNatVotes[par]  || 0) / simTot;
      var ratio = baseS > 0 ? simS / baseS : 1;
      newVotes[par] = Math.round((terr.votes[par] || 0) * ratio);
    });
    out[id] = Object.assign({}, terr, { votes: newVotes });
  });
  return out;
}

// Propaga swing de nacional a circunscripciones de diputados
function _scaleCircFromNat(circ, baseNatVotes, simNatVotes) {
  var baseTot = Object.values(baseNatVotes).reduce(function(a,v){return a+v;},0) || 1;
  var simTot  = Object.values(simNatVotes).reduce(function(a,v){return a+v;},0)  || 1;
  var out = {};

  Object.entries(circ).forEach(function(e) {
    var id  = e[0];
    var c   = e[1];
    var newVotes = {};
    Object.keys(c.votes || {}).forEach(function(par) {
      var baseS = (baseNatVotes[par] || 0) / baseTot;
      var simS  = (simNatVotes[par]  || 0) / simTot;
      var ratio = baseS > 0 ? simS / baseS : 1;
      newVotes[par] = Math.round((c.votes[par] || 0) * ratio);
    });
    out[id] = Object.assign({}, c, { votes: newVotes });
  });
  return out;
}

// Construye el shape baselineShares que espera simular() en simulador2028.js
function _buildBaselineShares(ctxNorm, resultado) {
  var presNac   = ctxNorm.r[2028].pres.nacional;
  var presTotal = Object.values(presNac.votes).reduce(function(a,v){return a+v;},0) || 1;
  var sharesPres = {};
  Object.keys(presNac.votes).forEach(function(p) {
    sharesPres[p] = presNac.votes[p] / presTotal;
  });

  var senProv = {};
  var senLv   = ctxNorm.r[2028].sen;
  if (senLv && senLv.prov) {
    Object.keys(senLv.prov).forEach(function(pid) {
      var pdata = senLv.prov[pid];
      senProv[pid] = {
        votes:       pdata.votes || {},
        inscritos:   pdata.inscritos || 0,
        participacion: pdata.emitidos && pdata.inscritos
          ? pdata.emitidos / pdata.inscritos : 0.60,
      };
    });
  }

  var dipCirc = {};
  var dipLv   = ctxNorm.r[2028].dip;
  if (dipLv && dipLv.circ) {
    Object.keys(dipLv.circ).forEach(function(key) {
      var c = dipLv.circ[key];
      dipCirc[key] = { votes: c.votes || {}, seats: c.seats || 0 };
    });
  }
  // Añadir circs con seats desde curules si dipLv.circ tiene seats en meta
  if (resultado && resultado.dip && resultado.dip.trazabilidad && resultado.dip.trazabilidad.circs) {
    Object.entries(resultado.dip.trazabilidad.circs).forEach(function(e) {
      var key = e[0]; var c = e[1];
      if (!dipCirc[key]) dipCirc[key] = { votes: {}, seats: c.seats || 0 };
      else dipCirc[key].seats = c.seats || dipCirc[key].seats || 0;
    });
  }

  return {
    pres: { shares: sharesPres, validos: presNac.validos || presTotal },
    sen:  { prov: senProv },
    dip:  { circ: dipCirc },
  };
}

// Extrae votos_flip del resultado de diputados para movilización
function _collectDipFlips(dipResult) {
  if (!dipResult || !dipResult.trazabilidad) return {};
  var flips = {};
  var circs = dipResult.trazabilidad.circs || {};
  Object.entries(circs).forEach(function(e) {
    var key = e[0]; var c = e[1];
    if (c.votos_flip) flips[key] = c.votos_flip;
  });
  return flips;
}

// Obtiene rows de padrón provincial desde ctx
function _getPadronRows(ctx) {
  // ctx._padronUnificado (si fue cargado extra) o ctx.padronProvLookup como fallback
  if (ctx._padronUnificado && ctx._padronUnificado.mayo2024) {
    return (ctx._padronUnificado.mayo2024.provincial || {}).rows || [];
  }
  // Reconstruir desde padronProvLookup si es lo único disponible
  if (ctx.padronProvLookup && Object.keys(ctx.padronProvLookup).length) {
    return Object.entries(ctx.padronProvLookup).map(function(e) {
      return { provincia_id: parseInt(e[0]), inscritos: e[1],
               participacion_pres: 0.62, abstencion_pres: Math.round(e[1] * 0.38) };
    });
  }
  return [];
}
