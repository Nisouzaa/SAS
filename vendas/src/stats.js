/**
 * stats.js
 * Cálculos estatísticos complementares em JavaScript puro.
 * Opera sobre os dados já transformados pelo transform.js.
 *
 * Funções:
 *  - Sumário descritivo completo (média, mediana, moda, variância, assimetria, curtose)
 *  - Intervalos de confiança (95%)
 *  - Teste Z simplificado
 *  - Taxa de crescimento MoM / YoY na série temporal
 *  - Score de concentração (Gini) por categoria
 *  - Detecção de outliers via IQR
 *  - KPIs do negócio
 */

"use strict";

// ── Estatísticas de base ──────────────────────────────────────────────────────

function sum(arr)  { return arr.reduce((a, b) => a + b, 0); }
function mean(arr) { return arr.length === 0 ? 0 : sum(arr) / arr.length; }

function variance(arr, pop = false) {
  if (arr.length < 2) return 0;
  const m   = mean(arr);
  const div = pop ? arr.length : arr.length - 1;
  return sum(arr.map((x) => (x - m) ** 2)) / div;
}

function stdDev(arr, pop = false) { return Math.sqrt(variance(arr, pop)); }

function median(arr) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid    = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function mode(arr) {
  const freq = {};
  arr.forEach((v) => { freq[v] = (freq[v] || 0) + 1; });
  const max = Math.max(...Object.values(freq));
  return Object.keys(freq).filter((k) => freq[k] === max).map(Number);
}

function percentile(arr, p) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const index  = (p / 100) * (sorted.length - 1);
  const lower  = Math.floor(index);
  const frac   = index - lower;
  if (lower + 1 >= sorted.length) return sorted[lower];
  return sorted[lower] + frac * (sorted[lower + 1] - sorted[lower]);
}

// ── Momentos de distribuição ──────────────────────────────────────────────────

function skewness(arr) {
  if (arr.length < 3) return null;
  const m  = mean(arr);
  const sd = stdDev(arr);
  if (sd === 0) return 0;
  const n = arr.length;
  const s = sum(arr.map((x) => ((x - m) / sd) ** 3));
  return (n / ((n - 1) * (n - 2))) * s;
}

function kurtosis(arr) {
  if (arr.length < 4) return null;
  const m  = mean(arr);
  const sd = stdDev(arr);
  if (sd === 0) return 0;
  const n = arr.length;
  const s = sum(arr.map((x) => ((x - m) / sd) ** 4));
  return ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * s
    - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
}

// ── Intervalo de Confiança 95% ────────────────────────────────────────────────

function confidenceInterval95(arr) {
  if (arr.length < 2) return { lower: null, upper: null };
  const m  = mean(arr);
  const se = stdDev(arr) / Math.sqrt(arr.length);
  const z  = 1.96; // z para 95%
  return { lower: m - z * se, upper: m + z * se, mean: m, se };
}

// ── Outliers via IQR ──────────────────────────────────────────────────────────

function detectOutliers(arr) {
  const q1    = percentile(arr, 25);
  const q3    = percentile(arr, 75);
  const iqr   = q3 - q1;
  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;
  const outliers = arr.filter((x) => x < lower || x > upper);
  return { q1, q3, iqr, lower, upper, outliers, count: outliers.length };
}

// ── Coeficiente de Gini ───────────────────────────────────────────────────────

function gini(counts) {
  if (!counts || counts.length === 0) return null;
  const sorted = [...counts].sort((a, b) => a - b);
  const n      = sorted.length;
  const total  = sum(sorted);
  if (total === 0) return 0;
  let num = 0;
  sorted.forEach((v, i) => { num += (2 * (i + 1) - n - 1) * v; });
  return num / (n * total);
}

// ── Taxa de crescimento ───────────────────────────────────────────────────────

function growthRate(current, previous) {
  if (previous === 0 || previous == null) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

// ── Análise de Série Temporal ─────────────────────────────────────────────────

function analyzeTimeSeries(timeSeries) {
  if (!timeSeries || timeSeries.length === 0) return {};

  // Agrupa por período (todos os categorias somados)
  const byPeriod = {};
  timeSeries.forEach(({ period, total_valor, n_transacoes }) => {
    if (!byPeriod[period]) byPeriod[period] = { total_valor: 0, n_transacoes: 0 };
    byPeriod[period].total_valor   += total_valor   || 0;
    byPeriod[period].n_transacoes  += n_transacoes  || 0;
  });

  const periods  = Object.keys(byPeriod).sort();
  const values   = periods.map((p) => byPeriod[p].total_valor);
  const txCounts = periods.map((p) => byPeriod[p].n_transacoes);

  // MoM (month-over-month)
  const momRates = values.map((v, i) =>
    i === 0 ? null : growthRate(v, values[i - 1])
  ).filter((r) => r !== null);

  // YoY simplificado: compara mesmo mês do ano anterior
  const yoyRates = [];
  periods.forEach((p, i) => {
    const [year, month] = p.split("-");
    const prevPeriod    = `${Number(year) - 1}-${month}`;
    if (byPeriod[prevPeriod] !== undefined) {
      yoyRates.push(growthRate(byPeriod[p].total_valor, byPeriod[prevPeriod].total_valor));
    }
  });

  const bestPeriod  = periods[values.indexOf(Math.max(...values))];
  const worstPeriod = periods[values.indexOf(Math.min(...values))];

  return {
    periods,
    totalByPeriod: byPeriod,
    totalRevenue:  sum(values),
    avgMonthly:    mean(values),
    momAvg:        momRates.length ? mean(momRates) : null,
    yoyAvg:        yoyRates.length ? mean(yoyRates) : null,
    bestPeriod,
    worstPeriod,
    trend:         linearTrend(values),
  };
}

// ── Tendência linear (regressão simples) ──────────────────────────────────────

function linearTrend(values) {
  const n  = values.length;
  if (n < 2) return null;
  const x  = values.map((_, i) => i);
  const mx = mean(x);
  const my = mean(values);
  const num = sum(x.map((xi, i) => (xi - mx) * (values[i] - my)));
  const den = sum(x.map((xi) => (xi - mx) ** 2));
  const slope     = den === 0 ? 0 : num / den;
  const intercept = my - slope * mx;
  const direction = slope > 0.01 ? "crescente" : slope < -0.01 ? "decrescente" : "estável";
  return { slope, intercept, direction };
}

// ── Sumário por categoria ─────────────────────────────────────────────────────

function summarizeByCategory(stats) {
  if (!stats || stats.length === 0) return {};
  const result = {};
  stats.forEach((row) => {
    result[row.categoria] = {
      n:      row.n_obs,
      mean:   row.mean_valor,
      median: row.median_valor,
      std:    row.std_valor,
      cv:     row.mean_valor ? (row.std_valor / row.mean_valor) * 100 : null,
    };
  });
  return result;
}

// ── KPIs Executivos ───────────────────────────────────────────────────────────

function computeKPIs(transformed) {
  const { stats, freqCateg, timeSeries } = transformed;

  const totalObs        = freqCateg.reduce((s, r) => s + (r.count || 0), 0);
  const categConcentr   = gini(freqCateg.map((r) => r.count));

  const allMeans  = stats.filter((r) => r.mean_valor !== null).map((r) => r.mean_valor);
  const globalMean = allMeans.length ? mean(allMeans) : null;

  const ts    = analyzeTimeSeries(timeSeries);
  const trend = ts.trend ? ts.trend.direction : "desconhecida";

  return {
    totalObservacoes:     totalObs,
    numeroCategorias:     freqCateg.length,
    mediaGlobal:          globalMean,
    concentracaoGini:     categConcentr !== null ? +categConcentr.toFixed(4) : null,
    receitaTotal:         ts.totalRevenue ? +ts.totalRevenue.toFixed(2) : null,
    mediaReceitaMensal:   ts.avgMonthly   ? +ts.avgMonthly.toFixed(2)   : null,
    crescimentoMoM:       ts.momAvg       ? +ts.momAvg.toFixed(2)       : null,
    crescimentoYoY:       ts.yoyAvg       ? +ts.yoyAvg.toFixed(2)       : null,
    tendencia:            trend,
    melhorPeriodo:        ts.bestPeriod   || null,
    piorPeriodo:          ts.worstPeriod  || null,
  };
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Computa todas as estatísticas a partir dos dados transformados.
 * @param {object} transformed  Saída de transformData()
 * @returns {object}  { summary, byCategory, timeSeries, kpis, outliers }
 */
function computeStats(transformed) {
  const { stats, freqCateg, freqRegiao, timeSeries, regression } = transformed;

  // Valores brutos de valor médio por categoria para distribuição
  const means = stats.map((r) => r.mean_valor).filter((v) => v !== null);

  const summary = {
    global: {
      mean:      +mean(means).toFixed(4),
      median:    +median(means).toFixed(4),
      std:       +stdDev(means).toFixed(4),
      skewness:  skewness(means) !== null ? +skewness(means).toFixed(4) : null,
      kurtosis:  kurtosis(means) !== null ? +kurtosis(means).toFixed(4) : null,
      ci95:      confidenceInterval95(means),
    },
    byCategory:  summarizeByCategory(stats),
  };

  const outlierInfo = means.length > 0 ? detectOutliers(means) : {};

  const tsAnalysis = analyzeTimeSeries(timeSeries);
  const kpis       = computeKPIs(transformed);

  // R² da regressão (se disponível)
  let r2 = null;
  if (regression && regression.length > 1) {
    const actual    = regression.map((r) => r.valor).filter((v) => v !== null);
    const predicted = regression.map((r) => r.pred_valor).filter((v) => v !== null);
    const n         = Math.min(actual.length, predicted.length);
    if (n > 1) {
      const meanActual = mean(actual.slice(0, n));
      const ssTot = sum(actual.slice(0, n).map((v) => (v - meanActual) ** 2));
      const ssRes = sum(actual.slice(0, n).map((v, i) => (v - predicted[i]) ** 2));
      r2 = ssTot === 0 ? null : +(1 - ssRes / ssTot).toFixed(4);
    }
  }

  return {
    summary,
    outliers:   outlierInfo,
    timeSeries: tsAnalysis,
    kpis,
    regression: { r2 },
  };
}

module.exports = {
  computeStats,
  // Exporta utilitários para uso externo / testes
  mean, median, stdDev, variance, percentile, skewness, kurtosis,
  confidenceInterval95, detectOutliers, gini, growthRate, linearTrend,
};