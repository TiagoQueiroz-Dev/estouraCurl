// =====================================================
// worker-multi.js  (arquivo novo — nao altera index/parser/eventos)
// Monitora VARIOS jogos ao mesmo tempo a partir da MESMA pasta, sem
// duplicar o projeto. Cada jogo usa um perfil de Chrome isolado
// (.perfil-<slug>), evitando o conflito de lock do perfil unico.
//
// Reaproveita parser.js (parseMatch/extractMatchFullpage) e
// eventos.js (diffEventos). Escreve em dados/<slug>.json — a MESMA
// API (server.js) continua servindo tudo.
//
// Uso:
//   node worker-multi.js "africa do sul x canada" "mexico x equador"
//   xvfb-run -a node worker-multi.js "time A x time B" "time C x time D"
//   node worker-multi.js --out=./dados --watch=30 "time A x time B"
// =====================================================
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { parseMatch, extractMatchFullpage } from "./parser.js";
import { extrairJogoDoDom } from "./google-dom.js";
import { diffEventos } from "./eventos.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- Argumentos ----
const flags = new Map();
const jogos = [];
for (const a of process.argv.slice(2)) {
  if (a.startsWith("--")) {
    const [k, v] = a.slice(2).split("=");
    flags.set(k, v === undefined ? true : v);
  } else {
    jogos.push(a);
  }
}
if (!jogos.length) {
  console.error('Uso: node worker-multi.js "time A x time B" ["time C x time D" ...]');
  process.exit(1);
}

const headless = flags.has("headless"); // NAO recomendado (CAPTCHA); use xvfb no Linux
const watchSeconds = Number(flags.get("watch")) || 30;
const passoMs = (Number(flags.get("timeout")) || 12) * 1000;
const competicao = flags.get("comp") || "/m/030q7"; // Copa do Mundo
const outArg = flags.has("out") ? flags.get("out") : null;
const semSalvar = flags.has("no-save");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function slug(s) {
  return (s || "partida")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function salvar(jogo) {
  if (semSalvar) return null;
  const caminho = outArg
    ? outArg.endsWith(".json")
      ? outArg
      : join(outArg, slug(jogo.titulo) + ".json")
    : join(__dirname, "dados", slug(jogo.titulo) + ".json");
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(
    caminho,
    JSON.stringify({ coletadoEm: new Date().toISOString(), ...jogo }, null, 2),
    "utf8"
  );
  return caminho;
}

const hora = () => new Date().toLocaleTimeString("pt-BR");
const logJ = (tag, msg) => console.log(`[${hora()}] (${tag}) ${msg}`);

function snapshot(tag, jogo, arq) {
  const m = jogo.mandante || {}, v = jogo.visitante || {};
  logJ(
    tag,
    `${jogo.titulo || "Partida"} — ${m.nome ?? "?"} ${m.placar ?? "?"} x ` +
      `${v.placar ?? "?"} ${v.nome ?? "?"} [${jogo.status || "?"}` +
      `${jogo.minuto ? " " + jogo.minuto : ""}]`
  );
  for (const esc of jogo.escalacoes || [])
    logJ(tag, `escalacao ${esc.time} (${esc.formacao || "?"}) — ${esc.jogadores.length} jogadores`);
  if (arq) logJ(tag, `💾 salvo em ${arq}`);
}

// ---- Monitora um jogo (independente, perfil isolado) ----
async function monitorarJogo(query) {
  const tag = slug(query);
  const perfil = join(__dirname, ".perfil-" + tag);

  const context = await chromium.launchPersistentContext(perfil, {
    channel: "chrome",
    headless,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = context.pages()[0] || (await context.newPage());

  let ultima = null;
  let ultimaEscalacaoHtml = null;
  let seq = 0;
  page.on("response", async (r) => {
    try {
      const url = r.url();
      if (!/google\.[a-z.]+\//.test(url)) return;
      const text = await r.text();
      if (/\/async\/lr_mt_fp/.test(url) && text.includes("lrvl-fr")) {
        ultimaEscalacaoHtml = text;
      }
      const obj = extractMatchFullpage(text);
      if (obj) ultima = { obj, url, seq: ++seq };
    } catch {
      /* ignora respostas binarias/opacas */
    }
  });

  const buscar = (q, frag = "") =>
    page.goto(
      "https://www.google.com/search?hl=pt-BR&gl=BR" +
        (frag ? "&fbx=worldcup" : "") +
        "&q=" +
        encodeURIComponent(q) +
        frag,
      { waitUntil: "domcontentloaded", timeout: 60000 }
    );

  const aguardar = async (desde, ms) => {
    const ate = Date.now() + ms;
    while (Date.now() < ate) {
      if (ultima && ultima.seq > desde) return ultima;
      await sleep(500);
    }
    return null;
  };

  const extrairGid = async () => {
    try {
      return await page.evaluate(() => {
        const ids = document.documentElement.outerHTML.match(/\/g\/[0-9a-z_]{6,}/g) || [];
        return ids[0] || null;
      });
    } catch {
      return null;
    }
  };

  const aceitarConsentimento = async () => {
    for (const t of ["Aceitar tudo", "Aceito", "Accept all", "I agree", "Concordo"]) {
      try {
        const b = page.getByRole("button", { name: t });
        if (await b.first().isVisible({ timeout: 1200 })) {
          await b.first().click({ timeout: 2000 });
          await page.waitForLoadState("domcontentloaded");
          return;
        }
      } catch {
        /* nao apareceu */
      }
    }
  };

  logJ(tag, `iniciando — perfil ${perfil}`);
  await buscar(query);
  await aceitarConsentimento();
  let captura = await aguardar(0, passoMs);

  let fragImersivo = "";
  if (!captura) {
    const gid = await extrairGid();
    if (gid) {
      for (const aba of ["ms", "dt", "ln"]) {
        if (captura) break;
        const nomeAba = aba === "ln" ? "escalacoes" : aba === "dt" ? "estatisticas" : "resumo";
        logJ(tag, `abrindo visao imersiva (${nomeAba}) — ${gid}`);
        fragImersivo = `#sie=m;${gid};2;${competicao};${aba};fp;1;;;;-1${aba === "ln" ? "&slt=2" : ""}`;
        const esperarEscalacao =
          aba === "ln"
            ? page
                .waitForResponse((r) => {
                  const url = r.url();
                  return /\/async\/lr_mt_fp/.test(url) && /(tab:ln|tab%3Aln|\|ln\||%7Cln%7C)/.test(url);
                }, { timeout: passoMs + 6000 })
                .catch(() => null)
            : null;
        await buscar(query, fragImersivo);
        const respEscalacao = esperarEscalacao ? await esperarEscalacao : null;
        if (respEscalacao) {
          try {
            const text = await respEscalacao.text();
            if (text.includes("lrvl-fr")) ultimaEscalacaoHtml = text;
          } catch {
            /* segue com o DOM */
          }
        }
        captura = await aguardar(0, passoMs + 6000);
      }
    }
  }

  let jogoAnt = null;
  let ultSeq = 0;
  const fim = /^(Encerrad|Final|Após|Finalizad)/i;

  if (captura) {
    jogoAnt = parseMatch(captura.obj);
    ultSeq = captura.seq;
    snapshot(tag, jogoAnt, salvar(jogoAnt));
  } else {
    const jogoDom = await extrairJogoDoDom(page, ultimaEscalacaoHtml);
    if (jogoDom) {
      jogoAnt = jogoDom;
      snapshot(tag, jogoAnt, salvar(jogoAnt));
    }
  }

  if (jogoAnt && fim.test(jogoAnt.status || "")) {
    logJ(tag, `🏁 partida encerrada (${jogoAnt.status}).`);
    await context.close();
    logJ(tag, "worker encerrado.");
    return;
  }

  if (!jogoAnt) {
    logJ(tag, "aguardando o widget aparecer (jogo pode nao ter comecado)...");
  }

  // Loop: loga so os eventos que mudam; salva o JSON a cada coleta; para no fim.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const novo = await aguardar(ultSeq, Math.max(watchSeconds, 30) * 1000 + 15000);
    if (novo) {
      ultSeq = novo.seq;
      const jogo = parseMatch(novo.obj);
      const arq = salvar(jogo);
      if (!jogoAnt) {
        snapshot(tag, jogo, arq); // primeira captura (tinha comecado sem dados)
      } else {
        const eventos = diffEventos(jogoAnt, jogo);
        const pre = jogo.minuto ? `${jogo.minuto}  ` : "";
        for (const e of eventos) logJ(tag, pre + e);
      }
      jogoAnt = jogo;
      if (fim.test(jogo.status || "")) {
        logJ(tag, `🏁 partida encerrada (${jogo.status}).`);
        break;
      }
    } else {
      // Nada novo: recarrega para reativar o polling.
      if (fragImersivo) await buscar(query, fragImersivo).catch(() => {});
      else await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});

      const jogoDom = await extrairJogoDoDom(page, ultimaEscalacaoHtml);
      if (jogoDom) {
        const arq = salvar(jogoDom);
        if (!jogoAnt) {
          snapshot(tag, jogoDom, arq);
        } else {
          const eventos = diffEventos(jogoAnt, jogoDom);
          const pre = jogoDom.minuto ? `${jogoDom.minuto}  ` : "";
          for (const e of eventos) logJ(tag, pre + e);
        }
        jogoAnt = jogoDom;
        if (fim.test(jogoDom.status || "")) {
          logJ(tag, `🏁 partida encerrada (${jogoDom.status}).`);
          break;
        }
      }
    }
  }

  await context.close();
  logJ(tag, "worker encerrado.");
}

// ---- Main: roda todos os jogos em paralelo (perfis isolados) ----
console.log(`🎯  Monitorando ${jogos.length} jogo(s): ${jogos.join("  |  ")}`);
console.log(`    (Chrome ${headless ? "headless ⚠️" : "visivel/Xvfb"}, watch ${watchSeconds}s)\n`);

await Promise.all(
  jogos.map((q) =>
    monitorarJogo(q).catch((e) =>
      console.error(`(${slug(q)}) erro: ${e.message?.split("\n")[0] || e}`)
    )
  )
);

console.log("\n✅  Todos os workers encerraram.");
