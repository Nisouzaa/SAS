/**
 * SAS Analytics Platform — index.js
 * Orquestrador principal: executa o SAS, processa os resultados e serve o dashboard.
 *
 * Fluxo:
 *  1. Gera / recebe CSV de entrada
 *  2. Chama SAS Studio via CLI (sas -sysin) ou REST API (Viya)
 *  3. Lê os CSVs de saída gerados pelo SAS
 *  4. Transforma e consolida os dados (transform.js)
 *  5. Calcula estatísticas adicionais em JS (stats.js)
 *  6. Gera relatório JSON + HTML (report.js)
 *  7. Serve o dashboard web (Express)
 */

"use strict";

const path    = require("path"); 
const fs      = require("fs");
const express = require("express");

const { runSAS }         = require("./sasRunner");
const { transformData }  = require("./transforms");
const { computeStats }   = require("./stats");
const { generateReport } = require("../report/report");
const { generateDemoCSV } = require("./transforms"); 

// ── Configuração ──────────────────────────────────────────────────────────────

const CONFIG = {
  port:        process.env.PORT || 3000,
  sasScript:   path.resolve(__dirname, "../sas/analysis.sas"),
  dataDir:     path.resolve(__dirname, "../data"),
  outputDir:   path.resolve(__dirname, "../report"),
  publicDir:   path.resolve(__dirname, "../public"),

  // Modo de conexão com SAS: "cli" (SAS local) | "rest" (SAS Viya REST API)
  sasMode:     process.env.SAS_MODE || "cli",

  // SAS Viya REST (usado quando sasMode === "rest")
  sasViya: {
    baseUrl:    process.env.SAS_VIYA_URL    || "https://your-viya-server.com",
    token:      process.env.SAS_VIYA_TOKEN  || "",
    contextName: process.env.SAS_CONTEXT   || "SAS Studio compute context",
  },

  // SAS CLI local
  sasCli: {
    executable: process.env.SAS_EXEC || "C:\\Program Files\\SASHome\\SASFoundation\\9.4\\sas.exe",
    config:     process.env.SAS_CFG  || "",
  },
};


// ── Utilitários ───────────────────────────────────────────────────────────────

function ensureDirs() {
  [CONFIG.dataDir, CONFIG.outputDir, CONFIG.publicDir].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

function log(level, msg, extra = {}) {
  const entry = { ts: new Date().toISOString(), level, msg, ...extra };
  console.log(JSON.stringify(entry));
}

// ── Pipeline principal ────────────────────────────────────────────────────────

async function runPipeline(inputCsvPath) {
  log("info", "Pipeline iniciado", { input: inputCsvPath });

  // 1. Copia / valida CSV de entrada para a pasta /data
  const destInput = path.join(CONFIG.dataDir, "input_data.csv");
  if (inputCsvPath && inputCsvPath !== destInput) {
    fs.copyFileSync(inputCsvPath, destInput);
    log("info", "CSV de entrada copiado", { dest: destInput });
  }

  // 2. Executa SAS
  log("info", "Executando SAS...", { mode: CONFIG.sasMode });
  const sasResult = await runSAS(CONFIG);
  if (!sasResult.success) {
    throw new Error(`SAS falhou: ${sasResult.error}`);
  }
  log("info", "SAS concluído", { duration: sasResult.durationMs + "ms" });

  // 3. Lê CSVs de saída do SAS
  const outputFiles = {
    stats:      path.join(CONFIG.outputDir, "stats_summary.csv"),
    freqCateg:  path.join(CONFIG.outputDir, "freq_categ.csv"),
    freqRegiao: path.join(CONFIG.outputDir, "freq_categ_regiao.csv"),
    timeSeries: path.join(CONFIG.outputDir, "time_series.csv"),
    regression: path.join(CONFIG.outputDir, "regression_output.csv"),
  };

  // 4. Transforma
  const transformed = await transformData(outputFiles);
  log("info", "Transformação concluída", { datasets: Object.keys(transformed) });

  // 5. Estatísticas adicionais JS
  const stats = computeStats(transformed);
  log("info", "Estatísticas calculadas");

  // 6. Gera relatório
  const reportPath = await generateReport({ transformed, stats, outputDir: CONFIG.outputDir });
  log("info", "Relatório gerado", { path: reportPath });

  return { transformed, stats, reportPath };
}

// ── Express — Dashboard Web ───────────────────────────────────────────────────

function startServer(initialData = null) {
  const app = express();

  app.use(express.json());
  app.use(express.static(CONFIG.publicDir));
  app.use("/reports", express.static(CONFIG.outputDir));

  // API: status
  app.get("/api/status", (_req, res) => {
    res.json({ status: "ok", ts: new Date().toISOString() });
  });

  // API: disparar pipeline com upload de CSV
  app.post("/api/run", async (req, res) => {
    try {
      const { inputPath } = req.body;
      const result = await runPipeline(inputPath || null);
      res.json({ success: true, stats: result.stats.summary });
    } catch (err) {
      log("error", "Erro no pipeline", { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // API: retorna dados consolidados para o dashboard
  app.get("/api/data", (_req, res) => {
    const dataFile = path.join(CONFIG.outputDir, "consolidated.json");
    if (!fs.existsSync(dataFile)) {
      return res.status(404).json({ error: "Nenhum dado processado ainda." });
    }
    res.sendFile(dataFile);
  });

  // API: download do relatório HTML do SAS
  app.get("/api/report/html", (_req, res) => {
    const f = path.join(CONFIG.outputDir, "sas_report.html");
    if (!fs.existsSync(f)) return res.status(404).json({ error: "Relatório não encontrado." });
    res.download(f);
  });

  // API: download do relatório JSON gerado pelo Node
  app.get("/api/report/json", (_req, res) => {
    const f = path.join(CONFIG.outputDir, "report.json");
    if (!fs.existsSync(f)) return res.status(404).json({ error: "Relatório não encontrado." });
    res.sendFile(f);
  });

  app.listen(CONFIG.port, () => {
    log("info", `Dashboard disponível em http://localhost:${CONFIG.port}`);
  });

  return app;
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

(async () => {
  try {
    ensureDirs();

    // Se há CSV de entrada via argumento, executa pipeline imediatamente
    const inputArg = process.argv[2];
    let pipelineData = null;

    if (inputArg) {
      log("info", "Executando pipeline com arquivo de entrada", { file: inputArg });
      pipelineData = await runPipeline(path.resolve(inputArg));
    } else {
      log("info", "Nenhum CSV fornecido. Aguardando via /api/run ou iniciando demo...");

      // Demo: gera CSV sintético se não houver dados
      const demoInput = path.join(CONFIG.dataDir, "input_data.csv");
      if (!fs.existsSync(demoInput)) {
        const { generateDemoCSV } = require("./transforms");
        generateDemoCSV(demoInput);
        log("info", "CSV demo gerado", { path: demoInput });
      }
    }

    startServer(pipelineData);
  } catch (err) {
    log("error", "Falha crítica na inicialização", { error: err.message });
    process.exit(1);
  }
})();

module.exports = {
  transformData,
  generateDemoCSV
};
