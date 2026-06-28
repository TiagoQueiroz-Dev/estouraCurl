// =====================================================
// server.js  (Opcao A — API somente leitura)
// Serve os arquivos de dados/<slug>.json produzidos pelo worker
// (node index.js --watch), calcula o frescor de cada coleta e
// expoe via HTTP com documentacao Swagger em /docs.
//
// NAO abre navegador e NAO altera os demais arquivos do projeto.
//
// Uso:
//   node server.js
//   PORT=8080 DADOS_DIR=./dados node server.js
// =====================================================
import express from "express";
import swaggerUi from "swagger-ui-express";
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openapi } from "./openapi.js";
import {
  criarJob,
  listarJobs,
  obterJob,
  cancelarJob,
  encerrarTodos,
  MAX_JOBS,
} from "./workers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const DADOS_DIR = process.env.DADOS_DIR
  ? process.env.DADOS_DIR
  : join(__dirname, "dados");

// Token de acesso: env API_TOKEN > arquivo .api-token > gera um novo.
const TOKEN_FILE = join(__dirname, ".api-token");
function resolverToken() {
  if (process.env.API_TOKEN) return process.env.API_TOKEN.trim();
  if (existsSync(TOKEN_FILE)) {
    const t = readFileSync(TOKEN_FILE, "utf8").trim();
    if (t) return t;
  }
  const novo = randomBytes(24).toString("hex");
  writeFileSync(TOKEN_FILE, novo, "utf8");
  return novo;
}
const API_TOKEN = resolverToken();

const FIM = /^(Encerrad|Final|Após|Finalizad)/i;
const AO_VIVO = /(Ao vivo|Intervalo)/i;
const LIMITE_DEFASADO = 90; // segundos sem atualizar => "defasado"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slugValido = (s) => /^[a-z0-9-]+$/.test(s);

/** Lista os slugs disponiveis (arquivos .json em DADOS_DIR). */
function listarSlugs() {
  if (!existsSync(DADOS_DIR)) return [];
  return readdirSync(DADOS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5));
}

/** Le e faz parse de um slug, tolerante a leitura durante a escrita. */
async function lerJogo(slug) {
  const caminho = join(DADOS_DIR, slug + ".json");
  if (!existsSync(caminho)) return null;
  let ultimoErro;
  for (let i = 0; i < 3; i++) {
    try {
      const jogo = JSON.parse(readFileSync(caminho, "utf8"));
      return { slug, ...jogo, frescor: frescor(jogo) };
    } catch (e) {
      ultimoErro = e; // pode ter pego o arquivo no meio de uma escrita
      await sleep(60);
    }
  }
  throw ultimoErro;
}

/** Calcula o estado/idade da ultima coleta. */
function frescor(jogo) {
  const t = jogo.coletadoEm ? Date.parse(jogo.coletadoEm) : NaN;
  const idadeSegundos = Number.isNaN(t)
    ? null
    : Math.max(0, Math.round((Date.now() - t) / 1000));
  const status = jogo.status || "";
  const encerrado = FIM.test(status);
  const vivo = AO_VIVO.test(status);
  const fresco = idadeSegundos != null && idadeSegundos < LIMITE_DEFASADO;
  return {
    coletadoEm: jogo.coletadoEm ?? null,
    idadeSegundos,
    aoVivo: vivo && fresco && !encerrado,
    defasado: vivo && !fresco && !encerrado,
    encerrado,
  };
}

// Valida nomes de time (letras, numeros, espaco, acento, hifen, ponto, apostrofo).
const nomeValido = (s) =>
  typeof s === "string" && /^[\p{L}\p{N} .'-]{1,40}$/u.test(s.trim());

// ---- App ----
const app = express();
app.use(express.json());

// CORS liberado (facilita integracao de front-ends).
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type,X-Api-Token");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Autenticacao: exige o header X-Api-Token em TODAS as rotas, exceto a
// documentacao (Swagger UI e a spec), para a doc poder carregar no browser.
app.use((req, res, next) => {
  if (req.path === "/openapi.json" || req.path === "/docs" || req.path.startsWith("/docs/"))
    return next();
  if (req.get("X-Api-Token") === API_TOKEN) return next();
  res.status(401).json({ erro: "Nao autorizado: header X-Api-Token ausente ou invalido" });
});

// Documentacao Swagger
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapi));
app.get("/openapi.json", (_req, res) => res.json(openapi));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", dadosDir: DADOS_DIR, jogos: listarSlugs().length });
});

// Lista as partidas. Por padrao esconde as ENCERRADAS; use ?todos=true
// para incluir tambem os jogos ja finalizados.
app.get("/jogos", async (req, res) => {
  const todos = req.query.todos === "true" || req.query.todos === "1";
  const out = [];
  for (const slug of listarSlugs()) {
    try {
      const j = await lerJogo(slug);
      if (!j) continue;
      if (!todos && j.frescor?.encerrado) continue; // esconde jogos encerrados
      out.push({
        slug: j.slug,
        titulo: j.titulo ?? null,
        status: j.status ?? null,
        minuto: j.minuto ?? null,
        placar: j.placar ?? null,
        frescor: j.frescor,
      });
    } catch {
      /* arquivo ilegivel no momento: ignora nesta listagem */
    }
  }
  res.json(out);
});

// Sobe um worker para analisar UM jogo. Body: { mandante, visitante }.
app.post("/jogos", (req, res) => {
  const { mandante, visitante } = req.body || {};
  if (!nomeValido(mandante) || !nomeValido(visitante))
    return res.status(400).json({
      erro: "Informe 'mandante' e 'visitante' validos (ex.: { \"mandante\": \"Colombia\", \"visitante\": \"Portugal\" })",
    });
  try {
    const { job, reaproveitado } = criarJob(mandante.trim(), visitante.trim());
    res.status(reaproveitado ? 200 : 202).json({ reaproveitado, ...job });
  } catch (e) {
    if (e.code === "LIMITE")
      return res.status(429).json({ erro: e.message, limite: MAX_JOBS });
    res.status(500).json({ erro: e.message });
  }
});

// Gerenciamento de jobs (workers). Por padrao lista so os ATIVOS;
// use ?todos=true para incluir os finalizados/cancelados/expirados.
app.get("/jobs", (req, res) => {
  const todos = req.query.todos === "true" || req.query.todos === "1";
  res.json(listarJobs({ todos }));
});

app.get("/jobs/:id", (req, res) => {
  const j = obterJob(req.params.id);
  if (!j) return res.status(404).json({ erro: "Job nao encontrado", id: req.params.id });
  res.json(j);
});

app.delete("/jobs/:id", (req, res) => {
  const j = cancelarJob(req.params.id);
  if (!j) return res.status(404).json({ erro: "Job nao encontrado", id: req.params.id });
  res.json(j);
});

app.get("/jogos/:slug", async (req, res) => {
  const { slug } = req.params;
  if (!slugValido(slug))
    return res.status(400).json({ erro: "slug invalido", slug });
  try {
    const jogo = await lerJogo(slug);
    if (!jogo) return res.status(404).json({ erro: "Partida nao encontrada", slug });
    res.json(jogo);
  } catch {
    res.status(503).json({ erro: "Dados temporariamente indisponiveis", slug });
  }
});

app.get("/jogos/:slug/escalacoes", async (req, res) => {
  const { slug } = req.params;
  if (!slugValido(slug))
    return res.status(400).json({ erro: "slug invalido", slug });
  try {
    const jogo = await lerJogo(slug);
    if (!jogo) return res.status(404).json({ erro: "Partida nao encontrada", slug });
    res.json(jogo.escalacoes ?? []);
  } catch {
    res.status(503).json({ erro: "Dados temporariamente indisponiveis", slug });
  }
});

const server = app.listen(PORT, () => {
  console.log(`🌐  API no ar em http://localhost:${PORT}`);
  console.log(`📚  Swagger:    http://localhost:${PORT}/docs`);
  console.log(`📁  Lendo dados de: ${DADOS_DIR}`);
  console.log(`🔑  X-Api-Token: ${API_TOKEN}`);
  console.log(`⚙️   Max workers simultaneos: ${MAX_JOBS}` +
    (process.env.WORKER_PREFIX ? ` | prefixo: "${process.env.WORKER_PREFIX}"` : ""));
});

// Encerra os workers junto com a API.
function desligar() {
  console.log("\n⏹  Encerrando workers...");
  encerrarTodos();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGINT", desligar);
process.on("SIGTERM", desligar);
