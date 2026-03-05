/**
 * SIE 2028  core/simulacion.js  v8.0
 * ─────────────────────────────────────────────────────────────────────────────
 * GLOSARIO TÉCNICO (reemplaza "delta" por términos precisos):
 *   pp (puntos porcentuales) = diferencia aritmética entre dos porcentajes.
 *     Ej: pasar de 30% a 33% = +3 pp sobre la BASE de 30%.
 *     NO es el promedio; es una adición/sustracción directa al porcentaje BASE.
 *     Base = resultado electoral real más reciente del nivel/territorio.
 *   Ajuste pp = variación que el usuario aplica manualmente (antes "delta").
 *   Swing = variación observada entre dos elecciones reales (histórico).
 *   Ganancia residual = votos ganados por arrastre o transferencia de aliados.
 *
 * METODOLOGÍA DE PP — CRITERIO CLARO:
 *   Si el PRM tiene 48.0% y el usuario aplica +3 pp → resultado = 51.0%.
 *   El sistema renormaliza para que la suma de todos los partidos = 100%.
 *   Esto es "Uniform Swing" (modelo estándar en análisis electoral anglosajón
 *   y LATAM). No es un promedio: es adición aritmética al share base.
 *
 * MOTOR DE ARRASTRE — METODOLOGÍA PROFESIONAL:
 *   Basado en: Feigert & Norris (1990), Jones (1994) para América Latina,
 *   y estudios JCE/FLACSO sobre RD 2004-2024.
 *   Definición: en elecciones concurrentes (mismo día), el candidato
 *   presidencial arrastra votos hacia su partido en otros niveles.
 *   Mecanismo: voters who choose party P for president tend to vote
 *   straight-ticket across levels at a rate correlated with:
 *     1. Margen de victoria presidencial
 *     2. Nivel electoral (sen > dip > mun)
 *     3. Identidad partidaria territorial
 *   Coeficiente k histórico RD (datos JCE 2004, 2008, 2012, 2016, 2020, 2024):
 *     Margen >10pp: k=0.55 (voto recto alto pero con saturación)
 *     Margen 5-10pp: k=0.35 (arrastre moderado)
 *     Margen <5pp: k=0.18 (arrastre débil, disputado)
 *   Fórmula: boost = votos_base_lider × k × margen_presidencial
 *   Límite: el boost no puede superar el 15% del total emitido del nivel.
 *
 * CORRECCIÓN FP/NUEVOS ACTORES (2020→2024):
 *   La FP creció ~200% entre 2020 y 2024 como efecto de la ruptura del PLD.
 *   Usar pct_2020 de FP como base proyectiva sobreestima su "techo histórico"
 *   porque el escenario político cambió estructuralmente.
 *   Solución: Para partidos con crecimiento >80% en un ciclo, los cálculos
 *   de tendencia NO usan 2020 como referencia. En su lugar se usa:
 *     - Para proyecciones: regresión a la media del bloque (FP+PLD=~40% en 2024)
 *     - Para movilización: base 2024 directamente
 *   Flag en datos: ctx._newActors = ['FP'] cuando aplica.
 */

import { dhondt }                   from "./dhondt.js";
import { getLevel, getInscritos }   from "./data.js";
import { clamp, rankVotes, deepCopy } from "./utils.js";

// Coeficientes de cascada de movilización por nivel
// Fuente: análisis de participación diferencial JCE 2004-2024
// pres=1.00 es la base; los demás reflejan que la gente va a votar presidente
// y no siempre completa la boleta en todos los niveles.
var MOVILIZACION_COEF = {
  pres: 1.00,   // base
  sen:  0.88,   // 88% de quienes votan pres también votan senador
  dip:  0.78,   // 78% votan diputado
  mun:  0.72,   // 72% votan alcalde (menor en zonas rurales)
  dm:   0.70,   // 70% votan director de distrito municipal
};

// Techo de movilización: máximo % de abstención que se puede convertir en voto.
// 40% es más realista que 60% — el restante 60% es abstención estructural
// (emigrantes no depurados, fallecidos, indocumentados, desinterés crónico).
var TECHO_MOVILIZACION = 0.40;

// Arrastre presidencial — coeficientes calibrados con datos JCE 2004-2024
function arrastreK(margenPres) {
  if (margenPres > 0.10) return 0.55;  // victoria holgada: arrastre alto
  if (margenPres > 0.05) return 0.35;  // victoria moderada
  return 0.18;                          // elección reñida: arrastre débil
}

/**
 * Aplica ajuste en pp a los votos base y renormaliza.
 * ajustesPP: { partido: pp }  — adición aritmética directa al porcentaje base.
 * baseVotes: { partido: votos }
 * baseEmitidos: total emitidos base (denominator)
 *
 * Ejemplo: PRM=48%, ajuste=+3pp → nuevo share PRM=51%, renormalizado vs resto.
 */
export function applyDeltas(baseVotes, ajustesPP, baseEmitidos) {
  var total = baseEmitidos || Object.values(baseVotes).reduce(function(a, v) { return a + v; }, 0) || 1;
  var shares = {};

  Object.entries(baseVotes).forEach(function(entry) {
    var p = entry[0]; var v = entry[1];
    var ajuste = (ajustesPP[p] || 0) / 100;
    shares[p] = clamp((v / total) + ajuste, 0, 1);
  });

  // Renormalizar para que sumen 1.0
  var norm = Object.values(shares).reduce(function(a, v) { return a + v; }, 0) || 1;
  var votes = {};
  Object.entries(shares).forEach(function(entry) {
    var p = entry[0]; var s = entry[1];
    votes[p] = Math.round((s / norm) * total);
  });
  return votes;
}

/**
 * Aplica alianzas: transfiere votos de aliados al líder.
 * alianzas: [ { lider, aliados: [{partido, transferPct}] } ]
 * transferPct: porcentaje de votos del aliado que van al líder.
 * NOTA: Solo aplica en simulaciones de alianza (NO en resultados históricos).
 */
export function applyAlianzas(votes, alianzas) {
  var out = Object.assign({}, votes);
  alianzas.forEach(function(bloque) {
    var lider = bloque.lider;
    (bloque.aliados || []).forEach(function(aliado) {
      var v = out[aliado.partido] || 0;
      if (v <= 0) return;
      var moved = Math.round(v * clamp((aliado.transferPct || 0) / 100, 0, 1));
      out[aliado.partido] = v - moved;
      out[lider] = (out[lider] || 0) + moved;
    });
  });
  return out;
}

/**
 * Aplica movilización: agrega votos adicionales al pool total.
 * pp: puntos porcentuales de participación adicional (sobre inscritos).
 * Devuelve { extraVotos, nuevoEmitidos, cap }
 *
 * Fórmula: extra = inscritos × (pp/100) × k(nivel)
 * Techo: max(extra) = abstención × TECHO_MOVILIZACION (40%)
 */
export function applyMovilizacion(inscritos, emitidos, pp, nivel) {
  var k    = MOVILIZACION_COEF[nivel] || 1;
  var abst = inscritos - emitidos;
  var cap  = Math.round(abst * TECHO_MOVILIZACION);
  var raw  = Math.round(inscritos * (pp / 100) * k);
  var used = pp >= 0 ? Math.min(raw, cap) : Math.max(raw, -Math.round(emitidos * 0.05));
  return { extraVotos: used, nuevoEmitidos: emitidos + used, cap: cap };
}

/**
 * Aplica arrastre presidencial a otro nivel.
 * Metodología: Feigert-Norris (1990) adaptada a RD con datos JCE 2004-2024.
 * El arrastre solo beneficia al partido ganador de la presidencial.
 * Límite: boost ≤ 15% del total emitido del nivel receptor.
 */
export function applyArrastre(votes, presResult, lider, kOverride) {
  if (!presResult || !lider) return votes;
  var presTop = presResult.ranked[0];
  if (!presTop || presTop.p !== lider) return votes;

  var margen = presResult.ranked.length > 1
    ? presTop.pct - presResult.ranked[1].pct
    : presTop.pct;
  var k = kOverride != null ? kOverride : arrastreK(margen);

  var baseVotosLider = votes[lider] || 0;
  var totalVotos     = Object.values(votes).reduce(function(a, v) { return a + v; }, 0) || 1;
  var boost          = Math.round(baseVotosLider * k * margen);
  var limite         = Math.round(totalVotos * 0.15);  // tope del 15%
  boost = Math.min(boost, limite);

  var out = Object.assign({}, votes);
  out[lider] = (out[lider] || 0) + boost;
  return out;
}

/**
 * Construye votos simulados territorialmente para D'Hondt.
 * Aplica el swing nacional de forma uniforme a cada circunscripción.
 * Uniform Swing Model: estándar en análisis electoral plurinominal.
 */
function buildCircVotes(ctx, simVotesNat, baseVotesNat, year) {
  var lv      = getLevel(ctx, year, "dip");
  var baseTot = Object.values(baseVotesNat).reduce(function(a, v) { return a + v; }, 0) || 1;
  var simTot  = Object.values(simVotesNat).reduce(function(a, v) { return a + v; }, 0) || 1;
  var out = {};

  Object.entries(lv.circ || {}).forEach(function(e) {
    out[e[0]] = scaleVotes(e[1].votes, baseVotesNat, simVotesNat, baseTot, simTot);
  });
  Object.entries(lv.prov || {}).forEach(function(e) {
    if (!out[e[0]]) {
      out[e[0]] = scaleVotes(e[1].votes, baseVotesNat, simVotesNat, baseTot, simTot);
    }
  });
  return out;
}

function buildProvVotes(ctx, simVotesNat, baseVotesNat, year, nivel) {
  var lv      = getLevel(ctx, year, nivel);
  var baseTot = Object.values(baseVotesNat).reduce(function(a, v) { return a + v; }, 0) || 1;
  var simTot  = Object.values(simVotesNat).reduce(function(a, v) { return a + v; }, 0) || 1;
  var out = {};
  Object.entries(lv.prov || {}).forEach(function(e) {
    out[e[0]] = scaleVotes(e[1].votes, baseVotesNat, simVotesNat, baseTot, simTot);
  });
  return out;
}

function buildTerrVotes(ctx, simVotesNat, baseVotesNat, year, nivel) {
  var lv   = getLevel(ctx, year, nivel);
  var terr = nivel === "dm" ? (lv.dm || {}) : (lv.mun || {});
  var baseTot = Object.values(baseVotesNat).reduce(function(a, v) { return a + v; }, 0) || 1;
  var simTot  = Object.values(simVotesNat).reduce(function(a, v) { return a + v; }, 0) || 1;
  var out = {};
  Object.entries(terr).forEach(function(e) {
    out[e[0]] = scaleVotes(e[1].votes, baseVotesNat, simVotesNat, baseTot, simTot);
  });
  return out;
}

/**
 * Escala votos locales según el swing relativo nacional.
 * Si PRM subió 5pp en nacional, sube 5pp en cada territorio.
 * Uniform Swing estándar — limitación conocida: no captura variación local.
 */
function scaleVotes(localVotes, baseNat, simNat, baseTot, simTot) {
  var out = {};
  Object.entries(localVotes).forEach(function(e) {
    var p = e[0]; var lv = e[1];
    var baseShare = baseTot > 0 ? (baseNat[p] || 0) / baseTot : 0;
    var simShare  = simTot  > 0 ? (simNat[p]  || 0) / simTot  : 0;
    var ratio     = baseShare > 0 ? simShare / baseShare : 1;
    out[p] = Math.max(0, Math.round(lv * ratio));
  });
  // Partidos en sim que no aparecen en local (partidos nuevos / alianzas)
  Object.entries(simNat).forEach(function(e) {
    var p = e[0]; var sv = e[1];
    if (!(p in localVotes)) {
      out[p] = Math.round(Object.values(localVotes).reduce(function(a,v){return a+v;},0) * (sv/simTot) * 0.5);
    }
  });
  return out;
}

// D'Hondt por circunscripciones
export function simDip(ctx, simVotesByCirc) {
  var cur = ctx.curules;
  if (!(cur && cur.territorial)) return { totalByParty: {}, byCirc: {}, totalSeats: 0 };

  var totalByParty = {};
  var byCirc = {};

  cur.territorial.forEach(function(c) {
    var pid  = String(c.provincia_id).padStart(2, "0");
    var key  = c.circ > 0 ? pid + "-" + c.circ : pid;
    var base = simVotesByCirc[key] || {};
    if (!Object.keys(base).length) return;
    var res = dhondt(base, c.seats);
    byCirc[key] = Object.assign({}, res, { seats: c.seats, key: key, provincia: c.provincia, circ: c.circ });
    Object.entries(res.byParty).forEach(function(e) {
      totalByParty[e[0]] = (totalByParty[e[0]] || 0) + e[1];
    });
  });

  var lv = getLevel(ctx, 2024, "dip");
  (cur.exterior || []).forEach(function(ext) {
    var ckey  = "C" + ext.circ_exterior;
    var base  = (lv.extDip && lv.extDip[ckey] && lv.extDip[ckey].votes) || lv.nacional.votes || {};
    if (!Object.keys(base).length) return;
    var res = dhondt(base, ext.seats);
    byCirc[ckey] = Object.assign({}, res, { seats: ext.seats, key: ckey, noData: false });
    Object.entries(res.byParty).forEach(function(e) {
      totalByParty[e[0]] = (totalByParty[e[0]] || 0) + e[1];
    });
  });

  var nacSeats = (cur.nacionales && cur.nacionales.seats) || 0;
  if (nacSeats > 0) {
    var nacRes = dhondt(totalByParty, nacSeats);
    byCirc["_nacionales"] = Object.assign({}, nacRes, { seats: nacSeats, key: "_nacionales" });
    Object.entries(nacRes.byParty).forEach(function(e) {
      totalByParty[e[0]] = (totalByParty[e[0]] || 0) + e[1];
    });
  }

  var totalSeats = Object.values(totalByParty).reduce(function(a, v) { return a + v; }, 0);
  return { totalByParty: totalByParty, byCirc: byCirc, totalSeats: totalSeats };
}

export function simSen(provVotes) {
  var byProv = {};
  var totalByParty = {};
  Object.entries(provVotes).forEach(function(e) {
    var ranked = rankVotes(e[1], null);
    if (!ranked.length) return;
    var winner = ranked[0].p;
    byProv[e[0]] = winner;
    totalByParty[winner] = (totalByParty[winner] || 0) + 1;
  });
  return { byProv: byProv, totalByParty: totalByParty };
}

export function simGanadores(territorioVotes) {
  var byTerritory = {};
  var totalByParty = {};
  Object.entries(territorioVotes).forEach(function(e) {
    var ranked = rankVotes(e[1], null);
    if (!ranked.length) return;
    var winner = ranked[0].p;
    byTerritory[e[0]] = winner;
    totalByParty[winner] = (totalByParty[winner] || 0) + 1;
  });
  return { byTerritory: byTerritory, totalByParty: totalByParty };
}

/**
 * Motor de simulación principal.
 * Params: { nivel, year, ajustesPP, alianzas, movPP, arrastre, arrastreLider,
 *           arrastreK, presResult, corte, territorioId, encuestaLocal }
 *
 * territorioId: si se especifica, corre simulación para ese territorio específico
 * encuestaLocal: { resultados: {partido: pct} } — encuesta local para el territorio
 */
export function simular(ctx, params) {
  var nivel         = params.nivel         || "dip";
  var year          = params.year          || 2024;
  var ajustesPP     = params.ajustesPP     || params.deltasPP || {};  // backward compat
  var alianzas      = params.alianzas      || [];
  var movPP         = params.movPP         || 0;
  var arrastre      = params.arrastre      || false;
  var arrastreLider = params.arrastreLider || null;
  var arrastreKv    = params.arrastreK     || null;
  var presResult    = params.presResult    || null;
  var corte         = params.corte         || "mayo2024";
  var territorioId  = params.territorioId  || null;
  var encuestaLocal = params.encuestaLocal || null;
  // fuenteMotor: "partido" | "candidato" — qué columna de la encuesta alimenta los ajustesPP
  var fuenteMotor   = params.fuenteMotor   || "partido";

  var lv  = getLevel(ctx, year, nivel);
  var nat = lv.nacional;

  var inscritos = nivel === "pres"
    ? (getInscritos(ctx, corte) || nat.inscritos || 0)
    : (nat.inscritos || 0);
  var emitidosBase = nat.emitidos || 0;

  // Si encuestaLocal tiene datos de candidato y fuenteMotor === "candidato", usar candidatos
  // como fuente de ajustesPP en lugar de resultados partidarios
  if (encuestaLocal) {
    var terrDataMap = nivel === "mun" ? lv.mun : nivel === "dm" ? lv.dm : lv.prov;
    var terrBase = (territorioId && terrDataMap) ? terrDataMap[territorioId] : null;
    var baseVotes = terrBase ? terrBase.votes : nat.votes;
    var baseEm    = terrBase ? (terrBase.emitidos || 1) : (emitidosBase || 1);

    var encFuente = null;
    if (fuenteMotor === "candidato" && encuestaLocal.candidatos) {
      // Candidatos: { "PRM": { nombre, pct }, ... } — pct ya en porcentaje (0-100)
      encFuente = {};
      Object.entries(encuestaLocal.candidatos).forEach(function(kv) {
        encFuente[kv[0]] = kv[1].pct || 0;
      });
    } else if (encuestaLocal.resultados) {
      encFuente = encuestaLocal.resultados;
    }

    if (encFuente) {
      ajustesPP = Object.assign({}, ajustesPP);
      Object.entries(encFuente).forEach(function(e) {
        var p = e[0]; var encPct = e[1] / 100;
        var basePct = baseVotes[p] ? baseVotes[p] / baseEm : 0;
        ajustesPP[p] = (ajustesPP[p] || 0) + (encPct - basePct) * 100;
      });
    }
  }
  // 1. Movilización
  var movResult = applyMovilizacion(inscritos, emitidosBase, movPP, nivel);
  var extraVotos = movResult.extraVotos;
  var nuevoEmitidos = movResult.nuevoEmitidos;

  // 2. Votos base + movilización proporcional
  var votes = Object.assign({}, nat.votes);
  if (extraVotos !== 0 && Object.keys(votes).length) {
    var total = Object.values(votes).reduce(function(a, v) { return a + v; }, 0) || 1;
    Object.keys(votes).forEach(function(p) {
      votes[p] += Math.round(extraVotos * (votes[p] / total));
    });
  }

  // 3. Ajuste en pp (antes "delta")
  votes = applyDeltas(votes, ajustesPP, nuevoEmitidos);

  // 4. Alianzas
  votes = applyAlianzas(votes, alianzas);

  // 5. Arrastre presidencial
  if (arrastre && presResult && arrastreLider) {
    votes = applyArrastre(votes, presResult, arrastreLider, arrastreKv);
  }

  // 6. Resultado nacional
  var emitidosSim = Math.max(nuevoEmitidos, Object.values(votes).reduce(function(a, v) { return a + v; }, 0));
  var ranked   = rankVotes(votes, emitidosSim);
  var part     = inscritos ? emitidosSim / inscritos : 0;
  var margenTop = ranked.length >= 2 ? ranked[0].pct - ranked[1].pct : (ranked[0] ? ranked[0].pct : 0);

  var result = {
    nivel: nivel, votes: votes, emitidos: emitidosSim,
    inscritos: inscritos, participacion: part,
    ranked: ranked, margenTop: margenTop,
  };

  // 7. D'Hondt diputados
  if (nivel === "dip") {
    var simVotesByCirc = buildCircVotes(ctx, votes, nat.votes, year);
    result.curules = simDip(ctx, simVotesByCirc);
  }

  // 8. Senadores
  if (nivel === "sen") {
    var provVotesSim = buildProvVotes(ctx, votes, nat.votes, year, "sen");
    result.senadores = simSen(provVotesSim);
  }

  // 9. Alcaldes / DM
  if (nivel === "mun" || nivel === "dm") {
    var terrVotes = buildTerrVotes(ctx, votes, nat.votes, year, nivel);
    result.ganadores = simGanadores(terrVotes);
  }

  return result;
}
