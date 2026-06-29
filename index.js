// =====================================================
// index.js
// Abre o Chrome (visivel), busca no Google pelos jogos da Copa,
// abre a visao imersiva da partida e INTERCEPTA a resposta de rede
// que contem o JSON "match_fullpage" do widget de esportes. Em
// seguida usa o parser para extrair placar, escalacoes, estatisticas
// e transmissao.
//
// IMPORTANTE: rode com o navegador VISIVEL (padrao). Em modo headless
// o Google detecta automacao e mostra CAPTCHA ("trafego incomum").
//
// Uso:
//   node index.js "colombia x portugal"      # uma partida especifica
//   node index.js "africa do sul x canada"
//   node index.js --watch=30 "brasil x ..."  # re-coleta a cada 30s
//   node index.js --json "mexico x equador"  # imprime apenas JSON
// =====================================================
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { parseMatch, extractMatchFullpage } from "./parser.js";
import { extrairJogoDoDom } from "./google-dom.js";
import { diffEventos } from "./eventos.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- Argumentos de linha de comando ----
const args = process.argv.slice(2);
const flags = new Map();
const positional = [];
for (const a of args) {
  if (a.startsWith("--")) {
    const [k, v] = a.slice(2).split("=");
    flags.set(k, v === undefined ? true : v);
  } else {
    positional.push(a);
  }
}

const query = positional.join(" ") || "copa do mundo ao vivo";
const headless = flags.has("headless"); // NAO recomendado (CAPTCHA)
const watchSeconds = flags.has("watch") ? Number(flags.get("watch")) || 30 : 0;
const passoMs = (Number(flags.get("timeout")) || 12) * 1000;
const asJson = flags.has("json");
const competicao = flags.get("comp") || "/m/030q7"; // Copa do Mundo
const outArg = flags.has("out") ? flags.get("out") : null; // caminho do JSON
const semSalvar = flags.has("no-save"); // desliga a gravacao

const log = (...a) => !asJson && console.log(...a);

async function main() {
  log(`\n🔎  Buscando no Google por: "${query}"`);
  log(`    (Chrome ${headless ? "headless ⚠️ pode dar CAPTCHA" : "visivel"})\n`);

  const context = await chromium.launchPersistentContext(
    join(__dirname, ".perfil-chrome"),
    {
      channel: "chrome",
      headless,
      locale: "pt-BR",
      timezoneId: "America/Sao_Paulo",
      args: ["--disable-blink-features=AutomationControlled"],
    }
  );
  const page = context.pages()[0] || (await context.newPage());

  // Captura: guarda a ULTIMA resposta do Google que contenha match_fullpage,
  // com um numero de sequencia. O consumidor compara a sequencia para saber
  // se chegou algo novo (assim nenhuma atualizacao do polling e perdida).
  let ultima = null;
  let ultimaEscalacaoHtml = null;
  let seq = 0;
  page.on("response", async (response) => {
    try {
      const url = response.url();
      if (!/google\.[a-z.]+\//.test(url)) return;
      const text = await response.text();
      if (/\/async\/lr_mt_fp/.test(url) && text.includes("lrvl-fr")) {
        ultimaEscalacaoHtml = text;
      }
      const obj = extractMatchFullpage(text);
      if (obj) ultima = { obj, url, seq: ++seq };
    } catch {
      /* respostas binarias/opacas: ignora */
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

  // Aguarda chegar uma captura com seq > desde, ate o timeout. Retorna a
  // captura nova ou null.
  const aguardar = async (desde, ms) => {
    const ate = Date.now() + ms;
    while (Date.now() < ate) {
      if (ultima && ultima.seq > desde) return ultima;
      await sleep(500);
    }
    return null;
  };

  // 1) Busca normal — para jogo ao vivo o match_fullpage costuma vir direto.
  await buscar(query);
  await aceitarConsentimento(page);
  let captura = await aguardar(0, passoMs);

  // 2) Se nao veio, abre a visao imersiva (fullpage) que dispara o async.
  //    Tenta resumo (ms), estatisticas (dt) e escalacoes (ln). Em jogos
  //    encerrados o Google pode renderizar os dados so no DOM.
  let fragImersivo = ""; // ultimo fragmento usado (para recarregar no watch)
  if (!captura) {
    const gid = await extrairGid(page);
    if (gid) {
      for (const aba of ["ms", "dt", "ln"]) {
        if (captura) break;
        const nomeAba = aba === "ln" ? "escalacoes" : aba === "dt" ? "estatisticas" : "resumo";
        log(`🖼   Abrindo visao imersiva (${nomeAba}) — ${gid}...`);
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

  // Snapshot inicial (estado completo) + baseline para o diff de eventos.
  let jogoAnt = null;
  let ultSeq = 0;
  const jogoDom = captura ? null : await extrairJogoDoDom(page, ultimaEscalacaoHtml);
  if (captura) {
    jogoAnt = parseMatch(captura.obj);
    ultSeq = captura.seq;
    emitir({ jogo: jogoAnt, url: captura.url });
  } else if (jogoDom) {
    jogoAnt = jogoDom;
    emitir({ jogo: jogoAnt, url: page.url() });
  } else {
    erroSemCaptura();
    if (!watchSeconds) {
      await context.close();
      process.exit(2);
    }
    log("⌛  Watch ativo: aguardando o widget aparecer (jogo pode nao ter comecado)...");
  }

  // 3) Modo watch: mantem a pagina aberta e, a cada atualizacao do Google
  //    (polling ~30s), loga SO os eventos que mudaram (gol, cartao, escanteio,
  //    substituicao, status). O JSON e atualizado silenciosamente a cada
  //    coleta. Para sozinho quando a partida termina; Ctrl+C tambem encerra.
  if (watchSeconds) {
    log(`\n🔁  Acompanhando ao vivo — eventos serao logados conforme acontecem. Ctrl+C para sair.\n`);
    const fimRegex = /^(Encerrad|Final|Após|Finalizad)/i;
    if (jogoAnt && fimRegex.test(jogoAnt.status || "")) {
      log(`\n🏁  Partida encerrada (${jogoAnt.status}).`);
      await context.close();
      return;
    }
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const novo = await aguardar(ultSeq, Math.max(watchSeconds, 30) * 1000 + 15000);
      if (novo) {
        ultSeq = novo.seq;
        const jogo = parseMatch(novo.obj);
        salvar(jogo); // mantem o JSON sempre atualizado (silencioso)

        if (!jogoAnt) {
          // Primeira captura no watch (tinha comecado sem dados): snapshot.
          emitir({ jogo, url: novo.url });
        } else {
          const eventos = diffEventos(jogoAnt, jogo);
          if (eventos.length) logarEventos(jogo, eventos);
        }
        jogoAnt = jogo;

        if (fimRegex.test(jogo.status || "")) {
          log(`\n🏁  Partida encerrada (${jogo.status}).`);
          break;
        }
      } else {
        // Nada novo no intervalo: recarrega para reativar o polling.
        if (fragImersivo) await buscar(query, fragImersivo).catch(() => {});
        else await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});

        const jogoDomAtual = await extrairJogoDoDom(page, ultimaEscalacaoHtml);
        if (jogoDomAtual) {
          salvar(jogoDomAtual);
          if (!jogoAnt) emitir({ jogo: jogoDomAtual, url: page.url() });
          else {
            const eventos = diffEventos(jogoAnt, jogoDomAtual);
            if (eventos.length) logarEventos(jogoDomAtual, eventos);
          }
          jogoAnt = jogoDomAtual;
          if (fimRegex.test(jogoDomAtual.status || "")) {
            log(`\n🏁  Partida encerrada (${jogoDomAtual.status}).`);
            break;
          }
        }
      }
    }
  }

  await context.close();
}

/** Extrai o id da entidade da partida (/g/...) do HTML da pagina. */
async function extrairGid(page) {
  try {
    return await page.evaluate(() => {
      const html = document.documentElement.outerHTML;
      const ids = html.match(/\/g\/[0-9a-z_]{6,}/g) || [];
      return ids.length ? ids[0] : null;
    });
  } catch {
    return null;
  }
}

function erroSemCaptura() {
  console.error(
    "\n❌  Nao capturei o widget de esportes (match_fullpage).\n" +
      "    Causas comuns:\n" +
      "      • A partida nao esta AO VIVO (a resposta limpa match_fullpage\n" +
      "        so e servida durante jogos ao vivo).\n" +
      "      • O Google nao exibiu o widget para essa busca.\n" +
      "      • Modo headless disparou CAPTCHA (use o modo visivel).\n" +
      '    Dica: rode durante um jogo ao vivo, ex.: node index.js "time A x time B"\n'
  );
}

/** Gera um nome de arquivo seguro a partir do titulo da partida. */
function slug(s) {
  return (s || "partida")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Salva o objeto completo da partida (inclui escalacoes) em JSON. */
function salvar(jogo) {
  if (semSalvar) return null;
  const caminho = outArg
    ? (outArg.endsWith(".json") ? outArg : join(outArg, slug(jogo.titulo) + ".json"))
    : join(__dirname, "dados", slug(jogo.titulo) + ".json");
  const dir = dirname(caminho);
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* ja existe */
  }
  const conteudo = { coletadoEm: new Date().toISOString(), ...jogo };
  writeFileSync(caminho, JSON.stringify(conteudo, null, 2), "utf8");
  return caminho;
}

/** Imprime os eventos no log (texto) ou como JSON (modo --json). */
function logarEventos(jogo, eventos) {
  const ts = new Date().toLocaleTimeString("pt-BR");
  const min = jogo.minuto ? ` · ${jogo.minuto}` : "";
  if (asJson) {
    console.log(
      JSON.stringify({ ts: new Date().toISOString(), minuto: jogo.minuto, eventos })
    );
    return;
  }
  for (const e of eventos) console.log(`[${ts}${min}]  ${e}`);
}

function emitir({ jogo, url }) {
  const arquivo = salvar(jogo);
  if (asJson) {
    console.log(JSON.stringify(jogo, null, 2));
    if (arquivo) console.error("💾  Salvo em: " + arquivo);
    return;
  }
  const ts = new Date().toLocaleTimeString("pt-BR");
  const m = jogo.mandante || {};
  const v = jogo.visitante || {};
  console.log("=".repeat(64));
  console.log(`[${ts}]  ${jogo.titulo || "Partida"}`);
  console.log(
    `   ${jogo.competicao || ""}${jogo.fase ? "  •  " + jogo.fase : ""}`
  );
  console.log(
    `   ${m.nome ?? "?"} ${m.placar ?? "?"}  x  ${v.placar ?? "?"} ${v.nome ?? "?"}` +
      `   [${jogo.status || "?"}${jogo.minuto ? " " + jogo.minuto : ""}]`
  );
  if (jogo.local)
    console.log(`   🏟   ${jogo.local.estadio ?? ""} — ${jogo.local.cidade ?? ""}`);
  if (jogo.probabilidade) {
    const p = jogo.probabilidade;
    console.log(
      `   📊  Prob: ${p.casa.time} ${p.casa.chance}%  | Empate ${p.empate.chance}%  | ${p.visitante.time} ${p.visitante.chance}%`
    );
  }
  if (jogo.estatisticas.length) {
    console.log("   📈  Estatisticas (casa | fora):");
    for (const e of jogo.estatisticas)
      console.log(`        ${e.nome.padEnd(20)} ${String(e.casa).padStart(5)} | ${e.fora}`);
  }
  if (jogo.transmissao.length) {
    console.log("   📺  Transmissao:");
    for (const t of jogo.transmissao)
      console.log(`        ${t.nome} (${t.preco ?? ""}) -> ${t.url ?? ""}`);
  }
  for (const esc of jogo.escalacoes) {
    console.log(`   👥  ${esc.time} (${esc.formacao || "?"}) — ${esc.jogadores.length} jogadores`);
    for (const j of esc.jogadores)
      console.log(`        ${String("#" + j.numero).padStart(4)}  ${j.nome.padEnd(22)} ${j.posicao ?? ""}`);
  }
  if (arquivo) console.log(`   💾  Salvo em: ${arquivo}`);
  console.log("=".repeat(64));
}

/** Tenta aceitar o aviso de cookies/consentimento do Google, se aparecer. */
async function aceitarConsentimento(page) {
  const textos = ["Aceitar tudo", "Aceito", "Accept all", "I agree", "Concordo"];
  for (const t of textos) {
    try {
      const botao = page.getByRole("button", { name: t });
      if (await botao.first().isVisible({ timeout: 1200 })) {
        await botao.first().click({ timeout: 2000 });
        await page.waitForLoadState("domcontentloaded");
        return;
      }
    } catch {
      /* nao apareceu */
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

main().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});
