/**
 * report.js
 * Gera relatório estruturado em JSON e página HTML executiva.
 * O JSON é consumido pelo dashboard; o HTML pode ser enviado por e-mail ou impresso.
 */

"use strict";

const fs   = require("fs");
const path = require("path");

// ── Formatadores ──────────────────────────────────────────────────────────────

function fmt(n, dec = 2) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Number(n).toLocaleString("pt-BR", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

function fmtPct(n) { return n !== null && !isNaN(n) ? `${fmt(n, 1)}%` : "—"; }
function fmtInt(n) { return n !== null && !isNaN(n) ? Number(n).toLocaleString("pt-BR") : "—"; }
function fmtBRL(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function now() { return new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }); }

// ── Geração do JSON de relatório ──────────────────────────────────────────────

function buildReportJSON({ transformed, stats, outputDir }) {
  const report = {
    meta: {
      title:       "SAS Analytics Platform — Relatório de Análise",
      generatedAt: new Date().toISOString(),
      version:     "1.0.0",
    },
    kpis:       stats.kpis,
    summary:    stats.summary,
    outliers:   stats.outliers,
    timeSeries: stats.timeSeries,
    regression: stats.regression,
    datasets: {
      stats:      transformed.stats,
      freqCateg:  transformed.freqCateg,
      freqRegiao: transformed.freqRegiao,
      timeSeries: transformed.timeSeries.slice(0, 200), // amostra para o JSON
    },
  };

  const jsonPath = path.join(outputDir, "report.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
  return jsonPath;
}

// ── Geração do HTML executivo ─────────────────────────────────────────────────

function buildKPICard(label, value, sub = "", accent = "#2563eb") {
  return `
  <div class="kpi-card">
    <div class="kpi-label">${label}</div>
    <div class="kpi-value" style="color:${accent}">${value}</div>
    ${sub ? `<div class="kpi-sub">${sub}</div>` : ""}
  </div>`;
}

function buildTable(headers, rows, caption = "") {
  const head = headers.map((h) => `<th>${h}</th>`).join("");
  const body = rows.map((r) =>
    `<tr>${r.map((c) => `<td>${c ?? "—"}</td>`).join("")}</tr>`
  ).join("");
  return `
  <div class="table-wrap">
    ${caption ? `<div class="table-caption">${caption}</div>` : ""}
    <table>
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>`;
}

function buildHTMLReport({ transformed, stats, outputDir }) {
  const k = stats.kpis;
  const s = stats.summary.global;

  /* KPI Cards */
  const tendenciaBadge = {
    crescente:  `<span class="badge badge-green">↑ Crescente</span>`,
    decrescente:`<span class="badge badge-red">↓ Decrescente</span>`,
    estável:    `<span class="badge badge-gray">→ Estável</span>`,
  }[k.tendencia] || k.tendencia;

  const kpiSection = `
  <section class="section">
    <h2>Indicadores Executivos (KPIs)</h2>
    <div class="kpi-grid">
      ${buildKPICard("Total de Observações",    fmtInt(k.totalObservacoes),  `${k.numeroCategorias} categorias`)}
      ${buildKPICard("Receita Total",           fmtBRL(k.receitaTotal),      "Período analisado", "#059669")}
      ${buildKPICard("Média Mensal",            fmtBRL(k.mediaReceitaMensal), "")}
      ${buildKPICard("Crescimento MoM",         fmtPct(k.crescimentoMoM),   "Mês a mês médio", k.crescimentoMoM >= 0 ? "#059669" : "#dc2626")}
      ${buildKPICard("Crescimento YoY",         fmtPct(k.crescimentoYoY),   "Ano a ano médio",  k.crescimentoYoY >= 0 ? "#059669" : "#dc2626")}
      ${buildKPICard("Tendência",               tendenciaBadge,             "")}
      ${buildKPICard("Gini (Concentração)",     fmt(k.concentracaoGini, 4), "0 = uniforme · 1 = concentrado")}
      ${buildKPICard("R² Regressão",            fmt(stats.regression.r2, 4), "Ajuste do modelo")}
    </div>
  </section>`;

  /* Estatísticas Descritivas */
  const statsRows = Object.entries(stats.summary.byCategory).map(([cat, v]) => [
    cat,
    fmtInt(v.n),
    fmtBRL(v.mean),
    fmtBRL(v.median),
    fmt(v.std),
    fmtPct(v.cv),
  ]);

  const statsTable = buildTable(
    ["Categoria", "N", "Média", "Mediana", "Desvio Padrão", "CV (%)"],
    statsRows,
    "Estatísticas Descritivas por Categoria"
  );

  /* Frequências */
  const freqRows = transformed.freqCateg.map((r) => [
    r.categoria,
    fmtInt(r.count),
    fmtPct(r.percent),
  ]);

  const freqTable = buildTable(
    ["Categoria", "Contagem", "% do Total"],
    freqRows,
    "Distribuição por Categoria"
  );

  /* Série Temporal (últimos 12 períodos) */
  const byPeriod = stats.timeSeries.totalByPeriod || {};
  const periods  = (stats.timeSeries.periods || []).slice(-12);
  const tsRows   = periods.map((p) => [
    p,
    fmtInt(byPeriod[p]?.n_transacoes),
    fmtBRL(byPeriod[p]?.total_valor),
  ]);

  const tsTable = buildTable(
    ["Período", "Transações", "Total"],
    tsRows,
    "Série Temporal — Últimos 12 Meses"
  );

  /* Outliers */
  const o = stats.outliers;
  const outlierSection = o && o.count != null ? `
  <section class="section">
    <h2>Análise de Outliers (IQR)</h2>
    <div class="kpi-grid small">
      ${buildKPICard("Q1",          fmt(o.q1))}
      ${buildKPICard("Q3",          fmt(o.q3))}
      ${buildKPICard("IQR",         fmt(o.iqr))}
      ${buildKPICard("Limite Inf.", fmt(o.lower))}
      ${buildKPICard("Limite Sup.", fmt(o.upper))}
      ${buildKPICard("Outliers",    fmtInt(o.count), "", o.count > 0 ? "#dc2626" : "#059669")}
    </div>
  </section>` : "";

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SAS Analytics Platform — Relatório</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', system-ui, sans-serif;
    background: #f8fafc; color: #1e293b;
    line-height: 1.6; padding: 2rem;
  }
  .header {
    background: linear-gradient(135deg, #1e3a8a, #2563eb);
    color: #fff; padding: 2.5rem 3rem; border-radius: 16px;
    margin-bottom: 2rem; display: flex; justify-content: space-between; align-items: flex-end;
  }
  .header h1 { font-size: 1.8rem; font-weight: 700; letter-spacing: -0.5px; }
  .header .meta { font-size: 0.85rem; opacity: 0.75; text-align: right; }
  .section { background: #fff; border-radius: 12px; padding: 1.75rem 2rem;
    margin-bottom: 1.5rem; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
  .section h2 { font-size: 1.1rem; font-weight: 600; margin-bottom: 1.25rem;
    padding-bottom: .6rem; border-bottom: 2px solid #e2e8f0; color: #1e293b; }
  .kpi-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px,1fr)); gap: 1rem; }
  .kpi-grid.small .kpi-card { padding: 1rem 1.25rem; }
  .kpi-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
    padding: 1.25rem 1.5rem; }
  .kpi-label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: .5px;
    color: #64748b; margin-bottom: .4rem; }
  .kpi-value { font-size: 1.4rem; font-weight: 700; color: #2563eb; }
  .kpi-sub   { font-size: 0.75rem; color: #94a3b8; margin-top: .3rem; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 20px;
    font-size: 0.8rem; font-weight: 600; }
  .badge-green { background: #dcfce7; color: #166534; }
  .badge-red   { background: #fee2e2; color: #991b1b; }
  .badge-gray  { background: #f1f5f9; color: #475569; }
  .table-wrap { overflow-x: auto; }
  .table-caption { font-size: 0.85rem; color: #64748b; margin-bottom: .6rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th { background: #f1f5f9; text-align: left; padding: .6rem .9rem;
    font-weight: 600; color: #475569; font-size: 0.8rem; white-space: nowrap; }
  td { padding: .55rem .9rem; border-top: 1px solid #f1f5f9; }
  tr:hover td { background: #f8fafc; }
  .footer { text-align: center; font-size: 0.8rem; color: #94a3b8; margin-top: 2rem; }
  @media print {
    body { padding: 1rem; background: #fff; }
    .header { background: #1e3a8a !important; -webkit-print-color-adjust: exact; }
  }
</style>
</head>
<body>

<div class="header">
  <div>
    <div style="font-size:.8rem;opacity:.7;margin-bottom:.3rem">SAS ANALYTICS PLATFORM</div>
    <h1>Relatório Executivo de Análise</h1>
  </div>
  <div class="meta">
    Gerado em:<br>${now()}<br><br>
    Melhor período: <strong>${k.melhorPeriodo || "—"}</strong><br>
    Pior período: <strong>${k.piorPeriodo || "—"}</strong>
  </div>
</div>

${kpiSection}

<section class="section">
  <h2>Estatísticas por Categoria</h2>
  ${statsTable}
</section>

<section class="section">
  <h2>Distribuição por Categoria</h2>
  ${freqTable}
</section>

<section class="section">
  <h2>Série Temporal</h2>
  ${tsTable}
</section>

${outlierSection}

<div class="footer">
  SAS Analytics Platform &nbsp;·&nbsp; Gerado automaticamente via Node.js + SAS Studio &nbsp;·&nbsp; ${now()}
</div>

</body>
</html>`;

  const htmlPath = path.join(outputDir, "report_node.html");
  fs.writeFileSync(htmlPath, html, "utf8");
  return htmlPath;
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Gera JSON e HTML de relatório.
 * @returns {Promise<string>}  Caminho do relatório HTML
 */
async function generateReport({ transformed, stats, outputDir }) {
  buildReportJSON({ transformed, stats, outputDir });
  const htmlPath = buildHTMLReport({ transformed, stats, outputDir });
  return htmlPath;
}

module.exports = { generateReport };