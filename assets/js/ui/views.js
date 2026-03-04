/**
 * SIE 2028  ui/views.js
 * REGLA: cero backticks anidados. Toda interpolacin condicional usa funciones helper.
 */
import { toast }              from "./toast.js";
import { initMap }            from "./map.js";
import { getLevel, getInscritos } from "../core/data.js";
import { simular }            from "../core/simulacion.js";
import { generarEscenarios, calcularProvinciasCriticas } from "../core/objetivo.js";
import { calcPotencial }      from "../core/potencial.js";
import { runAuditoria }       from "../core/auditoria.js";
import { simBoleta }          from "../core/boleta.js";
import { exportarPDF }        from "../core/exportar.js";
import { fmtInt, fmtPct, rankVotes } from "../core/utils.js";
import { generarAlertas, renderAlertasHtml } from "../core/alertas.js";
import { proyectarPadron }    from "../core/proyeccion2028.js";

//  Constantes 
const NIVEL_LABEL = { pres:"Presidencial", sen:"Senadores", dip:"Diputados", mun:"Alcaldes", dm:"DM" };
const CORTE_LABEL = { mayo2024:"Mayo 2024", feb2024:"Feb 2024", proy2028:"Proy. 2028" };
const PARTY_COLORS = {
  PRM:"#7A52F4", PLD:"#9B1B30", FP:"#1B7BF4", PRD:"#E8B124",
  BIS:"#2EAE70", PRSC:"#5599FF", DXC:"#888", ALPAIS:"#E86A24",
};
const MOV_COEF = { pres:1.00, sen:0.85, dip:0.75, mun:0.70, dm:0.70 };

function clr(p) { return PARTY_COLORS[p] || "#555"; }
function view()  { return document.getElementById("view"); }
function el(id)  { return document.getElementById(id); }

//  Helpers UI (sin backticks anidados) 

function kpi(label, value, sub, accent) {
  var subHtml = sub ? "<div class=\"kpi-sub\">" + sub + "</div>" : "";
  var cls = accent ? "kpi-card kpi-accent" : "kpi-card";
  return "<div class=\"" + cls + "\"><div class=\"kpi-label\">" + label + "</div><div class=\"kpi-value\">" + value + "</div>" + subHtml + "</div>";
}

function dot(p) {
  return "<span class=\"dot\" style=\"background:" + clr(p) + "\"></span>";
}

function barRow(p, v, pct) {
  var w = Math.round(pct * 100);
  return "<div class=\"bar-row\">" +
    "<span class=\"bar-label\">" + p + "</span>" +
    "<div class=\"bar-track\"><div class=\"bar-fill\" style=\"width:" + w + "%;background:" + clr(p) + "\"></div></div>" +
    "<span class=\"bar-pct\">" + fmtPct(pct) + "</span>" +
    "<span class=\"bar-abs muted\">" + fmtInt(v) + "</span>" +
    "</div>";
}

function barChart(ranked, limit) {
  limit = limit || 6;
  var rows = ranked.slice(0, limit);
  if (!rows.length) return "<p class=\"muted\">Sin datos</p>";
  return rows.map(function(r) { return barRow(r.p, r.v, r.pct); }).join("");
}

function votesTr(p, v, pct, curul) {
  var curulTd = curul !== undefined ? "<td class=\"r\"><b>" + curul + "</b></td>" : "";
  return "<tr>" + dot(p) + p + "</td><td class=\"r\">" + fmtInt(v) + "</td><td class=\"r\">" + fmtPct(pct) + "</td>" + curulTd + "</tr>";
}

function votesTableHtml(ranked, curulesByParty) {
  if (!ranked.length) return "<p class=\"muted\">Sin datos</p>";
  var hasCurules = curulesByParty && Object.keys(curulesByParty).length;
  var curulTh = hasCurules ? "<th class=\"r\">Cur.</th>" : "";
  var rows = ranked.map(function(r) {
    var curul = hasCurules ? (curulesByParty[r.p] || 0) : undefined;
    return "<tr><td>" + dot(r.p) + r.p + "</td><td class=\"r\">" + fmtInt(r.v) + "</td><td class=\"r\">" + fmtPct(r.pct) + "</td>" +
      (hasCurules ? "<td class=\"r\"><b>" + curul + "</b></td>" : "") + "</tr>";
  });
  return "<table class=\"tbl\"><thead><tr><th>Partido</th><th class=\"r\">Votos</th><th class=\"r\">%</th>" + curulTh + "</tr></thead><tbody>" + rows.join("") + "</tbody></table>";
}

function curulesGrid(byParty) {
  var top = Object.entries(byParty).sort(function(a,b){return b[1]-a[1];}).slice(0,10);
  return "<div class=\"curul-grid\">" + top.map(function(kv) {
    return "<div class=\"curul-item\" style=\"border-left:3px solid " + clr(kv[0]) + "\"><b>" + kv[0] + "</b><span>" + kv[1] + "</span></div>";
  }).join("") + "</div>";
}

function catBadge(label, cls) {
  return "<span class=\"cat-badge " + cls + "\">" + label + "</span>";
}

function badge(txt, cls) {
  return "<span class=\"badge " + (cls||"") + "\">" + txt + "</span>";
}

function opt(value, label, selected) {
  return "<option value=\"" + value + "\"" + (selected ? " selected" : "") + ">" + label + "</option>";
}

function optionsList(parties, selectedVal) {
  return parties.map(function(p) { return opt(p, p, p === selectedVal); }).join("");
}

function statGrid(items) {
  var cells = items.map(function(it) {
    return "<div><span class=\"muted\">" + it[0] + "</span><br><b>" + it[1] + "</b></div>";
  }).join("");
  return "<div class=\"stat-grid\">" + cells + "</div>";
}

function sep() { return "<hr class=\"sep\">"; }

//  Global controls 
export function mountGlobalControls(state) {
  var slot = el("global-controls");
  if (!slot) return;
  var nOpts = Object.entries(NIVEL_LABEL).map(function(kv) { return opt(kv[0], kv[1], kv[0]===state.nivel); }).join("");
  var cOpts = Object.entries(CORTE_LABEL).map(function(kv) { return opt(kv[0], kv[1], kv[0]===state.corte); }).join("");
  slot.innerHTML =
    "<div class=\"ctrl-group\">" +
      "<label class=\"ctrl-label\" title=\"Afecta todos los modulos: Dashboard, Mapa, Simulador, Potencial y Movilizacion\">Nivel de Eleccion Activo</label>" +
      "<select id=\"g-nivel\" class=\"sel-sm\" title=\"Afecta todos los modulos\">" + nOpts + "</select>" +
    "</div>" +
    "<div class=\"ctrl-group\">" +
      "<label class=\"ctrl-label\" title=\"Determina el padron base para calcular participacion y abstencion proyectada\">Corte (Padron y Participacion)</label>" +
      "<select id=\"g-corte\" class=\"sel-sm\" title=\"Afecta padron, participacion y proyeccion base\">" + cOpts + "</select>" +
    "</div>";
  el("g-nivel").addEventListener("change", function(e) { state.setNivel(e.target.value); state.recomputeAndRender(); });
  el("g-corte").addEventListener("change", function(e) { state.setCorte(e.target.value); state.recomputeAndRender(); });
}

//  1. DASHBOARD 
export function renderDashboard(state, ctx) {
  var nivel  = state.nivel;
  var isProy = state.modo === "proy2028";
  var year   = isProy ? 2028 : 2024;
  var lv     = getLevel(ctx, year, nivel) || getLevel(ctx, 2024, nivel);
  var nat    = lv.nacional;
  var ins    = nivel === "pres" ? (getInscritos(ctx, state.corte) || nat.inscritos || 0) : (nat.inscritos || 0);
  if (isProy && ctx.padron2028) ins = ctx.padron2028.total;
  var em     = nat.emitidos || 0;
  var part   = ins ? em / ins : 0;
  var ranked = rankVotes(nat.votes, em);
  var top    = ranked[0];
  var top2   = ranked[1];
  var margen = top && top2 ? top.pct - top2.pct : (top ? top.pct : 0);

  var dipCurules = null;
  var senResult  = null;
  var munResult  = null;
  if (nivel === "dip") {
    var baseRes = simular(ctx, { nivel:"dip", year: isProy ? 2028 : 2024, corte:state.corte });
    dipCurules = baseRes.curules ? baseRes.curules.totalByParty : {};
  }
  if (nivel === "sen") {
    senResult = simular(ctx, { nivel:"sen", year: isProy ? 2028 : 2024 });
  }
  if (nivel === "mun") {
    munResult = simular(ctx, { nivel:"mun", year: isProy ? 2028 : 2024 });
  }

  var simForAlertas = dipCurules ? { ranked: ranked, curules: { totalByParty: dipCurules } }
    : senResult ? senResult : null;
  var alertas = generarAlertas(ctx, nivel, simForAlertas);

  var modoBanner = "";
  if (isProy && ctx.padron2028) {
    var p28 = ctx.padron2028;
    var fuente = (lv._proyeccion && lv._proyeccion.fuente) ? lv._proyeccion.fuente : "tendencia";
    modoBanner = "<div class=\"card\" style=\"margin-bottom:14px;border-color:var(--accent);background:var(--blue-bg);\">" +
      "<div style=\"display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:space-between;\">" +
        "<div style=\"display:flex;align-items:center;gap:10px;flex-wrap:wrap;\">" +
          "<span style=\"font-weight:700;color:var(--accent);\">✦ Proyección 2028</span>" +
          "<span class=\"muted\" style=\"font-size:12px;\">" +
            "Padrón: <b>" + fmtInt(p28.total) + "</b> " +
            "(<span style=\"color:var(--green)\">+" + fmtInt(p28.deltaTotal) + "</span> vs 2024) · " +
            "Interior: " + fmtInt(p28.interior) + " · " +
            "Exterior: " + fmtInt(p28.exterior) + " · " +
            "Participación: <b>" + (p28.participacion * 100).toFixed(2) + "%</b>" +
            (p28.ajuste !== 0 ? " (<span style=\"color:var(--accent)\">" + (p28.ajuste > 0 ? "+" : "") + (p28.ajuste * 100).toFixed(1) + "pp ajuste</span>)" : "") + " · " +
            "Emitidos: <b>" + fmtInt(p28.emitidosProyectados) + "</b> · " +
            "Fuente: <b>" + fuente + "</b>" +
          "</span>" +
        "</div>" +
        "<span class=\"muted\" style=\"font-size:10px;white-space:nowrap;\">" +
          "Int: ×(1+1.66%)⁴ · Ext: ×(1+10.6%)⁴" +
        "</span>" +
      "</div>" +
    "</div>";
  }

  var kpisHtml = _buildKpisByNivel(nivel, ins, em, part, ranked, margen, dipCurules, senResult, munResult, state, ctx, isProy);

  var dipSection = "";
  if (nivel === "dip" && dipCurules) {
    var dipRanked = ranked.filter(function(r) { return (dipCurules[r.p] || 0) > 0; });
    dipSection = sep() + "<h3 style=\"margin-top:12px;\">Curules (D'Hondt base)</h3>" + votesTableHtml(dipRanked, dipCurules);
  }
  var senSection = "";
  if (nivel === "sen" && senResult && senResult.senadores) {
    var tb = senResult.senadores.totalByParty;
    var senRanked = ranked.filter(function(r) { return (tb[r.p] || 0) > 0; });
    senSection = sep() + "<h3 style=\"margin-top:12px;\">Senadores</h3>" + votesTableHtml(senRanked, tb);
  }
  var munSection = "";
  if (nivel === "mun" && munResult && munResult.ganadores) {
    var tb2 = munResult.ganadores.totalByParty;
    munSection = sep() + "<h3 style=\"margin-top:12px;\">Municipios ganados</h3>" + curulesGrid(tb2);
  }

  var execItems = _buildExecItems(nivel, top, top2, margen, part, ins, em, dipCurules, senResult);
  var compBlock = _buildCompBlock(ctx, ranked, isProy);

  view().innerHTML =
    "<div class=\"page-header\"><h2>Dashboard - " + NIVEL_LABEL[nivel] + "</h2>" +
      badge(CORTE_LABEL[state.corte]) +
      (isProy ? " " + badge("Proy. 2028", "badge-warn") : "") +
    "</div>" +
    modoBanner +
    "<div class=\"kpi-grid\">" + kpisHtml + "</div>" +
    compBlock +
    "<div class=\"row-2col\" style=\"margin-top:16px;gap:16px;\">" +
      "<div class=\"card\"><h3>Distribucion - " + NIVEL_LABEL[nivel] + "</h3>" +
        barChart(ranked, 7) + dipSection + senSection + munSection +
      "</div>" +
      "<div>" +
        "<div class=\"card\" style=\"margin-bottom:12px;\"><h3>Resumen Ejecutivo</h3>" +
          "<ul class=\"exec-list\">" + execItems + "</ul>" +
          "<div style=\"margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;\">" +
            "<button class=\"btn\" onclick=\"location.hash='#simulador'\">Simulador</button>" +
            "<button class=\"btn-sm\" onclick=\"location.hash='#objetivo'\">Objetivo</button>" +
            "<button class=\"btn-sm\" onclick=\"location.hash='#auditoria'\">Auditoria</button>" +
          "</div>" +
        "</div>" +
        (alertas.length
          ? "<div class=\"card\"><h3>Alertas (" + alertas.length + ")</h3>" +
              renderAlertasHtml(alertas, true) + "</div>"
          : "") +
      "</div>" +
    "</div>";
}

function _buildKpisByNivel(nivel, ins, em, part, ranked, margen, dipCurules, senResult, munResult, state, ctx, isProy) {
  var top  = ranked[0];
  var top2 = ranked[1];
  var kpisHtml = "";
  var label24 = isProy ? "Proy. 2028" : "2024";
  var kpiTop  = top  ? kpi("Lider " + label24, top.p,  fmtPct(top.pct),  true) : "";
  var kpiTop2 = top2 ? kpi("2do lugar",  top2.p, fmtPct(top2.pct)) : "";

  if (nivel === "pres") {
    var riesgo2v  = top && top.pct < 0.5;
    var riesgoCls = riesgo2v ? "text-warn" : "text-ok";
    var riesgoTxt = riesgo2v ? "Alto" : "Bajo";
    kpisHtml =
      kpi("Padron", fmtInt(ins), CORTE_LABEL[state.corte]) +
      kpi("Emitidos " + label24, fmtInt(em)) +
      kpi("Participacion", fmtPct(part)) +
      kpi("Abstencion proyectada", fmtPct(1-part), fmtInt(Math.round(ins*(1-part))) + " votos") +
      kpiTop + kpiTop2 +
      kpi("Margen Top1-Top2", margen > 0 ? fmtPct(margen) : "-") +
      kpi("Riesgo 2a vuelta", "<span class=\"" + riesgoCls + "\">" + riesgoTxt + "</span>",
          top ? (top.pct < 0.5 ? "Faltan " + fmtPct(0.5 - top.pct) : "Sobre el umbral") : "");
  } else if (nivel === "sen") {
    var senByP  = senResult && senResult.senadores ? senResult.senadores.totalByParty : {};
    var liderSen = top ? (senByP[top.p] || 0) : 0;
    kpisHtml =
      kpi("Curules actuales " + (top ? top.p : ""), String(liderSen), "de 32 senadores") +
      kpi("Mayoria requerida", "17", "senadores") +
      kpi("Provincias competitivas", String(_countCompetitivos(ctx, "sen")), "<5pp de margen") +
      kpiTop + kpiTop2 +
      kpi("Participacion relativa", fmtPct(part));
  } else if (nivel === "dip") {
    var liderDip  = top && dipCurules ? (dipCurules[top.p] || 0) : 0;
    var marginals = dipCurules ? _countMarginalDip(ctx) : 0;
    kpisHtml =
      kpi("Curules proyectadas " + (top ? top.p : ""), String(liderDip), "de 190 diputados") +
      kpi("Mayoria requerida", "96", "diputados") +
      kpi("Curules marginales", String(marginals), "circunscripciones ajustadas") +
      kpiTop + kpiTop2 +
      kpi("Variacion por abstencion", fmtPct(1-part), fmtInt(Math.round(ins*(1-part))) + " abs.");
  } else if (nivel === "mun") {
    var munByP   = munResult && munResult.ganadores ? munResult.ganadores.totalByParty : {};
    var liderMun = top ? (munByP[top.p] || 0) : 0;
    var compMun  = _countCompetitivos(ctx, "mun");
    kpisHtml =
      kpi("Municipios dominados", String(liderMun), top ? top.p : "") +
      kpi("Municipios competitivos", String(compMun), "<5pp de margen") +
      kpiTop + kpiTop2 +
      kpi("Participacion", fmtPct(part));
  } else {
    kpisHtml =
      kpi("Padron", fmtInt(ins)) +
      kpi("Emitidos", fmtInt(em)) +
      kpi("Participacion", fmtPct(part)) +
      kpiTop;
  }

  // KPI encuesta si hay datos
  var polls = ctx.polls || [];
  if (polls.length && top) {
    var last   = polls[polls.length - 1];
    var encRes = last.resultados || {};
    if (encRes[top.p] !== undefined) {
      var encPct = encRes[top.p] / 100;
      var delta  = encPct - top.pct;
      var cls    = delta > 0 ? "text-ok" : delta < 0 ? "text-warn" : "";
      var sign   = delta > 0 ? "+" : "";
      kpisHtml += kpi(
        "Encuesta " + last.encuestadora,
        "<span class=\"" + cls + "\">" + encRes[top.p] + "%</span>",
        sign + (delta * 100).toFixed(1) + "pp vs " + label24
      );
    }
  }

  return kpisHtml;
}

function _buildExecItems(nivel, top, top2, margen, part, ins, em, dipCurules, senResult) {
  var items = "";
  if (nivel === "pres") {
    var riskClass = top && top.pct < 0.5 ? "text-warn" : "text-ok";
    var riskLabel = top && top.pct < 0.5 ? "Si (lider <50%)" : "Bajo";
    items += "<li>Riesgo 2a vuelta: <b class=\"" + riskClass + "\">" + riskLabel + "</b></li>";
    items += "<li>Margen sobre 2: <b>" + fmtPct(margen) + "</b></li>";
  }
  if (nivel === "dip" && dipCurules && top) {
    var liderCur = dipCurules[top.p] || 0;
    var majClass = liderCur >= 96 ? "text-ok" : "text-warn";
    items += "<li>Curules " + top.p + ": <b>" + liderCur + " / 190</b></li>";
    items += "<li>Mayoria (96+): <b class=\"" + majClass + "\">" + (liderCur >= 96 ? "Si" : "No") + "</b></li>";
  }
  if (nivel === "sen" && senResult && senResult.senadores && top) {
    var tb  = senResult.senadores.totalByParty;
    var sc  = tb[top.p] || 0;
    var mc  = sc >= 17 ? "text-ok" : "text-warn";
    items += "<li>Senadores " + top.p + ": <b>" + sc + " / 32</b></li>";
    items += "<li>Mayoria (17+): <b class=\"" + mc + "\">" + (sc >= 17 ? "Si" : "No") + "</b></li>";
  }
  items += "<li>Participacion: <b>" + fmtPct(part) + "</b></li>";
  items += "<li>Abstencion: <b>" + fmtInt(Math.round(ins*(1-part))) + " votos</b></li>";
  return items;
}

function _buildCompBlock(ctx, ranked, isProy) {
  var polls = ctx.polls || [];
  if (!polls.length || !ranked.length) return "";
  var last = polls[polls.length - 1];
  var enc  = last.resultados || {};
  var topN = ranked.slice(0, 6);
  var rows = topN.map(function(r) {
    var e24  = fmtPct(r.pct);
    var eEnc = enc[r.p] !== undefined ? (enc[r.p] + "%") : "-";
    var d    = enc[r.p] !== undefined ? enc[r.p] / 100 - r.pct : null;
    var dStr = d !== null
      ? "<span class=\"" + (d>0?"text-ok":d<0?"text-warn":"") + "\">" +
          (d>0?"+":"") + (d*100).toFixed(1) + "pp</span>"
      : "-";
    return "<tr><td>" + dot(r.p) + r.p + "</td><td class=\"r\">" + e24 + "</td><td class=\"r\">" + eEnc + "</td><td class=\"r\">" + dStr + "</td></tr>";
  }).join("");
  var colLabel = isProy ? "Proy. 2028" : "2024 JCE";
  return "<div class=\"card\" style=\"margin-top:14px;\">" +
    "<h3 style=\"margin-bottom:8px;\">Comparativo: " + colLabel + " vs Encuesta (" + last.encuestadora + " " + last.fecha + ")</h3>" +
    "<div style=\"overflow:auto;\">" +
      "<table class=\"tbl\"><thead><tr>" +
        "<th>Partido</th><th class=\"r\">" + colLabel + "</th><th class=\"r\">Encuesta</th><th class=\"r\">Delta</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table>" +
    "</div>" +
  "</div>";
}

function _countCompetitivos(ctx, nivel) {
  var lv   = getLevel(ctx, 2024, nivel);
  var terr = nivel === "mun" ? (lv.mun || {}) : (lv.prov || {});
  var count = 0;
  Object.keys(terr).forEach(function(id) {
    var t = terr[id];
    var ranked = rankVotes(t.votes || {}, t.emitidos || 1);
    if (ranked.length >= 2 && (ranked[0].pct - ranked[1].pct) < 0.05) count++;
  });
  return count;
}

function _countMarginalDip(ctx) {
  var cur = ctx.curules;
  if (!cur || !cur.territorial) return 0;
  var lv  = getLevel(ctx, 2024, "dip");
  var count = 0;
  cur.territorial.forEach(function(c) {
    var pid      = String(c.provincia_id).padStart(2, "0");
    var key      = c.circ > 0 ? pid + "-" + c.circ : pid;
    var provData = (lv.circ && lv.circ[key]) ? lv.circ[key] : (lv.prov && lv.prov[pid] ? lv.prov[pid] : null);
    if (!provData || !provData.votes) return;
    var topP = Object.keys(provData.votes).sort(function(a,b){ return (provData.votes[b]||0) - (provData.votes[a]||0); })[0];
    if (!topP) return;
    var topV = provData.votes[topP] || 0;
    if (topV > 0 && c.seats > 0 && (topV / c.seats) < 3000) count++;
  });
  return count;
}

//  2. MAPA 
var _mapApi = null;

//  2. MAPA 

export function renderMapa(state, ctx) {
  var nivel   = state.nivel;
  var isProy  = state.modo === "proy2028";
  var year    = isProy ? 2028 : 2024;
  var lv      = getLevel(ctx, year, nivel) || getLevel(ctx, 2024, nivel);
  var lv2024  = getLevel(ctx, 2024, nivel);
  var dipRes  = nivel === "dip" ? simular(ctx, { nivel:"dip", year: year }) : null;

  view().innerHTML =
    "<div class=\"page-header\"><h2>Mapa - " + NIVEL_LABEL[nivel] + "</h2>" +
      "<div style=\"display:flex;gap:6px;flex-wrap:wrap;align-items:center;\">" +
        "<button class=\"btn-sm\" id=\"map-zi\">Zoom +</button>" +
        "<button class=\"btn-sm\" id=\"map-zo\">Zoom -</button>" +
        "<button class=\"btn-sm\" id=\"map-r\">Reset</button>" +
        (isProy ? " " + "<span class=\"badge badge-warn\">Proy. 2028</span>" : "") +
      "</div>" +
    "</div>" +
    "<div style=\"font-size:11px;color:var(--text2);margin-bottom:8px;\">" +
      "<span style=\"display:inline-block;width:12px;height:12px;background:#888;border-radius:2px;vertical-align:middle;margin-right:4px;\"></span>Competitivo &lt;5pp" +
    "</div>" +
    "<div class=\"map-layout\">" +
      "<div class=\"map-wrap card\" id=\"map-container\" style=\"min-height:500px;padding:0!important;\"></div>" +
      "<div class=\"card\" id=\"map-panel\" style=\"overflow-y:auto;max-height:560px;\"><p class=\"muted\">Click en una provincia.</p></div>" +
    "</div>";

  el("map-zi").addEventListener("click", function() { if (_mapApi) _mapApi.zoomIn(); });
  el("map-zo").addEventListener("click", function() { if (_mapApi) _mapApi.zoomOut(); });
  el("map-r").addEventListener("click",  function() { if (_mapApi) _mapApi.reset(); });

  _mapApi = initMap({
    containerId: "map-container",
    svgUrl: "./assets/maps/provincias.svg",
    onSelect: function(provId) { showProvPanel(lv, lv2024, provId, nivel, dipRes, ctx); },
    onReady: function() {
      if (nivel === "pres" || nivel === "sen" || nivel === "dip") {
        Object.keys(lv.prov).forEach(function(pid) {
          var prov = lv.prov[pid];
          var r = rankVotes(prov.votes, prov.emitidos);
          if (r[0]) {
            var shape = document.querySelector("[id=\"DO-" + pid + "\"]");
            if (shape) {
              var margenProv = r.length >= 2 ? r[0].pct - r[1].pct : 1;
              shape.style.fill    = margenProv < 0.05 ? "#888" : clr(r[0].p);
              shape.style.opacity = String(0.35 + r[0].pct * 0.65);
            }
          }
        });
      }
      if (_mapApi && _mapApi.validate) {
        _mapApi.validate(Object.keys(lv.prov));
      }
    },
  });
}

function showProvPanel(lv, lv2024, provId, nivel, dipRes, ctx) {
  var panel = el("map-panel");
  if (!panel) return;
  var prov   = lv.prov ? lv.prov[provId] : null;
  var prov24 = lv2024 && lv2024.prov ? lv2024.prov[provId] : null;
  if (!prov) { panel.innerHTML = "<p class=\"muted\">Sin datos para provincia " + provId + ".</p>"; return; }

  var part   = prov.inscritos ? prov.emitidos / prov.inscritos : 0;
  var ranked = rankVotes(prov.votes, prov.validos || prov.emitidos);
  var margen = ranked.length >= 2 ? ranked[0].pct - ranked[1].pct : null;

  // Swing necesario para voltear
  var swingBlock = "";
  if (margen !== null && margen > 0 && ranked.length >= 2) {
    var emRef = prov.validos || prov.emitidos || 1;
    var swingV = Math.round((margen / 2) * emRef);
    var swingPP = margen / 2;
    swingBlock = "<div style=\"margin-top:10px;padding:8px;background:var(--bg3);border-radius:6px;font-size:12px;\">" +
      "<span class=\"muted\">Swing para voltear: </span>" +
      "<b>" + fmtInt(swingV) + " votos (" + fmtPct(swingPP) + ")</b>" +
    "</div>";
  }

  // Comparativo historico vs proyectado
  var histBlock = "";
  if (prov24 && prov !== prov24) {
    var ranked24 = rankVotes(prov24.votes, prov24.validos || prov24.emitidos);
    if (ranked24.length) {
      var hrows = ranked24.slice(0, 5).map(function(r) {
        var rProy = ranked.filter(function(x){ return x.p === r.p; })[0];
        var delta = rProy ? rProy.pct - r.pct : null;
        var dStr  = delta !== null
          ? "<span class=\"" + (delta > 0 ? "text-ok" : "text-warn") + "\">" + (delta > 0 ? "+" : "") + fmtPct(delta) + "</span>"
          : "-";
        return "<tr><td>" + dot(r.p) + r.p + "</td><td class=\"r\">" + fmtPct(r.pct) + "</td><td class=\"r\">" + dStr + "</td></tr>";
      }).join("");
      histBlock = "<h4 style=\"margin:12px 0 6px;\">2024 Real vs Proyectado</h4>" +
        "<table class=\"tbl\"><thead><tr><th>Partido</th><th class=\"r\">2024</th><th class=\"r\">Delta</th></tr></thead>" +
        "<tbody>" + hrows + "</tbody></table>";
    }
  }

  // Encuesta aplicada
  var encBlock = "";
  var polls = ctx ? (ctx.polls || []) : [];
  if (polls.length && ranked.length) {
    var last = polls[polls.length - 1];
    var enc  = last.resultados || {};
    if (enc[ranked[0].p] !== undefined) {
      var encPct = enc[ranked[0].p] / 100;
      var delta  = encPct - ranked[0].pct;
      var cls    = delta > 0 ? "text-ok" : "text-warn";
      encBlock = "<div style=\"margin-top:8px;font-size:12px;padding:6px 8px;background:var(--bg3);border-radius:4px;\">" +
        "<span class=\"muted\">Encuesta (" + last.encuestadora + "): </span>" +
        ranked[0].p + " " +
        "<span class=\"" + cls + "\">" + (delta > 0 ? "+" : "") + fmtPct(delta) + " vs base</span>" +
      "</div>";
    }
  }

  // Curules D'Hondt para dip
  var curulesHtml = "";
  if (nivel === "dip" && dipRes && dipRes.curules) {
    var byCirc    = dipRes.curules.byCirc || {};
    var provCircs = Object.keys(byCirc).filter(function(k) { return k === provId || k.indexOf(provId + "-") === 0; });
    if (provCircs.length) {
      var crows = provCircs.map(function(cid) {
        var c    = byCirc[cid];
        var dist = Object.keys(c.byParty).filter(function(p) { return c.byParty[p] > 0; })
          .map(function(p) { return dot(p) + p + ":" + c.byParty[p]; }).join(" ");
        return "<tr><td>" + cid + "</td><td class=\"r\">" + c.seats + "</td><td style=\"font-size:11px;\">" + dist + "</td></tr>";
      }).join("");
      curulesHtml = "<h4 style=\"margin:12px 0 6px;\">Curules</h4>" +
        "<table class=\"tbl\"><thead><tr><th>Circ.</th><th class=\"r\">Esc.</th><th>Dist.</th></tr></thead>" +
        "<tbody>" + crows + "</tbody></table>";
    }
  }

  panel.innerHTML =
    "<h3 style=\"margin:0 0 10px;\">" + (prov.nombre || "Provincia " + provId) + "</h3>" +
    statGrid([
      ["Inscritos",      fmtInt(prov.inscritos)],
      ["Emitidos",       fmtInt(prov.emitidos)],
      ["Participacion",  fmtPct(part)],
      ["Margen 1-2",     margen !== null ? fmtPct(margen) : "-"],
    ]) +
    "<div style=\"margin-top:10px;\">" + barChart(ranked, 6) + "</div>" +
    "<div style=\"margin-top:8px;\">"  + votesTableHtml(ranked.slice(0, 8)) + "</div>" +
    swingBlock +
    encBlock +
    histBlock +
    curulesHtml;
}

//  3. SIMULADOR  (tabs: Base | Encuestas | Movilizacion | Alianzas | Arrastre)
export function renderSimulador(state, ctx) {
  var nivel  = state.nivel;
  var isProy = state.modo === "proy2028";
  var year   = isProy ? 2028 : 2024;
  var lv     = getLevel(ctx, year, nivel) || getLevel(ctx, 2024, nivel);
  var nat    = lv.nacional;
  var ranked = rankVotes(nat.votes, nat.emitidos);

  var allParties = (ctx.partidos && ctx.partidos.length)
    ? ctx.partidos.map(function(p) { return p.codigo; })
    : ranked.map(function(r) { return r.p; });

  var partyData = allParties.map(function(p) {
    var e = ranked.filter(function(r) { return r.p === p; })[0];
    return { p: p, pct: e ? e.pct : 0, v: e ? e.v : 0 };
  });

  // Tabs
  var TABS = ["Base", "Encuestas", "Movilizacion", "Alianzas", "Arrastre"];

  var tblRows = partyData.slice(0, 8).map(function(r) {
    return "<tr data-p=\"" + r.p + "\">" +
      "<td>" + dot(r.p) + r.p + "</td>" +
      "<td class=\"r\">" + fmtPct(r.pct) + "</td>" +
      "<td class=\"r\"><input class=\"inp-sm delta-in\" type=\"number\" step=\"0.1\" value=\"0\" " +
        "style=\"width:68px;text-align:right;\" data-party=\"" + r.p + "\"></td></tr>";
  }).join("");

  var tblRowsAll = partyData.map(function(r) {
    return "<tr data-p=\"" + r.p + "\">" +
      "<td>" + dot(r.p) + r.p + "</td>" +
      "<td class=\"r\">" + fmtPct(r.pct) + "</td>" +
      "<td class=\"r\"><input class=\"inp-sm delta-in\" type=\"number\" step=\"0.1\" value=\"0\" " +
        "style=\"width:68px;text-align:right;\" data-party=\"" + r.p + "\"></td></tr>";
  }).join("");

  var movBtns = [-5,-3,3,5,7].map(function(pp) {
    return "<button class=\"btn-sm" + (pp < 0 ? " neg" : "") + "\" data-mov=\"" + pp + "\">" +
      (pp > 0 ? "+" : "") + pp + "</button>";
  }).join("");

  var liderOpts  = partyData.map(function(r) { return opt(r.p, r.p, false); }).join("");
  var aliadoRows = partyData.slice(1).map(function(r) {
    return "<div class=\"alianza-row\" style=\"display:flex;gap:8px;align-items:center;margin-bottom:4px;\" data-p=\"" + r.p + "\">" +
      "<input type=\"checkbox\" class=\"alz-chk\" value=\"" + r.p + "\" id=\"alz-" + r.p + "\">" +
      "<label for=\"alz-" + r.p + "\" style=\"min-width:50px;\">" + r.p + "</label>" +
      "<input class=\"inp-sm alz-pct\" type=\"number\" min=\"0\" max=\"100\" step=\"5\" value=\"80\" " +
        "style=\"width:60px;\" data-party=\"" + r.p + "\" disabled>% transf." +
    "</div>";
  }).join("");

  var arrOpts = partyData.slice(0, 8).map(function(r) { return opt(r.p, r.p, false); }).join("");
  var arrastreBlock = nivel !== "pres"
    ? "<div style=\"display:flex;gap:8px;align-items:center;flex-wrap:wrap;\">" +
        "<label><input type=\"checkbox\" id=\"sim-arrastre\"> Activar arrastre</label>" +
        "<select id=\"sim-arr-lider\" class=\"sel-sm\">" + arrOpts + "</select>" +
        "<select id=\"sim-arr-k\" class=\"sel-sm\">" +
          "<option value=\"auto\">Auto</option>" +
          "<option value=\"0.60\">k=0.60 (&gt;10pp)</option>" +
          "<option value=\"0.40\">k=0.40 (5-10pp)</option>" +
          "<option value=\"0.25\">k=0.25 (&lt;5pp)</option>" +
        "</select>" +
      "</div>"
    : "<p class=\"muted\" style=\"font-size:12px;\">Solo aplica a niveles legislativos y municipales.</p>";

  // Encuestas tab
  var polls     = ctx.polls || [];
  var encBlock  = polls.length
    ? "<p class=\"muted\" style=\"font-size:12px;margin-bottom:10px;\">Selecciona una encuesta para cargar sus deltas como punto de partida.</p>" +
        polls.map(function(p, i) {
          var topRes = Object.entries(p.resultados || {}).sort(function(a,b){return b[1]-a[1];}).slice(0,3)
            .map(function(kv){ return kv[0]+":"+kv[1]+"%"; }).join(" | ");
          return "<div style=\"padding:8px;background:var(--bg3);border-radius:6px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;\">" +
            "<div><b>" + p.encuestadora + "</b> <span class=\"muted\">" + p.fecha + " · n=" + (p.muestra||"?") + "</span><br>" +
            "<span style=\"font-size:12px;\">" + topRes + "</span></div>" +
            "<button class=\"btn-sm\" data-enc-idx=\"" + i + "\">Aplicar</button>" +
          "</div>";
        }).join("")
    : "<p class=\"muted\">Sin encuestas cargadas. Ve a la pestaña Encuestas para importar.</p>";

  var tabBtns = TABS.map(function(t, i) {
    return "<button class=\"tab-btn" + (i===0?" active":"") + "\" data-tab=\"sim-tab-" + i + "\">" + t + "</button>";
  }).join("");

  view().innerHTML =
    "<div class=\"page-header\"><h2>Simulador - " + NIVEL_LABEL[nivel] + "</h2>" +
      (isProy ? badge("Proy. 2028", "badge-warn") : "") +
    "</div>" +

    // Bloque resultado: siempre visible arriba
    "<div class=\"card\" style=\"margin-bottom:14px;\" id=\"sim-header-result\">" +
      "<div style=\"display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;\">" +
        "<div><div class=\"kpi-label\">Resultado actual</div><div id=\"sh-base\" style=\"font-size:14px;font-weight:600;\">-</div></div>" +
        "<div><div class=\"kpi-label\">Resultado simulado</div><div id=\"sh-sim\" style=\"font-size:14px;font-weight:600;color:var(--accent);\">-</div></div>" +
        "<div><div class=\"kpi-label\">Δ votos</div><div id=\"sh-dv\" style=\"font-size:14px;font-weight:600;\">-</div></div>" +
        "<div><div class=\"kpi-label\">Δ curules</div><div id=\"sh-dc\" style=\"font-size:14px;font-weight:600;\">-</div></div>" +
      "</div>" +
    "</div>" +

    "<div style=\"display:flex;gap:0;margin-bottom:0;border-bottom:2px solid var(--border);\">" + tabBtns + "</div>" +
    "<div class=\"sim-layout\" style=\"margin-top:14px;\">" +
      "<div>" +
        // Tab 0: Base
        "<div id=\"sim-tab-0\">" +
          "<div class=\"card\" style=\"margin-bottom:10px;\">" +
            "<div style=\"display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;\">" +
              "<h3>Ajuste por partido (delta pp)</h3>" +
              "<button class=\"btn-sm\" id=\"btn-show-all\">+ Todos</button>" +
            "</div>" +
            "<p class=\"muted\" style=\"font-size:11px;margin-bottom:8px;\">Variacion en pp. Se renormaliza automaticamente.</p>" +
            "<div style=\"overflow:auto;max-height:280px;\">" +
              "<table class=\"tbl\" id=\"sim-tbl\">" +
                "<thead><tr><th>Partido</th><th class=\"r\">% base</th><th class=\"r\">delta pp</th></tr></thead>" +
                "<tbody id=\"sim-tbody\">" + tblRows + "</tbody>" +
              "</table>" +
            "</div>" +
          "</div>" +
        "</div>" +
        // Tab 1: Encuestas
        "<div id=\"sim-tab-1\" style=\"display:none;\">" +
          "<div class=\"card\" style=\"margin-bottom:10px;\">" +
            "<h3>Encuestas disponibles</h3>" + encBlock +
          "</div>" +
        "</div>" +
        // Tab 2: Movilizacion
        "<div id=\"sim-tab-2\" style=\"display:none;\">" +
          "<div class=\"card\" style=\"margin-bottom:10px;\">" +
            "<h3>Movilizacion</h3>" +
            "<p class=\"muted\" style=\"font-size:12px;margin-bottom:8px;\">Coef. por nivel: pres=1.00, sen=0.85, dip=0.75, mun=0.70</p>" +
            "<div style=\"display:flex;gap:6px;flex-wrap:wrap;align-items:center;\">" + movBtns +
              "<input id=\"sim-mov\" class=\"inp-sm\" type=\"number\" step=\"0.1\" value=\"0\" style=\"width:68px;\"> pp" +
            "</div>" +
          "</div>" +
        "</div>" +
        // Tab 3: Alianzas
        "<div id=\"sim-tab-3\" style=\"display:none;\">" +
          "<div class=\"card\" style=\"margin-bottom:10px;\">" +
            "<h3>Alianzas</h3>" +
            (!ctx.alianzas || !ctx.alianzas[nivel] ?
              "<div class=\"badge-warn\" style=\"display:inline-block;margin-bottom:10px;\">⚠ alianzas_2024.json pendiente</div>" +
              "<p class=\"muted\" style=\"font-size:12px;margin-bottom:8px;\">" +
                "Las alianzas históricas 2024 aún no están cargadas. " +
                "Puedes definir alianzas ad-hoc abajo — se aplican solo a esta simulación." +
              "</p>"
            : "<p class=\"muted\" style=\"font-size:12px;margin-bottom:8px;\">Alianzas históricas 2024 cargadas como referencia.</p>") +
            "<p class=\"muted\" style=\"font-size:11px;margin-bottom:8px;\">Fórmula: votosBloque = votosPartido + (votosAliado × transferencia%)</p>" +
            "<div style=\"display:flex;gap:8px;align-items:center;margin-bottom:8px;\">" +
              "<label class=\"muted\">Líder:</label>" +
              "<select id=\"sim-lider\" class=\"sel-sm\">" + liderOpts + "</select>" +
            "</div>" +
            "<div id=\"sim-aliados\" style=\"max-height:180px;overflow-y:auto;font-size:13px;\">" + aliadoRows + "</div>" +
          "</div>" +
        "</div>" +
        // Tab 4: Arrastre
        "<div id=\"sim-tab-4\" style=\"display:none;\">" +
          "<div class=\"card\" style=\"margin-bottom:10px;\">" +
            "<h3>Arrastre presidencial</h3>" +
            "<p class=\"muted\" style=\"font-size:12px;margin-bottom:8px;\">" +
              "k automatico: &gt;10pp margen=0.60 | 5-10pp=0.40 | &lt;5pp=0.25" +
            "</p>" +
            arrastreBlock +
          "</div>" +
        "</div>" +
        // Acciones
        "<div style=\"display:flex;gap:10px;flex-wrap:wrap;margin-top:4px;\">" +
          "<button class=\"btn\" id=\"btn-sim\">Simular</button>" +
          "<button class=\"btn-sm\" id=\"btn-sim-reset\">Reset</button>" +
        "</div>" +
      "</div>" +

      // Resultado derecho
      "<div>" +
        "<div class=\"card\" id=\"sim-result\"><p class=\"muted\">Configura y presiona Simular.</p></div>" +
      "</div>" +
    "</div>";

  // Tab switching
  document.querySelectorAll(".tab-btn[data-tab]").forEach(function(btn) {
    btn.addEventListener("click", function() {
      document.querySelectorAll(".tab-btn[data-tab]").forEach(function(b) { b.classList.remove("active"); });
      btn.classList.add("active");
      TABS.forEach(function(_, i) {
        var el2 = document.getElementById("sim-tab-" + i);
        if (el2) el2.style.display = btn.dataset.tab === "sim-tab-" + i ? "" : "none";
      });
    });
  });

  // Show all parties toggle
  el("btn-show-all").addEventListener("click", function() {
    var tbody  = el("sim-tbody");
    var btn    = el("btn-show-all");
    var showing = btn.textContent === "- Menos";
    if (tbody) tbody.innerHTML = showing ? tblRows : tblRowsAll;
    btn.textContent = showing ? "+ Todos" : "- Menos";
    document.querySelectorAll(".delta-in").forEach(function(inp) {
      inp.addEventListener("input", debouncedSim);
    });
  });

  // Alianzas checkbox
  document.querySelectorAll(".alz-chk").forEach(function(chk) {
    chk.addEventListener("change", function() {
      var inp = document.querySelector(".alz-pct[data-party=\"" + chk.value + "\"]");
      if (inp) inp.disabled = !chk.checked;
    });
  });

  // Mov quick buttons
  document.querySelectorAll("[data-mov]").forEach(function(b) {
    b.addEventListener("click", function() {
      var m = el("sim-mov"); if (m) m.value = b.dataset.mov;
      debouncedSim();
    });
  });

  // Lider alianza
  el("sim-lider").addEventListener("change", function() {
    var lider = el("sim-lider").value;
    document.querySelectorAll(".alianza-row").forEach(function(row) {
      row.style.display = row.dataset.p === lider ? "none" : "";
    });
  });

  // Aplicar encuesta
  document.querySelectorAll("[data-enc-idx]").forEach(function(btn) {
    btn.addEventListener("click", function() {
      var idx = parseInt(btn.dataset.encIdx, 10);
      var enc = polls[idx];
      if (!enc || !enc.resultados) return;
      var em  = nat.emitidos || 1;
      document.querySelectorAll(".delta-in").forEach(function(inp) {
        var p     = inp.dataset.party;
        var base  = (nat.votes[p] || 0) / em;
        var encP  = enc.resultados[p] !== undefined ? enc.resultados[p] / 100 : base;
        var delta = Math.round((encP - base) * 100 * 10) / 10;
        inp.value = String(delta);
        inp.style.color = delta !== 0 ? "var(--accent)" : "";
      });
      toast("Encuesta " + enc.encuestadora + " cargada como deltas");
      runSim(ctx, state, nivel, nat);
    });
  });

  // Debounce reactivo
  var _simTimer = null;
  function debouncedSim() {
    clearTimeout(_simTimer);
    _simTimer = setTimeout(function() { runSim(ctx, state, nivel, nat); }, 300);
  }
  document.querySelectorAll(".delta-in").forEach(function(inp) {
    inp.addEventListener("input", debouncedSim);
  });
  var movInp = el("sim-mov");
  if (movInp) movInp.addEventListener("input", debouncedSim);

  el("btn-sim").addEventListener("click", function() { runSim(ctx, state, nivel, nat); });
  el("btn-sim-reset").addEventListener("click", function() {
    document.querySelectorAll(".delta-in").forEach(function(i) { i.value = "0"; i.style.color = ""; });
    var m = el("sim-mov"); if (m) m.value = "0";
    document.querySelectorAll(".alz-chk").forEach(function(c) { c.checked = false; });
    document.querySelectorAll(".alz-pct").forEach(function(p) { p.disabled = true; });
    var res = el("sim-result"); if (res) res.innerHTML = "<p class=\"muted\">Reset.</p>";
    var sh = el("sim-header-result");
    if (sh) {
      ["sh-base","sh-sim","sh-dv","sh-dc"].forEach(function(id){
        var e=document.getElementById(id); if(e) e.textContent="-";
      });
    }
  });

  // Run initial base calculation to populate header
  runSim(ctx, state, nivel, nat);
}

// runSim: reads UI state, calls simular(), populates results
function runSim(ctx, state, nivel, nat) {
  // Read deltas
  var deltasPP = {};
  document.querySelectorAll(".delta-in").forEach(function(inp) {
    var v = parseFloat(inp.value) || 0;
    if (v !== 0) deltasPP[inp.dataset.party] = v;
  });

  // Read movilizacion
  var movPP = parseFloat((el("sim-mov") || {}).value) || 0;

  // Read alianzas
  var alianzas = [];
  var liderSel = el("sim-lider") ? el("sim-lider").value : null;
  if (liderSel) {
    var aliados = [];
    document.querySelectorAll(".alz-chk:checked").forEach(function(chk) {
      var pct2 = document.querySelector(".alz-pct[data-party=\"" + chk.value + "\"]");
      aliados.push({ partido: chk.value, transferPct: pct2 ? Number(pct2.value) : 80 });
    });
    if (aliados.length) {
      alianzas.push({ lider: liderSel, aliados: aliados });
    }
  }

  // Read arrastre
  var arrastre     = el("sim-arrastre") ? el("sim-arrastre").checked : false;
  var arrastreLider = el("sim-arr-lider") ? el("sim-arr-lider").value : null;
  var arrastreKVal  = el("sim-arr-k") ? el("sim-arr-k").value : "auto";
  var arrastreK2   = arrastreKVal === "auto" ? null : parseFloat(arrastreKVal);

  var isProy = state.modo === "proy2028";
  var year   = isProy ? 2028 : 2024;

  var res = simular(ctx, {
    nivel:         nivel,
    year:          year,
    deltasPP:      deltasPP,
    alianzas:      alianzas,
    movPP:         movPP,
    arrastre:      arrastre,
    arrastreLider: arrastreLider,
    arrastreK:     arrastreK2,
    corte:         state.corte,
  });

  if (!res) return;

  // Update header before/after
  var top1base = rankVotes(nat.votes, nat.emitidos)[0];
  var top1sim  = res.ranked[0];
  var shBase   = document.getElementById("sh-base");
  var shSim    = document.getElementById("sh-sim");
  var shDv     = document.getElementById("sh-dv");
  var shDc     = document.getElementById("sh-dc");
  if (shBase && top1base) shBase.textContent = top1base.p + " " + fmtPct(top1base.pct);
  if (shSim  && top1sim)  shSim.textContent  = top1sim.p  + " " + fmtPct(top1sim.pct);
  if (shDv   && top1base && top1sim) {
    var dv = (top1sim.pct - top1base.pct) * 100;
    shDv.textContent  = (dv >= 0 ? "+" : "") + dv.toFixed(1) + "pp";
    shDv.style.color  = dv >= 0 ? "var(--green)" : "var(--red)";
  }
  if (shDc) {
    var curBase = 0; var curSim = 0;
    if (nivel === "dip") {
      var baseRes0 = simular(ctx, { nivel:"dip", year: year, corte: state.corte });
      curBase = baseRes0.curules && top1base ? (baseRes0.curules.totalByParty[top1base.p] || 0) : 0;
      curSim  = res.curules && top1sim ? (res.curules.totalByParty[top1sim.p] || 0) : 0;
    } else if (nivel === "sen") {
      var baseRes0 = simular(ctx, { nivel:"sen", year: year });
      curBase = baseRes0.senadores && top1base ? (baseRes0.senadores.totalByParty[top1base.p] || 0) : 0;
      curSim  = res.senadores && top1sim ? (res.senadores.totalByParty[top1sim.p] || 0) : 0;
    }
    if (curBase || curSim) {
      var dc = curSim - curBase;
      shDc.textContent = (dc >= 0 ? "+" : "") + dc + " curules";
      shDc.style.color = dc >= 0 ? "var(--green)" : "var(--red)";
    } else {
      shDc.textContent = "-";
    }
  }

  // Full result card
  var resDiv = el("sim-result");
  if (!resDiv) return;

  var ranked2 = res.ranked;
  var em      = res.emitidos;
  var ins     = res.inscritos;
  var part    = ins ? em / ins : 0;

  var beforeAfterRows = ranked2.slice(0, 8).map(function(r) {
    var baseEntry = nat.votes[r.p] ? (nat.votes[r.p] / (nat.emitidos || 1)) : 0;
    var delta = r.pct - baseEntry;
    var dStr  = "<span class=\"" + (delta > 0 ? "text-ok" : delta < 0 ? "text-warn" : "") + "\">" +
      (delta > 0 ? "+" : "") + fmtPct(delta) + "</span>";
    return "<tr><td>" + dot(r.p) + r.p + "</td>" +
      "<td class=\"r\">" + fmtPct(baseEntry) + "</td>" +
      "<td class=\"r\" style=\"color:var(--accent);\">" + fmtPct(r.pct) + "</td>" +
      "<td class=\"r\">" + dStr + "</td>" +
      "<td class=\"r\">" + fmtInt(r.v) + "</td></tr>";
  }).join("");

  var curulesSection = "";
  if (nivel === "dip" && res.curules) {
    curulesSection = sep() + "<h3 style=\"margin-top:12px;\">Curules simulados</h3>" +
      curulesGrid(res.curules.totalByParty);
  }
  if (nivel === "sen" && res.senadores) {
    var senTbl = Object.entries(res.senadores.totalByParty)
      .sort(function(a,b){return b[1]-a[1];})
      .map(function(kv) {
        return "<tr><td>" + dot(kv[0]) + kv[0] + "</td><td class=\"r\"><b>" + kv[1] + "</b></td></tr>";
      }).join("");
    curulesSection = sep() + "<h3 style=\"margin-top:12px;\">Senadores simulados</h3>" +
      "<table class=\"tbl\"><thead><tr><th>Partido</th><th class=\"r\">Senadores</th></tr></thead><tbody>" + senTbl + "</tbody></table>";
  }

  // Riesgo presidencial
  var riesgoBlock = "";
  if (nivel === "pres" && ranked2.length) {
    var t1 = ranked2[0]; var t2 = ranked2[1];
    var riesgoCls = t1.pct < 0.5 ? "text-warn" : "text-ok";
    riesgoBlock = "<div style=\"margin-top:10px;padding:8px;background:var(--bg3);border-radius:6px;font-size:13px;\">" +
      "<b class=\"" + riesgoCls + "\">" + (t1.pct < 0.5 ? "Riesgo 2a vuelta" : "Sin riesgo 2a vuelta") + "</b>" +
      (t2 ? " · Margen: " + fmtPct(t1.pct - t2.pct) : "") +
      (t1.pct < 0.5 ? " · Faltan " + fmtPct(0.5 - t1.pct) + " para 50%+1" : "") +
    "</div>";
  }

  resDiv.innerHTML =
    "<h3 style=\"margin-bottom:10px;\">Resultado simulado</h3>" +
    "<div style=\"overflow:auto;\">" +
      "<table class=\"tbl\">" +
        "<thead><tr>" +
          "<th>Partido</th><th class=\"r\">Base</th>" +
          "<th class=\"r\" style=\"color:var(--accent);\">Simulado</th>" +
          "<th class=\"r\">Delta</th><th class=\"r\">Votos</th>" +
        "</tr></thead>" +
        "<tbody>" + beforeAfterRows + "</tbody>" +
      "</table>" +
    "</div>" +
    statGrid([
      ["Emitidos sim.",    fmtInt(em)],
      ["Participacion",    fmtPct(part)],
    ]) +
    riesgoBlock +
    curulesSection;
}

//  4. POTENCIAL
// Score = Σ(componente_escala_fija × peso)  — SIN min-max dinámico
// Columnas: Score | Categoria | % Partido | Tendencia | Margen | 2do partido | Δ 2do partido | Inscritos | Abstención
export function renderPotencial(state, ctx) {
  var nivel  = state.nivel;
  var lv24   = getLevel(ctx, 2024, nivel);
  var nat24  = lv24.acional;
  var ranked = rankVotes(nat24.votes, nat24.emitidos);
  var liderDefault = ranked[0] ? ranked[0].p : "PRM";

  var pOpts = ranked.map(function(r) {
    return opt(r.p, r.p + " (" + fmtPct(r.pct) + ")", r.p === liderDefault);
  }).join("");

  var MET_HTML =
    "<div class=\"card\" style=\"margin-bottom:12px;border-color:var(--accent);\">" +
      "<h3>Metodología — Score de Potencial</h3>" +
      "<div class=\"row-2col\" style=\"gap:12px;\">" +
        "<div>" +
          "<p class=\"muted\" style=\"font-size:12px;margin-bottom:6px;\">Fórmula: <b>Score = Σ(componente × peso) / maxRaw × 100</b></p>" +
          "<table class=\"tbl\" style=\"font-size:12px;\"><thead><tr><th>Componente</th><th class=\"r\">Peso</th><th>Fórmula</th></tr></thead><tbody>" +
            "<tr><td>Tendencia</td><td class=\"r\">20</td><td>0.5 + (pct24 − pct20) × 3, clamped [0,1]</td></tr>" +
            "<tr><td>Margen</td><td class=\"r\">30</td><td>0.5 + margen_vs_rival × 2, clamped [0,1]</td></tr>" +
            "<tr><td>Abstención</td><td class=\"r\">20</td><td>abstencion2024 / 0.6, clamped [0,1]</td></tr>" +
            "<tr><td>Padrón</td><td class=\"r\">15</td><td>inscritos / max_inscritos</td></tr>" +
            "<tr><td>Elasticidad</td><td class=\"r\">15</td><td>|tendencia| × 2, clamped [0,1]</td></tr>" +
            "<tr><td>Estabilidad</td><td class=\"r\">0</td><td>desactivado (penaliza recuperables)</td></tr>" +
          "</tbody></table>" +
        "</div>" +
        "<div>" +
          "<p class=\"muted\" style=\"font-size:12px;margin-bottom:6px;\">Categorías:</p>" +
          "<table class=\"tbl\" style=\"font-size:12px;\"><tbody>" +
            "<tr><td><span class=\"cat-badge cat-green\">Fortaleza</span></td><td>Score ≥ 70</td></tr>" +
            "<tr><td><span class=\"cat-badge cat-lgreen\">Oportunidad</span></td><td>Score ≥ 55</td></tr>" +
            "<tr><td><span class=\"cat-badge cat-yellow\">Disputa</span></td><td>Score ≥ 45</td></tr>" +
            "<tr><td><span class=\"cat-badge cat-blue\">Crecimiento</span></td><td>Score ≥ 35</td></tr>" +
            "<tr><td><span class=\"cat-badge cat-red\">Adverso</span></td><td>Score ≥ 20</td></tr>" +
            "<tr><td><span class=\"cat-badge cat-gray\">Baja prioridad</span></td><td>Score &lt; 20</td></tr>" +
          "</tbody></table>" +
          "<p class=\"muted\" style=\"font-size:11px;margin-top:8px;\">Sin min-max dinámico. Escalas fijas para comparabilidad entre elecciones.</p>" +
        "</div>" +
      "</div>" +
    "</div>";

  view().innerHTML =
    "<div class=\"page-header\"><h2>Potencial - " + NIVEL_LABEL[nivel] + "</h2>" +
      "<div style=\"display:flex;gap:8px;align-items:center;flex-wrap:wrap;\">" +
        "<label class=\"muted\">Partido:</label>" +
        "<select id=\"pot-partido\" class=\"sel-sm\">" + pOpts + "</select>" +
        "<button class=\"btn-sm\" id=\"btn-ord-score\">Ordenar: Score</button>" +
        "<button class=\"btn-sm\" id=\"btn-ord-tend\">Ordenar: Tendencia</button>" +
        "<button class=\"btn-sm\" id=\"btn-pot-met\">Metodología</button>" +
      "</div>" +
    "</div>" +
    "<div id=\"pot-met\" style=\"display:none;\">" + MET_HTML + "</div>" +
    "<div id=\"pot-body\"><p class=\"muted\">Calculando...</p></div>";

  var _sortKey = "score";

  function renderPotTable(lider, sortKey) {
    var data = calcPotencial(ctx, nivel, lider);
    if (!data || !data.length) {
      el("pot-body").innerHTML = "<div class=\"card\"><p class=\"muted\">Sin datos para este nivel/partido.</p></div>";
      return;
    }

    if (sortKey === "tend") {
      data.sort(function(a, b) { return b.tendencia - a.tendencia; });
    }

    // KPIs resumen por categoría
    var CATS = ["Fortaleza","Oportunidad","Disputa","Crecimiento","Adverso","Baja prioridad"];
    var kpiCats = CATS.map(function(cat) {
      var count = data.filter(function(r) { return r.categoria.label === cat; }).length;
      return kpi(cat, String(count));
    }).join("");

    var rows = data.map(function(r, i) {
      var tendStr = (r.pct20 !== null && r.pct20 !== undefined)
        ? (r.tendencia > 0 ? "+" : "") + fmtPct(r.tendencia)
        : "<span class=\"muted\">s/d</span>";
      var tendCls = r.tendencia > 0.02 ? "text-ok" : r.tendencia < -0.02 ? "text-warn" : "";
      var margenStr = r.margen >= 0
        ? "<span class=\"text-ok\">" + fmtPct(r.margen) + "</span>"
        : "<span class=\"text-warn\">" + fmtPct(r.margen) + "</span>";

      // Δ segundo partido (2024 vs 2020 para el rival)
      var deltaSeg = "-";
      if (r.segundo && r.pctSegundo !== undefined) {
        deltaSeg = fmtPct(r.pctSegundo);
      }

      return "<tr>" +
        "<td class=\"muted\" style=\"width:28px;\">" + (i+1) + "</td>" +
        "<td><b>" + (r.nombre || r.id) + "</b></td>" +
        "<td class=\"r\"><b style=\"font-size:15px;\">" + r.score + "</b></td>" +
        "<td>" + catBadge(r.categoria.label, r.categoria.cls) + "</td>" +
        "<td class=\"r\">" + fmtPct(r.pct24) + "</td>" +
        "<td class=\"r " + tendCls + "\">" + tendStr + "</td>" +
        "<td class=\"r\">" + margenStr + "</td>" +
        "<td class=\"muted\" style=\"font-size:12px;\">" +
          (r.segundo ? dot(r.segundo) + r.segundo + " " + fmtPct(r.pctSegundo) : "-") +
        "</td>" +
        "<td class=\"r\">" + deltaSeg + "</td>" +
        "<td class=\"r\">" + fmtInt(r.padron) + "</td>" +
        "<td class=\"r\">" + fmtPct(r.abst) + "</td>" +
      "</tr>";
    }).join("");

    el("pot-body").innerHTML =
      "<div class=\"kpi-grid\" style=\"margin-bottom:14px;\">" + kpiCats + "</div>" +
      "<div class=\"card\" style=\"overflow:auto;\">" +
        "<p class=\"muted\" style=\"font-size:11px;margin-bottom:8px;\">Ordenado por: <b>" +
          (sortKey === "tend" ? "Tendencia" : "Score") + "</b> · Base: datos reales 2024 vs 2020</p>" +
        "<table class=\"tbl\">" +
          "<thead><tr>" +
            "<th>#</th>" +
            "<th>Territorio</th>" +
            "<th class=\"r\">Score</th>" +
            "<th>Categoría</th>" +
            "<th class=\"r\">% Partido</th>" +
            "<th class=\"r\">Tendencia</th>" +
            "<th class=\"r\">Margen</th>" +
            "<th>2do partido</th>" +
            "<th class=\"r\">% 2do</th>" +
            "<th class=\"r\">Inscritos</th>" +
            "<th class=\"r\">Abstención</th>" +
          "</tr></thead>" +
          "<tbody>" + rows + "</tbody>" +
        "</table>" +
      "</div>";
  }

  // Eventos
  el("btn-pot-met").addEventListener("click", function() {
    var met = el("pot-met");
    if (met) { met.style.display = met.style.display === "none" ? "" : "none"; }
  });

  el("btn-ord-score").addEventListener("click", function() {
    _sortKey = "score";
    renderPotTable(el("pot-partido").value, _sortKey);
  });
  el("btn-ord-tend").addEventListener("click", function() {
    _sortKey = "tend";
    renderPotTable(el("pot-partido").value, _sortKey);
  });

  el("pot-partido").addEventListener("change", function() {
    renderPotTable(el("pot-partido").value, _sortKey);
  });

  renderPotTable(liderDefault, _sortKey);
}

//  5. MOVILIZACIÓN
// Muestra: votos adicionales simulados | impacto en % | impacto en curules | cambio de escenario
// Coeficientes por nivel: pres=1.00, sen=0.85, dip=0.75, mun=0.70 (definidos en const MOV_COEF L25)

export function renderMovilizacion(state, ctx) {
  var nivel  = state.nivel;
  var isProy = state.modo === "proy2028";
  var year   = isProy ? 2028 : 2024;
  var lv     = getLevel(ctx, year, nivel) || getLevel(ctx, 2024, nivel);
  var nat    = lv.nacional;
  var ins    = nivel === "pres" ? (getInscritos(ctx, state.corte) || nat.inscritos || 0) : (nat.inscritos || 0);
  if (isProy && ctx.padron2028) ins = ctx.padron2028.total;
  var em     = nat.emitidos || 0;
  var abst   = ins - em;
  var cap60  = Math.round(abst * 0.6);  // techo: 60% de la abstención es movilizable
  var k      = MOV_COEF[nivel] || 1;
  var ranked = rankVotes(nat.votes, em);

  // Tabla territorial de abstención
  var lv20   = getLevel(ctx, 2020, nivel);
  var terr24 = nivel === "mun" ? lv.mun : nivel === "dm" ? lv.dm : lv.prov;
  var terr20 = nivel === "mun" ? lv20.mun : nivel === "dm" ? lv20.dm : lv20.prov;

  var terrData = Object.keys(terr24).map(function(id) {
    var t   = terr24[id];
    var t20 = terr20 ? terr20[id] : null;
    var a24 = t.inscritos ? 1 - (t.emitidos / t.inscritos) : 0;
    var a20 = t20 && t20.inscritos ? 1 - (t20.emitidos / t20.inscritos) : null;
    var delta = a20 !== null ? a24 - a20 : null;
    var ranked24 = rankVotes(t.votes || {}, t.emitidos || 1);
    var lider24  = ranked24[0] ? ranked24[0].p : "-";
    return { id: id, nombre: t.nombre || id, a24: a24, delta: delta, ins: t.inscritos || 0, lider: lider24 };
  }).sort(function(a,b) { return b.a24 - a.a24; });

  var terrRows = terrData.slice(0, 30).map(function(r) {
    var deltaStr = r.delta !== null
      ? "<span class=\"" + (r.delta > 0 ? "text-warn" : "text-ok") + "\">" +
          (r.delta > 0 ? "+" : "") + fmtPct(r.delta) + "</span>"
      : "-";
    return "<tr>" +
      "<td>" + r.nombre + "</td>" +
      "<td class=\"r\">" + fmtPct(r.a24) + "</td>" +
      "<td class=\"r\">" + deltaStr + "</td>" +
      "<td class=\"r\">" + fmtInt(r.ins) + "</td>" +
      "<td>" + dot(r.lider) + r.lider + "</td>" +
    "</tr>";
  }).join("");

  var movBtns = [-5,-3,3,5,7].map(function(pp) {
    return "<button class=\"" + (pp < 0 ? "btn-sm neg" : "btn-sm") + "\" data-pp=\"" + pp + "\">" +
      (pp > 0 ? "+" : "") + pp + " pp</button>";
  }).join("");

  // Metodología visible
  var metHtml =
    "<div style=\"font-size:11px;color:var(--text2);margin-top:8px;padding:8px;background:var(--bg3);border-radius:6px;\">" +
      "<b>Fórmula:</b> extra = Inscritos × (pp/100) × k(nivel) · Techo = Abstención × 60%" +
      "<br>Coef. k: pres=1.00 · sen=0.85 · dip=0.75 · mun/dm=0.70" +
    "</div>";

  view().innerHTML =
    "<div class=\"page-header\"><h2>Movilización - " + NIVEL_LABEL[nivel] + "</h2>" +
      (isProy ? " " + badge("Proy. 2028", "badge-warn") : "") +
    "</div>" +
    "<div class=\"row-2col\" style=\"gap:14px;\">" +
      "<div>" +
        "<div class=\"card\" style=\"margin-bottom:14px;\">" +
          "<h3>Parámetros base</h3>" +
          "<div class=\"kpi-grid\" style=\"grid-template-columns:1fr 1fr;\">" +
            kpi("Inscritos", fmtInt(ins)) +
            kpi("Emitidos " + (isProy ? "proy." : "2024"), fmtInt(em)) +
            kpi("Abstención", fmtInt(abst), fmtPct(ins ? abst/ins : 0)) +
            kpi("Cap. movilizable (60%)", fmtInt(cap60), "máximo") +
            kpi("Coef. " + nivel, String(k)) +
            kpi("Nivel", NIVEL_LABEL[nivel]) +
          "</div>" +
          metHtml +
        "</div>" +
        "<div class=\"card\" style=\"margin-bottom:14px;\">" +
          "<h3>Simular movilización</h3>" +
          "<div style=\"display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;\">" + movBtns + "</div>" +
          "<div style=\"display:flex;align-items:center;gap:8px;\">" +
            "<input id=\"mov-pp\" class=\"inp-sm\" type=\"number\" step=\"0.1\" value=\"0\" style=\"width:80px;\"> pp" +
            "<button class=\"btn\" id=\"btn-mov-calc\">Calcular impacto</button>" +
          "</div>" +
          "<div id=\"mov-result\" style=\"margin-top:12px;\"></div>" +
        "</div>" +
      "</div>" +
      "<div class=\"card\" style=\"overflow:auto;\">" +
        "<h3>Top 30 territorios por abstención 2024</h3>" +
        "<p class=\"muted\" style=\"font-size:12px;margin-bottom:8px;\">Ordenado por abstención descendente · Δ vs 2020</p>" +
        "<table class=\"tbl\">" +
          "<thead><tr>" +
            "<th>Territorio</th>" +
            "<th class=\"r\">Abstención</th>" +
            "<th class=\"r\">Δ vs 2020</th>" +
            "<th class=\"r\">Inscritos</th>" +
            "<th>Líder</th>" +
          "</tr></thead>" +
          "<tbody>" + terrRows + "</tbody>" +
        "</table>" +
      "</div>" +
    "</div>";

  // Botones rápidos
  document.querySelectorAll("[data-pp]").forEach(function(btn) {
    btn.addEventListener("click", function() {
      var movInp = el("mov-pp");
      if (movInp) movInp.value = btn.dataset.pp;
      calcMovImpacto(ctx, state, nivel, ins, em, nat, ranked);
    });
  });

  el("btn-mov-calc").addEventListener("click", function() {
    calcMovImpacto(ctx, state, nivel, ins, em, nat, ranked);
  });
}

function calcMovImpacto(ctx, state, nivel, ins, em, nat, ranked) {
  var pp      = parseFloat((el("mov-pp") || {}).value) || 0;
  var k       = MOV_COEF[nivel] || 1;
  var abst    = ins - em;
  var cap60   = Math.round(abst * 0.6);
  var raw     = Math.round(ins * (pp / 100) * k);
  var extra   = pp >= 0 ? Math.min(raw, cap60) : Math.max(raw, -Math.round(em * 0.05));
  var nuevoEm = em + extra;
  var isProy  = state.modo === "proy2028";
  var year    = isProy ? 2028 : 2024;

  // Simular con movilización
  var resMov = simular(ctx, {
    nivel: nivel, year: year, movPP: pp, corte: state.corte
  });
  var resBase = simular(ctx, {
    nivel: nivel, year: year, corte: state.corte
  });

  var top1base = resBase.ranked[0];
  var top1mov  = resMov.ranked[0];
  var deltaPP  = top1base && top1mov ? (top1mov.pct - top1base.pct) * 100 : 0;
  var deltaV   = top1base && top1mov ? (top1mov.v - top1base.v) : 0;

  // Curules antes/después
  var curBase = 0; var curMov = 0;
  if (nivel === "dip") {
    curBase = resBase.curules && top1base ? (resBase.curules.totalByParty[top1base.p] || 0) : 0;
    curMov  = resMov.curules  && top1mov  ? (resMov.curules.totalByParty[top1mov.p]   || 0) : 0;
  } else if (nivel === "sen") {
    curBase = resBase.senadores && top1base ? (resBase.senadores.totalByParty[top1base.p] || 0) : 0;
    curMov  = resMov.senadores  && top1mov  ? (resMov.senadores.totalByParty[top1mov.p]   || 0) : 0;
  } else if (nivel === "mun") {
    curBase = resBase.ganadores && top1base ? (resBase.ganadores.totalByParty[top1base.p] || 0) : 0;
    curMov  = resMov.ganadores  && top1mov  ? (resMov.ganadores.totalByParty[top1mov.p]   || 0) : 0;
  }

  // Cambio de escenario presidencial
  var escenarioBlock = "";
  if (nivel === "pres" && top1mov) {
    var antes = top1base ? (top1base.pct < 0.5 ? "Riesgo 2a vuelta" : "Sin riesgo") : "-";
    var despues = top1mov.pct < 0.5 ? "Riesgo 2a vuelta" : "Sin riesgo";
    var cambioCls = antes !== despues ? "text-warn" : "text-ok";
    escenarioBlock = "<div style=\"margin-top:10px;padding:8px;background:var(--bg3);border-radius:6px;font-size:13px;\">" +
      "<b>Cambio de escenario:</b> " +
      "<span>" + antes + "</span> → " +
      "<span class=\"" + cambioCls + "\"><b>" + despues + "</b></span>" +
    "</div>";
  }

  var curulesBlock = "";
  if (nivel === "dip" || nivel === "sen" || nivel === "mun") {
    var dc = curMov - curBase;
    var dcCls = dc > 0 ? "text-ok" : dc < 0 ? "text-warn" : "";
    var label = nivel === "mun" ? "Alcaldías" : "Curules";
    curulesBlock = "<div style=\"margin-top:8px;\">" +
      kpi("Impacto en " + label,
        "<span class=\"" + dcCls + "\">" + (dc >= 0 ? "+" : "") + dc + "</span>",
        "de " + curBase + " a " + curMov) +
    "</div>";
  }

  var resMov2 = el("mov-result");
  if (!resMov2) return;
  resMov2.innerHTML =
    "<div class=\"kpi-grid\" style=\"grid-template-columns:1fr 1fr 1fr;margin-bottom:10px;\">" +
      kpi("Votos adicionales", fmtInt(extra), (pp > 0 ? "+" : "") + pp.toFixed(1) + " pp") +
      kpi("Nuevo total emitidos", fmtInt(nuevoEm), "cap: " + fmtInt(cap60)) +
      kpi("Impacto en % " + (top1base ? top1base.p : ""),
        "<span class=\"" + (deltaPP >= 0 ? "text-ok" : "text-warn") + "\">" +
          (deltaPP >= 0 ? "+" : "") + deltaPP.toFixed(2) + "pp</span>",
        fmtInt(deltaV) + " votos adicionales") +
    "</div>" +
    curulesBlock +
    escenarioBlock;
}

//  6. OBJETIVO
// Presidencial: ¿cuánto falta para 50%? ¿cuántos votos?
// Legislativo: ¿cuántos votos para próxima curul? ¿dónde es más eficiente?
export function renderObjetivo(state, ctx) {
  var nivel  = state.nivel;
  var isProy = state.modo === "proy2028";
  var year   = isProy ? 2028 : 2024;
  var lv     = getLevel(ctx, year, nivel) || getLevel(ctx, 2024, nivel);
  var nat    = lv.nacional;
  var ranked = rankVotes(nat.votes, nat.emitidos);
  var pOpts  = ranked.map(function(r) { return opt(r.p, r.p, false); }).join("");

  // Default meta según nivel
  var defVal   = nivel === "dip" ? "96" : nivel === "sen" ? "17" : nivel === "mun" ? "80" : "50.1";
  var defStep  = nivel === "dip" || nivel === "sen" || nivel === "mun" ? "1" : "0.1";
  var defLabel = nivel === "dip"  ? "Curules objetivo (de 190)" :
                 nivel === "sen"  ? "Senadores objetivo (de 32)" :
                 nivel === "mun"  ? "Alcaldías objetivo (de 158)" :
                                    "% votos objetivo";
  var arrCheck = nivel !== "pres"
    ? "<label style=\"display:flex;align-items:center;gap:8px;\"><input type=\"checkbox\" id=\"obj-arrastre\"> Incluir arrastre presidencial</label>"
    : "";

  // Metodología por nivel
  var metNivel = nivel === "pres"
    ? "Presidencial: meta = 50%+1. Backsolve binario encuentra el delta pp mínimo para alcanzar la meta."
    : nivel === "sen"
    ? "Senadores: mayoría simple por provincia. Se identifica el costo marginal (votos) por cada provincia reversible."
    : nivel === "dip"
    ? "Diputados: D'Hondt consolidado. Backsolve encuentra el delta pp que maximiza curules. nextSeatVotes() calcula el costo marginal por circunscripción."
    : "Alcaldes/DM: mayoría simple. Se identifica el umbral de votos necesario para voltear cada municipio competitivo.";

  view().innerHTML =
    "<div class=\"page-header\"><h2>Objetivo - " + NIVEL_LABEL[nivel] + "</h2>" +
      (isProy ? " " + badge("Proy. 2028", "badge-warn") : "") +
    "</div>" +
    "<div style=\"font-size:11px;color:var(--text2);margin-bottom:10px;padding:8px;background:var(--bg3);border-radius:6px;\">" +
      metNivel +
    "</div>" +
    "<div class=\"row-2col\" style=\"gap:14px;\">" +
      "<div class=\"card\"><h3>Configurar meta</h3>" +
        "<div style=\"display:flex;flex-direction:column;gap:12px;\">" +
          "<div><label class=\"muted\">Partido objetivo</label>" +
            "<select id=\"obj-partido\" class=\"sel-sm\" style=\"width:100%;margin-top:4px;\">" + pOpts + "</select>" +
          "</div>" +
          "<div><label class=\"muted\">" + defLabel + "</label>" +
            "<input id=\"obj-meta\" class=\"inp-sm\" type=\"number\" step=\"" + defStep + "\" value=\"" + defVal + "\" style=\"width:100%;margin-top:4px;\">" +
          "</div>" +
          "<div><label class=\"muted\">Delta pp movilización adicional</label>" +
            "<input id=\"obj-mov\" class=\"inp-sm\" type=\"number\" step=\"0.1\" value=\"0\" style=\"width:100%;margin-top:4px;\">" +
          "</div>" +
          arrCheck +
          "<button class=\"btn\" id=\"obj-calc\">Calcular escenarios</button>" +
        "</div>" +
      "</div>" +
      "<div id=\"obj-result\"><div class=\"card\"><p class=\"muted\">Configura y presiona Calcular.</p></div></div>" +
    "</div>" +

    // Panel de provincias críticas para legislativo
    (nivel === "sen" || nivel === "dip"
      ? "<div class=\"card\" style=\"margin-top:14px;\"><h3 id=\"obj-crit-title\">Territorios críticos</h3>" +
          "<p class=\"muted\" style=\"font-size:12px;margin-bottom:8px;\">Selecciona un partido arriba y presiona Calcular para ver los territorios más eficientes.</p>" +
          "<div id=\"obj-criticos\"></div>" +
        "</div>"
      : "");

  el("obj-calc").addEventListener("click", function() {
    var lider    = el("obj-partido").value;
    var meta     = Number(el("obj-meta").value) || (nivel === "dip" ? 96 : 51);
    var movPP    = Number(el("obj-mov").value)  || 0;
    var arrastre = el("obj-arrastre") ? el("obj-arrastre").checked : false;
    el("obj-result").innerHTML = "<div class=\"card\"><p class=\"muted\">Calculando...</p></div>";

    setTimeout(function() {
      try {
        var esc = generarEscenarios(ctx, {
          lider: lider, nivel: nivel, metaValor: meta,
          arrastre: arrastre, movPP: movPP,
          year: isProy ? 2028 : 2024
        });
        renderObjResult(el("obj-result"), esc, nivel, lider, nat);

        // Territorios críticos para legislativo
        if (nivel === "sen" || nivel === "dip") {
          var criticos = calcularProvinciasCriticas(ctx, { nivel: nivel, lider: lider }, 8);
          var critEl   = el("obj-criticos");
          var titEl    = el("obj-crit-title");
          if (critEl && criticos.length) {
            if (titEl) titEl.textContent = "Territorios críticos para " + lider + " (" + criticos.length + ")";
            var cRows = criticos.map(function(c) {
              var tipoCls = c.tipo === "voltear" ? "cat-red" : c.tipo === "consolidar" ? "cat-green" : "cat-blue";
              var gapStr  = c.gap > 0 ? fmtPct(c.gap) : "(liderando)";
              return "<tr>" +
                "<td><b>" + c.nombre + "</b></td>" +
                "<td class=\"r\">" + fmtPct(c.lPct) + "</td>" +
                "<td class=\"r\">" + gapStr + "</td>" +
                "<td>" + dot(c.rival) + c.rival + "</td>" +
                "<td><span class=\"cat-badge " + tipoCls + "\">" + c.tipo + "</span></td>" +
              "</tr>";
            }).join("");
            critEl.innerHTML =
              "<table class=\"tbl\"><thead><tr>" +
                "<th>Territorio</th><th class=\"r\">% " + lider + "</th>" +
                "<th class=\"r\">Gap</th><th>Rival</th><th>Tipo</th>" +
              "</tr></thead><tbody>" + cRows + "</tbody></table>";
          }
        }

      } catch(e) {
        el("obj-result").innerHTML = "<div class=\"card\"><p class=\"muted\">Error: " + e.message + "</p></div>";
      }
    }, 10);
  });
}

function renderObjResult(container, esc, nivel, lider, nat) {
  var labels = {
    conservador: { label: "Conservador", cls: "cat-blue",   desc: "90% de la meta" },
    razonable:   { label: "Razonable",   cls: "cat-green",  desc: "100% de la meta" },
    optimizado:  { label: "Optimizado",  cls: "cat-yellow", desc: "105% de la meta" },
    agresivo:    { label: "Agresivo",    cls: "cat-orange", desc: "112% de la meta" },
  };

  var metaLabel = nivel === "dip"  ? "curules" :
                  nivel === "sen"  ? "senadores" :
                  nivel === "mun"  ? "alcaldías" : "% votos";

  var cards = Object.keys(labels).map(function(key) {
    var lbl = labels[key];
    var s   = esc[key];
    if (!s) return "";

    if (s.imposible) {
      return "<div class=\"kpi-card\" style=\"border:1px solid var(--border);border-radius:8px;padding:12px;\">" +
        "<div class=\"kpi-label\">" + catBadge(lbl.label, lbl.cls) + " " + lbl.desc + "</div>" +
        "<div class=\"kpi-value text-warn\" style=\"font-size:16px;\">Imposible</div>" +
        "<div class=\"kpi-sub\">Máximo alcanzable: " +
          (nivel === "dip"  ? s.maximo + " curules" :
           nivel === "sen"  ? s.maximo + " senadores" :
           nivel === "mun"  ? s.maximo + " alcaldías" :
           (s.maximo * 100).toFixed(1) + "%") +
        "</div>" +
      "</div>";
    }

    var res    = s.resultado;
    var top    = res && res.ranked ? res.ranked.filter(function(r) { return r.p === lider; })[0] : null;
    var curVal = "";
    if (nivel === "dip" && res && res.curules) {
      curVal = (res.curules.totalByParty[lider] || 0) + " curules";
    } else if (nivel === "sen" && res && res.senadores) {
      curVal = (res.senadores.totalByParty[lider] || 0) + " senadores";
    } else if (nivel === "mun" && res && res.ganadores) {
      curVal = (res.ganadores.totalByParty[lider] || 0) + " alcaldías";
    } else if (top) {
      curVal = fmtPct(top.pct);
    }

    var deltaPP = s.deltaPP !== undefined ? s.deltaPP : 0;
    var votos   = res && res.emitidos && deltaPP
      ? Math.round(res.emitidos * Math.abs(deltaPP) / 100)
      : null;

    // Presidencial: mostrar falta/sobra para 50%
    var presidencialExtra = "";
    if (nivel === "pres" && top) {
      var diff = top.pct - 0.5;
      var diffV = res ? Math.round(Math.abs(diff) * res.emitidos) : null;
      presidencialExtra = diff < 0
        ? "<div class=\"kpi-sub text-warn\">Faltan " + fmtPct(-diff) +
            (diffV ? " (" + fmtInt(diffV) + " votos)" : "") + " para 50%+1</div>"
        : "<div class=\"kpi-sub text-ok\">+" + fmtPct(diff) + " sobre el umbral</div>";
    }

    return "<div class=\"kpi-card\" style=\"border:1px solid var(--border);border-radius:8px;padding:12px;\">" +
      "<div class=\"kpi-label\">" + catBadge(lbl.label, lbl.cls) + " " + lbl.desc + "</div>" +
      "<div class=\"kpi-value\" style=\"font-size:18px;\">" + curVal + "</div>" +
      presidencialExtra +
      "<div class=\"kpi-sub\">Delta necesario: " + (deltaPP >= 0 ? "+" : "") + deltaPP.toFixed(2) + "pp</div>" +
      (votos ? "<div class=\"kpi-sub\">≈ " + fmtInt(votos) + " votos adicionales</div>" : "") +
    "</div>";
  }).join("");

  container.innerHTML =
    "<div class=\"card\">" +
      "<h3>Escenarios para " + lider + " — " + NIVEL_LABEL[nivel] + "</h3>" +
      "<div style=\"display:grid;grid-template-columns:1fr 1fr;gap:12px;\">" + cards + "</div>" +
    "</div>";
}

export function renderBoleta(state, ctx) {
  var isProy = state.modo === "proy2028";
  var year   = isProy ? 2028 : 2024;
  var lv     = getLevel(ctx, year, "dip") || getLevel(ctx, 2024, "dip");
  var ranked = rankVotes(lv.nacional.votes, lv.nacional.emitidos);
  var parties = ranked.map(function(r) { return r.p; });
  var provs   = Object.keys(lv.prov);
  var provOpts = provs.map(function(id) {
    return opt(id, (lv.prov[id].nombre || id), false);
  }).join("");
  var partyOpts = parties.map(function(p) { return opt(p, p, false); }).join("");

  view().innerHTML =
    "<div class=\"page-header\"><h2>Boleta Única Opositora</h2>" +
      (isProy ? " " + badge("Proy. 2028", "badge-warn") : " " + badge("Base 2024")) +
    "</div>" +
    (!ctx.alianzas || !ctx.alianzas.dip ?
      "<div class=\"badge-warn\" style=\"display:block;margin-bottom:10px;padding:8px 12px;border-radius:6px;font-size:12px;\">" +
        "⚠ <b>alianzas_2024.json pendiente:</b> Los bloques D'Hondt usan votos individuales. " +
        "El resultado será correcto solo una vez que se carguen las alianzas reales 2024." +
      "</div>" : "") +
    "<div style=\"font-size:11px;color:var(--text2);margin-bottom:10px;padding:8px;background:var(--bg3);border-radius:6px;\">" +
      "<b>Metodología D'Hondt:</b> votosBloque = votosPartido + (votosAliado × transferencia%) · " +
      "Aplicar D'Hondt al bloque consolidado antes de distribuir curules · " +
      "Base: datos " + (isProy ? "proyectados 2028" : "reales 2024") + " · Sin alianza por defecto." +
    "</div>" +
    // Tabs modo A / modo B
    "<div style=\"display:flex;gap:0;margin-bottom:16px;border-bottom:2px solid var(--border);\">" +
      "<button class=\"tab-btn active\" id=\"tab-a\">Modo A: Territorio primero</button>" +
      "<button class=\"tab-btn\" id=\"tab-b\">Modo B: Partido primero</button>" +
    "</div>" +
    "<div id=\"modo-a\">" + buildModoA(parties, provs, lv, partyOpts, provOpts) + "</div>" +
    "<div id=\"modo-b\" style=\"display:none;\">" + buildModoB(parties, lv, partyOpts) + "</div>";

  // Tab switching
  el("tab-a").addEventListener("click", function() {
    el("modo-a").style.display = "";
    el("modo-b").style.display = "none";
    el("tab-a").classList.add("active");
    el("tab-b").classList.remove("active");
  });
  el("tab-b").addEventListener("click", function() {
    el("modo-a").style.display = "none";
    el("modo-b").style.display = "";
    el("tab-b").classList.add("active");
    el("tab-a").classList.remove("active");
  });

  // Modo A: seleccionar provincia -> ver partidos -> alianzas -> D'Hondt live
  var modoASelect = el("modoA-prov");
  var modoARes    = el("modoA-result");
  if (modoASelect) {
    modoASelect.addEventListener("change", function() {
      recalcModoA(ctx, parties, lv);
    });
  }
  document.querySelectorAll(".mA-chk").forEach(function(chk) {
    chk.addEventListener("change", function() {
      var pct = document.querySelector(".mA-pct[data-party=\"" + chk.value + "\"]");
      if (pct) pct.disabled = !chk.checked;
      recalcModoA(ctx, parties, lv);
    });
  });
  document.querySelectorAll(".mA-pct").forEach(function(inp) {
    inp.addEventListener("change", function() { recalcModoA(ctx, parties, lv); });
  });

  // Modo B: seleccionar partido base -> territorios -> aliados -> progresivo
  var modoBSelect = el("modoB-partido");
  if (modoBSelect) {
    modoBSelect.addEventListener("change", function() { recalcModoB(ctx, parties, lv); });
  }
  document.querySelectorAll(".mB-chk").forEach(function(chk) {
    chk.addEventListener("change", function() { recalcModoB(ctx, parties, lv); });
  });
}

function buildModoA(parties, provs, lv, partyOpts, provOpts) {
  return "<div class=\"row-2col\" style=\"gap:14px;\">" +
    "<div class=\"card\">" +
      "<h3>Seleccionar provincia</h3>" +
      "<select id=\"modoA-prov\" class=\"sel-sm\" style=\"width:100%;margin-bottom:12px;\">" + provOpts + "</select>" +
      "<h4 style=\"margin-bottom:8px;\">Alianzas para esta provincia</h4>" +
      "<div id=\"modoA-parties\">" +
        parties.map(function(p) {
          return "<div style=\"display:flex;gap:8px;align-items:center;margin-bottom:4px;\">" +
            "<input type=\"checkbox\" class=\"mA-chk\" value=\"" + p + "\" id=\"mA-" + p + "\">" +
            "<label for=\"mA-" + p + "\" style=\"min-width:55px;\">" + dot(p) + p + "</label>" +
            "<input class=\"inp-sm mA-pct\" type=\"number\" min=\"0\" max=\"100\" step=\"5\" value=\"80\" style=\"width:58px;\" data-party=\"" + p + "\" disabled>" +
            "<span class=\"muted\" style=\"font-size:11px;\">% transf.</span>" +
            "</div>";
        }).join("") +
      "</div>" +
    "</div>" +
    "<div class=\"card\" id=\"modoA-result\"><p class=\"muted\">Selecciona una provincia para ver el efecto.</p></div>" +
  "</div>";
}

function buildModoB(parties, lv, partyOpts) {
  return "<div class=\"row-2col\" style=\"gap:14px;\">" +
    "<div class=\"card\">" +
      "<h3>Partido base</h3>" +
      "<select id=\"modoB-partido\" class=\"sel-sm\" style=\"width:100%;margin-bottom:12px;\">" + partyOpts + "</select>" +
      "<h4 style=\"margin-bottom:8px;\">Aliados a incluir</h4>" +
      "<div id=\"modoB-aliados\">" +
        parties.slice(1).map(function(p) {
          return "<div style=\"display:flex;gap:8px;align-items:center;margin-bottom:4px;\">" +
            "<input type=\"checkbox\" class=\"mB-chk\" value=\"" + p + "\" id=\"mB-" + p + "\">" +
            "<label for=\"mB-" + p + "\">" + dot(p) + p + "</label>" +
          "</div>";
        }).join("") +
      "</div>" +
    "</div>" +
    "<div class=\"card\" id=\"modoB-result\"><p class=\"muted\">Selecciona partido base para ver territorios de impacto.</p></div>" +
  "</div>";
}

function recalcModoA(ctx, parties, lv) {
  var provId  = el("modoA-prov") ? el("modoA-prov").value : null;
  var resDiv  = el("modoA-result");
  if (!provId || !resDiv) return;

  var prov = lv.prov[provId];
  if (!prov) { resDiv.innerHTML = "<p class=\"muted\">Sin datos para esta provincia.</p>"; return; }

  // Buscar circ de esta provincia en curules (puede ser multi-circ)
  var cur = ctx.curules;
  var circs = (cur.territorial || []).filter(function(c) {
    return String(c.provincia_id).padStart(2,"0") === provId;
  });
  if (!circs.length) { resDiv.innerHTML = "<p class=\"muted\">Sin circunscripciones para provincia " + provId + ".</p>"; return; }

  // Obtener partidos seleccionados como aliados
  var aliados = [];
  document.querySelectorAll(".mA-chk:checked").forEach(function(chk) {
    var pct = document.querySelector(".mA-pct[data-party=\"" + chk.value + "\"]");
    aliados.push({ partido: chk.value, transferPct: pct ? Number(pct.value) : 80 });
  });
  // El primero seleccionado es el lider de la alianza
  var lider = aliados.length ? aliados[0].partido : null;

  // D'Hondt por circ, base vs boleta
  var html = "<h3>" + (prov.nombre || provId) + " - " + circs.length + " circunscripcion(es)</h3>";
  // Use lv passed in — respects Base 2024 vs Proy 2028 mode
  circs.forEach(function(c) {
    var key = c.circ > 0 ? provId + "-" + c.circ : provId;
    var circData = c.circ > 0
      ? (lv.circ ? lv.circ[key] : null)
      : lv.prov[provId];
    if (!circData) return;

    // Calcular boleta aplicando transferencias
    var baseVotes  = Object.assign({}, circData.votes || {});
    var boletaVotes = Object.assign({}, baseVotes);
    if (aliados.length >= 2) {
      // El primero en la lista es el lider de la alianza
      var liderId = aliados[0].partido;
      for (var i = 1; i < aliados.length; i++) {
        var al = aliados[i];
        var moved = Math.round((boletaVotes[al.partido] || 0) * (al.transferPct / 100));
        boletaVotes[al.partido] = (boletaVotes[al.partido] || 0) - moved;
        boletaVotes[liderId]    = (boletaVotes[liderId]    || 0) + moved;
      }
    }

    // D'Hondt simple
    function dhondtLocal(votes, seats) {
      var q = [];
      Object.keys(votes).forEach(function(p) {
        var v = votes[p] || 0;
        if (v > 0) {
          for (var d = 1; d <= seats; d++) q.push({ p: p, q: v/d });
        }
      });
      q.sort(function(a,b){return b.q-a.q;});
      var bp = {};
      q.slice(0,seats).forEach(function(x) { bp[x.p] = (bp[x.p]||0)+1; });
      return bp;
    }

    var baseRes   = dhondtLocal(baseVotes,   c.seats);
    var boletaRes = aliados.length >= 2 ? dhondtLocal(boletaVotes, c.seats) : baseRes;

    var baseDist   = Object.keys(baseRes).filter(function(p){return baseRes[p]>0;}).map(function(p){return p+":"+baseRes[p];}).join(", ");
    var boletaDist = Object.keys(boletaRes).filter(function(p){return boletaRes[p]>0;}).map(function(p){return p+":"+boletaRes[p];}).join(", ");

    html += "<div style=\"margin-top:12px;padding:10px;background:var(--bg3);border-radius:6px;\">" +
      "<b>Circ " + key + " (" + c.seats + " escanos)</b><br>" +
      "<span class=\"muted\">Base: </span>" + baseDist + "<br>" +
      (aliados.length >= 2 ? "<span class=\"muted\">Con alianza: </span><b>" + boletaDist + "</b>" : "<span class=\"muted\">(Selecciona 2+ partidos para ver efecto)</span>") +
    "</div>";
  });

  resDiv.innerHTML = html;
}

function recalcModoB(ctx, parties, lv) {
  var partido = el("modoB-partido") ? el("modoB-partido").value : null;
  var resDiv  = el("modoB-result");
  if (!partido || !resDiv) return;

  var aliados = [];
  document.querySelectorAll(".mB-chk:checked").forEach(function(chk) {
    aliados.push({ partido: chk.value, transferPct: 85 });
  });

  // Usar simBoleta para calcular impacto global
  var partidos = parties.map(function(p) {
    return {
      partido:    p,
      incluir:    p === partido || aliados.some(function(a){ return a.partido === p; }),
      encabeza:   p === partido,
      transferPct: 85,
    };
  });

  var _yr = typeof isProy !== "undefined" && isProy ? 2028 : 2024;
  var res = simBoleta(ctx, { partidos: partidos, year: _yr });
  if (!res) { resDiv.innerHTML = "<p class=\"muted\">Error al calcular.</p>"; return; }

  var delta = res.deltaLider;
  var base  = res.baseTotal[partido] || 0;
  var con   = res.boletaTotal[partido] || 0;

  var allTerr = (res.ganados || []).concat(res.perdidos || []).sort(function(a,b){return Math.abs(b.delta)-Math.abs(a.delta);});
  var topImpact = allTerr.slice(0, 10).map(function(t) {
    var circ = t.circ > 0 ? " C" + t.circ : "";
    var cls  = t.delta > 0 ? "text-ok" : "text-warn";
    return "<tr><td>" + t.provincia + circ + "</td><td class=\"r\">" + t.seats +
      "</td><td class=\"r " + cls + "\">" + (t.delta > 0 ? "+" : "") + t.delta + "</td></tr>";
  }).join("");

  resDiv.innerHTML =
    "<h3>Impacto de coalicion para " + partido + "</h3>" +
    statGrid([
      ["Aliados activos", String(aliados.length)],
      ["Curules base", String(base)],
      ["Curules con boleta", String(con)],
      ["Delta", (delta >= 0 ? "+" : "") + delta],
    ]) +
    (res.territorios.length
      ? "<h4 style=\"margin:12px 0 6px;\">Top territorios de impacto</h4>" +
        "<table class=\"tbl\"><thead><tr><th>Territorio</th><th class=\"r\">Esc.</th><th class=\"r\">Delta</th></tr></thead><tbody>" + topImpact + "</tbody></table>"
      : "<p class=\"muted\" style=\"margin-top:10px;\">Sin impacto con aliados actuales.</p>"
    );
}

function renderBoletaResult(container, res) {
  var lider    = res.lider;
  var baseL    = res.baseTotal[lider]   || 0;
  var boletaL  = res.boletaTotal[lider] || 0;
  var delta    = boletaL - baseL;
  var deltaStr = (delta >= 0 ? "+" : "") + delta;
  var deltaCls = delta > 0 ? "text-ok" : delta < 0 ? "text-warn" : "";
  var majBadge = boletaL >= 96
    ? badge("Mayoria absoluta con boleta", "badge-good")
    : badge("Sin mayoria (" + boletaL + "/96)", "badge-warn");

  var ganRows = res.ganados.map(function(t) {
    var circ = t.circ > 0 ? " C" + t.circ : "";
    return "<tr><td>" + t.provincia + circ + "</td><td class=\"r\">" + t.seats + "</td><td class=\"muted\">" + t.baseDistrib + "</td><td>" + t.boletaDistrib + "</td><td class=\"r text-ok\">+" + t.delta + "</td></tr>";
  }).join("");

  var perRows = res.perdidos.map(function(t) {
    var circ = t.circ > 0 ? " C" + t.circ : "";
    return "<tr><td>" + t.provincia + circ + "</td><td class=\"r\">" + t.seats + "</td><td class=\"muted\">" + t.baseDistrib + "</td><td>" + t.boletaDistrib + "</td><td class=\"r text-warn\">" + t.delta + "</td></tr>";
  }).join("");

  var ganSection = res.ganados.length ? "<div class=\"card\" style=\"margin-bottom:12px;\"><h3 style=\"color:var(--green)\">Donde gana curules (" + res.ganados.length + ")</h3><table class=\"tbl\"><thead><tr><th>Demarcacion</th><th class=\"r\">Esc.</th><th>Base</th><th>Con boleta</th><th class=\"r\">Delta</th></tr></thead><tbody>" + ganRows + "</tbody></table></div>" : "";
  var perSection = res.perdidos.length ? "<div class=\"card\"><h3 style=\"color:var(--yellow)\">Donde pierde curules (" + res.perdidos.length + ")</h3><table class=\"tbl\"><thead><tr><th>Demarcacion</th><th class=\"r\">Esc.</th><th>Base</th><th>Con boleta</th><th class=\"r\">Delta</th></tr></thead><tbody>" + perRows + "</tbody></table></div>" : "";

  container.innerHTML =
    "<div class=\"card\" style=\"margin-bottom:12px;\">" +
      "<h3>Impacto en " + lider + "</h3>" +
      statGrid([["Curules base", String(baseL)], ["Curules boleta", String(boletaL)], ["Diferencia", "<span class=\"" + deltaCls + "\">" + deltaStr + "</span>"]]) +
      "<div style=\"margin-top:8px;\">" + majBadge + "</div>" +
    "</div>" +
    ganSection + perSection;
}

//  8. AUDITORÍA DE DATOS  v7.0
// Política: cero datos inventados. Errores y pendientes son visibles, nunca silenciosos.
export function renderAuditoria(state, ctx) {
  var audit = runAuditoria(ctx);
  var res   = audit.resumen;

  var SECS = {
    padron:        "Padrón 2024",
    resultados2024:"Resultados 2024",
    resultados2020:"Resultados 2020",
    curules:       "Curules",
    alianzas:      "Alianzas 2024",
    encuestas:     "Encuestas",
    partidos:      "Partidos",
    proyeccion:    "Proyección 2028",
    consistencia:  "Consistencia cruzada",
    general:       "General",
  };

  // Agrupar por sección
  var bySection = {};
  function addItems(arr, tipo, cls) {
    arr.forEach(function(item) {
      var s = item.seccion || "general";
      if (!bySection[s]) bySection[s] = [];
      bySection[s].push({ tipo:tipo, cls:cls, msg:item.msg });
    });
  }
  addItems(audit.issues,     "ERROR",     "badge-err");
  addItems(audit.warnings,   "AVISO",     "badge-warn");
  addItems(audit.pendientes, "PENDIENTE", "badge-pend");
  addItems(audit.ok,         "OK",        "badge-good");
  addItems(audit.notas,      "NOTA",      "badge-info");

  // KPIs resumen
  var kpis =
    "<div class=\"kpi-grid\" style=\"margin-bottom:16px;\">" +
      kpi("Errores",      "<span class=\"" + (res.errores    >0?"text-warn":"text-ok") + "\">" + res.errores     + "</span>", "críticos") +
      kpi("Avisos",       "<span class=\"" + (res.advertencias>0?"text-warn":"")       + "\">" + res.advertencias+ "</span>", "revisar") +
      kpi("Pendientes",   "<span class=\"" + (res.pendientes >0?"text-warn":"")        + "\">" + res.pendientes  + "</span>", "por confirmar") +
      kpi("Correctos",    "<span class=\"text-ok\">" + res.correctos + "</span>", "verificados") +
      kpi("Notas",        String(res.notas), "informativas") +
    "</div>";

  var alertaBanner = res.errores > 0
    ? "<div style=\"padding:10px 14px;margin-bottom:12px;border-radius:6px;background:rgba(220,50,50,0.12);border:1px solid var(--red);font-weight:600;\">" +
        "✗ " + res.errores + " error(es) — módulos afectados pueden mostrar datos incorrectos o vacíos" +
      "</div>"
    : res.advertencias > 0
    ? "<div style=\"padding:10px 14px;margin-bottom:12px;border-radius:6px;background:rgba(220,170,0,0.12);border:1px solid var(--yellow);\">" +
        "⚠ " + res.advertencias + " aviso(s) — verificar antes de análisis definitivo" +
      "</div>"
    : "<div style=\"padding:10px 14px;margin-bottom:12px;border-radius:6px;background:rgba(40,180,80,0.10);border:1px solid var(--green);color:var(--green);font-weight:600;\">" +
        "✓ Sin errores críticos — datos en buen estado" +
      "</div>";

  // Secciones con toggle
  var seccionesHtml = Object.keys(SECS).map(function(secKey) {
    var items = bySection[secKey] || [];
    if (!items.length) return "";
    var nErr  = items.filter(function(i){return i.tipo==="ERROR";}).length;
    var nWarn = items.filter(function(i){return i.tipo==="AVISO";}).length;
    var nPend = items.filter(function(i){return i.tipo==="PENDIENTE";}).length;
    var borderColor = nErr  > 0 ? "var(--red)"
                    : nWarn > 0 ? "var(--yellow)"
                    : nPend > 0 ? "var(--accent)"
                    : "var(--green)";
    var badges =
      (nErr  ? " <span class=\"badge-err\" style=\"font-size:11px;\">"+nErr+" error</span>"     : "") +
      (nWarn ? " <span class=\"badge-warn\" style=\"font-size:11px;\">"+nWarn+" aviso</span>"   : "") +
      (nPend ? " <span class=\"badge-pend\" style=\"font-size:11px;\">"+nPend+" pend</span>"    : "") +
      (!nErr&&!nWarn&&!nPend ? " <span class=\"badge-good\" style=\"font-size:11px;\">✓</span>" : "");

    var rows = items.map(function(item) {
      var bg = item.tipo==="ERROR"?"rgba(220,50,50,0.07)":item.tipo==="AVISO"?"rgba(220,170,0,0.07)":item.tipo==="PENDIENTE"?"rgba(100,140,220,0.07)":"";
      return "<div style=\"padding:7px 12px;border-bottom:1px solid var(--border);font-size:12px;background:"+bg+";display:flex;gap:10px;align-items:flex-start;\">" +
        "<span class=\""+item.cls+"\" style=\"min-width:76px;text-align:center;flex-shrink:0;font-size:10px;\">"+item.tipo+"</span>" +
        "<span>"+item.msg+"</span>" +
      "</div>";
    }).join("");

    return "<div class=\"card\" style=\"margin-bottom:10px;padding:0;overflow:hidden;border-left:3px solid "+borderColor+";\">" +
      "<div style=\"padding:10px 14px;display:flex;justify-content:space-between;align-items:center;background:var(--bg2);cursor:pointer;\"" +
        " onclick=\"var n=this.nextElementSibling;n.style.display=n.style.display===\'none\'?\'\':\'none\';\">" +
        "<b style=\"font-size:13px;\">"+(SECS[secKey]||secKey)+"</b>" +
        "<span>"+badges+" <span class=\"muted\" style=\"font-size:11px;\">"+items.length+" items</span></span>" +
      "</div>" +
      "<div>"+rows+"</div>" +
    "</div>";
  }).join("");

  view().innerHTML =
    "<div class=\"page-header\">" +
      "<h2>Auditoría de Datos</h2>" +
      "<span class=\"muted\" style=\"font-size:12px;\">v7.0 — política: cero datos inventados ni estimados como reales</span>" +
    "</div>" +
    "<div class=\"card\" style=\"margin-bottom:14px;\">" +
      "<p class=\"muted\" style=\"font-size:12px;margin-bottom:12px;\">" +
        "Verificación completa. Errores = datos faltantes o incorrectos que afectan resultados. " +
        "Pendientes = datos reales por confirmar (sistema funciona sin ellos, con menor precisión)." +
      "</p>" +
      kpis + alertaBanner +
    "</div>" +
    seccionesHtml;
}

export function renderEncuestas(state, ctx) {
  var polls = ctx.polls || [];

  view().innerHTML =
    "<div class=\"page-header\"><h2>Encuestas</h2>" +
      "<button class=\"btn-sm\" id=\"btn-enc-upload\">Cargar archivo</button>" +
      "<input type=\"file\" id=\"enc-file\" accept=\".json\" style=\"display:none;\">" +
    "</div>" +

    // Toggle aplicar a simulador
    "<div class=\"card\" style=\"margin-bottom:14px;display:flex;gap:16px;align-items:center;flex-wrap:wrap;\">" +
      "<label style=\"display:flex;align-items:center;gap:8px;font-weight:600;\">" +
        "<input type=\"checkbox\" id=\"enc-apply\"> Aplicar encuesta activa al Simulador como delta inicial" +
      "</label>" +
      "<select id=\"enc-activa\" class=\"sel-sm\">" +
        (polls.length
          ? polls.map(function(p, i) {
              return opt(String(i), p.fecha + " - " + p.encuestadora + " (" + p.nivel + ")", i === 0);
            }).join("")
          : "<option>Sin encuestas</option>"
        ) +
      "</select>" +
    "</div>" +

    // Tabla historica
    "<div class=\"card\" style=\"margin-bottom:14px;\">" +
      "<h3>Historico de encuestas (" + polls.length + ")</h3>" +
      (polls.length
        ? "<div style=\"overflow:auto;\">" +
            "<table class=\"tbl\">" +
              "<thead><tr>" +
                "<th>Fecha</th><th>Encuestadora</th><th>Nivel</th>" +
                "<th class=\"r\">Muestra</th><th class=\"r\">Margen error</th>" +
                "<th>Principales resultados</th>" +
              "</tr></thead>" +
              "<tbody>" + polls.map(function(p) {
                var topRes = Object.entries(p.resultados || {})
                  .sort(function(a,b){return b[1]-a[1];})
                  .slice(0,5)
                  .map(function(kv) { return kv[0] + ":" + kv[1] + "%"; })
                  .join(" | ");
                return "<tr>" +
                  "<td>" + (p.fecha || "-") + "</td>" +
                  "<td>" + (p.encuestadora || "-") + "</td>" +
                  "<td>" + (p.nivel || "-") + "</td>" +
                  "<td class=\"r\">" + (p.muestra ? fmtInt(p.muestra) : "-") + "</td>" +
                  "<td class=\"r\">+/-" + (p.margen_error || "-") + "%</td>" +
                  "<td style=\"font-size:12px;\">" + topRes + "</td>" +
                "</tr>";
              }).join("") +
              "</tbody>" +
            "</table>" +
          "</div>"
        : "<p class=\"muted\">Sin encuestas cargadas. Usa el boton \"Cargar archivo\" para importar un polls.json.</p>"
      ) +
    "</div>" +

    // Grafico comparativo (si hay datos)
    (polls.length
      ? "<div class=\"card\">" +
          "<h3>Comparativo - Encuesta mas reciente</h3>" +
          renderEncuestaChart(polls[polls.length-1]) +
        "</div>"
      : ""
    );

  // Upload handler
  el("btn-enc-upload").addEventListener("click", function() {
    var fi = el("enc-file");
    if (fi) fi.click();
  });
  var fileInp = el("enc-file");
  if (fileInp) {
    fileInp.addEventListener("change", function(e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function(ev) {
        try {
          var data = JSON.parse(ev.target.result);
          var arr  = Array.isArray(data) ? data : [data];
          // Normalizar cada encuesta a 100%
          arr.forEach(function(enc) {
            var res = enc.resultados || {};
            var total = Object.values(res).reduce(function(a,v){return a+v;},0);
            if (total > 0 && Math.abs(total - 100) > 0.5) {
              var factor = 100 / total;
              Object.keys(res).forEach(function(p){ res[p] = Math.round(res[p]*factor*10)/10; });
              enc._normalizado = true;
            }
          });
          ctx.polls = (ctx.polls || []).concat(arr);
          toast("Encuesta cargada: " + arr.length + " registro(s)");
          renderEncuestas(state, ctx);
        } catch(err) {
          toast("Error: JSON invalido");
        }
      };
      reader.readAsText(file);
    });
  }

  // Aplicar al simulador
  var applyChk = el("enc-apply");
  if (applyChk) {
    applyChk.addEventListener("change", function() {
      if (!applyChk.checked) return;
      var idx   = el("enc-activa") ? Number(el("enc-activa").value) : 0;
      var encuesta = polls[idx];
      if (!encuesta || !encuesta.resultados) {
        toast("Sin datos de resultados en la encuesta");
        return;
      }
      // Calcular deltas vs 2024
      var nivel = state.nivel === "pres" ? "pres" : state.nivel;
      var lv    = getLevel(ctx, 2024, nivel);
      var nat   = lv.nacional;
      var totalEm = nat.emitidos || 1;
      var deltaStore = {};
      Object.entries(encuesta.resultados).forEach(function(kv) {
        var p = kv[0]; var pctEnc = kv[1] / 100;
        var pctBase = (nat.votes[p] || 0) / totalEm;
        var delta = Math.round((pctEnc - pctBase) * 100 * 10) / 10;
        if (Math.abs(delta) > 0.1) deltaStore[p] = delta;
      });
      localStorage.setItem("sie28-sim-deltas", JSON.stringify(deltaStore));
      toast("Deltas guardados. Ve al Simulador para aplicarlos.");
    });
  }
}

function renderEncuestaChart(encuesta) {
  if (!encuesta || !encuesta.resultados) return "<p class=\"muted\">Sin datos.</p>";
  var sorted = Object.entries(encuesta.resultados)
    .sort(function(a,b){return b[1]-a[1];})
    .slice(0, 8);
  var max = sorted[0] ? sorted[0][1] : 1;
  return "<div style=\"margin-top:8px;\">" +
    sorted.map(function(kv) {
      var p = kv[0]; var pct = kv[1];
      var w = Math.round((pct/max)*100);
      return "<div class=\"bar-row\">" +
        "<span class=\"bar-label\">" + p + "</span>" +
        "<div class=\"bar-track\">" +
          "<div class=\"bar-fill\" style=\"width:" + w + "%;background:" + clr(p) + "\"></div>" +
        "</div>" +
        "<span class=\"bar-pct\">" + pct + "%</span>" +
        "</div>";
    }).join("") +
    "<p class=\"muted\" style=\"margin-top:8px;font-size:11px;\">" +
      encuesta.encuestadora + " | " + encuesta.fecha +
      (encuesta.muestra ? " | n=" + fmtInt(encuesta.muestra) : "") +
      (encuesta.margen_error ? " | +/-" + encuesta.margen_error + "%" : "") +
    "</p>" +
  "</div>";
}

export { exportarPDF };
