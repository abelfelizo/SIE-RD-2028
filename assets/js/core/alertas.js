/**
 * SIE 2028  core/alertas.js  v6.0
 *
 * Motor de Alertas Electoral. No toca la base 2024.
 * Tipos: 2da_vuelta | margen_critico | sin_mayoria | swing_necesario | encuesta_difiere | competitivo
 */

import { nextSeatVotes } from "./dhondt_engine.js";
import { rankVotes }     from "./utils.js";
import { getLevel }      from "./data.js";

export function generarAlertas(ctx, nivel, simResult) {
  var alertas = [];
  if (!ctx || !nivel) return alertas;
  if (nivel === "pres") { _alertasPres(ctx, simResult, alertas); }
  else if (nivel === "sen") { _alertasSen(ctx, simResult, alertas); }
  else if (nivel === "dip") { _alertasDip(ctx, simResult, alertas); }
  else if (nivel === "mun" || nivel === "dm") { _alertasTerr(ctx, nivel, alertas); }
  _alertasEncuesta(ctx, nivel, alertas);
  return alertas;
}

function _alertasPres(ctx, sim, alertas) {
  var ranked = sim ? sim.ranked : _rankNac(ctx, "pres");
  if (!ranked.length) return;
  var t1 = ranked[0], t2 = ranked[1];
  if (t1.pct < 0.50) {
    alertas.push({ tipo:"2da_vuelta", nivel_alerta:"error",
      msg: "Riesgo 2a vuelta",
      detalle: t1.p + " en " + _p(t1.pct) + " — faltan " + _p(0.5 - t1.pct) + " para 50%+1" });
  }
  if (t2 && (t1.pct - t2.pct) < 0.05) {
    alertas.push({ tipo:"margen_bajo", nivel_alerta:"warn",
      msg: "Margen presidencial <5pp",
      detalle: t1.p + " " + _p(t1.pct) + " vs " + t2.p + " " + _p(t2.pct) });
  }
}

function _alertasSen(ctx, sim, alertas) {
  var lv = getLevel(ctx, _year(ctx), "sen");
  var criticos = 0;
  Object.keys(lv.prov || {}).forEach(function(id) {
    var r = rankVotes((lv.prov[id].votes || {}), lv.prov[id].emitidos || 1);
    if (r.length >= 2 && (r[0].pct - r[1].pct) < 0.03) criticos++;
  });
  if (criticos > 0) {
    alertas.push({ tipo:"margen_critico", nivel_alerta:"error",
      msg: criticos + " provincia(s) empate tecnico (<3pp)",
      detalle: "Senados en juego con minima movilizacion" });
  }
  if (sim && sim.senadores) {
    var top = _topParty(sim.senadores.totalByParty);
    var c   = top ? (sim.senadores.totalByParty[top] || 0) : 0;
    if (top && c < 17) {
      alertas.push({ tipo:"sin_mayoria", nivel_alerta:"warn",
        msg: top + " sin mayoria senatorial",
        detalle: c + "/32 senadores (necesita 17)" });
    }
  }
}

function _alertasDip(ctx, sim, alertas) {
  var cur = ctx.curules;
  if (!cur || !cur.territorial) return;
  var lv = getLevel(ctx, _year(ctx), "dip");
  var marg = [];
  cur.territorial.forEach(function(c) {
    var pid  = String(c.provincia_id).padStart(2, "0");
    var key  = c.circ > 0 ? pid + "-" + c.circ : pid;
    var data = (lv.circ && lv.circ[key]) || (lv.prov && lv.prov[pid]) || null;
    if (!data || !data.votes) return;
    var leader = _topParty(data.votes);
    if (!leader) return;
    var need = nextSeatVotes(data.votes, c.seats, leader);
    if (need > 0 && need < 5000) marg.push({ circ: key, votos: need });
  });
  if (marg.length) {
    alertas.push({ tipo:"swing_necesario", nivel_alerta:"warn",
      msg: marg.length + " curul(es) marginal(es) (<5k votos)",
      detalle: marg.slice(0, 3).map(function(m) {
        return "Circ " + m.circ + ": " + m.votos.toLocaleString("en-US") + " votos";
      }).join(" | ") });
  }
  if (sim && sim.curules) {
    var top = _topParty(sim.curules.totalByParty);
    var c2  = top ? (sim.curules.totalByParty[top] || 0) : 0;
    if (top && c2 < 96) {
      alertas.push({ tipo:"sin_mayoria", nivel_alerta:"warn",
        msg: top + " sin mayoria en Camara: " + c2 + "/190",
        detalle: "Necesita 96 diputados" });
    }
  }
}

function _alertasTerr(ctx, nivel, alertas) {
  var lv   = getLevel(ctx, _year(ctx), nivel);
  var terr = nivel === "dm" ? (lv.dm || {}) : (lv.mun || {});
  var comp = 0;
  Object.keys(terr).forEach(function(id) {
    var r = rankVotes(terr[id].votes || {}, terr[id].emitidos || 1);
    if (r.length >= 2 && (r[0].pct - r[1].pct) < 0.05) comp++;
  });
  if (comp > 0) {
    alertas.push({ tipo:"competitivo", nivel_alerta:"warn",
      msg: comp + " " + (nivel==="dm" ? "DM" : "municipios") + " competitivos (<5pp)",
      detalle: "Reversibles con pequena movilizacion" });
  }
}

function _alertasEncuesta(ctx, nivel, alertas) {
  var polls = ctx.polls || [];
  if (!polls.length) return;
  var last = polls[polls.length - 1];
  var enc  = last.resultados || {};
  var lv24 = (ctx.r && ctx.r[2024] && ctx.r[2024][nivel]) ? ctx.r[2024][nivel] : {};
  var nat24 = lv24.nacional || {};
  var em24  = nat24.emitidos || 1;
  var v24   = nat24.votes    || {};
  var difs  = [];
  Object.keys(enc).forEach(function(p) {
    var delta = enc[p]/100 - (v24[p]||0)/em24;
    if (Math.abs(delta) > 0.07) difs.push({ p:p, delta:delta });
  });
  if (difs.length) {
    alertas.push({ tipo:"encuesta_difiere", nivel_alerta:"warn",
      msg: "Encuesta difiere >7pp de base 2024",
      detalle: difs.map(function(d) {
        return d.p + " " + (d.delta>0?"+":"") + (d.delta*100).toFixed(1) + "pp";
      }).join(" | ") + " — " + last.encuestadora + " " + last.fecha });
  }
}

export function renderAlertasHtml(alertas, compact) {
  if (!alertas || !alertas.length) {
    return "<p class=\"muted\" style=\"font-size:12px;\">Sin alertas activas.</p>";
  }
  var rows = alertas.map(function(a) {
    var bc = a.nivel_alerta === "error" ? "badge-err" : "badge-warn";
    var lb = a.nivel_alerta === "error" ? "ALERTA" : "AVISO";
    if (compact) {
      return "<li style=\"margin-bottom:5px;\">" +
        "<span class=\"badge " + bc + "\" style=\"margin-right:5px;\">" + lb + "</span>" +
        a.msg +
        (a.detalle ? "<span class=\"muted\" style=\"font-size:11px;margin-left:6px;\">" + a.detalle + "</span>" : "") +
        "</li>";
    }
    return "<li style=\"margin-bottom:10px;\">" +
      "<div style=\"display:flex;align-items:center;gap:8px;\">" +
        "<span class=\"badge " + bc + "\">" + lb + "</span><b>" + a.msg + "</b>" +
      "</div>" +
      (a.detalle ? "<div class=\"muted\" style=\"font-size:12px;margin-top:3px;\">" + a.detalle + "</div>" : "") +
      "</li>";
  }).join("");
  return "<ul style=\"margin:0;padding:0;list-style:none;\">" + rows + "</ul>";
}

function _rankNac(ctx, nivel) {
  var lv = getLevel(ctx, _year(ctx), nivel);
  return rankVotes((lv.nacional||{}).votes||{}, (lv.nacional||{}).emitidos||1);
}
function _topParty(obj) {
  var ks = Object.keys(obj||{});
  return ks.length ? ks.sort(function(a,b){return (obj[b]||0)-(obj[a]||0);})[0] : null;
}
function _year(ctx) { return (ctx.r && ctx.r[2028]) ? 2028 : 2024; }
function _p(x) { return (Number(x)*100).toFixed(1)+"%"; }
