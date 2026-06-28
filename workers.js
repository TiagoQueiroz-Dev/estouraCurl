// =====================================================
// workers.js  (arquivo novo)
// Gerenciador de jobs: cada job sobe UM worker (worker-multi.js com um
// unico jogo) num processo proprio, com perfil de Chrome isolado.
// O worker encerra sozinho quando o jogo acaba -> o job vira
// "finalizado". Tambem ha cancelamento manual e TTL de seguranca.
//
// Nao usa dependencia externa (so child_process nativo).
// =====================================================
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MAX_JOBS = Number(process.env.MAX_JOBS) || 3; // workers simultaneos
const TTL_MIN = Number(process.env.JOB_TTL_MIN) || 240; // mata orfaos (jogo que nunca comeca)
const PRUNE_MIN = Number(process.env.JOB_PRUNE_MIN) || 15; // remove jobs terminados da memoria
const PREFIX = (process.env.WORKER_PREFIX || "").trim(); // ex.: "xvfb-run -a" na VM Linux

const jobs = new Map(); // id -> job
let contador = 0;

const TERMINAIS = new Set(["finalizado", "cancelado", "expirado", "erro"]);
const ativo = (j) => !TERMINAIS.has(j.status);

/** Remove da memoria jobs terminados ha mais de PRUNE_MIN minutos. */
function podar() {
  const limite = Date.now() - PRUNE_MIN * 60000;
  for (const [id, j] of jobs)
    if (TERMINAIS.has(j.status) && j.finishedAt && Date.parse(j.finishedAt) < limite)
      jobs.delete(id);
}

function slug(s) {
  return (s || "partida")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const ativos = () =>
  [...jobs.values()].filter((j) => j.status === "rodando").length;

/** Apenas os campos publicos do job (sem o handle do processo). */
function publico(j) {
  return {
    id: j.id,
    query: j.query,
    slug: j.slug, // slug derivado da busca (usado no perfil/dedup)
    dataSlug: j.dataSlug, // slug real do arquivo em dados/ (do titulo do Google)
    status: j.status, // rodando | finalizado | cancelado | expirado | erro
    pid: j.pid ?? null,
    exitCode: j.exitCode,
    erro: j.erro ?? null,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
  };
}

/** Monta o comando do worker (com prefixo xvfb-run opcional). */
function montarComando(query) {
  const script = join(__dirname, "worker-multi.js");
  if (PREFIX) {
    const p = PREFIX.split(/\s+/);
    return { cmd: p[0], args: [...p.slice(1), process.execPath, script, query] };
  }
  return { cmd: process.execPath, args: [script, query] };
}

/** Mata a arvore de processos do worker (inclui o Chrome). */
function matarArvore(job) {
  const child = job._child;
  if (!child || child.killed) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
    } else {
      process.kill(-child.pid, "SIGTERM"); // grupo (spawn detached)
    }
  } catch {
    /* ja morreu */
  }
}

/** Cria (ou reaproveita) um job para a partida mandante x visitante. */
function criarJob(mandante, visitante) {
  podar();
  const query = `${mandante} x ${visitante}`.trim();
  const s = slug(query);

  // Dedup: se ja existe um worker rodando para esse jogo, reaproveita.
  for (const j of jobs.values())
    if (j.slug === s && j.status === "rodando")
      return { job: publico(j), reaproveitado: true };

  if (ativos() >= MAX_JOBS) {
    const e = new Error(`limite de ${MAX_JOBS} workers simultaneos atingido`);
    e.code = "LIMITE";
    throw e;
  }

  const id = `${Date.now().toString(36)}-${++contador}`;
  const { cmd, args } = montarComando(query);
  const child = spawn(cmd, args, {
    cwd: __dirname,
    env: process.env,
    detached: process.platform !== "win32", // grupo proprio p/ kill em arvore no Linux
  });

  const job = {
    id,
    query,
    slug: s,
    dataSlug: null,
    status: "rodando",
    pid: child.pid,
    exitCode: null,
    erro: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    _child: child,
    _ttl: null,
  };
  jobs.set(id, job);

  // Eco dos logs do worker, prefixado, e descoberta do slug real do arquivo.
  child.stdout?.on("data", (buf) => {
    const txt = buf.toString();
    process.stdout.write(`[job ${id}] ${txt}`);
    const m = txt.match(/salvo em .*[\\/]([a-z0-9-]+)\.json/i);
    if (m && !job.dataSlug) job.dataSlug = m[1];
  });
  child.stderr?.on("data", (buf) => process.stderr.write(`[job ${id}] ${buf}`));

  child.on("error", (e) => {
    job.status = "erro";
    job.erro = e.message;
    job.finishedAt = new Date().toISOString();
  });

  child.on("exit", (code) => {
    if (job._ttl) clearTimeout(job._ttl);
    if (job.status === "rodando") job.status = "finalizado"; // saiu sozinho (fim do jogo)
    job.exitCode = code;
    job.finishedAt = job.finishedAt || new Date().toISOString();
  });

  // TTL de seguranca: mata worker que nunca termina (jogo que nao comeca).
  job._ttl = setTimeout(() => {
    if (job.status === "rodando") {
      job.status = "expirado";
      matarArvore(job);
    }
  }, TTL_MIN * 60000);

  return { job: publico(job), reaproveitado: false };
}

/** Lista jobs. Por padrao apenas os ATIVOS (esconde os terminados). */
function listarJobs({ todos = false } = {}) {
  podar();
  return [...jobs.values()].filter((j) => todos || ativo(j)).map(publico);
}

function obterJob(id) {
  const j = jobs.get(id);
  return j ? publico(j) : null;
}

/** Cancela (mata) um job em execucao. */
function cancelarJob(id) {
  const j = jobs.get(id);
  if (!j) return null;
  if (j.status === "rodando") {
    j.status = "cancelado";
    j.finishedAt = new Date().toISOString();
    matarArvore(j);
  }
  return publico(j);
}

/** Encerra todos os workers (usar no shutdown da API). */
function encerrarTodos() {
  for (const j of jobs.values())
    if (j.status === "rodando") {
      j.status = "cancelado";
      matarArvore(j);
    }
}

export {
  criarJob,
  listarJobs,
  obterJob,
  cancelarJob,
  encerrarTodos,
  MAX_JOBS,
};
