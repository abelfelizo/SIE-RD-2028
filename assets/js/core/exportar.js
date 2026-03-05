/**
 * SIE 2028  core/exportar.js  v8.2
 * Exportación PDF: captura vista actual + estado visible (mapa SVG, tablas, charts).
 * Estrategia: clona el DOM del módulo visible, serializa SVGs inline, abre ventana de impresión.
 */
import { fmtInt, fmtPct, rankVotes } from "./utils.js";
import { getLevel, getInscritos }    from "./data.js";
import { simular }                   from "./simulacion.js";
import { runAuditoria }              from "./auditoria.js";

var NIVEL_LABEL = { pres:"Presidencial", sen:"Senadores", dip:"Diputados", mun:"Alcaldes", dm:"DM" };
var CORTE_LABEL = { mayo2024:"Mayo 2024", feb2024:"Feb 2024", proy2028:"Proy. 2028" };

/**
 * Captura el estado visual actual del módulo visible.
 * Incluye SVG del mapa (si está visible), tablas y texto.
 * Excluye elementos interactivos (sliders, botones).
 */
function captureCurrentView() {
  var viewEl = document.getElementById("view");
  if (!viewEl) return "<p>Sin vista activa</p>";

  // Clonar el DOM para no modificar el original
  var clone = viewEl.cloneNode(true);

  // 1. Serializar SVGs inline (el mapa)
  var originalSVGs = viewEl.querySelectorAll("svg");
  var clonedSVGs   = clone.querySelectorAll("svg");
  originalSVGs.forEach(function(orig, i) {
    if (clonedSVGs[i]) {
      // Copiar estilos computados de paths del mapa
      var origPaths   = orig.querySelectorAll("path, [id^='DO-']");
      var clonePaths  = clonedSVGs[i].querySelectorAll("path, [id^='DO-']");
      origPaths.forEach(function(op, j) {
        if (clonePaths[j]) {
          clonePaths[j].setAttribute("style",
            "fill:" + (op.style.fill || "#4a5568") + ";" +
            "stroke:" + (op.style.stroke || "#fff") + ";" +
            "stroke-width:" + (op.style.strokeWidth || "0.5") + ";");
        }
      });
      clonedSVGs[i].setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clonedSVGs[i].setAttribute("style", "max-width:100%;height:auto;");
    }
  });

  // 2. Eliminar elementos interactivos del clon
  ["button","input","select","textarea",".btn-sm",".seg-group","details > summary + *:not(table)"]
    .forEach(function(sel) {
      try {
        clone.querySelectorAll(sel).forEach(function(el) {
          // Mantener tablas dentro de details
          if (el.tagName === "TABLE") return;
          el.style.display = "none";
        });
      } catch(e) {}
    });

  // 3. Abrir details para que su contenido aparezca en el PDF
  clone.querySelectorAll("details").forEach(function(d) {
    d.setAttribute("open", "");
  });

  return clone.innerHTML;
}

export function exportarPDF(ctx, state, simResult) {
  var nivel   = state.nivel;
  var corte   = state.corte || "mayo2024";
  var isProy  = corte === "proy2028";
  var lv      = getLevel(ctx, isProy ? 2028 : 2024, nivel) || getLevel(ctx, 2024, nivel);
  var nat     = lv.nacional;
  var ins     = nivel === "pres" ? (getInscritos(ctx, corte) || nat.inscritos || 0) : (nat.inscritos || 0);
  var em      = nat.emitidos || 0;
  var part    = ins ? em / ins : 0;
  var ranked  = rankVotes(nat.votes, em);
  var audit   = runAuditoria(ctx);
  var now     = new Date().toLocaleDateString("es-DO", { year:"numeric", month:"long", day:"numeric" });

  // Captura visual del módulo activo
  var viewCapture = captureCurrentView();

  // Resumen tabular de datos base
  var dipBase    = nivel === "dip" ? simular(ctx, { nivel:"dip", year: isProy ? 2028 : 2024 }) : null;
  var dipCurRow  = function(p) { return nivel === "dip"
    ? "<td>" + ((dipBase && dipBase.curules && dipBase.curules.totalByParty && dipBase.curules.totalByParty[p]) || 0) + "</td>" : ""; };
  var dipCurTh   = nivel === "dip" ? "<th>Cur.</th>" : "";

  var simSection = "";
  if (simResult) {
    var sr = simResult;
    simSection = "<h2>Escenario Simulado</h2>" +
      "<table><tr><th>Emitidos</th><td>" + fmtInt(sr.emitidos) + "</td>" +
      "<th>Participación</th><td>" + fmtPct(sr.participacion) + "</td></tr></table>" +
      "<table><tr><th>Partido</th><th>Votos</th><th>%</th>" +
      (nivel === "dip" ? "<th>Curules</th>" : "") + "</tr>" +
      sr.ranked.slice(0, 12).map(function(row) {
        return "<tr><td>" + row.p + "</td><td>" + fmtInt(row.v) + "</td><td>" + fmtPct(row.pct) + "</td>" +
          (nivel === "dip" ? "<td>" + ((sr.curules && sr.curules.totalByParty && sr.curules.totalByParty[row.p]) || 0) + "</td>" : "") +
          "</tr>";
      }).join("") + "</table>";
  }

  var html = "<!doctype html>\n<html lang=\"es\"><head>\n<meta charset=\"utf-8\">\n" +
    "<title>SIE 2028 — " + (NIVEL_LABEL[nivel] || nivel) + " — " + now + "</title>\n" +
    "<style>\n" +
    "* { box-sizing:border-box; margin:0; padding:0; }\n" +
    "body { font-family:Arial,sans-serif; font-size:10pt; color:#111; padding:15mm; }\n" +
    "h1 { font-size:16pt; color:#0d2a6e; margin-bottom:3pt; }\n" +
    "h2 { font-size:12pt; color:#0d2a6e; border-bottom:1pt solid #bbb; padding-bottom:3pt; margin:12pt 0 6pt; }\n" +
    "h3 { font-size:11pt; color:#0d2a6e; margin:10pt 0 4pt; }\n" +
    "p  { margin-bottom:5pt; font-size:9.5pt; }\n" +
    "table { width:100%; border-collapse:collapse; margin-bottom:8pt; font-size:9.5pt; }\n" +
    "th { background:#0d2a6e; color:#fff; padding:3pt 5pt; text-align:left; }\n" +
    "td { padding:2.5pt 5pt; border-bottom:1pt solid #e0e0e0; }\n" +
    "tr:nth-child(even) td { background:#f4f6fb; }\n" +
    ".meta { font-size:8.5pt; color:#555; margin-bottom:10pt; }\n" +
    ".ok  { color:#165a29; }\n" +
    ".err { color:#721c24; }\n" +
    ".card { border:1pt solid #e0e0e0; border-radius:4pt; padding:8pt; margin-bottom:8pt; }\n" +
    ".kpi { display:inline-block; border:1pt solid #ccd; border-radius:3pt; padding:4pt 8pt; margin:2pt; }\n" +
    ".kpi .t { font-size:8pt; color:#666; }\n" +
    ".kpi .v { font-size:12pt; font-weight:bold; color:#0d2a6e; }\n" +
    ".met-box, .met-body { display:block; font-size:8pt; color:#555; margin-top:4pt; }\n" +
    ".badge, .cat-badge { padding:1pt 4pt; border-radius:2pt; font-size:8pt; }\n" +
    "svg { max-width:100%; height:auto; page-break-inside:avoid; }\n" +
    "button, input, select, .seg-group, .btn-sm { display:none !important; }\n" +
    ".footer { margin-top:15pt; font-size:7.5pt; color:#999; border-top:1pt solid #ddd; padding-top:4pt; }\n" +
    "@media print { body { padding:10mm; } @page { margin:10mm; } }\n" +
    "</style>\n</head><body>\n" +
    "<h1>SIE 2028 · Sistema Inteligente Electoral</h1>\n" +
    "<p class=\"meta\">Nivel: <b>" + (NIVEL_LABEL[nivel] || nivel) + "</b> &nbsp;·&nbsp; " +
    "Corte: <b>" + (CORTE_LABEL[corte] || corte) + "</b> &nbsp;·&nbsp; " +
    "Generado: <b>" + now + "</b></p>\n" +

    "<h2>Vista Actual — " + (NIVEL_LABEL[nivel] || nivel) + "</h2>\n" +
    "<div class=\"view-capture\">" + viewCapture + "</div>\n" +

    simSection +

    "<h2>Auditoría de Datos</h2>\n" +
    "<p><span class=\"ok\">✓ " + audit.resumen.correctos + " validaciones OK</span> &nbsp;&nbsp; " +
    "<span class=\"err\">⚠ " + audit.resumen.errores + " alertas</span></p>\n" +
    (audit.issues.length ? "<ul>" + audit.issues.map(function(i) { return "<li>" + i.msg + "</li>"; }).join("") + "</ul>\n" : "") +

    "<div class=\"footer\">SIE 2028 · Sistema Inteligente Electoral · " + now + " · Datos: JCE 2024</div>\n" +
    "<script>window.onload=function(){setTimeout(function(){window.print();},400);};<\/script>\n" +
    "</body></html>";

  var win = window.open("", "_blank");
  if (!win) {
    alert("Habilita ventanas emergentes para exportar PDF.");
    return;
  }
  win.document.write(html);
  win.document.close();
}
