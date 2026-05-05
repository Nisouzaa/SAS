/**
 * sasRunner.js
 * Adaptador de execução do SAS: suporta CLI local (SAS 9.4) e REST (SAS Viya).
 */

"use strict";

const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");
const https = require("https");
const http = require("http");

// ── CLI — SAS 9.4 local ───────────────────────────────────────────────────────

function runSasCLI(config) {
  return new Promise((resolve) => {
    const start = Date.now();
    const logFile = path.join(config.outputDir, "sas_execution.log");

    const args = [
      "-sysin",
      config.sasScript,
      "-log",
      logFile,
      "-print",
      path.join(config.outputDir, "sas_print.lst"),
      "-nosplash",
      "-nologo",
    ];

    if (config.sasCli.config) {
      args.push("-config", config.sasCli.config);
    }

    execFile(
      config.sasCli.executable,
      args,
      { timeout: 120_000 },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - start;

        let sasLog = "";
        try {
          sasLog = fs.readFileSync(logFile, "utf8");
        } catch (_) {}

        // Se houve erro no processo OU no log SAS
        if (error || /^ERROR/m.test(sasLog)) {
          const match = sasLog.match(/^ERROR.*/m);
          return resolve({
            success: false,
            error: match ? match[0] : error?.message || "Erro ao executar SAS",
            durationMs,
            log: sasLog,
          });
        }

        // 🔥 NOVO: valida arquivos esperados
        const expectedFiles = [
          "stats_summary.csv",
          "freq_categ.csv",
          "freq_categ_regiao.csv",
          "time_series.csv",
          "regression_output.csv",
        ];

        const missing = expectedFiles.filter(
          (f) => !fs.existsSync(path.join(config.outputDir, f)),
        );

        if (missing.length > 0) {
          return resolve({
            success: false,
            error: "SAS não gerou arquivos: " + missing.join(", "),
            durationMs,
            log: sasLog,
          });
        }

        resolve({ success: true, durationMs });
      },
    );
  });
}

// ── REST — SAS Viya ───────────────────────────────────────────────────────────

async function runSasViya(config) {
  const start = Date.now();
  const { baseUrl, token, contextName } = config.sasViya;
  const sasCode = fs.readFileSync(config.sasScript, "utf8");

  // 1. Cria sessão de computação
  const session = await viyaRequest({
    baseUrl,
    token,
    method: "POST",
    path: "/compute/sessions",
    body: { version: 1, name: "sas-platform-session", context: contextName },
  });

  const sessionId = session.id;

  try {
    // 2. Submete o código SAS
    const job = await viyaRequest({
      baseUrl,
      token,
      method: "POST",
      path: `/compute/sessions/${sessionId}/jobs`,
      body: { version: 1, code: sasCode },
    });

    // 3. Aguarda conclusão (polling)
    const jobId = job.id;
    let state = "running";
    let attempts = 0;
    while (["running", "pending"].includes(state) && attempts < 120) {
      await sleep(2000);
      const status = await viyaRequest({
        baseUrl,
        token,
        method: "GET",
        path: `/compute/sessions/${sessionId}/jobs/${jobId}`,
      });
      state = status.state;
      attempts++;
    }

    if (state !== "completed") {
      throw new Error(`Job SAS Viya terminou com estado: ${state}`);
    }

    return { success: true, durationMs: Date.now() - start, state };
  } finally {
    // 4. Encerra a sessão
    await viyaRequest({
      baseUrl,
      token,
      method: "DELETE",
      path: `/compute/sessions/${sessionId}`,
    }).catch(() => {});
  }
}

// ── Utilitários HTTP ─────────────────────────────────────────────────────────

function viyaRequest({ baseUrl, token, method, path: urlPath, body }) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, baseUrl);
    const isHttps = url.protocol === "https:";
    const lib = isHttps ? https : http;
    const payload = body ? JSON.stringify(body) : undefined;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    };

    const req = lib.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        if (res.statusCode >= 400) {
          return reject(new Error(`Viya HTTP ${res.statusCode}: ${data}`));
        }
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (_) {
          resolve({});
        }
      });
    });

    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Exportação principal ──────────────────────────────────────────────────────

/**
 * Executa o SAS conforme o modo configurado.
 * @param {object} config  Configuração do index.js
 * @returns {Promise<{success: boolean, durationMs: number, error?: string}>}
 */
async function runSAS(config) {
  if (config.sasMode === "rest") {
    return runSasViya(config);
  }
  return runSasCLI(config);
}

module.exports = { runSAS };
