/**
 * transforms.js
 * Lê os CSVs gerados pelo SAS, normaliza, valida e consolida em estruturas JS.
 * Também expõe generateDemoCSV() para modo de demonstração sem SAS.
 */

"use strict";

const fs   = require("fs");
const path = require("path");


// ── Parser CSV mínimo (sem dependências externas) ─────────────────────────────

/**
 * Converte texto CSV em array de objetos, respeitando aspas e vírgulas internas.
 */
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().split("\n");
  if (lines.length < 2) return [];

  const headers = splitCSVLine(lines[0]).map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));

  return lines.slice(1).map((line) => {
    const values = splitCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => {
      const raw = (values[i] || "").trim().replace(/^"|"$/g, "");
      obj[h] = raw === "" ? null : raw;
    });
    return obj;
  });
}

function splitCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ── Helpers de tipo ───────────────────────────────────────────────────────────

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return isNaN(n) ? null : n;
}

function toInt(v) {
  const n = toNum(v);
  return n === null ? null : Math.round(n);
}

// ── Transformações por dataset ────────────────────────────────────────────────

function transformStats(rows) {
  return rows.map((r) => ({
    categoria:    r.categoria || r._categoria_ || "N/A",
    n_obs:        toInt(r.n_obs),
    mean_valor:   toNum(r.mean_valor),
    median_valor: toNum(r.median_valor),
    std_valor:    toNum(r.std_valor),
  })).filter((r) => r.n_obs !== null);
}

function transformFreqCateg(rows) {
  return rows.map((r) => ({
    categoria:   r.categoria || "N/A",
    count:       toInt(r.count),
    percent:     toNum(r.percent),
  })).filter((r) => r.count > 0);
}

function transformFreqRegiao(rows) {
  return rows.map((r) => ({
    categoria: r.categoria || "N/A",
    regiao:    r.regiao    || "N/A",
    count:     toInt(r.count),
    percent:   toNum(r.percent),
  })).filter((r) => r.count > 0);
}

function transformTimeSeries(rows) {
  return rows
    .map((r) => ({
      ano:           toInt(r.ano),
      mes:           toInt(r.mes),
      categoria:     r.categoria || "N/A",
      n_transacoes:  toInt(r.n_transacoes),
      total_valor:   toNum(r.total_valor),
      media_valor:   toNum(r.media_valor),
      period:        r.ano && r.mes ? `${r.ano}-${String(toInt(r.mes)).padStart(2, "0")}` : null,
    }))
    .filter((r) => r.period !== null)
    .sort((a, b) => a.period.localeCompare(b.period));
}

function transformRegression(rows) {
  return rows
    .slice(0, 500) // limita para não sobrecarregar o JSON
    .map((r) => ({
      valor:       toNum(r.valor),
      pred_valor:  toNum(r.pred_valor),
      residuo:     toNum(r.residuo),
      log_valor:   toNum(r.log_valor),
    }))
    .filter((r) => r.valor !== null && r.pred_valor !== null);
}

// ── Leitura de arquivo CSV com fallback ───────────────────────────────────────

function readCSV(filePath, transformFn, label) {
  try {
    if (!fs.existsSync(filePath)) {
      console.warn(`[transform] Arquivo não encontrado: ${filePath} — usando array vazio para ${label}`);
      return [];
    }
    const text = fs.readFileSync(filePath, "utf8");
    const rows = parseCSV(text);
    return transformFn(rows);
  } catch (err) {
    console.error(`[transform] Erro ao processar ${label}:`, err.message);
    return [];
  }
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Lê todos os CSVs de saída do SAS e retorna objeto consolidado.
 * @param {object} files  Mapa { stats, freqCateg, freqRegiao, timeSeries, regression }
 */
async function transformData(files) {
  const transformed = {
    stats:      readCSV(files.stats,      transformStats,       "stats"),
    freqCateg:  readCSV(files.freqCateg,  transformFreqCateg,   "freqCateg"),
    freqRegiao: readCSV(files.freqRegiao, transformFreqRegiao,  "freqRegiao"),
    timeSeries: readCSV(files.timeSeries, transformTimeSeries,  "timeSeries"),
    regression: readCSV(files.regression, transformRegression,  "regression"),
  };

  // Grava JSON consolidado para o dashboard
  const outputDir = path.dirname(files.stats);
  fs.writeFileSync(
    path.join(outputDir, "consolidated.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), ...transformed }, null, 2),
    "utf8"
  );

  return transformed;
}

// ── Gerador de CSV demo (sem SAS) ─────────────────────────────────────────────

const CATEGORIAS = ["Varejo", "Industria", "Servicos", "Agronegocio", "Tecnologia"];
const REGIOES    = ["Sudeste", "Sul", "Nordeste", "Centro-Oeste", "Norte"];

function randBetween(min, max) { return min + Math.random() * (max - min); }
function randInt(min, max)     { return Math.floor(randBetween(min, max + 1)); }
function randChoice(arr)       { return arr[randInt(0, arr.length - 1)]; }

/**
 * Gera um CSV sintético para demonstração do pipeline sem SAS.
 */
function generateDemoCSV(outputPath, n = 2000) {
  const header = "id,valor,categoria,regiao,data_str\n";
  const rows = [];

  for (let i = 1; i <= n; i++) {
    const cat  = randChoice(CATEGORIAS);
    const base = { Varejo: 500, Industria: 8000, Servicos: 1200, Agronegocio: 4000, Tecnologia: 6000 }[cat];
    const valor = (base * randBetween(0.5, 2.0)).toFixed(2);

    const year  = randInt(2022, 2024);
    const month = String(randInt(1, 12)).padStart(2, "0");
    const day   = String(randInt(1, 28)).padStart(2, "0");

    rows.push([i, valor, cat, randChoice(REGIOES), `${year}-${month}-${day}`].join(","));
  }

  fs.writeFileSync(outputPath, header + rows.join("\n"), "utf8");
  console.log(`[transform] CSV demo gerado: ${outputPath} (${n} linhas)`);
}

module.exports = { transformData, generateDemoCSV, parseCSV };