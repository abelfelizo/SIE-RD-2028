/**
 * SIE 2028  ui/views.js  v8.0 — Build Final
 * REGLA: cero backticks anidados. Toda interpolacin condicional usa funciones helper.
 */
import { toast }              from "./toast.js";
import { initMap }            from "./map.js";
import { getLevel, getInscritos } from "../core/data.js";
import { simular }            from "../core/simulacion.js";
import { generarEscenarios, calcularProvinciasCriticas, calcularEficienciaTerritorios, generarPlanAccion } from "../core/objetivo.js";
import { calcPotencial }      from "../core/potencial.js";
import { runAuditoria }       from "../core/auditoria.js";
import { simBoleta }          from "../core/boleta.js";
import { exportarPDF }        from "../core/exportar.js";
import { fmtInt, fmtPct, rankVotes } from "../core/utils.js";
import { generarAlertas, renderAlertasHtml } from "../core/alertas.js";
import { proyectarPadron }    from "../core/proyeccion2028.js";
import { calcSwing, calcRiesgoSegundaVuelta } from "../core/swing.js";

//  Constantes 
const NIVEL_LABEL = { pres:"Presidencial", sen:"Senadores", dip:"Diputados", mun:"Alcaldes", dm:"DM" };
const CORTE_LABEL = { mayo2024:"Mayo 2024", feb2024:"Feb 2024", proy2028:"Proy. 2028" };
// Colores base — extraídos de boleta JCE 2024 (https://jce.gob.do)
const PARTY_COLORS_BASE = {
  // ── Colores oficiales de boleta JCE 2024 ──────────────────────────────
  PRM:    "#1A3FA0",  // Azul oscuro (boleta #1)
  PLD:    "#8B0D8B",  // Morado/violeta (boleta #2 - estrella amarilla sobre fondo oscuro)
  FP:     "#007A33",  // Verde oscuro (boleta #3)
  PRD:    "#CC2200",  // Rojo (boleta #4)
  PRSC:   "#1055A0",  // Rojo/azul reforma social cristiana (boleta #5)
  ALPAIS: "#0097A7",  // Teal (boleta #6)
  DXC:    "#F5A800",  // Amarillo/dorado (boleta #7)
  PUN:    "#1B6B20",  // Verde oscuro (boleta #8)
  BIS:    "#2E7D32",  // Verde (boleta #9)
  PHD:    "#D4A100",  // Dorado (boleta #10)
  PCR:    "#B71C1C",  // Rojo oscuro (boleta #11)
  PRSD:   "#C00000",  // Rojo (boleta #12 - toro negro)
  MODA:   "#3949AB",  // Azul/violeta (boleta #13)
  "F.AMPLIO": "#4CAF50",  // Verde (boleta #14)
  FAMPLIO:    "#4CAF50",
  FAMPLIO2:   "#4CAF50",
  APD:    "#D32F2F",  // Rojo con X (boleta #15)
  PP:     "#2E8B57",  // Verde (boleta #16)
  PLR:    "#43A047",  // Verde (boleta #17)
  PPC:    "#E65100",  // Naranja (boleta #18)
  PQDC:   "#1A6B2A",  // Verde (boleta #19)
  UDC:    "#F9A825",  // Amarillo (boleta #20)
  PAL:    "#FBC02D",  // Amarillo/verde (boleta #21)
  FNP:    "#37474F",  // Gris oscuro (boleta #22)
  PRI:    "#2E7D32",  // Verde (boleta #23)
  PDP:    "#1565C0",  // Azul (boleta #24)
  PNVC:   "#E53935",  // Rojo (boleta #25)
  PASOVE: "#33691E",  // Verde (boleta #26)
  PPT:    "#827717",  // Verde/amarillo (boleta #27)
  GENS:   "#5C6BC0",  // Azul/lila (boleta #28)
  OD:     "#455A64",  // Gris azulado (boleta #29)
  PSC:    "#C62828",  // Rojo (boleta #30)
  PDI:    "#4A148C",  // Morado (boleta #31)
  PED:    "#00838F",  // Teal verde (boleta #32)
  PPG:    "#6A1B9A",  // Morado (boleta #33)
  JS:     "#0D47A1",  // Azul oscuro (boleta #34)
  OTROS:  "#9E9E9E"
};
// _ctxPartidos se rellena en cada render con ctx.partidos — permite primaryColor dinámico
var _ctxPartidosColors = {};
const MOV_COEF = { pres:1.00, sen:0.85, dip:0.75, mun:0.70, dm:0.70 };

function clr(p) {
  return _ctxPartidosColors[p] || PARTY_COLORS_BASE[p] || "#666";
}
function loadPartyColors(ctx) {
  if (!ctx || !ctx.partidos) return;
  _ctxPartidosColors = {};
  ctx.partidos.forEach(function(pt) {
    if (pt.codigo && pt.color_primario) _ctxPartidosColors[pt.codigo] = pt.color_primario;
  });
}
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

  // Niveles como botones segmentados
  var NIVELES = [
    { id:"pres", label:"Presidencial", short:"Pres." },
    { id:"sen",  label:"Senadores",    short:"Sen."  },
    { id:"dip",  label:"Diputados",    short:"Dip."  },
    { id:"mun",  label:"Alcaldes",     short:"Alc."  },
    { id:"dm",   label:"Distritos M.", short:"DM"    },
  ];
  var nivelBtns = NIVELES.map(function(n) {
    var active = n.id === state.nivel ? "active" : "";
    return "<button class=\"seg-btn " + active + "\" data-nivel=\"" + n.id + "\" " +
      "title=\"" + n.label + "\">" + n.short + "</button>";
  }).join("");

  slot.innerHTML =
    "<div class=\"seg-group\" id=\"g-nivel-group\" title=\"Nivel de elección activo — afecta todos los módulos\">" +
      nivelBtns +
    "</div>";

  el("g-nivel-group").addEventListener("click", function(e) {
    var btn = e.target.closest(".seg-btn[data-nivel]");
    if (!btn) return;
    var n = btn.dataset.nivel;
    state.setNivel(n);
    // update active
    el("g-nivel-group").querySelectorAll(".seg-btn").forEach(function(b) {
      b.classList.toggle("active", b.dataset.nivel === n);
    });
    state.recomputeAndRender();
  });
}

//  1. DASHBOARD 
export function renderDashboard(state, ctx) {
  loadPartyColors(ctx);
  var nivel  = state.nivel;
  var isProy = state.modo === "proy2028";
  var year   = isProy ? 2028 : 2024;
  var lv     = getLevel(ctx, year, nivel) || getLevel(ctx, 2024, nivel);
  var nat    = lv.nacional;
  var ins    = nivel === "pres" ? (getInscritos(ctx, state.corte) || nat.inscritos || 0) : (nat.inscritos || 0);
  if (isProy && ctx.padron2028) ins = ctx.padron2028.total;
  var em     = nat.emitidos || 0;
  // Proy 2028: si emitidos proyectados disponibles, usarlos para participación
  if (isProy && ctx.padron2028 && ctx.padron2028.emitidosProyectados) {
    em = ctx.padron2028.emitidosProyectados;
  }
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

  // ── Alianzas 2024 en distribución ─────────────────────────────────────────
  // Calcular resultados con alianzas para mostrar en dashboard (solo visualización)
  var alianzasSection = "";
  var alNivel = ctx.alianzas ? ctx.alianzas[nivel] : null;
  if (alNivel && !isProy) {
    var bloques = alNivel.bloques || [];
    if (bloques.length) {
      var alVotes = Object.assign({}, nat.votes);
      bloques.forEach(function(bloque) {
        (bloque.aliados || []).forEach(function(aliado) {
          var v = alVotes[aliado.partido] || 0;
          var moved = Math.round(v * ((aliado.transferPct || 100) / 100));
          alVotes[aliado.partido] = v - moved;
          alVotes[bloque.lider]   = (alVotes[bloque.lider] || 0) + moved;
        });
      });
      var alRanked = rankVotes(alVotes, em);
      var alRows = alRanked.slice(0, 6).map(function(r) {
        var base = ranked.filter(function(x){ return x.p === r.p; })[0];
        var basePct = base ? base.pct : 0;
        var diff = r.pct - basePct;
        var diffStr = diff > 0.001
          ? "<span class=\"text-ok\">+" + fmtPct(diff) + "</span>"
          : diff < -0.001
          ? "<span class=\"text-warn\">" + fmtPct(diff) + "</span>"
          : "<span class=\"muted\">—</span>";
        return "<tr><td>" + dot(r.p) + " <b>" + r.p + "</b></td>" +
               "<td class=\"r\">" + fmtPct(basePct) + "</td>" +
               "<td class=\"r\"><b>" + fmtPct(r.pct) + "</b></td>" +
               "<td class=\"r\">" + diffStr + "</td></tr>";
      }).join("");
      alianzasSection = sep() +
        "<h3 style=\"margin-top:12px;\">Con alianzas 2024 <span class=\"muted\" style=\"font-size:11px;font-weight:400;\">(visualización — no aplica en motores)</span></h3>" +
        "<table class=\"tbl\"><thead><tr>" +
          "<th>Partido</th><th class=\"r\">Individual</th><th class=\"r\">Con aliados</th><th class=\"r\">Δ</th>" +
        "</tr></thead><tbody>" + alRows + "</tbody></table>";
    }
  }

  var execItems = _buildExecItems(nivel, top, top2, margen, part, ins, em, dipCurules, senResult);
  var compBlock = _buildCompBlock(ctx, ranked, isProy);

  // ── Dashboard ORDER: KPI → Resumen Ejecutivo → Alertas → Distribución + Comparativos ──
  view().innerHTML =
    "<div class=\"page-header\"><h2>Dashboard - " + NIVEL_LABEL[nivel] + "</h2>" +
      badge(CORTE_LABEL[state.corte]) +
      (isProy ? " " + badge("Proy. 2028", "badge-warn") : "") +
    "</div>" +
    modoBanner +

    // 1. KPIs
    "<div class=\"kpi-grid\">" + kpisHtml + "</div>" +

    // 2. Resumen Ejecutivo + Alertas (full width)
    "<div class=\"row-2col\" style=\"margin-top:16px;gap:16px;margin-bottom:16px;\">" +
      "<div class=\"card\"><h3>Resumen Ejecutivo</h3>" +
        "<ul class=\"exec-list\">" + execItems + "</ul>" +
        "<div style=\"margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;\">" +
          "<button class=\"btn\" onclick=\"location.hash='#simulador'\">Simulador</button>" +
          "<button class=\"btn-sm\" onclick=\"location.hash='#objetivo'\">Objetivo</button>" +
          "<button class=\"btn-sm\" onclick=\"location.hash='#auditoria'\">Auditoría</button>" +
        "</div>" +
      "</div>" +
      (alertas.length
        ? "<div class=\"card\"><h3>⚠ Alertas (" + alertas.length + ")</h3>" +
            renderAlertasHtml(alertas, true) + "</div>"
        : "<div class=\"card\" style=\"border-color:var(--green);\"><p style=\"color:var(--green);font-weight:600;\">✓ Sin alertas activas</p></div>"
      ) +
    "</div>" +

    // 3. Distribución (barras + tablas)
    "<div class=\"card\" style=\"margin-bottom:16px;\"><h3>Distribución de votos — " + NIVEL_LABEL[nivel] + "</h3>" +
      barChart(ranked, 8) + dipSection + senSection + munSection + alianzasSection +
    "</div>" +

    // 4. Comparativo histórico (compBlock)
    compBlock +

    // 5. Metodología
    "<details class=\"met-box\" style=\"margin-top:12px;\">" +
      "<summary><b>Metodología — Dashboard</b></summary>" +
      "<div class=\"met-body\">" +
        "<b>Motor activo:</b> Resultados JCE 2024 (histórico) o Proyección 2028 (motor Escenarios)<br>" +
        "<b>Participación:</b> Emitidos / Padrón · <b>Abstención:</b> 1 − Participación<br>" +
        "<b>Proy. Padrón 2028:</b> Padrón₂₀₂₄ × (1 + 1.66%)⁴ + Exterior × (1 + 10.6%)⁴<br>" +
        "<b>Alianzas:</b> Solo visualización en dashboard. Para activar en motores, ir a Simulador → pestaña Alianzas.<br>" +
        "<b>Ganador:</b> partido con mayor % de votos válidos · <b>Margen:</b> Líder − 2do lugar<br>" +
        "<b>Curules:</b> aplicación D'Hondt sobre resultados por circunscripción<br>" +
        "<b>Fuente:</b> JCE resultados definitivos 2024 · Proyección: SIE 2028 v8.3" +
      "</div>" +
    "</details>";
}

function _buildKpisByNivel(nivel, ins, em, part, ranked, margen, dipCurules, senResult, munResult, state, ctx, isProy) {
  var top  = ranked[0];
  var top2 = ranked[1];
  var kpisHtml = "";
  var label24 = isProy ? "Proy. 2028" : "2024";

  // ── Calcular % con alianzas para KPI ─────────────────────────────────────
  function calcPctConAlianzas(partido) {
    if (!ctx.alianzas || !ctx.alianzas[nivel] || !partido) return null;
    var bloques = ctx.alianzas[nivel].bloques || [];
    var liderBlock = bloques.filter(function(b){ return b.lider === partido; })[0];
    if (!liderBlock) return null;
    var nat = ranked;
    var totalEm = em || 1;
    var sumVotos = (nat.filter(function(r){ return r.p === partido; })[0] || {votes: 0}).votes || 0;
    if (!sumVotos && ctx.results2024) {
      var lv = ctx.results2024[nivel] || {};
      var natV = (lv.nacional || {}).votes || {};
      sumVotos = natV[partido] || 0;
    }
    // Use ranked to find base votes
    var baseR = ranked.filter(function(r){ return r.p === partido; })[0];
    if (!baseR) return null;
    var baseVotos = Math.round(baseR.pct * em);
    var totalAliados = 0;
    (liderBlock.aliados || []).forEach(function(al) {
      var alR = ranked.filter(function(r){ return r.p === al.partido; })[0];
      if (alR) totalAliados += Math.round(alR.pct * em * ((al.transferPct || 100) / 100));
    });
    return (baseVotos + totalAliados) / em;
  }

  function kpiConAlianzas(partido, pct) {
    if (!partido || !pct) return "";
    var alPct = calcPctConAlianzas(partido);
    if (alPct === null) {
      return kpi("Lider " + label24, partido, fmtPct(pct), true);
    }
    var diff = alPct - pct;
    return kpi("Lider " + label24,
      "<span style=\"color:" + clr(partido) + ";\">" + partido + "</span>",
      fmtPct(pct) + " individual · <b>" + fmtPct(alPct) + "</b> con aliados" +
      " <span class=\"text-ok\">(+" + fmtPct(diff) + ")</span>",
      true);
  }

  var kpiTop  = top  ? kpiConAlianzas(top.p, top.pct) : "";
  var kpiTop2 = top2 ? kpi("2do lugar",  top2.p, fmtPct(top2.pct)) : "";

  if (nivel === "pres") {
    var riesgo2v  = top && top.pct < 0.5;
    var riesgoCls = riesgo2v ? "text-warn" : "text-ok";
    var riesgoTxt = riesgo2v ? "Alto" : "Bajo";
    kpisHtml =
      kpi("Padron", fmtInt(ins), CORTE_LABEL[state.corte]) +
      kpi("Emitidos " + label24, fmtInt(em)) +
      kpi(isProy ? "Part. Proyectada 2028" : "Participacion 2024", fmtPct(part)) +
      kpi(isProy ? "Abstencion proyectada 2028" : "Abstencion 2024", fmtPct(1-part), fmtInt(Math.round(ins*(1-part))) + " votos") +
      kpiTop + kpiTop2 +
      kpi("Margen Top1-Top2", margen > 0 ? fmtPct(margen) : "-") +
      kpi("Riesgo 2a vuelta", "<span class=\"" + riesgoCls + "\">" + riesgoTxt + "</span>",
          top ? (top.pct < 0.5 ? "Faltan " + fmtPct(0.5 - top.pct) : "Sobre el umbral") : "");
  } else if (nivel === "sen") {
    var senByP  = senResult && senResult.senadores ? senResult.senadores.totalByParty : {};
    var liderSen = top ? (senByP[top.p] || 0) : 0;
    // Sen con alianzas: contar provincias ganadas con aliados
    var alSen = ctx.alianzas ? ctx.alianzas.sen : null;
    var liderSenAl = 0;
    if (alSen && alSen.por_provincia && top) {
      Object.values(alSen.por_provincia).forEach(function(pdata) {
        if (pdata.lider === top.p) liderSenAl++;
      });
    }
    var senAlStr = liderSenAl > liderSen
      ? "<b>" + liderSen + "</b> individual · <b style=\"color:var(--accent)\">" + liderSenAl + "</b> con aliados"
      : String(liderSen);
    kpisHtml =
      kpi("Senadores " + (top ? top.p : ""), senAlStr, "de 32 · mayoría: 17") +
      kpi("Provincias competitivas", String(_countCompetitivos(ctx, "sen")), "<5pp de margen") +
      kpiTop + kpiTop2 +
      kpi("Participacion relativa", fmtPct(part));
  } else if (nivel === "dip") {
    var liderDip  = top && dipCurules ? (dipCurules[top.p] || 0) : 0;
    var marginals = dipCurules ? _countMarginalDip(ctx) : 0;
    kpisHtml =
      kpi("Curules " + label24 + " " + (top ? top.p : ""), String(liderDip), "de 190 diputados · mayoría: 96") +
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
      kpi(isProy ? "Part. Proyectada 2028" : "Participacion 2024", fmtPct(part)) +
      kpiTop;
  }

  // KPI encuesta: promedio ponderado por recencia (peso = 1/(1+meses))
  var polls = ctx.polls || [];
  if (polls.length && top) {
    var hoy = new Date();
    var totalPeso = 0;
    var sumaPct   = 0;
    var nUsadas   = 0;
    polls.forEach(function(p) {
      if (!p.resultados || p.resultados[top.p] === undefined) return;
      if (p.nivel && p.nivel !== nivel && p.nivel !== "presidencial" && p.nivel !== "pres") return;
      var fecha  = p.fecha ? new Date(p.fecha) : null;
      var meses  = fecha ? Math.max(0, (hoy - fecha) / (1000*60*60*24*30)) : 24;
      var peso   = 1 / (1 + meses);
      totalPeso += peso;
      sumaPct   += p.resultados[top.p] * peso;
      nUsadas++;
    });
    if (nUsadas > 0 && totalPeso > 0) {
      var encPct  = (sumaPct / totalPeso) / 100;
      var delta   = encPct - top.pct;
      var cls     = delta > 0.005 ? "text-ok" : delta < -0.005 ? "text-warn" : "";
      var sign    = delta >= 0 ? "+" : "";
      kpisHtml += kpi(
        "Encuestas (" + nUsadas + (nUsadas === 1 ? " fuente" : " fuentes") + ")",
        "<span class=\"" + cls + "\">" + (encPct * 100).toFixed(1) + "%</span>",
        sign + (delta * 100).toFixed(1) + "pp vs " + label24 + " — promedio ponderado"
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
  loadPartyColors(ctx);
  var nivel   = state.nivel;
  var isProy  = state.modo === "proy2028";
  var year    = isProy ? 2028 : 2024;
  var lv      = getLevel(ctx, year, nivel) || getLevel(ctx, 2024, nivel);
  var lv2024  = getLevel(ctx, 2024, nivel);
  var dipRes  = nivel === "dip" ? simular(ctx, { nivel:"dip", year: year }) : null;

  view().innerHTML =
    "<div class=\"page-header\"><h2>Mapa - " + NIVEL_LABEL[nivel] + "</h2>" +
      "<div style=\"display:flex;gap:6px;flex-wrap:wrap;align-items:center;\">" +
        "<button class=\"btn-sm\" id=\"map-zi\">+</button>" +
        "<button class=\"btn-sm\" id=\"map-zo\">−</button>" +
        "<button class=\"btn-sm\" id=\"map-r\">↺</button>" +
        "<span style=\"color:var(--border);margin:0 4px;\">|</span>" +
        "<button class=\"seg-btn active\" id=\"map-mode-ganador\" data-mapmode=\"ganador\" title=\"Color por partido ganador\">Ganador</button>" +
        "<button class=\"seg-btn\" id=\"map-mode-swing\" data-mapmode=\"swing\" title=\"Territorios más competitivos y cambiantes\">Swing</button>" +
        "<button class=\"seg-btn\" id=\"map-mode-abst\" data-mapmode=\"abst\" title=\"Nivel de abstención por provincia\">Abstención</button>" +
        "<span style=\"color:var(--border);margin:0 4px;\">|</span>" +
        "<button class=\"seg-btn\" id=\"map-mode-con-aliados\" data-mapmode=\"con-aliados\" title=\"Resultados acumulando votos de partidos + aliados\">Con aliados</button>" +
        "<button class=\"seg-btn active\" id=\"map-mode-sin-aliados\" data-mapmode=\"sin-aliados\" title=\"Resultados por partido individual sin alianzas\">Sin aliados</button>" +
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

  // Modo mapa: Ganador / Swing / Abstención
  var _mapMode = "ganador";
  function applyMapColors(mode) {
    _mapMode = mode;
    // Actualizar botones activos
    ["ganador","swing","abst","con-aliados","sin-aliados"].forEach(function(m) {
      var btn = document.getElementById("map-mode-" + m);
      if (btn) btn.classList.toggle("active", m === mode);
    });
    if (!lv || !lv.prov) return;

    // Para modo alianzas: construir mapa de ganadores con votos agregados
    var alianzasVotes = null;
    if (mode === "con-aliados" && ctx.alianzas && ctx.alianzas[nivel]) {
      alianzasVotes = {};
      // Pre-calcular votos consolidados por provincia para el nivel activo
      var bloques = ctx.alianzas[nivel].bloques || [];
      Object.keys(lv.prov).forEach(function(pid) {
        var prov  = lv.prov[pid];
        var votes = Object.assign({}, prov.votes || {});
        bloques.forEach(function(bloque) {
          (bloque.aliados || []).forEach(function(aliado) {
            var v     = votes[aliado.partido] || 0;
            var moved = Math.round(v * ((aliado.transferPct || 70) / 100));
            votes[aliado.partido] = v - moved;
            votes[bloque.lider]   = (votes[bloque.lider] || 0) + moved;
          });
        });
        alianzasVotes[pid] = votes;
      });
    }

    Object.keys(lv.prov).forEach(function(pid) {
      var prov  = lv.prov[pid];
      // pid is JCE code. Find the corresponding SVG id using jceToSvg mapping
      var svgId = (ctx.jceToSvg && ctx.jceToSvg[pid]) ? ctx.jceToSvg[pid] : pid;
      var shape = document.querySelector("[id=\"DO-" + svgId + "\"]");
      if (!shape) return;

      var votes = (mode === "con-aliados" && alianzasVotes) ? alianzasVotes[pid] : (prov.votes || {});
      var r = rankVotes(votes, prov.emitidos);

      if (mode === "ganador" || mode === "con-aliados" || mode === "sin-aliados") {
        if (r[0]) {
          var margenProv = r.length >= 2 ? r[0].pct - r[1].pct : 1;
          shape.style.fill    = margenProv < 0.05 ? "#888" : clr(r[0].p);
          shape.style.opacity = String(0.35 + r[0].pct * 0.65);
        }
      } else if (mode === "swing") {
        var marg = r.length >= 2 ? r[0].pct - r[1].pct : 1;
        var intensity = Math.max(0, Math.min(1, 1 - marg * 5));
        shape.style.fill    = "hsl(" + Math.round(intensity * 0 + (1-intensity) * 120) + ",70%,45%)";
        shape.style.opacity = "0.85";
      } else if (mode === "abst") {
        var ins    = prov.inscritos || 1;
        var abst   = ins > 0 ? 1 - (prov.emitidos || 0) / ins : 0;
        var intens = Math.min(1, abst / 0.6);
        shape.style.fill    = "hsl(210," + Math.round(30 + intens * 70) + "%," + Math.round(60 - intens * 30) + "%)";
        shape.style.opacity = "0.85";
      }
    });
  }

  ["ganador","swing","abst","con-aliados","sin-aliados"].forEach(function(m) {
    var btn = document.getElementById("map-mode-" + m);
    if (btn) btn.addEventListener("click", function() { applyMapColors(m); });
  });

  var _selectedSvgId = null;  // track currently selected province for reset

  _mapApi = initMap({
    containerId: "map-container",
    svgUrl: "./assets/maps/provincias.svg",
    onSelect: function(svgProvId) {
      // Translate SVG id -> JCE province code
      var provId = (ctx.svgToJce && ctx.svgToJce[svgProvId]) ? ctx.svgToJce[svgProvId] : svgProvId;

      // Clear previously selected province BEFORE re-applying all colors
      if (_selectedSvgId && _selectedSvgId !== svgProvId) {
        var prevTarget = document.querySelector("[id='DO-" + _selectedSvgId + "']");
        if (prevTarget) {
          prevTarget.style.stroke = "";
          prevTarget.style.strokeWidth = "";
        }
      }

      // Re-apply all colors (this resets all fills correctly)
      applyMapColors(_mapMode);
      showProvPanel(lv, lv2024, provId, nivel, dipRes, ctx, _mapMode);

      // Apply selected highlight AFTER color reset — use SVG id (not JCE)
      var svgHighlightId = (ctx.jceToSvg && ctx.jceToSvg[provId]) ? ctx.jceToSvg[provId] : provId;
      var target = document.querySelector("[id='DO-" + svgHighlightId + "']");
      if (target) {
        target.style.fill = "var(--accent)";
        target.style.opacity = "0.95";
        target.style.strokeWidth = "2.5";
        target.style.stroke = "#fff";
      }
      _selectedSvgId = svgHighlightId;
    },
    onReady: function() {
      applyMapColors("ganador");
      if (_mapApi && _mapApi.validate) {
        var svgKeys = Object.keys(lv.prov).filter(function(id) {
          var n = parseInt(id, 10); return n >= 1 && n <= 32;
        });
        _mapApi.validate(svgKeys);
      }
    },
  });
}

function showProvPanel(lv, lv2024, provId, nivel, dipRes, ctx, mapMode) {
  var panel = el("map-panel");
  if (!panel) return;
  var prov   = lv.prov ? lv.prov[provId] : null;
  var prov24 = lv2024 && lv2024.prov ? lv2024.prov[provId] : null;
  if (!prov) { panel.innerHTML = "<p class=\"muted\">Sin datos para provincia " + provId + ".</p>"; return; }

  // Apply alianzas if mode is "con-aliados"
  var provVotes = prov.votes || {};
  var modoAliados = (mapMode === "con-aliados");
  if (modoAliados && ctx.alianzas && ctx.alianzas[nivel]) {
    var bloques = ctx.alianzas[nivel].bloques || [];
    // For sen: use por_provincia
    if (nivel === "sen" && ctx.alianzas.sen && ctx.alianzas.sen.por_provincia) {
      var senProv = ctx.alianzas.sen.por_provincia[provId];
      if (senProv) {
        // Build consolidated votes for this province
        var mergedVotes = Object.assign({}, provVotes);
        (senProv.aliados || []).forEach(function(al) {
          var v     = mergedVotes[al.partido] || 0;
          var moved = Math.round(v * ((al.transferPct || 100) / 100));
          mergedVotes[al.partido] = v - moved;
          mergedVotes[senProv.lider] = (mergedVotes[senProv.lider] || 0) + moved;
        });
        provVotes = mergedVotes;
      }
    } else if (bloques.length) {
      var mergedVotes = Object.assign({}, provVotes);
      bloques.forEach(function(bloque) {
        (bloque.aliados || []).forEach(function(aliado) {
          var v     = mergedVotes[aliado.partido] || 0;
          var moved = Math.round(v * ((aliado.transferPct || 100) / 100));
          mergedVotes[aliado.partido] = v - moved;
          mergedVotes[bloque.lider]   = (mergedVotes[bloque.lider] || 0) + moved;
        });
      });
      provVotes = mergedVotes;
    }
  }

  var part   = prov.inscritos ? prov.emitidos / prov.inscritos : 0;
  var ranked = rankVotes(provVotes, prov.validos || prov.emitidos);
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
      var nCircs = provCircs.length;
      var circNota = nCircs > 1
        ? "<p style=\"font-size:11px;color:var(--accent);margin-bottom:4px;\">📋 " + nCircs + " circunscripciones en esta provincia. D'Hondt se aplica por separado en cada una.</p>"
        : "<p style=\"font-size:11px;color:var(--text2);margin-bottom:4px;\">📋 1 circunscripción (provincia completa).</p>";
      curulesHtml = circNota + "<h4 style=\"margin:12px 0 6px;\">Curules</h4>" +
        "<table class=\"tbl\"><thead><tr><th>Circ.</th><th class=\"r\">Esc.</th><th>Dist.</th></tr></thead>" +
        "<tbody>" + crows + "</tbody></table>";
    }
  }

  // Autoridades electas 2024 en esta provincia
  var autoridadesHtml = "";
  var lv24Sen = getLevel(ctx, 2024, "sen");
  var lv24Mun = getLevel(ctx, 2024, "mun");
  var senProv = lv24Sen && lv24Sen.prov ? lv24Sen.prov[provId] : null;
  var autoRows = [];

  // Senadores ganadores
  if (senProv && senProv.votes) {
    var rSen = rankVotes(senProv.votes, senProv.emitidos);
    if (rSen[0]) autoRows.push([
      "Senador electo",
      dot(rSen[0].p) + " <b>" + rSen[0].p + "</b>",
      fmtPct(rSen[0].pct)
    ]);
  }

  // Alcalde capital de provincia (municipio con mismo ID de 2 dígitos si existe)
  if (lv24Mun && lv24Mun.mun) {
    // Find municipalities that belong to this province (mun ID starts with provId)
    var provMuns = Object.keys(lv24Mun.mun).filter(function(mid) {
      return mid.indexOf(provId) === 0;
    });
    // Use first municipality as proxy for provincial capital
    if (provMuns.length) {
      var capMun = lv24Mun.mun[provMuns[0]];
      var rMun = rankVotes(capMun.votes, capMun.emitidos);
      if (rMun[0]) autoRows.push([
        "Alcalde (cap.)",
        dot(rMun[0].p) + " <b>" + rMun[0].p + "</b>",
        fmtPct(rMun[0].pct)
      ]);
    }
  }

  if (autoRows.length) {
    autoridadesHtml = "<h4 style=\"margin:12px 0 6px;\">Autoridades electas 2024</h4>" +
      "<table class=\"tbl\"><tbody>" +
      autoRows.map(function(r) {
        return "<tr><td style=\"color:var(--text2);font-size:12px;\">" + r[0] + "</td>" +
          "<td>" + r[1] + "</td><td class=\"r\">" + r[2] + "</td></tr>";
      }).join("") +
      "</tbody></table>";
  }

  panel.innerHTML =
    "<h3 style=\"margin:0 0 10px;\">" + (prov.nombre || "Provincia " + provId) + "</h3>" +
    statGrid([
      ["Inscritos",      fmtInt(prov.inscritos)],
      ["Emitidos",       fmtInt(prov.emitidos)],
      ["Participacion",  fmtPct(part)],
      ["Margen 1-2",     margen !== null ? fmtPct(margen) : "-"],
    ]) +
    "<div style=\"margin-top:10px;\">" + barChart(ranked, 8) + "</div>" +
    swingBlock +
    encBlock +
    histBlock +
    autoridadesHtml +
    curulesHtml +
    "<details class=\"met-box\" style=\"margin-top:12px;\">" +
      "<summary><b>Metodología — Mapa Electoral</b></summary>" +
      "<div class=\"met-body\">" +
        "<b>Modos:</b> Ganador (mayor % provincial) · Swing (desviación vs media nacional) · Abstención (%)<br>" +
        "<b>Aliados:</b> votos consolidados por bloque presidencial según acuerdos de aval JCE 2024<br>" +
        "<b>IDs:</b> códigos JCE 01–32 vinculados al SVG oficial · click = provincia correcta<br>" +
        "<b>Swing:</b> %provincial − %nacional del partido (positivo = sobre-desempeño territorial)<br>" +
        "<b>Fuente:</b> JCE resultados definitivos 2024 · Alianzas: alianzas_2024.json v2.0" +
      "</div>" +
    "</details>";
}

//  3. SIMULADOR UNIFICADO v8.0
// Integra: Simulación nacional + por territorio + Boleta Única (D'Hondt por circ)
// DEFINICIÓN PP: adición aritmética al % base. PRM 48% + 3pp = 51%, renormalizado.
export function renderSimulador(state, ctx) {
  loadPartyColors(ctx);
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

  // Selector de territorio
  var terr24     = nivel === "mun" ? lv.mun : nivel === "dm" ? lv.dm : lv.prov;
  var terrKeys   = Object.keys(terr24 || {}).filter(function(id) {
    if (nivel !== "mun" && nivel !== "dm") {
      var n = parseInt(id, 10); return n >= 1 && n <= 32;
    }
    return true;
  }).sort();

  var terrOpts = "<option value=\"\">Nacional (todos)</option>" +
    terrKeys.map(function(id) {
      var t = (terr24 || {})[id];
      return opt(id, (t && t.nombre) || id, false);
    }).join("");

  // Para diputados: selector de circunscripción
  var circOpts = "";
  if (nivel === "dip" && ctx.curules && ctx.curules.territorial) {
    var circItems = ctx.curules.territorial.filter(function(c) {
      var pid = String(c.provincia_id).padStart(2, "0");
      var n = parseInt(pid, 10); return n >= 1 && n <= 32;
    });
    circOpts = "<option value=\"\">-- todas --</option>" +
      circItems.map(function(c) {
        var pid  = String(c.provincia_id).padStart(2, "0");
        var key  = c.circ > 0 ? pid + "-" + c.circ : pid;
        var lbl  = c.provincia + (c.circ > 0 ? " Circ." + c.circ : "") + " (" + c.seats + " esc.)";
        return opt(key, lbl, false);
      }).join("");
  }

  var TABS = ["Base", "Encuesta", "Movilización", "Alianzas", "Arrastre", "D'Hondt"];

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
      "<label for=\"alz-" + r.p + "\" style=\"min-width:50px;\">" + dot(r.p) + r.p + "</label>" +
      "<input class=\"inp-sm alz-pct\" type=\"number\" min=\"0\" max=\"100\" step=\"5\" value=\"80\" " +
        "style=\"width:60px;\" data-party=\"" + r.p + "\" disabled>% transf." +
    "</div>";
  }).join("");

  var arrOpts = partyData.slice(0, 8).map(function(r) { return opt(r.p, r.p, false); }).join("");
  var arrastreBlock = nivel !== "pres"
    ? "<div style=\"font-size:11px;color:var(--text2);margin-bottom:10px;padding:8px;background:var(--bg3);border-radius:6px;\">" +
        "<b>Metodología (Feigert-Norris 1990, datos JCE 2004-2024):</b><br>" +
        "En elecciones concurrentes, el candidato presidencial arrastra voto a otros niveles. " +
        "Coef. k calibrado: margen &gt;10pp → k=0.55 | 5-10pp → k=0.35 | &lt;5pp → k=0.18. " +
        "Fórmula: boost = votos_base × k × margen_presidencial. Tope: 15% del total emitido." +
      "</div>" +
      "<div style=\"display:flex;gap:8px;align-items:center;flex-wrap:wrap;\">" +
        "<label><input type=\"checkbox\" id=\"sim-arrastre\"> Activar arrastre</label>" +
        "<select id=\"sim-arr-lider\" class=\"sel-sm\">" + arrOpts + "</select>" +
        "<select id=\"sim-arr-k\" class=\"sel-sm\">" +
          "<option value=\"auto\">Auto (histórico)</option>" +
          "<option value=\"0.55\">k=0.55 (victoria &gt;10pp)</option>" +
          "<option value=\"0.35\">k=0.35 (victoria 5-10pp)</option>" +
          "<option value=\"0.18\">k=0.18 (elección reñida &lt;5pp)</option>" +
        "</select>" +
      "</div>"
    : "<p class=\"muted\" style=\"font-size:12px;\">Solo aplica a niveles legislativos y municipales.</p>";

  // Encuesta tab — ahora con soporte de encuesta LOCAL por territorio
  var polls    = ctx.polls || [];
  var encBlock =
    "<div style=\"margin-bottom:10px;\">" +
      "<div style=\"display:flex;gap:8px;align-items:center;margin-bottom:8px;\">" +
        "<label class=\"muted\" style=\"font-size:12px;\">Encuesta local (territorio seleccionado):</label>" +
        "<select id=\"enc-scope\" class=\"sel-sm\">" +
          "<option value=\"nacional\">Nacional</option>" +
          (terrOpts ? "<option value=\"territorial\">Por territorio activo</option>" : "") +
        "</select>" +
      "</div>" +
    "</div>" +
    (polls.length
      ? "<p class=\"muted\" style=\"font-size:12px;margin-bottom:8px;\">Selecciona encuesta → carga como ajuste base. Si hay encuesta local, aplica por territorio.</p>" +
        polls.map(function(p, i) {
          var topRes = Object.entries(p.resultados || {}).sort(function(a,b){return b[1]-a[1];}).slice(0,3)
            .map(function(kv){ return kv[0]+":"+kv[1]+"%"; }).join(" | ");
          return "<div style=\"padding:8px;background:var(--bg3);border-radius:6px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;\">" +
            "<div><b>" + p.encuestadora + "</b> <span class=\"muted\">" + p.fecha + " · n=" + (p.muestra||"?") + "</span><br>" +
            "<span style=\"font-size:12px;\">" + topRes + "</span></div>" +
            "<button class=\"btn-sm\" data-enc-idx=\"" + i + "\">Aplicar</button>" +
          "</div>";
        }).join("")
      : "<p class=\"muted\">Sin encuestas cargadas. Ve al módulo Encuestas para importar.</p>");

  // D'Hondt tab — ex Boleta Única fusionada
  var lv_dip  = getLevel(ctx, year, "dip") || getLevel(ctx, 2024, "dip");
  var dhondtTab = nivel === "dip"
    ? "<div class=\"card\" style=\"margin-bottom:10px;\">" +
        "<h3>Boleta única / D'Hondt por circunscripción</h3>" +
        (!ctx.alianzas || !ctx.alianzas.dip
          ? "<div class=\"badge-warn\" style=\"display:inline-block;margin-bottom:8px;padding:4px 10px;border-radius:4px;font-size:12px;\">⚠ alianzas_2024.json pendiente — resultados sin alianzas</div>"
          : "") +
        "<p class=\"muted\" style=\"font-size:11px;margin-bottom:8px;\">Circunscripciones con multi-circ: DN (3), La Vega (2), Puerto Plata (2), San Cristóbal (3), Santiago (3), Sto. Domingo (6).</p>" +
        "<div style=\"display:flex;gap:8px;align-items:center;margin-bottom:8px;\">" +
          "<label class=\"muted\">Circunscripción:</label>" +
          "<select id=\"dhondt-circ\" class=\"sel-sm\" style=\"flex:1;\">" + circOpts + "</select>" +
          "<button class=\"btn-sm\" id=\"btn-dhondt-calc\">Calcular</button>" +
        "</div>" +
        "<div id=\"dhondt-result\"><p class=\"muted\">Selecciona circunscripción y calcula para ver distribución de escaños.</p></div>" +
      "</div>"
    : "<p class=\"muted\" style=\"font-size:12px;\">D'Hondt solo aplica al nivel Diputados.</p>";

  var tabBtns = TABS.map(function(t, i) {
    return "<button class=\"tab-btn" + (i===0?" active":"") + "\" data-tab=\"sim-tab-" + i + "\">" + t + "</button>";
  }).join("");

  view().innerHTML =
    "<div class=\"page-header\"><h2>Simulador - " + NIVEL_LABEL[nivel] + "</h2>" +
      (isProy ? badge("Proy. 2028", "badge-warn") : "") +
      "<div style=\"display:flex;gap:6px;align-items:center;flex-wrap:wrap;\">" +
        "<label class=\"muted\" style=\"font-size:12px;\">Territorio:</label>" +
        "<select id=\"sim-territorio\" class=\"sel-sm\" style=\"max-width:200px;\">" + terrOpts + "</select>" +
      "</div>" +
    "</div>" +

    "<div style=\"font-size:11px;color:var(--text2);margin-bottom:8px;padding:6px 10px;background:var(--bg3);border-radius:4px;\">" +
      "<b>¿Qué es pp?</b> Puntos porcentuales: adición aritmética al % base. " +
      "Ej: PRM en 48.0% + 3 pp → 51.0%, luego el sistema renormaliza todos los partidos a 100%. " +
      "Si no hay encuesta local para el territorio, se aplica simpatía general + arrastre presidencial." +
    "</div>" +

    // Header resultado
    "<div class=\"card\" style=\"margin-bottom:14px;\" id=\"sim-header-result\">" +
      "<div style=\"display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;\">" +
        "<div><div class=\"kpi-label\">Resultado actual</div><div id=\"sh-base\" style=\"font-size:14px;font-weight:600;\">-</div></div>" +
        "<div><div class=\"kpi-label\">Resultado simulado</div><div id=\"sh-sim\" style=\"font-size:14px;font-weight:600;color:var(--accent);\">-</div></div>" +
        "<div><div class=\"kpi-label\">Variación votos</div><div id=\"sh-dv\" style=\"font-size:14px;font-weight:600;\">-</div></div>" +
        "<div><div class=\"kpi-label\">Variación curules</div><div id=\"sh-dc\" style=\"font-size:14px;font-weight:600;\">-</div></div>" +
      "</div>" +
      "<div id=\"sim-fuente-ind\" style=\"margin-top:8px;padding:6px 10px;border-radius:4px;background:var(--bg3);font-size:11px;display:none;\">" +
        "<span style=\"color:var(--text2);\">Motor usando: </span>" +
        "<span id=\"sim-fuente-label\" style=\"font-weight:600;color:var(--accent);\"></span>" +
        " <button id=\"btn-enc-clear\" class=\"btn-sm\" style=\"font-size:10px;padding:1px 6px;margin-left:8px;\">✕ Quitar</button>" +
      "</div>" +
    "</div>" +

    "<div style=\"display:flex;gap:0;margin-bottom:0;border-bottom:2px solid var(--border);\">" + tabBtns + "</div>" +
    "<div class=\"sim-layout\" style=\"margin-top:14px;\">" +
      "<div>" +
        // Tab 0: Base
        "<div id=\"sim-tab-0\">" +
          "<div class=\"card\" style=\"margin-bottom:10px;\">" +
            "<div style=\"display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;\">" +
              "<h3>Ajuste por partido (variación en pp)</h3>" +
              "<button class=\"btn-sm\" id=\"btn-show-all\">+ Todos</button>" +
            "</div>" +
            "<p class=\"muted\" style=\"font-size:11px;margin-bottom:8px;\">Adición directa al % base. Positivo = sube, negativo = baja. Se renormaliza automáticamente.</p>" +
            "<div style=\"overflow:auto;max-height:280px;\">" +
              "<table class=\"tbl\" id=\"sim-tbl\">" +
                "<thead><tr><th>Partido</th><th class=\"r\">% base</th><th class=\"r\">ajuste pp</th></tr></thead>" +
                "<tbody id=\"sim-tbody\">" + tblRows + "</tbody>" +
              "</table>" +
            "</div>" +
          "</div>" +
        "</div>" +
        // Tab 1: Encuestas
        "<div id=\"sim-tab-1\" style=\"display:none;\">" +
          "<div class=\"card\" style=\"margin-bottom:10px;\">" +
            "<h3>Encuestas</h3>" + encBlock +
          "</div>" +
        "</div>" +
        // Tab 2: Movilización
        "<div id=\"sim-tab-2\" style=\"display:none;\">" +
          "<div class=\"card\" style=\"margin-bottom:10px;\">" +
            "<h3>Movilización</h3>" +
            "<p class=\"muted\" style=\"font-size:12px;margin-bottom:8px;\">Coef. por nivel (cascada JCE 2004-2024): pres=1.00, sen=0.88, dip=0.78, mun=0.72, dm=0.70. Techo: 40% de la abstención (60% es estructural).</p>" +
            "<div style=\"display:flex;gap:6px;flex-wrap:wrap;align-items:center;\">" + movBtns +
              "<input id=\"sim-mov\" class=\"inp-sm\" type=\"number\" step=\"0.1\" value=\"0\" style=\"width:68px;\"> pp" +
            "</div>" +
          "</div>" +
        "</div>" +
        // Tab 3: Alianzas
        "<div id=\"sim-tab-3\" style=\"display:none;\">" +
          "<div class=\"card\" style=\"margin-bottom:10px;\">" +
            "<h3>Alianzas electorales</h3>" +
            (!ctx.alianzas || !ctx.alianzas[nivel]
              ? "<div class=\"badge-warn\" style=\"display:inline-block;margin-bottom:10px;\">⚠ alianzas_2024.json pendiente</div><br>"
              : "<p class=\"muted\" style=\"font-size:12px;margin-bottom:8px;\">Alianzas históricas 2024 cargadas como referencia.</p>") +
            "<p class=\"muted\" style=\"font-size:11px;margin-bottom:8px;\">Fórmula: votos_bloque = votos_partido + (votos_aliado × % transferencia). Solo aplica en la simulación, no modifica datos base.</p>" +
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
            arrastreBlock +
          "</div>" +
        "</div>" +
        // Tab 5: D'Hondt (ex Boleta Única)
        "<div id=\"sim-tab-5\" style=\"display:none;\">" + dhondtTab + "</div>" +

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

  document.querySelectorAll(".alz-chk").forEach(function(chk) {
    chk.addEventListener("change", function() {
      var inp = document.querySelector(".alz-pct[data-party=\"" + chk.value + "\"]");
      if (inp) inp.disabled = !chk.checked;
    });
  });

  document.querySelectorAll("[data-mov]").forEach(function(b) {
    b.addEventListener("click", function() {
      var m = el("sim-mov"); if (m) m.value = b.dataset.mov;
      debouncedSim();
    });
  });

  el("sim-lider").addEventListener("change", function() {
    var lider = el("sim-lider").value;
    document.querySelectorAll(".alianza-row").forEach(function(row) {
      row.style.display = row.dataset.p === lider ? "none" : "";
    });
  });

  // Territorio selector — actualiza la tabla base si se selecciona un territorio específico
  var terrSel = el("sim-territorio");
  if (terrSel) {
    terrSel.addEventListener("change", function() {
      var terrId = terrSel.value;
      if (terrId && terr24 && terr24[terrId]) {
        var tData = terr24[terrId];
        var tRanked = rankVotes(tData.votes || {}, tData.emitidos || 1);
        // Actualizar columna "% base" con datos del territorio
        document.querySelectorAll(".delta-in").forEach(function(inp) {
          var p   = inp.dataset.party;
          var row = inp.closest("tr");
          if (row) {
            var cells = row.querySelectorAll("td");
            if (cells[1]) {
              var tEntry = tRanked.filter(function(r){return r.p===p;})[0];
              cells[1].textContent = tEntry ? fmtPct(tEntry.pct) : "0.0%";
            }
          }
        });
        toast("Territorio: " + (tData.nombre || terrId));
      } else {
        // Restaurar datos nacionales
        document.querySelectorAll(".delta-in").forEach(function(inp) {
          var p   = inp.dataset.party;
          var row = inp.closest("tr");
          if (row) {
            var cells = row.querySelectorAll("td");
            if (cells[1]) {
              var e = ranked.filter(function(r){return r.p===p;})[0];
              cells[1].textContent = e ? fmtPct(e.pct) : "0.0%";
            }
          }
        });
      }
      debouncedSim();
    });
  }

  // D'Hondt cálculo
  var dhondtCalcBtn = el("btn-dhondt-calc");
  if (dhondtCalcBtn) {
    dhondtCalcBtn.addEventListener("click", function() {
      var circSel = el("dhondt-circ");
      var circId  = circSel ? circSel.value : "";
      var resDiv  = el("dhondt-result");
      if (!resDiv) return;

      // Obtener votos del simulador actual
      var simRes = runSimAndGet(ctx, state, nivel, nat);
      if (!simRes || !simRes.curules) {
        resDiv.innerHTML = "<p class=\"muted\">Primero presiona Simular para ver resultados base.</p>";
        return;
      }

      if (!circId) {
        // Mostrar todos los resultados
        var rows = Object.entries(simRes.curules.byCirc || {}).filter(function(e) {
          return e[0] !== "_nacionales";
        }).sort(function(a, b) { return a[0].localeCompare(b[0]); }).map(function(e) {
          var cid = e[0]; var cdata = e[1];
          var seatsStr = Object.entries(cdata.byParty || {}).sort(function(a,b){return b[1]-a[1];})
            .map(function(kv){ return dot(kv[0]) + kv[0] + ":" + kv[1]; }).join(" ");
          return "<tr><td>" + cid + "</td><td>" + seatsStr + "</td><td class=\"r\">" + (cdata.seats||0) + "</td></tr>";
        }).join("");
        resDiv.innerHTML = "<div style=\"overflow:auto;\"><table class=\"tbl\"><thead><tr><th>Circ.</th><th>Distribución</th><th class=\"r\">Escaños</th></tr></thead><tbody>" + rows + "</tbody></table></div>";
      } else {
        var circ = simRes.curules.byCirc ? simRes.curules.byCirc[circId] : null;
        if (!circ) {
          resDiv.innerHTML = "<p class=\"muted\">Sin datos para circunscripción " + circId + ".</p>";
          return;
        }
        var rows2 = Object.entries(circ.byParty || {}).sort(function(a,b){return b[1]-a[1];}).map(function(kv) {
          return "<tr><td>" + dot(kv[0]) + kv[0] + "</td><td class=\"r\"><b>" + kv[1] + "</b></td></tr>";
        }).join("");
        resDiv.innerHTML = "<h4 style=\"margin-bottom:8px;\">Circunscripción " + circId + " — " + (circ.seats||0) + " escaños</h4>" +
          "<table class=\"tbl\"><thead><tr><th>Partido</th><th class=\"r\">Escaños</th></tr></thead><tbody>" + rows2 + "</tbody></table>";
      }
    });
  }

  // Aplicar encuesta
  document.querySelectorAll("[data-enc-idx]").forEach(function(btn) {
    btn.addEventListener("click", function() {
      var idx = parseInt(btn.dataset.encIdx, 10);
      var enc = polls[idx];
      if (!enc) return;
      var em  = nat.emitidos || 1;

      // Resolver fuente_motor: del objeto encuesta → botón UI → default partido
      var modoBtn = document.querySelector(".seg-btn.active[data-encmodo]");
      var modoUI  = modoBtn ? modoBtn.dataset.encmodo : "partido";
      var modo    = enc.fuente_motor || modoUI;

      // Validar disponibilidad de datos para el modo elegido
      if (modo === "candidato" && (!enc.candidatos || !Object.keys(enc.candidatos).length)) {
        modo = "partido";
      }

      // Construir mapa de fuente para pre-popular inputs (visual feedback)
      var fuente = enc.resultados || {};
      if (modo === "candidato" && enc.candidatos) {
        fuente = {};
        Object.entries(enc.candidatos).forEach(function(kv) {
          fuente[kv[0]] = kv[1].pct || 0;
        });
      }

      // Pre-popular delta inputs con diferencia encuesta vs base
      document.querySelectorAll(".delta-in").forEach(function(inp) {
        var p      = inp.dataset.party;
        var base   = (nat.votes[p] || 0) / em;
        var encP   = fuente[p] !== undefined ? fuente[p] / 100 : base;
        var ajuste = Math.round((encP - base) * 100 * 10) / 10;
        inp.value = String(ajuste);
        inp.style.color = ajuste !== 0 ? "var(--accent)" : "";
      });

      // Guardar objeto encuesta completo en ctx para que el motor lo use directamente
      ctx._encuestaActiva  = enc;
      ctx._simFuenteMotor  = modo;
      ctx._simDeltasFuente = enc.encuestadora + " · " + (enc.fecha || "?") +
                             " [fuente: " + modo + "]";

      toast("✓ " + enc.encuestadora + " — motor: " +
            (modo === "candidato" ? "simpatía candidato" : "simpatía partidaria"));
      runSim(ctx, state, nivel, nat);
    });
  });

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
    ["sh-base","sh-sim","sh-dv","sh-dc"].forEach(function(id){
      var e=document.getElementById(id); if(e) { e.textContent="-"; e.style.color=""; }
    });
    // Limpiar encuesta activa
    ctx._encuestaActiva  = null;
    ctx._simFuenteMotor  = "partido";
    ctx._simDeltasFuente = null;
    var ind = document.getElementById("sim-fuente-ind");
    if (ind) ind.style.display = "none";
  });

  // Botón quitar encuesta activa
  document.addEventListener("click", function(e) {
    if (e.target && e.target.id === "btn-enc-clear") {
      ctx._encuestaActiva  = null;
      ctx._simFuenteMotor  = "partido";
      ctx._simDeltasFuente = null;
      var ind = document.getElementById("sim-fuente-ind");
      if (ind) ind.style.display = "none";
      // Limpiar deltas en inputs
      document.querySelectorAll(".delta-in").forEach(function(i) { i.value = "0"; i.style.color = ""; });
      toast("Encuesta desactivada — motor vuelve a base JCE 2024");
      runSim(ctx, state, nivel, nat);
    }
  });

  runSim(ctx, state, nivel, nat);
}

// Retorna el resultado de la simulación actual sin actualizar la UI
function runSimAndGet(ctx, state, nivel, nat) {
  var ajustesPP = {};
  document.querySelectorAll(".delta-in").forEach(function(inp) {
    var v = parseFloat(inp.value) || 0;
    if (v !== 0) ajustesPP[inp.dataset.party] = v;
  });
  var movPP        = parseFloat((el("sim-mov") || {}).value) || 0;
  var isProy       = state.modo === "proy2028";
  var year         = isProy ? 2028 : 2024;
  var terrSel      = el("sim-territorio");
  var territorioId = terrSel ? terrSel.value : "";

  return simular(ctx, {
    nivel: nivel, year: year,
    ajustesPP: ajustesPP, deltasPP: ajustesPP,
    movPP: movPP, corte: state.corte,
    territorioId: territorioId || null,
    encuestaLocal: ctx._encuestaActiva || null,
    fuenteMotor:   ctx._simFuenteMotor || "partido",
  });
}

// runSim: lee estado UI, llama simular(), actualiza resultados
function runSim(ctx, state, nivel, nat) {
  var ajustesPP = {};
  document.querySelectorAll(".delta-in").forEach(function(inp) {
    var v = parseFloat(inp.value) || 0;
    if (v !== 0) ajustesPP[inp.dataset.party] = v;
  });

  var movPP = parseFloat((el("sim-mov") || {}).value) || 0;

  var alianzas = [];
  var liderSel = el("sim-lider") ? el("sim-lider").value : null;
  if (liderSel) {
    var aliados = [];
    document.querySelectorAll(".alz-chk:checked").forEach(function(chk) {
      var pct2 = document.querySelector(".alz-pct[data-party=\"" + chk.value + "\"]");
      aliados.push({ partido: chk.value, transferPct: pct2 ? Number(pct2.value) : 80 });
    });
    if (aliados.length) alianzas.push({ lider: liderSel, aliados: aliados });
  }

  var arrastre      = el("sim-arrastre") ? el("sim-arrastre").checked : false;
  var arrastreLider = el("sim-arr-lider") ? el("sim-arr-lider").value : null;
  var arrastreKVal  = el("sim-arr-k") ? el("sim-arr-k").value : "auto";
  var arrastreK2    = arrastreKVal === "auto" ? null : parseFloat(arrastreKVal);
  var isProy        = state.modo === "proy2028";
  var year          = isProy ? 2028 : 2024;
  var terrSel       = el("sim-territorio");
  var territorioId  = terrSel ? terrSel.value : "";

  var res = simular(ctx, {
    nivel: nivel, year: year,
    ajustesPP: ajustesPP, deltasPP: ajustesPP,
    alianzas: alianzas, movPP: movPP,
    arrastre: arrastre, arrastreLider: arrastreLider, arrastreK: arrastreK2,
    corte: state.corte,
    territorioId:  territorioId || null,
    encuestaLocal: ctx._encuestaActiva || null,
    fuenteMotor:   ctx._simFuenteMotor || "partido",
  });

  if (!res) return;

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
    shDv.textContent = (dv >= 0 ? "+" : "") + dv.toFixed(1) + "pp";
    shDv.style.color = dv >= 0 ? "var(--green)" : "var(--red)";
  }
  // Indicador de encuesta activa en motor
  var fuenteInd = document.getElementById("sim-fuente-ind");
  var fuenteLbl = document.getElementById("sim-fuente-label");
  if (fuenteInd && fuenteLbl) {
    if (ctx._encuestaActiva && ctx._simDeltasFuente) {
      var icon = ctx._simFuenteMotor === "candidato" ? "🧑 Candidato" : "🏛 Partido";
      fuenteLbl.textContent = icon + " — " + ctx._simDeltasFuente;
      fuenteInd.style.display = "";
    } else {
      fuenteInd.style.display = "none";
    }
  }
  if (shDc) {
    var curBase = 0; var curSim = 0;
    if (nivel === "dip") {
      var baseRes0 = simular(ctx, { nivel:"dip", year:year, corte:state.corte });
      curBase = baseRes0.curules && top1base ? (baseRes0.curules.totalByParty[top1base.p] || 0) : 0;
      curSim  = res.curules && top1sim ? (res.curules.totalByParty[top1sim.p] || 0) : 0;
    } else if (nivel === "sen") {
      var baseRes0 = simular(ctx, { nivel:"sen", year:year });
      curBase = baseRes0.senadores && top1base ? (baseRes0.senadores.totalByParty[top1base.p] || 0) : 0;
      curSim  = res.senadores && top1sim ? (res.senadores.totalByParty[top1sim.p] || 0) : 0;
    }
    if (curBase || curSim) {
      var dc = curSim - curBase;
      shDc.textContent = (dc >= 0 ? "+" : "") + dc + (nivel === "sen" ? " sen." : " cur.");
      shDc.style.color = dc >= 0 ? "var(--green)" : "var(--red)";
    } else {
      shDc.textContent = "-";
    }
  }

  var resDiv = el("sim-result");
  if (!resDiv) return;

  var ranked2 = res.ranked;
  var em      = res.emitidos;
  var ins     = res.inscritos;
  var part    = ins ? em / ins : 0;

  var beforeAfterRows = ranked2.slice(0, 10).map(function(r) {
    var baseEntry = nat.votes[r.p] ? (nat.votes[r.p] / (nat.emitidos || 1)) : 0;
    var diff = r.pct - baseEntry;
    var dStr = "<span class=\"" + (diff > 0 ? "text-ok" : diff < 0 ? "text-warn" : "") + "\">" +
      (diff > 0 ? "+" : "") + fmtPct(diff) + "</span>";
    return "<tr><td>" + dot(r.p) + r.p + "</td>" +
      "<td class=\"r\">" + fmtPct(baseEntry) + "</td>" +
      "<td class=\"r\" style=\"color:var(--accent);\">" + fmtPct(r.pct) + "</td>" +
      "<td class=\"r\">" + dStr + "</td>" +
      "<td class=\"r\">" + fmtInt(r.v) + "</td></tr>";
  }).join("");

  var curulesSection = "";
  if (nivel === "dip" && res.curules) {
    // Compare with base 2024 D'Hondt
    var baseRes2024 = simular(ctx, { nivel: "dip", year: 2024, ajustesPP: {}, corte: state.corte });
    var baseCurules2024 = baseRes2024 && baseRes2024.curules ? baseRes2024.curules.totalByParty : {};
    var simCurules  = res.curules.totalByParty;
    var allParties  = Object.keys(Object.assign({}, baseCurules2024, simCurules));
    var curulesRows = allParties
      .sort(function(a,b){ return (simCurules[b]||0) - (simCurules[a]||0); })
      .filter(function(p){ return (simCurules[p]||0) > 0 || (baseCurules2024[p]||0) > 0; })
      .map(function(p) {
        var base = baseCurules2024[p] || 0;
        var sim  = simCurules[p] || 0;
        var diff = sim - base;
        var diffStr = diff === 0 ? "<span class=\"muted\">—</span>"
          : diff > 0 ? "<span class=\"text-ok\">+" + diff + "</span>"
          : "<span class=\"text-warn\">" + diff + "</span>";
        return "<tr><td>" + dot(p) + " <b>" + p + "</b></td>" +
          "<td class=\"r\">" + base + "</td>" +
          "<td class=\"r\"><b>" + sim + "</b></td>" +
          "<td class=\"r\">" + diffStr + "</td></tr>";
      }).join("");
    var totalBase = Object.values(baseCurules2024).reduce(function(a,v){return a+v;},0);
    var totalSim  = Object.values(simCurules).reduce(function(a,v){return a+v;},0);
    curulesSection = sep() +
      "<h3 style=\"margin-top:12px;\">Curules simulados (D'Hondt)</h3>" +
      "<p class=\"muted\" style=\"font-size:11px;margin-bottom:6px;\">" +
        "D'Hondt aplicado por circunscripción con Uniform Swing sobre base JCE 2024. " +
        "Total: " + totalSim + " / 190 escaños. <b>Base 2024: " + totalBase + " escaños.</b>" +
      "</p>" +
      "<table class=\"tbl\">" +
        "<thead><tr><th>Partido</th><th class=\"r\">Base 2024</th><th class=\"r\">Simulado</th><th class=\"r\">Δ Curules</th></tr></thead>" +
        "<tbody>" + curulesRows + "</tbody>" +
      "</table>" +
      "<p class=\"muted\" style=\"font-size:11px;margin-top:6px;\">" +
        "💡 Para ver D'Hondt por circunscripción, usa el panel «D'Hondt por Circ.» en la pestaña Circunscripciones." +
      "</p>";
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

  var terrLabel = "";
  var terrSel2  = el("sim-territorio");
  if (terrSel2 && terrSel2.value) {
    var lv2 = getLevel(ctx, year, nivel);
    var t2  = (nivel === "mun" ? lv2.mun : nivel === "dm" ? lv2.dm : lv2.prov) || {};
    var td  = t2[terrSel2.value];
    terrLabel = "<div style=\"font-size:12px;color:var(--accent);margin-bottom:6px;\">📍 Territorio: " +
      (td ? (td.nombre || terrSel2.value) : terrSel2.value) + "</div>";
  }

  resDiv.innerHTML =
    terrLabel +
    "<h3 style=\"margin-bottom:10px;\">Resultado simulado</h3>" +
    "<div style=\"overflow:auto;\">" +
      "<table class=\"tbl\">" +
        "<thead><tr>" +
          "<th>Partido</th><th class=\"r\">Base</th>" +
          "<th class=\"r\" style=\"color:var(--accent);\">Simulado</th>" +
          "<th class=\"r\">Variación</th><th class=\"r\">Votos</th>" +
        "</tr></thead>" +
        "<tbody>" + beforeAfterRows + "</tbody>" +
      "</table>" +
    "</div>" +
    statGrid([
      ["Emitidos sim.", fmtInt(em)],
      ["Participación", fmtPct(part)],
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
  var nat24  = lv24.nacional;
  var ranked = rankVotes(nat24.votes, nat24.emitidos);
  var liderDefault = ranked[0] ? ranked[0].p : "PRM";

  var pOpts = ranked.map(function(r) {
    return opt(r.p, r.p + " (" + fmtPct(r.pct) + ")", r.p === liderDefault);
  }).join("");

  var MET_HTML =
    "<div class=\"card\" style=\"margin-bottom:12px;border-color:var(--accent);\">" +
      "<h3>Metodología v8.0 — Competitiveness-Opportunity Index</h3>" +
      "<div style=\"font-size:11px;color:var(--text2);margin-bottom:8px;padding:6px 10px;background:var(--bg3);border-radius:4px;\">" +
        "Basado en: MIT Election Lab · LAPOP Electoral Competitiveness Index · NDI Strategy Toolkit 2021 · " +
        "<b>Corrección FP/nuevos actores:</b> partidos con crecimiento &gt;80% entre ciclos usan arraigo relativo en vez de tendencia absoluta 2020→2024." +
      "</div>" +
      "<div class=\"row-2col\" style=\"gap:12px;\">" +
        "<div>" +
          "<p class=\"muted\" style=\"font-size:12px;margin-bottom:6px;\">Fórmula: <b>Score = Σ(componente × peso) / maxRaw × 100</b></p>" +
          "<table class=\"tbl\" style=\"font-size:12px;\"><thead><tr><th>Componente</th><th class=\"r\">Peso</th><th>Fórmula</th></tr></thead><tbody>" +
            "<tr><td>Margen competitivo</td><td class=\"r\">35</td><td>0.5 + margen_vs_rival × 2.5 — posición directa</td></tr>" +
            "<tr><td>Reserva abstención</td><td class=\"r\">25</td><td>abstención_2024 / 0.55 — potencial no activado</td></tr>" +
            "<tr><td>Conversión (nuevo)</td><td class=\"r\">20</td><td>pct_partido × abstención / 0.16 — base × reserva simultánea</td></tr>" +
            "<tr><td>Tamaño territorio</td><td class=\"r\">10</td><td>inscritos / max_inscritos — eficiencia de recursos</td></tr>" +
            "<tr><td>Tendencia ajustada</td><td class=\"r\">10</td><td>Partido establecido: pct24−pct20 · Nuevo actor: local vs media nacional</td></tr>" +
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
    var CAT_META = {
      "Fortaleza":      { cls:"cat-green",  score:"≥ 70", desc:"Ventaja sólida y consolidada. Territorio propio. Enfoque: retención y movilización de base." },
      "Oportunidad":    { cls:"cat-lgreen", score:"≥ 55", desc:"Adelante pero con margen competitivo. Terreno ganable con inversión moderada en campaña." },
      "Disputa":        { cls:"cat-yellow", score:"≥ 45", desc:"Empate técnico. Puede ganarse o perderse. Requiere esfuerzo focalizado y recursos." },
      "Crecimiento":    { cls:"cat-blue",   score:"≥ 35", desc:"Detrás pero con tendencia positiva o reserva de abstención alta. Inversión estratégica." },
      "Adverso":        { cls:"cat-red",    score:"≥ 20", desc:"Territorio del rival. Difícil de voltear en un ciclo. Limitar sangría, no gastar en exceso." },
      "Baja prioridad": { cls:"cat-gray",   score:"< 20", desc:"Sin condiciones electorales favorables. Recursos mínimos; activismo testimonial." },
    };
    var CATS = ["Fortaleza","Oportunidad","Disputa","Crecimiento","Adverso","Baja prioridad"];
    var kpiCats = CATS.map(function(cat) {
      var count = data.filter(function(r) { return r.categoria.label === cat; }).length;
      var meta = CAT_META[cat];
      return "<div class=\"kpi-card\" style=\"border-left:3px solid var(--" +
        (meta.cls === "cat-green"?"accent":meta.cls==="cat-lgreen"?"accent":meta.cls==="cat-yellow"?"yellow":meta.cls==="cat-blue"?"blue":meta.cls==="cat-red"?"danger":"border") +
        ");padding:8px 10px;background:var(--bg2);border-radius:6px;\">" +
        "<div style=\"display:flex;align-items:center;gap:6px;margin-bottom:4px;\">" +
          "<span class=\"cat-badge " + meta.cls + "\">" + cat + "</span>" +
          "<span style=\"font-size:20px;font-weight:700;color:var(--text1);\">" + count + "</span>" +
          "<span class=\"muted\" style=\"font-size:11px;\">Score " + meta.score + "</span>" +
        "</div>" +
        "<div style=\"font-size:11px;color:var(--text2);line-height:1.4;\">" + meta.desc + "</div>" +
      "</div>";
    }).join("");

    var rows = data.map(function(r, i) {
      var tendStr;
      if (r.natIsNewActor) {
        tendStr = "<span class=\"badge-warn\" style=\"font-size:10px;\">nuevo actor</span>";
      } else if (r.pct20 !== null && r.pct20 !== undefined) {
        tendStr = (r.tendencia > 0 ? "+" : "") + fmtPct(r.tendencia);
      } else {
        tendStr = "<span class=\"muted\">s/d</span>";
      }
      var tendCls = (!r.natIsNewActor && r.tendencia > 0.02) ? "text-ok" : (!r.natIsNewActor && r.tendencia < -0.02) ? "text-warn" : "";
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
      "<div style=\"display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-bottom:16px;\">" + kpiCats + "</div>" +
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
            "<th class=\"r\">% rival</th>" +
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
  var cap60  = Math.round(abst * 0.4);  // techo: 40% de la abstención es movilizable (ajustado a metodología v8)
  var k      = MOV_COEF[nivel] || 1;
  var ranked = rankVotes(nat.votes, em);

  // Tabla territorial de abstención — vs abstención proyectada 2028
  var lv20   = getLevel(ctx, 2020, nivel);
  var terr24 = nivel === "mun" ? lv.mun : nivel === "dm" ? lv.dm : lv.prov;
  var terr20 = nivel === "mun" ? lv20.mun : nivel === "dm" ? lv20.dm : lv20.prov;

  // Abstención proyectada 2028: si isProy usar padrón 2028, si no usar base 2024
  var lv28 = isProy ? getLevel(ctx, 2028, nivel) : null;
  var terr28 = lv28 ? (nivel === "mun" ? lv28.mun : nivel === "dm" ? lv28.dm : lv28.prov) : null;

  var terrData = Object.keys(terr24).filter(function(id) {
    var n = parseInt(id, 10); return n >= 1 && n <= 32;
  }).map(function(id) {
    var t    = terr24[id];
    var t28  = terr28 ? terr28[id] : null;
    var t20  = terr20 ? terr20[id] : null;
    // For pres level, inscritos may be null — fallback to padronProvLookup
    var ins24 = t.inscritos || (ctx.padronProvLookup && ctx.padronProvLookup[id]) || 0;
    var a24   = ins24 > 0 ? 1 - (t.emitidos / ins24) : 0;
    // Delta: vs proyectado 2028 si está activo, si no vs 2020
    var deltaRef = null, deltaLabel = "";
    if (isProy && t28 && t28.inscritos) {
      var a28 = 1 - ((t28.emitidos || 0) / t28.inscritos);
      deltaRef = a24 - a28; // positivo = más abstención en 2024 que proyectado (oportunidad)
      deltaLabel = "vs Proy.2028";
    } else if (t20 && t20.inscritos) {
      var a20 = 1 - ((t20.emitidos || 0) / t20.inscritos);
      deltaRef = a24 - a20;
      deltaLabel = "vs 2020";
    }
    var ranked24 = rankVotes(t.votes || {}, t.emitidos || 1);
    var lider24  = ranked24[0] ? ranked24[0].p : "-";
    return { id: id, nombre: t.nombre || id, a24: a24, delta: deltaRef, deltaLabel: deltaLabel, ins: ins24, lider: lider24 };
  }).sort(function(a,b) { return b.a24 - a.a24; });

  var deltaColLabel = isProy ? "Δ vs Proy.2028" : "Δ vs 2020";

  function buildTerrRows(data, movPP) {
    movPP = movPP || 0;
    return data.slice(0, 30).map(function(r) {
      // Proyectar abstención post-movilización
      var k = MOV_COEF[nivel] || 1;
      var absActual = r.ins > 0 ? r.ins - (r.ins * (1 - r.a24)) : 0;
      var extraVotos = movPP !== 0 ? Math.min(Math.round(r.ins * (Math.abs(movPP) / 100) * k), Math.round(absActual * 0.4)) : 0;
      var a24post = movPP > 0 && r.ins > 0 ? Math.max(0, r.a24 - (extraVotos / r.ins)) : r.a24;
      var deltaStr = r.delta !== null
        ? "<span class=\"" + (r.delta > 0.005 ? "text-warn" : r.delta < -0.005 ? "text-ok" : "") + "\">" +
            (r.delta > 0 ? "+" : "") + fmtPct(r.delta) + "</span>"
        : "-";
      var postStr = movPP !== 0
        ? " <span class=\"text-ok\" style=\"font-size:11px;\">→" + fmtPct(a24post) + "</span>"
        : "";
      return "<tr>" +
        "<td>" + r.nombre + "</td>" +
        "<td class=\"r\">" + fmtPct(r.a24) + postStr + "</td>" +
        "<td class=\"r\">" + deltaStr + "</td>" +
        "<td class=\"r\">" + fmtInt(r.ins) + "</td>" +
        "<td>" + dot(r.lider) + r.lider + "</td>" +
      "</tr>";
    }).join("");
  }

  var terrRows = buildTerrRows(terrData, 0);

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
            kpi("Cap. movilizable (40%)", fmtInt(cap60), "máximo real") +
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
        "<p class=\"muted\" style=\"font-size:12px;margin-bottom:8px;\">Ordenado por abstención descendente · " +
          (isProy ? "Δ vs Proyección 2028 (oportunidad: rojo = más abstención ahora que proyectado)" : "Δ vs 2020") +
        "</p>" +
        "<table class=\"tbl\">" +
          "<thead><tr>" +
            "<th>Territorio</th>" +
            "<th class=\"r\">Abstención</th>" +
            "<th class=\"r\">" + deltaColLabel + "</th>" +
            "<th class=\"r\">Inscritos</th>" +
            "<th>Líder</th>" +
          "</tr></thead>" +
          "<tbody id=\"mov-terr-tbody\">" + terrRows + "</tbody>" +
        "</table>" +
      "</div>" +
      "<details class=\"met-box\" style=\"margin-top:8px;\">" +
        "<summary style=\"font-size:12px;\"><b>Fórmula territorial</b></summary>" +
        "<div class=\"met-body\" style=\"font-size:11px;\">" +
          "<b>Abstención proyectada:</b> Abs₂₀₂₄ × (1 − δ_movilización)<br>" +
          "<b>Δ vs Proy.2028:</b> Abs₂₀₂₄ − Abs_proy — cuántos abstentionistas podría activar la campaña<br>" +
          "<b>Δ vs 2020:</b> Abs₂₀₂₄ − Abs₂₀₂₀ — variación histórica real<br>" +
          "<b>Techo movilización:</b> máx. 40% de abstención reducible (cap empírico JCE 2004-2024)<br>" +
          "<b>Coefs. calibrados:</b> k_pres=0.88, k_mun=0.78 vs benchmark ciclos anteriores" +
        "</div>" +
      "</details>" +
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

function calcMovImpacto(ctx, state, nivel, ins, em, nat, ranked, terrData, buildTerrRowsFn) {
  var pp      = parseFloat((el("mov-pp") || {}).value) || 0;
  var k       = MOV_COEF[nivel] || 1;
  var abst    = ins - em;
  var cap60   = Math.round(abst * 0.4);  // v8: techo realista 40% (60% es abstención estructural)
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

  // Update territory table to reflect movilización impact
  if (buildTerrRowsFn && terrData) {
    var tbody = document.getElementById("mov-terr-tbody");
    if (tbody) tbody.innerHTML = buildTerrRowsFn(terrData, pp);
  }
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
    ? "Presidencial: meta = 50%+1. Backsolve binario encuentra el mínimo ajuste en pp necesario (adición aritmética al % base actual)."
    : nivel === "sen"
    ? "Senadores: mayoría simple por provincia (32 senadores, 1 por provincia). Backsolve halla el ajuste en pp necesario para voltear las provincias con mayor ROI."
    : nivel === "dip"
    ? "Diputados: D'Hondt por circunscripción. Backsolve encuentra el ajuste en pp que maximiza curules. Circunscripciones multi-curul: DN (3), La Vega (2), Pto. Plata (2), S. Cristóbal (3), Santiago (3), Sto. Domingo (6)."
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
          "<div><label class=\"muted\">Ajuste en pp — movilización adicional</label>" +
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
          "<p class=\"muted\" style=\"font-size:12px;margin-bottom:8px;\">Ordenados por ROI: menor costo relativo de votos · Columnas: territorio, % partido, brecha rival, votos necesarios, tipo, ROI.</p>" +
          "<div id=\"obj-criticos\"></div>" +
        "</div>"
      : "") +

    // Panel Plan de Acción Estratégico
    "<div class=\"card\" style=\"margin-top:14px;\">" +
      "<h3>Plan de Acción Estratégico</h3>" +
      "<p class=\"muted\" style=\"font-size:12px;margin-bottom:10px;\">" +
        "Recomendaciones priorizadas para alcanzar la meta. Presiona Calcular para activar." +
      "</p>" +
      "<div id=\"obj-plan\"><p class=\"muted\">Presiona Calcular para generar el plan.</p></div>" +
    "</div>";

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

        // Territorios críticos para legislativo con ROI
        if (nivel === "sen" || nivel === "dip") {
          var criticos = calcularProvinciasCriticas(ctx, { nivel: nivel, lider: lider }, 10);
          // Swing data por territorio
          var swingData = calcSwing(ctx, nivel, lider, 2024);
          var swingByID = {};
          swingData.forEach(function(s) { swingByID[s.id] = s; });
          var critEl   = el("obj-criticos");
          var titEl    = el("obj-crit-title");
          if (critEl && criticos.length) {
            if (titEl) titEl.textContent = "Territorios críticos para " + lider + " (por ROI descendente)";
            var cRows = criticos.map(function(c) {
              var tipoCls = c.tipo === "voltear" ? "cat-red" : c.tipo === "asegurar" ? "cat-yellow" : c.tipo === "consolidar" ? "cat-green" : "cat-blue";
              var sw = swingByID[c.id];
              var tendPP = sw ? sw.liderTend : null;
              var swStr  = tendPP !== null
                ? "<span style=\"color:" + (tendPP > 0.005 ? "var(--ok)" : tendPP < -0.005 ? "var(--err)" : "var(--muted)") + ";\">" +
                    (tendPP > 0 ? "▲" : tendPP < 0 ? "▼" : "–") +
                    " " + (tendPP * 100).toFixed(1) + "pp</span>"
                : "<span class=\"muted\">—</span>";
              var gapStr  = c.gap > 0 ? ("+" + (c.gap * 100).toFixed(1) + "pp rival") : "(liderando)";
              var votosStr = c.votosNecesarios > 0 ? fmtInt(c.votosNecesarios) + " votos" : "consolidado";
              return "<tr>" +
                "<td><b>" + c.nombre + "</b></td>" +
                "<td class=\"r\">" + fmtPct(c.lPct) + "</td>" +
                "<td class=\"r\">" + gapStr + "</td>" +
                "<td>" + dot(c.rival) + c.rival + "</td>" +
                "<td class=\"r\" style=\"font-size:11px;\">" + swStr + "</td>" +
                "<td class=\"r\" style=\"font-size:11px;\">" + votosStr + "</td>" +
                "<td><span class=\"cat-badge " + tipoCls + "\">" + c.tipo + "</span></td>" +
                "<td class=\"r\" style=\"color:var(--accent);font-weight:600;\">" + c.roi + "</td>" +
              "</tr>";
            }).join("");
            critEl.innerHTML =
              "<table class=\"tbl\"><thead><tr>" +
                "<th>Territorio</th><th class=\"r\">% " + lider + "</th>" +
                "<th class=\"r\">Gap rival</th><th>Rival</th>" +
                "<th class=\"r\" title=\"Tendencia 2020→2024 del partido. Positivo = creciendo.\">Swing</th>" +
                "<th class=\"r\">Votos nec.</th><th>Tipo</th><th class=\"r\">ROI</th>" +
              "</tr></thead><tbody>" + cRows + "</tbody></table>";
          }
        }

        // PLAN DE ACCIÓN ESTRATÉGICO
        var planDiv = el("obj-plan");
        if (planDiv) {
          var plan = generarPlanAccion(ctx, { nivel: nivel, lider: lider }, esc.razonable);
          if (plan && plan.length) {
            var iconMap = { movilizacion: "📢", alianza: "🤝", territorial: "📍", arrastre: "🎯", consolidacion: "🛡" };
            var prioMap = { alta: "cat-red", media: "cat-yellow", baja: "cat-blue" };
            var planHtml = plan.map(function(rec) {
              var icon   = iconMap[rec.tipo] || "📌";
              var prioCls = prioMap[rec.prioridad] || "cat-gray";
              var accionesHtml = rec.acciones && rec.acciones.length
                ? "<ul style=\"margin:6px 0 0 16px;font-size:12px;color:var(--text2);\">" +
                    rec.acciones.map(function(a) { return "<li>" + a + "</li>"; }).join("") +
                  "</ul>"
                : "";
              return "<div style=\"border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:8px;\">" +
                "<div style=\"display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;\">" +
                  "<div style=\"font-weight:600;\">" + icon + " " + rec.titulo + "</div>" +
                  "<span class=\"cat-badge " + prioCls + "\">" + rec.prioridad + "</span>" +
                "</div>" +
                "<p style=\"font-size:12px;color:var(--text2);margin-bottom:4px;\">" + rec.detalle + "</p>" +
                (rec.impactoEstimado ? "<div style=\"font-size:11px;color:var(--accent);\">Impacto estimado: +" + fmtInt(rec.impactoEstimado) + " votos</div>" : "") +
                accionesHtml +
              "</div>";
            }).join("");
            planDiv.innerHTML = planHtml;
          } else {
            planDiv.innerHTML = "<p class=\"muted\">Sin recomendaciones adicionales para el escenario seleccionado.</p>";
          }
        }

      } catch(e) {
        el("obj-result").innerHTML = "<div class=\"card\"><p class=\"muted\">Error: " + e.message + "</p></div>";
        console.error("[Objetivo]", e);
      }
    }, 10);
  });
}

function renderObjResult(container, esc, nivel, lider, nat) {
  // ── Senate: special display with province analysis ───────────────────
  if (esc._tipo === "sen") {
    var r = esc.razonable;
    var statusCls = r.alcanzable ? "text-ok" : "text-warn";
    var statusTxt = r.alcanzable ? "✓ Alcanzable con alianzas" : "⚠ Requiere movilización adicional";

    // KPI cards
    var kpiSen = [
      kpi("Senadores base (sin alianzas)", String(r.senatosBase), "victorias individuales", false),
      kpi("Senadores con alianzas 2024", "<span class=\"text-ok\">" + r.senatosConAlianzas + "</span>", "de 32 · mayoría: 17"),
      kpi("Meta solicitada", String(r.metaAsientos), "senadores"),
      kpi("Provincias a voltear", String(r.necesitaVoltear), "con alianzas actuales"),
    ].join("");

    // Table: provinces that alliance changes the winner
    var provAlRows = (r.analisisProv || [])
      .filter(function(p){ return p.alianzaCambia; })
      .sort(function(a,b){ return a.brechaBase - b.brechaBase; })
      .map(function(p) {
        var aliStr = (p.alianzasProvinciales || []).slice(0,4).join("+") || "-";
        return "<tr>" +
          "<td><b>" + p.nombre + "</b></td>" +
          "<td>" + dot(lider) + " " + fmtPct(p.lPctBase) + " → <b class=\"text-ok\">" + fmtPct(p.lPctConAlianzas) + "</b></td>" +
          "<td>" + dot(p.rival) + " " + p.rival + " " + fmtPct(p.rivalPct) + "</td>" +
          "<td style=\"font-size:10px;color:var(--text2);\">" + aliStr + "</td>" +
          "<td><span class=\"cat-badge cat-green\">GANA CON ALIANZA</span></td>" +
        "</tr>";
      }).join("");

    // Table: provinces that could be flipped with mobilization
    var provMovRows = (r.aVoltear || [])
      .filter(function(p){ return !p.alianzaCambia && p.brechaConAlianzas > 0 && p.brechaConAlianzas < 0.15; })
      .slice(0, 5)
      .map(function(p) {
        return "<tr>" +
          "<td><b>" + p.nombre + "</b></td>" +
          "<td>" + dot(lider) + " " + fmtPct(p.lPctConAlianzas) + "</td>" +
          "<td>" + dot(p.rival) + " " + p.rival + " +" + fmtPct(p.brechaConAlianzas) + "</td>" +
          "<td>" + fmtInt(p.votosParaVoltearConAlianzas) + " votos</td>" +
          "<td>" + (p.abstension > 0.3 ? fmtPct(p.abstension) + " abst." : "-") + "</td>" +
          "<td><span class=\"cat-badge cat-yellow\">GANANCIA POSIBLE</span></td>" +
        "</tr>";
      }).join("");

    // Provinces already won with details  
    var provGanaRows = (r.ganadas || [])
      .sort(function(a,b){ return a.lPctConAlianzas - b.lPctConAlianzas; })
      .map(function(p) {
        var fragil = p.lPctConAlianzas < 0.52;
        return "<tr>" +
          "<td><b>" + p.nombre + "</b></td>" +
          "<td class=\"text-ok\"><b>" + fmtPct(p.lPctConAlianzas) + "</b></td>" +
          "<td>" + dot(p.rival) + " " + p.rival + " " + fmtPct(p.rivalPct) + "</td>" +
          "<td><span class=\"cat-badge " + (fragil ? "cat-yellow" : "cat-green") + "\">" + (fragil ? "FRÁGIL" : "ASEGURADO") + "</span></td>" +
        "</tr>";
      }).join("");

    container.innerHTML =
      "<div class=\"card\">" +
        "<h3>Análisis Senatorial para " + lider + " — Meta: " + r.metaAsientos + " senadores</h3>" +
        "<div class=\"kpi-grid\" style=\"margin-bottom:16px;\">" + kpiSen + "</div>" +
        "<div style=\"margin-bottom:10px;padding:8px 12px;border-radius:6px;background:var(--bg3);" +
          "font-weight:600;font-size:13px;" + (r.alcanzable ? "color:var(--green);" : "color:var(--yellow);") + "\">" +
          statusTxt +
        "</div>" +
      "</div>" +
      (provAlRows
        ? "<div class=\"card\"><h3>🤝 Provincias donde la alianza cambia el ganador</h3>" +
            "<p class=\"muted\" style=\"font-size:12px;margin-bottom:8px;\">Partidos que con sus votos combinados logran ganar la provincia.</p>" +
            "<table class=\"tbl\"><thead><tr>" +
              "<th>Provincia</th><th>% " + lider + " (base → alianza)</th>" +
              "<th>Rival</th><th>Aliados</th><th>Resultado</th>" +
            "</tr></thead><tbody>" + provAlRows + "</tbody></table></div>"
        : "") +
      (provMovRows
        ? "<div class=\"card\"><h3>📊 Provincias con ganancia residual (movilización)</h3>" +
            "<p class=\"muted\" style=\"font-size:12px;margin-bottom:8px;\">Con brecha &lt;15pp con alianzas — pueden voltearse con movilización específica.</p>" +
            "<table class=\"tbl\"><thead><tr>" +
              "<th>Provincia</th><th>% " + lider + "</th><th>Brecha</th><th>Votos nec.</th><th>Abstención</th><th>Status</th>" +
            "</tr></thead><tbody>" + provMovRows + "</tbody></table></div>"
        : "") +
      "<div class=\"card\"><h3>✓ Provincias ya ganadas con alianzas</h3>" +
        "<table class=\"tbl\"><thead><tr>" +
          "<th>Provincia</th><th>% " + lider + "</th><th>2do lugar</th><th>Status</th>" +
        "</tr></thead><tbody>" + provGanaRows + "</tbody></table></div>";
    return;
  }

  // ── Other levels: pres / dip / mun ──────────────────────────────────
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
    } else if (nivel === "mun" && res && res.ganadores) {
      curVal = (res.ganadores.totalByParty[lider] || 0) + " alcaldías";
    } else if (top) {
      curVal = fmtPct(top.pct);
    }

    var ajustePP = s.ajustePP !== undefined ? s.ajustePP : (s.deltaPP || 0);
    var votos   = res && res.emitidos && ajustePP
      ? Math.round(res.emitidos * Math.abs(ajustePP) / 100)
      : null;

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
      "<div class=\"kpi-sub\">Ajuste mín. necesario: " + (ajustePP >= 0 ? "+" : "") + ajustePP.toFixed(2) + " pp sobre base 2024</div>" +
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
  var nivel = state.nivel;
  var lv24  = getLevel(ctx, 2024, nivel);
  var nat24 = lv24.nacional;
  var totalEm24 = nat24.emitidos || 1;

  // Advertencia encuestas ejemplo
  var ejemploWarning = polls.some(function(p){return p._ejemplo;})
    ? "<div style=\"padding:8px 12px;margin-bottom:10px;border-radius:6px;background:rgba(220,170,0,0.1);border:1px solid var(--yellow);font-size:12px;\">" +
        "⚠ <b>Encuesta de ejemplo</b> — reemplaza con datos reales cargando un polls.json o Excel." +
      "</div>"
    : "";

  // Toggle partido/candidato
  var modoEnc = "partido";  // will be updated by button

  // Gráfico comparativo: muestra ambas columnas si la encuesta tiene las dos
  function buildCompChart(enc, useCand) {
    if (!enc) return "";
    var resPartido = enc.resultados || {};
    var resCand    = enc.candidatos || {};
    var hasCand    = Object.keys(resCand).length > 0;
    var hasPartido = Object.keys(resPartido).length > 0;
    if (!hasPartido && !hasCand) return "";

    // Determinar qué partidos mostrar (unión de ambas fuentes, sin OTROS, top 6)
    var partySet = {};
    Object.keys(resPartido).forEach(function(p){ if (p !== "OTROS") partySet[p] = true; });
    Object.keys(resCand).forEach(function(p){ partySet[p] = true; });
    var parties = Object.keys(partySet).slice(0, 7);

    // Marcar cuál usa el motor
    var motorFuente = enc.fuente_motor || (useCand ? "candidato" : "partido");

    var rows = parties.map(function(p) {
      var pct24     = nat24.votes[p] ? Math.round((nat24.votes[p] / totalEm24) * 10000) / 100 : 0;
      var pctP      = resPartido[p] !== undefined ? resPartido[p] : null;
      var pctC      = resCand[p] ? resCand[p].pct : null;
      var candNom   = resCand[p] ? (resCand[p].nombre || p) : null;

      function deltaCell(pct) {
        if (pct === null) return "<td class=\"muted r\" style=\"font-size:11px;\">—</td><td class=\"muted r\" style=\"font-size:11px;\">—</td>";
        var d = pct - pct24;
        var cls = d > 0.5 ? "text-ok" : d < -0.5 ? "text-warn" : "";
        return "<td class=\"r\"><b>" + pct.toFixed(1) + "%</b></td>" +
               "<td class=\"r\"><span class=\"" + cls + "\">" + (d >= 0 ? "+" : "") + d.toFixed(1) + "pp</span></td>";
      }

      var motorMark = function(fuente) {
        return motorFuente === fuente
          ? " <span title=\"Motor activo\" style=\"color:var(--accent);font-size:10px;\">⚡</span>"
          : "";
      };

      return "<tr>" +
        "<td>" + dot(p) + " <b>" + p + "</b></td>" +
        "<td class=\"r muted\">" + pct24.toFixed(1) + "%</td>" +
        // Columna A: partido
        (hasPartido
          ? "<td class=\"r\" style=\"border-left:2px solid var(--accent);\">" +
              (pctP !== null ? pctP.toFixed(1) + "%" : "<span class='muted'>—</span>") + motorMark("partido") + "</td>" +
            (pctP !== null ? "<td class=\"r\"><span class=\"" +
              (pctP - pct24 > 0.5 ? "text-ok" : pctP - pct24 < -0.5 ? "text-warn" : "") + "\">" +
              (pctP - pct24 >= 0 ? "+" : "") + (pctP - pct24).toFixed(1) + "pp</span></td>"
              : "<td class=\"muted r\">—</td>")
          : "") +
        // Columna B: candidato
        (hasCand
          ? "<td class=\"r\" style=\"border-left:2px solid #6C3483;\">" +
              (pctC !== null
                ? "<span title=\"" + (candNom || p) + "\">" + pctC.toFixed(1) + "%</span>" + motorMark("candidato")
                : "<span class='muted'>—</span>") + "</td>" +
            (pctC !== null ? "<td class=\"r\"><span class=\"" +
              (pctC - pct24 > 0.5 ? "text-ok" : pctC - pct24 < -0.5 ? "text-warn" : "") + "\">" +
              (pctC - pct24 >= 0 ? "+" : "") + (pctC - pct24).toFixed(1) + "pp</span></td>"
              : "<td class=\"muted r\">—</td>")
          : "") +
      "</tr>";
    });

    var thPartido = hasPartido
      ? "<th class=\"r\" style=\"border-left:2px solid var(--accent);\">🏛 Partido</th><th class=\"r\">Δ</th>"
      : "";
    var thCand = hasCand
      ? "<th class=\"r\" style=\"border-left:2px solid #6C3483;\">🧑 Candidato</th><th class=\"r\">Δ</th>"
      : "";
    var motorNote = hasCand && hasPartido
      ? "<div style=\"font-size:10px;color:var(--text2);margin-top:4px;\">⚡ = fuente que usa el motor · Motor activo: <b>" +
          (motorFuente === "candidato" ? "🧑 Candidato" : "🏛 Partido") + "</b></div>"
      : "";

    return "<table class=\"tbl\" style=\"margin-top:8px;\">" +
      "<thead><tr><th>Partido</th><th class=\"r\">2024 JCE</th>" + thPartido + thCand + "</tr></thead>" +
      "<tbody>" + rows.join("") + "</tbody></table>" + motorNote;
  }

  // Timeline: evolución por partido si hay varias encuestas
  function buildTimeline() {
    if (polls.length < 2) return "";
    var sorted = polls.slice().sort(function(a,b){ return (a.fecha||"") > (b.fecha||"") ? 1 : -1; });
    var parties = ["FP","PRM","PLD"];
    var rows = parties.map(function(p) {
      var cells = sorted.map(function(enc) {
        var res = enc.resultados || {};
        var pct = res[p];
        if (pct === undefined) return "<td class=\"muted r\">-</td>";
        var pct24 = nat24.votes[p] ? (nat24.votes[p]/totalEm24*100) : 0;
        var delta = pct - pct24;
        var cls = delta > 0.5 ? "text-ok" : delta < -0.5 ? "text-warn" : "";
        return "<td class=\"r\"><span class=\"" + cls + "\">" + pct.toFixed(1) + "%</span></td>";
      }).join("");
      return "<tr><td>" + dot(p) + " " + p + "</td>" + cells + "</tr>";
    });
    var dateCols = sorted.map(function(enc) {
      return "<th class=\"r\">" + (enc.fecha||"?").slice(0,7) + "<br><span style=\"font-size:10px;font-weight:400;\">" + (enc.encuestadora||"").slice(0,8) + "</span></th>";
    }).join("");
    return "<h3 style=\"margin-bottom:8px;\">Evolución temporal</h3>" +
      "<div style=\"overflow:auto;\">" +
      "<table class=\"tbl\"><thead><tr><th>Partido</th>" + dateCols + "</tr></thead>" +
      "<tbody>" + rows.join("") + "</tbody></table></div>";
  }

  var lastPoll = polls.length ? polls[polls.length-1] : null;
  var compChart = buildCompChart(lastPoll, false);
  var timeline  = buildTimeline();

  view().innerHTML =
    "<div class=\"page-header\">" +
      "<h2>Encuestas</h2>" +
      "<button class=\"btn-sm\" id=\"btn-enc-upload\">+ Cargar JSON</button>" +
      "<input type=\"file\" id=\"enc-file\" accept=\".json\" style=\"display:none;\">" +
      "<button class=\"btn-sm\" id=\"btn-enc-new\" title=\"Ingresar encuesta manualmente\">+ Manual</button>" +
    "</div>" +

    // Formulario entrada manual (oculto por defecto)
    "<div id=\"enc-form-manual\" class=\"card\" style=\"display:none;margin-top:10px;\">" +
      "<h3 style=\"margin-bottom:10px;\">Registrar encuesta manualmente</h3>" +
      "<div style=\"display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px;\">" +
        "<div><label style=\"font-size:11px;display:block;margin-bottom:3px;\">Encuestadora</label>" +
          "<input id=\"enc-m-encuestadora\" class=\"inp-sm\" type=\"text\" placeholder=\"Ej: Gallup RD\" style=\"width:100%;\"></div>" +
        "<div><label style=\"font-size:11px;display:block;margin-bottom:3px;\">Fecha</label>" +
          "<input id=\"enc-m-fecha\" class=\"inp-sm\" type=\"date\" style=\"width:100%;\"></div>" +
        "<div><label style=\"font-size:11px;display:block;margin-bottom:3px;\">Nivel</label>" +
          "<select id=\"enc-m-nivel\" class=\"sel-sm\" style=\"width:100%;\">" +
            "<option value=\"pres\">Presidencial</option>" +
            "<option value=\"sen\">Senado</option>" +
            "<option value=\"dip\">Diputados</option>" +
            "<option value=\"mun\">Municipal</option>" +
          "</select></div>" +
        "<div><label style=\"font-size:11px;display:block;margin-bottom:3px;\">Muestra (n)</label>" +
          "<input id=\"enc-m-muestra\" class=\"inp-sm\" type=\"number\" placeholder=\"800\" style=\"width:100%;\"></div>" +
        "<div><label style=\"font-size:11px;display:block;margin-bottom:3px;\">Territorio</label>" +
          "<select id=\"enc-m-territorio\" class=\"sel-sm\" style=\"width:100%;\">" +
            "<option value=\"nacional\">Nacional</option>" +
            (function() {
              var lv24p = getLevel(ctx, 2024, "pres");
              return Object.keys(lv24p.prov || {}).filter(function(id){ return parseInt(id)<=32; }).sort().map(function(id){
                var p = (lv24p.prov || {})[id];
                return opt(id, (p && p.nombre) || ("Prov. " + id), false);
              }).join("");
            })() +
          "</select></div>" +
        "<div><label style=\"font-size:11px;display:block;margin-bottom:3px;\">Motor usa:</label>" +
          "<select id=\"enc-m-fuente\" class=\"sel-sm\" style=\"width:100%;\">" +
            "<option value=\"partido\">Simpatía partidaria</option>" +
            "<option value=\"candidato\">Simpatía candidato</option>" +
          "</select>" +
          "<span style=\"font-size:10px;color:var(--text2);display:block;margin-top:2px;\">¿Qué alimenta los ajustes del motor?</span>" +
        "</div>" +
      "</div>" +

      // Sección A: Resultados por partido
      "<div style=\"display:grid;grid-template-columns:1fr 1fr;gap:14px;\">" +
        "<div>" +
          "<label style=\"font-size:12px;font-weight:600;display:block;margin-bottom:4px;\">A — Simpatía Partidaria <span class=\"muted\" style=\"font-size:10px;\">(% intención por organización política)</span></label>" +
          "<div id=\"enc-m-partidos\">" +
            ["PRM","FP","PLD"].map(function(p) {
              return "<div style=\"display:flex;align-items:center;gap:6px;margin-bottom:4px;\">" +
                "<span style=\"width:60px;font-size:12px;\">" + p + "</span>" +
                "<input class=\"inp-sm enc-m-pct\" data-partido=\"" + p + "\" type=\"number\" " +
                "min=\"0\" max=\"100\" step=\"0.1\" placeholder=\"0.0\" style=\"width:80px;\"> %" +
                "</div>";
            }).join("") +
          "</div>" +
          "<button id=\"enc-m-add-row\" class=\"btn-sm\" style=\"margin-top:6px;font-size:11px;\">+ Agregar partido</button>" +
        "</div>" +

        // Sección B: Candidatos
        "<div>" +
          "<label style=\"font-size:12px;font-weight:600;display:block;margin-bottom:4px;\">B — Simpatía por Candidato <span class=\"muted\" style=\"font-size:10px;\">(% intención por figura individual)</span></label>" +
          "<div id=\"enc-m-candidatos\">" +
            ["PRM","FP","PLD"].map(function(p) {
              return "<div style=\"display:flex;align-items:center;gap:4px;margin-bottom:4px;\">" +
                "<span style=\"width:44px;font-size:11px;\">" + p + "</span>" +
                "<input class=\"inp-sm enc-m-cand-nombre\" data-partido=\"" + p + "\" type=\"text\" " +
                "placeholder=\"Nombre\" style=\"width:110px;font-size:11px;\"> " +
                "<input class=\"inp-sm enc-m-cand-pct\" data-partido=\"" + p + "\" type=\"number\" " +
                "min=\"0\" max=\"100\" step=\"0.1\" placeholder=\"%\" style=\"width:64px;\"> %" +
                "</div>";
            }).join("") +
          "</div>" +
          "<button id=\"enc-m-add-cand\" class=\"btn-sm\" style=\"margin-top:6px;font-size:11px;\">+ Agregar candidato</button>" +
          "<p style=\"font-size:10px;color:var(--text2);margin-top:4px;\">Partido ref. = código de partido cuya boleta identifica al candidato</p>" +
        "</div>" +
      "</div>" +

      "<div style=\"display:flex;gap:8px;margin-top:10px;\">" +
        "<button id=\"enc-m-guardar\" class=\"btn-sm\" style=\"background:var(--accent);color:#fff;\">Guardar encuesta</button>" +
        "<button id=\"enc-m-cancelar\" class=\"btn-sm\">Cancelar</button>" +
      "</div>" +
    "</div>" +

    ejemploWarning +

    // Modo: partido vs candidato
    "<div class=\"card\" style=\"margin-bottom:14px;\">" +
      "<div style=\"display:flex;gap:12px;align-items:center;flex-wrap:wrap;\">" +
        "<div class=\"seg-group\" id=\"enc-modo-group\">" +
          "<button class=\"seg-btn active\" data-encmodo=\"partido\">Por partido</button>" +
          "<button class=\"seg-btn\" data-encmodo=\"candidato\">Por candidato</button>" +
        "</div>" +
        "<label style=\"display:flex;align-items:center;gap:8px;font-size:12px;\">" +
          "<input type=\"checkbox\" id=\"enc-apply\"> Aplicar al Simulador como delta inicial" +
        "</label>" +
        "<select id=\"enc-activa\" class=\"sel-sm\">" +
          (polls.length
            ? polls.map(function(p, i) {
                return opt(String(i), p.fecha + " - " + p.encuestadora + " (" + p.nivel + ")", i === polls.length-1);
              }).join("")
            : "<option>Sin encuestas</option>"
          ) +
        "</select>" +
      "</div>" +
    "</div>" +

    // Comparativo vs 2024
    (lastPoll
      ? "<div class=\"card\" style=\"margin-bottom:14px;\">" +
          "<h3>Comparativo: Encuesta más reciente vs. 2024 JCE</h3>" +
          "<p class=\"muted\" style=\"font-size:11px;margin-bottom:6px;\">" +
            lastPoll.encuestadora + " · " + lastPoll.fecha +
            (lastPoll.muestra ? " · n=" + fmtInt(lastPoll.muestra) : "") +
            (lastPoll.margen_error ? " · ±" + lastPoll.margen_error + "%" : "") +
          "</p>" +
          "<div id=\"enc-comp-chart\">" + compChart + "</div>" +
        "</div>"
      : ""
    ) +

    // Timeline
    (timeline
      ? "<div class=\"card\" style=\"margin-bottom:14px;\">" + timeline + "</div>"
      : ""
    ) +

    // Tabla histórica completa
    "<div class=\"card\" style=\"margin-bottom:14px;\">" +
      "<h3>Histórico (" + polls.length + " encuesta" + (polls.length !== 1 ? "s" : "") + ")</h3>" +
      (polls.length
        ? "<div style=\"overflow:auto;\">" +
            "<table class=\"tbl\">" +
              "<thead><tr>" +
                "<th>Fecha</th><th>Encuestadora</th><th>Nivel</th><th>Territorio</th>" +
                "<th class=\"r\">Muestra</th>" +
                "<th>Motor</th>" +
                "<th>🏛 Partido (top 4)</th><th>🧑 Candidato (top 3)</th>" +
              "</tr></thead>" +
              "<tbody>" + polls.map(function(p) {
                var topRes = Object.entries(p.resultados || {})
                  .sort(function(a,b){return b[1]-a[1];})
                  .slice(0,4)
                  .map(function(kv) { return dot(kv[0]) + kv[0] + ":" + kv[1] + "%"; })
                  .join(" ");
                var candRes = p.candidatos
                  ? Object.entries(p.candidatos)
                      .filter(function(kv){return kv[1].pct;})
                      .sort(function(a,b){return b[1].pct-a[1].pct;})
                      .slice(0,3)
                      .map(function(kv){
                        return "<b>" + (kv[1].nombre || kv[0]) + "</b>:" + kv[1].pct + "%";
                      })
                      .join(" | ")
                  : "<span class=\"muted\">—</span>";
                var motorBadge = p.fuente_motor === "candidato"
                  ? "<span style=\"font-size:10px;background:#6C3483;color:#fff;padding:1px 5px;border-radius:3px;\">🧑 Cand.</span>"
                  : "<span style=\"font-size:10px;background:var(--accent);color:#fff;padding:1px 5px;border-radius:3px;\">🏛 Part.</span>";
                var territorio = p.territorio && p.territorio !== "nacional"
                  ? "Prov." + p.territorio
                  : "Nacional";
                return "<tr>" +
                  "<td>" + (p.fecha || "-") + "</td>" +
                  "<td>" + (p.encuestadora || "-") + "</td>" +
                  "<td>" + (p.nivel || "-") + "</td>" +
                  "<td style=\"font-size:11px;\">" + territorio + "</td>" +
                  "<td class=\"r\">" + (p.muestra ? fmtInt(p.muestra) : "-") + "</td>" +
                  "<td>" + motorBadge + "</td>" +
                  "<td style=\"font-size:11px;\">" + (topRes || "<span class='muted'>—</span>") + "</td>" +
                  "<td style=\"font-size:11px;color:var(--text2);\">" + candRes + "</td>" +
                "</tr>";
              }).join("") +
              "</tbody>" +
            "</table>" +
          "</div>"
        : "<p class=\"muted\">Sin encuestas. Carga un archivo polls.json.</p>"
      ) +
    "</div>" +

    // Metodología
    "<div class=\"card\">" +
      "<h3>Metodología</h3>" +
      "<p class=\"muted\" style=\"font-size:12px;\">" +
        "Promedio ponderado por recencia: <b>peso = 1 / (1 + meses_desde_publicación)</b>. " +
        "Encuestas recientes tienen mayor peso. Delta vs JCE 2024 indica variación desde el resultado oficial. " +
        "Las encuestas alimentan directamente el motor de Proyección 2028 y el Simulador. " +
        "<b>Motor usa «partido»:</b> aplica % de intención por organización política. " +
        "<b>Motor usa «candidato»:</b> aplica % de simpatía personal del candidato — útil en elecciones " +
        "municipales o senatoriales donde el factor individual supera al partido." +
      "</p>" +
    "</div>";

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
          toast("Error: JSON inválido — " + err.message);
        }
      };
      reader.readAsText(file);
    });
  }

  // Manual entry form toggle
  var btnNew = el("btn-enc-new");
  if (btnNew) {
    btnNew.addEventListener("click", function() {
      var fm = el("enc-form-manual");
      if (fm) {
        fm.style.display = fm.style.display === "none" ? "block" : "none";
        // Set today as default date
        var fechaInp = el("enc-m-fecha");
        if (fechaInp && !fechaInp.value) {
          fechaInp.value = new Date().toISOString().slice(0, 10);
        }
      }
    });
  }
  var btnCancelar = el("enc-m-cancelar");
  if (btnCancelar) {
    btnCancelar.addEventListener("click", function() {
      var fm = el("enc-form-manual");
      if (fm) fm.style.display = "none";
    });
  }
  // Add party row button
  var btnAddRow = el("enc-m-add-row");
  if (btnAddRow) {
    btnAddRow.addEventListener("click", function() {
      var container = el("enc-m-partidos");
      if (!container) return;
      var cod = prompt("Código del partido (ej: PRSC):");
      if (!cod) return;
      cod = cod.trim().toUpperCase();
      var div = document.createElement("div");
      div.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:4px;";
      div.innerHTML = "<span style=\"width:60px;font-size:12px;\">" + cod + "</span>" +
        "<input class=\"inp-sm enc-m-pct\" data-partido=\"" + cod + "\" type=\"number\" " +
        "min=\"0\" max=\"100\" step=\"0.1\" placeholder=\"0.0\" style=\"width:80px;\"> %";
      container.appendChild(div);
    });
  }
  // Add candidato row button
  var btnAddCand = el("enc-m-add-cand");
  if (btnAddCand) {
    btnAddCand.addEventListener("click", function() {
      var container = el("enc-m-candidatos");
      if (!container) return;
      var cod = prompt("Código del partido ref. para este candidato (ej: PRSC):");
      if (!cod) return;
      cod = cod.trim().toUpperCase();
      var div = document.createElement("div");
      div.style.cssText = "display:flex;align-items:center;gap:4px;margin-bottom:4px;";
      div.innerHTML = "<span style=\"width:44px;font-size:11px;\">" + cod + "</span>" +
        "<input class=\"inp-sm enc-m-cand-nombre\" data-partido=\"" + cod + "\" type=\"text\" " +
        "placeholder=\"Nombre\" style=\"width:110px;font-size:11px;\"> " +
        "<input class=\"inp-sm enc-m-cand-pct\" data-partido=\"" + cod + "\" type=\"number\" " +
        "min=\"0\" max=\"100\" step=\"0.1\" placeholder=\"%\" style=\"width:64px;\"> %";
      container.appendChild(div);
    });
  }
  // Save manual entry
  var btnGuardar = el("enc-m-guardar");
  if (btnGuardar) {
    btnGuardar.addEventListener("click", function() {
      var encuestadora = (el("enc-m-encuestadora") || {}).value || "Manual";
      var fecha        = (el("enc-m-fecha") || {}).value || new Date().toISOString().slice(0, 10);
      var nivel_enc    = (el("enc-m-nivel") || {}).value || "pres";
      var muestra      = Number((el("enc-m-muestra") || {}).value) || null;
      var territorio   = (el("enc-m-territorio") || {}).value || "nacional";
      var fuente_motor = (el("enc-m-fuente") || {}).value || "partido";
      var resultados   = {};
      document.querySelectorAll(".enc-m-pct").forEach(function(inp) {
        var p   = inp.dataset.partido;
        var val = parseFloat(inp.value);
        if (p && !isNaN(val) && val > 0) resultados[p] = val;
      });
      // Capture candidatos
      var candidatos = {};
      var candNombres = document.querySelectorAll(".enc-m-cand-nombre");
      var candPcts    = document.querySelectorAll(".enc-m-cand-pct");
      candNombres.forEach(function(inp) {
        var p    = inp.dataset.partido;
        var nom  = inp.value.trim();
        if (!p) return;
        if (!candidatos[p]) candidatos[p] = { partido_ref: p };
        candidatos[p].nombre = nom || p;
      });
      candPcts.forEach(function(inp) {
        var p   = inp.dataset.partido;
        var val = parseFloat(inp.value);
        if (p && !isNaN(val) && val > 0) {
          if (!candidatos[p]) candidatos[p] = { partido_ref: p, nombre: p };
          candidatos[p].pct = val;
        }
      });
      // Remove candidatos without pct
      Object.keys(candidatos).forEach(function(k) {
        if (!candidatos[k].pct) delete candidatos[k];
      });

      if (!Object.keys(resultados).length && !Object.keys(candidatos).length) {
        toast("Ingresa al menos un resultado de partido o candidato.");
        return;
      }
      if (Object.keys(resultados).length) {
        var total = Object.values(resultados).reduce(function(a, v) { return a + v; }, 0);
        if (Math.abs(total - 100) > 5) {
          toast("Partidos suman " + total.toFixed(1) + "% — deben sumar ~100%.");
          return;
        }
      }
      var newEnc = {
        encuestadora: encuestadora,
        fecha: fecha,
        nivel: nivel_enc,
        muestra: muestra,
        territorio: territorio,
        fuente_motor: fuente_motor,
        resultados: resultados,
        _manual: true
      };
      if (Object.keys(candidatos).length) newEnc.candidatos = candidatos;
      if (!ctx.polls) ctx.polls = [];
      ctx.polls.push(newEnc);
      toast("Encuesta '" + encuestadora + "' guardada [motor: " + fuente_motor + ", territorio: " + territorio + "].");
      renderEncuestas(state, ctx);
    });
  }

  // Toggle partido/candidato → actualizar gráfico comparativo
  var modoGroup = el("enc-modo-group");
  if (modoGroup) {
    modoGroup.addEventListener("click", function(e) {
      var btn = e.target.closest(".seg-btn[data-encmodo]");
      if (!btn) return;
      var modo = btn.dataset.encmodo;
      modoGroup.querySelectorAll(".seg-btn").forEach(function(b){
        b.classList.toggle("active", b.dataset.encmodo === modo);
      });
      var chart = el("enc-comp-chart");
      if (chart && lastPoll) {
        chart.innerHTML = buildCompChart(lastPoll, modo === "candidato");
      }
    });
  }

  // Cambio de encuesta activa → actualizar gráfico
  var selActiva = el("enc-activa");
  if (selActiva) {
    selActiva.addEventListener("change", function() {
      var idx = Number(selActiva.value);
      var chart = el("enc-comp-chart");
      if (chart && polls[idx]) {
        var modoActual = modoGroup ? (modoGroup.querySelector(".seg-btn.active") || {}).dataset : {};
        chart.innerHTML = buildCompChart(polls[idx], modoActual.encmodo === "candidato");
        // update header
        var hdr = chart.previousElementSibling;
        if (hdr && hdr.classList.contains("muted")) {
          var p = polls[idx];
          hdr.textContent = p.encuestadora + " · " + p.fecha +
            (p.muestra ? " · n=" + fmtInt(p.muestra) : "") +
            (p.margen_error ? " · ±" + p.margen_error + "%" : "");
        }
      }
    });
  }

  // Aplicar al simulador
  var applyChk = el("enc-apply");
  if (applyChk) {
    applyChk.addEventListener("change", function() {
      if (!applyChk.checked) {
        // Des-aplicar: limpiar encuesta activa
        ctx._encuestaActiva  = null;
        ctx._simFuenteMotor  = "partido";
        ctx._simDeltasFuente = null;
        var ind = document.getElementById("sim-fuente-ind");
        if (ind) ind.style.display = "none";
        return;
      }
      var idx      = el("enc-activa") ? Number(el("enc-activa").value) : 0;
      var encuesta = polls[idx];
      if (!encuesta || (!encuesta.resultados && !encuesta.candidatos)) {
        toast("Sin datos en la encuesta"); return;
      }
      // Modo: primero leer fuente_motor del objeto encuesta; si no, leer botón UI
      var modoBtn  = document.querySelector(".seg-btn.active[data-encmodo]");
      var modoUI   = modoBtn ? modoBtn.dataset.encmodo : "partido";
      var modo     = encuesta.fuente_motor || modoUI;

      // Validar que el modo candidato tiene datos
      if (modo === "candidato" && (!encuesta.candidatos || !Object.keys(encuesta.candidatos).length)) {
        toast("⚠ Esta encuesta no tiene datos de candidatos. Usando simpatía partidaria.");
        modo = "partido";
      }
      if (modo === "partido" && (!encuesta.resultados || !Object.keys(encuesta.resultados).length)) {
        toast("⚠ Esta encuesta no tiene resultados de partido. Usando datos de candidato.");
        modo = "candidato";
      }

      // Guardar el objeto encuesta completo + modo resuelto en ctx
      // runSim lo leerá directamente y lo pasará como encuestaLocal al motor
      ctx._encuestaActiva  = encuesta;
      ctx._simFuenteMotor  = modo;
      ctx._simDeltasFuente = encuesta.encuestadora + " · " + (encuesta.fecha || "?") +
                             (encuesta.territorio && encuesta.territorio !== "nacional"
                               ? " · Prov." + encuesta.territorio : "") +
                             " [fuente: " + modo + "]";

      var nDatos = modo === "candidato"
        ? Object.keys(encuesta.candidatos || {}).length
        : Object.keys(encuesta.resultados || {}).length;

      toast("✓ " + encuesta.encuestadora + " activada — motor usará " +
            (modo === "candidato" ? "simpatía candidato" : "simpatía partidaria") +
            " (" + nDatos + " partidos)");
    });
  }

  // Leyenda metodológica encuestas
  var metEnc = document.createElement("details");
  metEnc.className = "met-box";
  metEnc.style.marginTop = "12px";
  metEnc.innerHTML =
    "<summary><b>Metodología — Encuestas</b></summary>" +
    "<div class=\"met-body\">" +
      "<b>Modo partido:</b> intención de voto por organización política<br>" +
      "<b>Modo candidato:</b> simpatía/intención por figura individual (útil en elecciones personalistas)<br>" +
      "<b>Ponderación:</b> inverso de días desde publicación × factor tamaño muestral (si disponible)<br>" +
      "<b>Promedio ponderado:</b> Σ(pct_i × w_i) / Σ(w_i) — encuestas recientes pesan más<br>" +
      "<b>Delta al Simulador:</b> diferencia encuesta vs resultado 2024 aplicada como ajuste inicial de pp<br>" +
      "<b>Advertencia:</b> encuestas miden intención, no participación efectiva — combinar con motor Movilización" +
    "</div>";
  var encWrap = document.getElementById("enc-wrap");
  if (encWrap) encWrap.appendChild(metEnc);
}


export { exportarPDF };
