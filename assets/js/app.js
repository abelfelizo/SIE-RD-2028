/**
 * SIE 2028 v8.0
 */
var VERSION = "8.0";

import { loadCTX }         from "./core/data.js";
import { state }           from "./core/state.js";
import { buildCtx2028 }    from "./core/proyeccion2028.js";
import { toast }           from "./ui/toast.js";
import { mountGlobalControls,
         renderDashboard,
         renderMapa,
         renderSimulador,
         renderPotencial,
         renderMovilizacion,
         renderObjetivo,
         renderAuditoria,
         renderEncuestas,
         exportarPDF }     from "./ui/views.js";

var ROUTES = [
  { id:"dashboard",    label:"Dashboard",    fn: renderDashboard    },
  { id:"mapa",         label:"Mapa",         fn: renderMapa         },
  { id:"simulador",    label:"Simulador",    fn: renderSimulador    },
  { id:"potencial",    label:"Potencial",    fn: renderPotencial    },
  { id:"movilizacion", label:"Movilizacion", fn: renderMovilizacion },
  { id:"objetivo",     label:"Objetivo",     fn: renderObjetivo     },
  { id:"encuestas",    label:"Encuestas",    fn: renderEncuestas    },
  { id:"auditoria",    label:"Auditoria",    fn: renderAuditoria    },
];

var ctx = null;
var ctx2028 = null;
var _partAjuste = 0;   // slider participación 2028 en pp, default 0
var currentRoute = "dashboard";
var rendering = false;

function getActiveCtx() {
  if (state.modo === "proy2028") {
    if (!ctx2028) ctx2028 = buildCtx2028(ctx, _partAjuste);
    return ctx2028;
  }
  // feb2024: usa el mismo ctx pero con corte feb2024 aplicado (state.corte ya lo tiene)
  // Los módulos leen state.corte directamente para el padrón — no se necesita ctx diferente
  return ctx;
}

async function render(routeId) {
  if (rendering) return;
  rendering = true;
  try {
    if (!ctx) {
      document.getElementById("view").innerHTML = "<div class=\"loading\">Cargando datos...</div>";
      ctx = await loadCTX();
      // ── BOOT CHECK ──────────────────────────────────────────────────────────
      // Verificar integridad de datos al primer arranque. Sin inventar nada.
      import("./core/auditoria_data.js").then(function(mod) {
        var report = mod.runDataAudit(ctx);
        if (report.errores.length > 0) {
          toast("⚠ " + report.errores.length + " error(es) en datos. Ver Auditoría.");
          console.warn("[SIE BOOT] Errores de datos:", report.errores.map(function(e){return e.codigo+": "+e.msg;}));
        } else if (report.alertas.length > 0) {
          console.info("[SIE BOOT] Alertas de datos:", report.alertas.length, "— ver módulo Auditoría");
        }
        if (!ctx.alianzas || !ctx.alianzas.pres) {
          console.info("[SIE BOOT] alianzas_2024.json: pendiente de completar.");
        }
        console.info("[SIE BOOT] " + report.resumen);
      }).catch(function() { /* auditoria_data no crítico en boot */ });
    }
    currentRoute = routeId;
    var btns = document.querySelectorAll(".nav-btn");
    btns.forEach(function(b) {
      b.classList.toggle("active", b.dataset.route === routeId);
    });
    history.replaceState({}, "", "#" + routeId);
    var route = null;
    for (var i = 0; i < ROUTES.length; i++) {
      if (ROUTES[i].id === routeId) { route = ROUTES[i]; break; }
    }
    if (!route) route = ROUTES[0];
    route.fn(state, getActiveCtx());
    var expBtn = document.getElementById("btn-export");
    if (expBtn) {
      expBtn.style.display = "";  // v8: PDF export visible en todos los módulos
    }
  } catch(e) {
    console.error("[SIE]", e);
    toast("Error: " + e.message);
    document.getElementById("view").innerHTML = "<div class=\"error-msg\">Error: " + e.message + "</div>";
  } finally {
    rendering = false;
  }
}

function initTheme() {
  var saved = localStorage.getItem("sie28-theme") || "dark";
  document.documentElement.setAttribute("data-theme", saved);
  var btn = document.getElementById("btn-theme");
  if (!btn) return;
  btn.textContent = saved === "dark" ? "☀️" : "🌙";
  btn.addEventListener("click", function() {
    var cur  = document.documentElement.getAttribute("data-theme");
    var next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("sie28-theme", next);
    btn.textContent = next === "dark" ? "☀️" : "🌙";
  });
}

function boot() {
  initTheme();
  var vBadge = document.querySelector(".brand .badge");
  if (vBadge) vBadge.textContent = "v8.0";
  var nav = document.getElementById("nav");
  var navHtml = "";
  for (var i = 0; i < ROUTES.length; i++) {
    navHtml += "<button class=\"nav-btn\" data-route=\"" + ROUTES[i].id + "\">" + ROUTES[i].label + "</button>";
  }
  nav.innerHTML = navHtml;
  nav.addEventListener("click", function(e) {
    var btn = e.target.closest(".nav-btn");
    if (btn) render(btn.dataset.route);
  });
  mountGlobalControls(state);

  // ── ESCENARIO CÍCLICO: Base 2024 → Feb 2024 → Proy. 2028 → Base 2024 ──────
  // Estado: state.modo (base2024 | feb2024 | proy2028) + state.corte (mayo2024 | feb2024)
  var ESCENARIOS = [
    { modo: "base2024", corte: "mayo2024", label: "Base 2024",  icon: "📊" },
    { modo: "feb2024",  corte: "feb2024",  label: "Feb 2024",   icon: "📅" },
    { modo: "proy2028", corte: "mayo2024", label: "Proy. 2028", icon: "✦"  },
  ];
  function getEscIdx() {
    for (var i = 0; i < ESCENARIOS.length; i++) {
      if (ESCENARIOS[i].modo === state.modo) return i;
    }
    return 0;
  }
  var modoBtn = document.createElement("button");
  modoBtn.id = "btn-modo";
  modoBtn.className = "btn-sm";
  modoBtn.title = "Ciclar escenario: Base 2024 → Feb 2024 → Proyección 2028";
  modoBtn.style.cssText = "font-weight:600;border-color:var(--accent);color:var(--accent);min-width:110px;";
  function updateModoBtn() {
    var esc = ESCENARIOS[getEscIdx()];
    modoBtn.textContent = esc.icon + " " + esc.label;
  }
  updateModoBtn();
  modoBtn.addEventListener("click", function() {
    var nextIdx = (getEscIdx() + 1) % ESCENARIOS.length;
    var nextEsc = ESCENARIOS[nextIdx];
    state.setModo(nextEsc.modo);
    state.setCorte(nextEsc.corte);
    ctx2028 = null;
    updateModoBtn();
    var sliderWrap = document.getElementById("wrap-part-slider");
    if (sliderWrap) sliderWrap.style.display = nextEsc.modo === "proy2028" ? "flex" : "none";
    state.recomputeAndRender();
  });

  // Slider participación 2028 (visible solo en modo proy2028)
  var sliderWrap = document.createElement("div");
  sliderWrap.id = "wrap-part-slider";
  sliderWrap.style.cssText = "display:" + (state.modo === "proy2028" ? "flex" : "none") + ";align-items:center;gap:6px;font-size:12px;";
  sliderWrap.innerHTML =
    "<span style=\"color:var(--text2);\">Part.2028:</span>" +
    "<input id=\"slider-part\" type=\"range\" min=\"-5\" max=\"5\" step=\"0.5\" value=\"0\" " +
      "style=\"width:80px;cursor:pointer;\">" +
    "<span id=\"slider-part-val\" style=\"min-width:44px;color:var(--accent);font-weight:600;\">±0.0pp</span>";

  var topbarRight = document.querySelector(".topbar-right");
  if (topbarRight) {
    topbarRight.insertBefore(modoBtn, topbarRight.firstChild);
    topbarRight.insertBefore(sliderWrap, topbarRight.firstChild);
  }

  document.addEventListener("input", function(e) {
    if (e.target && e.target.id === "slider-part") {
      var val = parseFloat(e.target.value) || 0;
      _partAjuste = val;
      var lbl = document.getElementById("slider-part-val");
      if (lbl) lbl.textContent = (val >= 0 ? "+" : "") + val.toFixed(1) + "pp";
      ctx2028 = null;  // invalidar caché para recalcular con nuevo ajuste
      state.recomputeAndRender();
    }
  });
  state.recomputeAndRender = function() { render(currentRoute); };
  var expBtn = document.getElementById("btn-export");
  if (expBtn) {
    expBtn.style.display = "none";
    expBtn.addEventListener("click", function() { exportarPDF(ctx, state); });
  }
  var initial = location.hash.replace("#", "") || "dashboard";
  var validInitial = false;
  for (var i = 0; i < ROUTES.length; i++) {
    if (ROUTES[i].id === initial) { validInitial = true; break; }
  }
  render(validInitial ? initial : "dashboard");
  window.addEventListener("hashchange", function() {
    var id = location.hash.replace("#", "");
    if (id && id !== currentRoute) render(id);
  });
}

window.addEventListener("DOMContentLoaded", boot);
