/**
 * SIE 2028 v4.1
 */
var VERSION = "5.0";

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
         renderBoleta,
         renderEncuestas,
         exportarPDF }     from "./ui/views.js";

var ROUTES = [
  { id:"dashboard",    label:"Dashboard",    fn: renderDashboard    },
  { id:"mapa",         label:"Mapa",         fn: renderMapa         },
  { id:"simulador",    label:"Simulador",    fn: renderSimulador    },
  { id:"potencial",    label:"Potencial",    fn: renderPotencial    },
  { id:"movilizacion", label:"Movilizacion", fn: renderMovilizacion },
  { id:"objetivo",     label:"Objetivo",     fn: renderObjetivo     },
  { id:"boleta",       label:"Boleta unica", fn: renderBoleta       },
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
  return ctx;
}

async function render(routeId) {
  if (rendering) return;
  rendering = true;
  try {
    if (!ctx) {
      document.getElementById("view").innerHTML = "<div class=\"loading\">Cargando datos...</div>";
      ctx = await loadCTX();
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
      var show = routeId === "dashboard" || routeId === "simulador" || routeId === "auditoria";
      expBtn.style.display = show ? "" : "none";
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
  btn.textContent = saved === "dark" ? "Claro" : "Oscuro";
  btn.addEventListener("click", function() {
    var cur  = document.documentElement.getAttribute("data-theme");
    var next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("sie28-theme", next);
    btn.textContent = next === "dark" ? "Claro" : "Oscuro";
  });
}

function boot() {
  initTheme();
  var vBadge = document.querySelector(".brand .badge");
  if (vBadge) vBadge.textContent = "v5.0";
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
  // Toggle Base 2024 / Proyección 2028
  var modoBtn = document.createElement("button");
  modoBtn.id = "btn-modo";
  modoBtn.className = "btn-sm";
  modoBtn.title = "Alternar entre datos reales 2024 y proyección 2028";
  modoBtn.style.cssText = "font-weight:600;border-color:var(--accent);color:var(--accent);";
  function updateModoBtn() {
    modoBtn.textContent = state.modo === "proy2028" ? "Proy. 2028 ✦" : "Base 2024";
  }
  updateModoBtn();
  modoBtn.addEventListener("click", function() {
    var next = state.modo === "base2024" ? "proy2028" : "base2024";
    state.setModo(next);
    ctx2028 = null;
    updateModoBtn();
    // Mostrar/ocultar slider de participación
    var sliderWrap = document.getElementById("wrap-part-slider");
    if (sliderWrap) sliderWrap.style.display = next === "proy2028" ? "flex" : "none";
    state.recomputeAndRender();
  });

  // Slider participación 2028 (visible solo en modo proy2028)
  var sliderWrap = document.createElement("div");
  sliderWrap.id = "wrap-part-slider";
  sliderWrap.style.cssText = "display:none;align-items:center;gap:6px;font-size:12px;";
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
