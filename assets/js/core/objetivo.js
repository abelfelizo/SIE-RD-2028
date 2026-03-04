/**
 * SIE 2028  core/objetivo.js  v8.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Motor de Objetivos Estratégicos — Target Modeling Estándar
 * Ref: NDI Electoral Strategy Toolkit 2021, NEC/CACI 2022, LAPOP 2024
 *
 * Capacidades v8.0:
 *   1. Backsolve: calcula el mínimo ajuste pp para alcanzar una meta
 *   2. Eficiencia territorial: costo-por-voto por provincia (ROI campañas)
 *   3. Provincias críticas: ranking con ROI y elasticidad
 *   4. Plan de acción: recomendaciones específicas por escenario
 *      (alianzas, movilización, consolidación, inversión territorial)
 */
import { simular }   from "./simulacion.js";
import { rankVotes } from "./utils.js";
import { getLevel }  from "./data.js";

export function calcularDeltaParaMeta(ctx, params) {
  var lider    = params.lider;
  var metaPct  = params.metaPct;
  var nivel    = params.nivel || "pres";
  var maxAjuste = params.maxDelta || 30;
  var lo = -10, hi = maxAjuste, best = null;

  for (var iter = 0; iter < 40; iter++) {
    var mid = (lo + hi) / 2;
    var ajustes = Object.assign({}, params.ajustesPP || params.deltasPP || {});
    ajustes[lider] = mid;
    var res   = simular(ctx, Object.assign({}, params, { nivel: nivel, ajustesPP: ajustes, deltasPP: ajustes }));
    var found = res.ranked.filter(function(r) { return r.p === lider; })[0];
    var pct   = found ? found.pct : 0;
    if (Math.abs(pct - metaPct) < 0.0001) { best = { ajustePP: mid, deltaPP: mid, resultado: res }; break; }
    if (pct < metaPct) lo = mid; else hi = mid;
    best = { ajustePP: mid, deltaPP: mid, resultado: res };
  }

  var ajMax = Object.assign({}, params.ajustesPP || {}); ajMax[lider] = maxAjuste;
  var resMax  = simular(ctx, Object.assign({}, params, { nivel: nivel, ajustesPP: ajMax, deltasPP: ajMax }));
  var mxFound = resMax.ranked.filter(function(r) { return r.p === lider; })[0];
  var maxPct  = mxFound ? mxFound.pct : 0;

  if (maxPct < metaPct) return { imposible: true, maximo: maxPct, resultado: resMax };
  return Object.assign({ imposible: false }, best);
}

export function calcularDipMeta(ctx, params) {
  var lider       = params.lider;
  var metaCurules = params.metaCurules;
  var maxAjuste   = params.maxDelta || 25;
  var lo = 0, hi = maxAjuste, bestAjuste = 0, bestRes = null;

  for (var iter = 0; iter < 40; iter++) {
    var mid = (lo + hi) / 2;
    var ajustes = Object.assign({}, params.ajustesPP || {}); ajustes[lider] = mid;
    var res     = simular(ctx, Object.assign({}, params, { nivel: "dip", ajustesPP: ajustes, deltasPP: ajustes }));
    var curules = (res && res.curules && res.curules.totalByParty && res.curules.totalByParty[lider]) || 0;
    if (curules >= metaCurules) { hi = mid; bestAjuste = mid; bestRes = res; }
    else lo = mid;
    if (hi - lo < 0.01) break;
  }

  var ajMax   = Object.assign({}, params.ajustesPP || {}); ajMax[lider] = maxAjuste;
  var resMax  = simular(ctx, Object.assign({}, params, { nivel: "dip", ajustesPP: ajMax, deltasPP: ajMax }));
  var maxCur  = (resMax && resMax.curules && resMax.curules.totalByParty && resMax.curules.totalByParty[lider]) || 0;

  if (maxCur < metaCurules) return { imposible: true, maximo: maxCur, resultado: resMax };
  return { imposible: false, ajustePP: bestAjuste, deltaPP: bestAjuste, resultado: bestRes };
}

/**
 * Calcula eficiencia de inversión por territorio.
 * Retorna ranking por ROI: mayor ROI = menor costo relativo para voltear/asegurar.
 */
export function calcularEficienciaTerritorios(ctx, params) {
  var nivel = params.nivel;
  var lider = params.lider;
  var lv    = getLevel(ctx, 2024, nivel);
  var terrs = nivel === "mun" ? (lv.mun || {}) : (lv.prov || {});
  var resultados = [];

  Object.keys(terrs).forEach(function(id) {
    if (nivel !== "mun" && nivel !== "dm") {
      var n = parseInt(id, 10);
      if (n < 1 || n > 32) return;
    }
    var t = terrs[id];
    if (!t || !t.votes || !t.emitidos) return;
    var ins    = t.inscritos || t.emitidos || 1;
    var em     = t.emitidos || 0;
    var ranked = rankVotes(t.votes, em);
    var lEntry = ranked.filter(function(r) { return r.p === lider; })[0];
    var lPct   = lEntry ? lEntry.pct : 0;
    var top1   = ranked[0];
    var abst   = ins > 0 ? 1 - em / ins : 0;
    var votosDisponibles = Math.round(ins * abst * 0.40);
    var situation, votosNecesarios, tipo;

    if (!top1) return;

    if (top1.p === lider) {
      var rival = ranked[1];
      var ventaja = rival ? lPct - rival.pct : lPct;
      if (ventaja >= 0.10) {
        situation = "consolidado"; votosNecesarios = 0; tipo = "consolidar";
      } else {
        situation = "fragil";
        votosNecesarios = Math.round((0.10 - ventaja) * em * 0.5);
        tipo = "asegurar";
      }
    } else {
      var brecha = (top1.pct - lPct) * em;
      votosNecesarios = Math.round(brecha / 2) + 1;
      situation = "deficit";
      tipo = brecha / em < 0.08 ? "voltear" : brecha / em < 0.20 ? "crecer" : "sembrar";
    }

    var eficiencia = votosNecesarios > 0
      ? Math.max(0, 100 - (votosNecesarios / ins) * 100)
      : 100;
    var roi = Math.round(eficiencia * (1 + abst));

    resultados.push({
      id: id, nombre: t.nombre || id,
      lPct: lPct, lVotos: lEntry ? lEntry.v : 0,
      rival: top1.p === lider ? (ranked[1] ? ranked[1].p : "-") : top1.p,
      rivalPct: top1.p === lider ? (ranked[1] ? ranked[1].pct : 0) : top1.pct,
      situation: situation, tipo: tipo,
      votosNecesarios: votosNecesarios, votosDisponibles: votosDisponibles,
      abst: abst, inscritos: ins, eficiencia: eficiencia, roi: roi,
    });
  });

  return resultados.sort(function(a, b) { return b.roi - a.roi; });
}

/**
 * Provincias críticas con tipo, ROI, y acción recomendada.
 */
export function calcularProvinciasCriticas(ctx, params, n) {
  n = n || 8;
  var efic = calcularEficienciaTerritorios(ctx, params);
  var filtrados = efic.filter(function(r) {
    return params.nivel === "sen"
      ? r.tipo === "voltear" || r.tipo === "asegurar" || r.tipo === "fragil"
      : r.tipo !== "consolidado";
  });
  return filtrados.slice(0, n).map(function(r) {
    return {
      id: r.id, nombre: r.nombre, lPct: r.lPct, rival: r.rival,
      gap: r.rivalPct - r.lPct,
      ganando: r.situation === "consolidado" || r.situation === "fragil",
      tipo: r.tipo, roi: r.roi, eficiencia: r.eficiencia,
      votosNecesarios: r.votosNecesarios,
    };
  });
}

/**
 * NUEVO v8.0: Plan de acción estratégico.
 * Analiza la brecha entre situación actual y meta, y genera
 * recomendaciones priorizadas con estimado de impacto.
 *
 * Recomendaciones posibles:
 *  - MOVILIZACIÓN: si hay alta abstención recuperable
 *  - ALIANZA: si hay partidos aliados con votos significativos
 *  - CONSOLIDAR TERRITORIOS: si el partido está fragmentado
 *  - REDUCIR FUGA: si hay pérdida de votos propios
 *  - INVERSIÓN TERRITORIAL SELECTIVA: territorios con mejor ROI
 *  - CAMPAÑA PRESIDENCIAL: si el arrastre puede subir el nivel sub-pres
 */
export function generarPlanAccion(ctx, params, escenario) {
  var nivel  = params.nivel;
  var lider  = params.lider;
  var lv     = getLevel(ctx, 2024, nivel);
  var nat    = lv.nacional;
  var ins    = nat.inscritos || 0;
  var em     = nat.emitidos || 0;
  var ranked = rankVotes(nat.votes, em);
  var lEntry = ranked.filter(function(r) { return r.p === lider; })[0];
  var lPct   = lEntry ? lEntry.pct : 0;
  var lVotos = lEntry ? lEntry.v : 0;
  var top1   = ranked[0];
  var top2   = ranked[1];
  var abst   = ins > 0 ? 1 - em / ins : 0;
  var votosDisp = Math.round(ins * abst * 0.40);

  var recomendaciones = [];
  var ajusteNecesario = escenario && !escenario.imposible ? (escenario.ajustePP || escenario.deltaPP || 0) : null;

  // 1. MOVILIZACIÓN — si la abstención es alta y hay margen
  if (abst > 0.25 && votosDisp > 1000) {
    var ppMovNecesario = ajusteNecesario ? Math.max(0, ajusteNecesario * 0.6) : null;
    recomendaciones.push({
      tipo: "movilizacion",
      prioridad: abst > 0.40 ? "alta" : "media",
      titulo: "Aumentar movilización",
      detalle: "Abstención actual: " + Math.round(abst * 100) + "%. " +
        "Votos recuperables estimados: " + fmtIntLocal(votosDisp) + ". " +
        (ppMovNecesario ? "Se requieren aprox. +" + ppMovNecesario.toFixed(1) + " pp de participación adicional." : ""),
      impactoEstimado: votosDisp,
      acciones: [
        "Despliegue masivo en zonas de alta abstención identificadas en el Mapa",
        "Transporte de votantes el día de la elección en municipios clave",
        "Campaña GOTV (Get Out The Vote) en los 10 territorios con mayor abstención"
      ]
    });
  }

  // 2. ALIANZA — si hay potencial de transferencia
  var partidosAliables = ranked.filter(function(r) {
    return r.p !== lider && r.pct > 0.02 && r.pct < 0.15;
  });
  if (partidosAliables.length > 0) {
    var votosAliables = partidosAliables.reduce(function(s, r) { return s + r.v; }, 0);
    var gananciaPotencial = Math.round(votosAliables * 0.65); // 65% transferencia típica
    recomendaciones.push({
      tipo: "alianza",
      prioridad: votosAliables > 50000 ? "alta" : "media",
      titulo: "Fortalecer alianzas — ganancia residual",
      detalle: "Partidos aliables (" + partidosAliables.map(function(r){return r.p;}).join(", ") + "): " +
        fmtIntLocal(votosAliables) + " votos totales. " +
        "Transferencia estimada al 65%: +" + fmtIntLocal(gananciaPotencial) + " votos.",
      impactoEstimado: gananciaPotencial,
      acciones: partidosAliables.map(function(r) {
        return "Negociar alianza con " + r.p + " (" + (r.pct*100).toFixed(1) + "%) — impacto: +" +
          fmtIntLocal(Math.round(r.v * 0.65)) + " votos";
      })
    });
  }

  // 3. INVERSIÓN TERRITORIAL SELECTIVA — top 5 territorios por ROI
  var efic = calcularEficienciaTerritorios(ctx, { nivel: nivel, lider: lider });
  var topROI = efic.filter(function(t) { return t.tipo === "voltear" || t.tipo === "asegurar"; }).slice(0, 5);
  if (topROI.length > 0) {
    recomendaciones.push({
      tipo: "territorial",
      prioridad: "alta",
      titulo: "Inversión territorial selectiva (mayor ROI)",
      detalle: "Territorios donde el costo por voto es más bajo y el impacto más alto.",
      impactoEstimado: topROI.reduce(function(s, t) { return s + t.votosDisponibles; }, 0),
      acciones: topROI.map(function(t) {
        return (t.tipo === "voltear" ? "🎯 VOLTEAR " : "🛡 ASEGURAR ") + t.nombre +
          " — " + t.rival + " lidera por " +
          (t.gap > 0 ? "+" + (t.gap * 100).toFixed(1) + "pp" : "partido ya ganando") +
          " · ROI: " + t.roi;
      })
    });
  }

  // 4. ARRASTRE PRESIDENCIAL — para niveles sub-pres
  if (nivel !== "pres") {
    var presLv  = getLevel(ctx, 2024, "pres");
    var presNat = presLv.nacional;
    var presRanked = rankVotes(presNat.votes, presNat.emitidos);
    var presLider  = presRanked.filter(function(r) { return r.p === lider; })[0];
    if (presLider && presLider.pct > 0.40) {
      recomendaciones.push({
        tipo: "arrastre",
        prioridad: presLider.pct > 0.50 ? "alta" : "media",
        titulo: "Capitalizar arrastre presidencial",
        detalle: lider + " obtuvo " + (presLider.pct * 100).toFixed(1) + "% en presidencial 2024. " +
          "Con ese margen, el arrastre esperado en " + nivel + " es k≈" +
          (presLider.pct > 0.50 ? "0.55" : "0.35") + ".",
        impactoEstimado: Math.round(lVotos * (presLider.pct > 0.50 ? 0.55 : 0.35) * presLider.pct),
        acciones: [
          "Asociar la campaña " + nivel + " con la imagen presidencial en materiales de campaña",
          "Coordinar eventos conjuntos candidato presidencial + legislativos/municipales",
          "En zonas donde el candidato presidencial es fuerte, priorizar boleta corrida"
        ]
      });
    }
  }

  // 5. CONSOLIDACIÓN DE TERRITORIOS PROPIOS FRÁGILES
  var fragiles = efic.filter(function(t) { return t.tipo === "asegurar" || t.tipo === "fragil"; }).slice(0, 3);
  if (fragiles.length > 0) {
    recomendaciones.push({
      tipo: "consolidacion",
      prioridad: "media",
      titulo: "Consolidar territorios frágiles",
      detalle: "Territorios donde " + lider + " gana pero por menos de 10pp — en riesgo de perderse.",
      impactoEstimado: null,
      acciones: fragiles.map(function(t) {
        return "⚠ " + t.nombre + " — margen actual: +" + ((t.lPct - t.rivalPct) * 100).toFixed(1) + "pp sobre " + t.rival;
      })
    });
  }

  // Ordenar por prioridad: alta > media > baja
  var orden = { "alta": 0, "media": 1, "baja": 2 };
  recomendaciones.sort(function(a, b) { return (orden[a.prioridad] || 2) - (orden[b.prioridad] || 2); });

  return recomendaciones;
}

function fmtIntLocal(n) {
  if (n == null) return "-";
  return Math.round(n).toLocaleString("es-DO");
}

export function generarEscenarios(ctx, params) {
  var nivel     = params.nivel;
  var metaValor = params.metaValor;
  var metas = {
    conservador: metaValor * 0.90,
    razonable:   metaValor,
    optimizado:  metaValor * 1.05,
    agresivo:    metaValor * 1.12,
  };
  function calc(meta) {
    return nivel === "dip"
      ? calcularDipMeta(ctx, Object.assign({}, params, { metaCurules: Math.round(meta) }))
      : calcularDeltaParaMeta(ctx, Object.assign({}, params, { metaPct: meta / 100 }));
  }
  return {
    conservador: calc(metas.conservador),
    razonable:   calc(metas.razonable),
    optimizado:  calc(metas.optimizado),
    agresivo:    calc(metas.agresivo),
  };
}
