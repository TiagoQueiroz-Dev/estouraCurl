// =====================================================
// parser.js
// Mapeia o JSON aninhado do widget de esportes do Google
// (objeto "match_fullpage") para um objeto limpo e legivel.
//
// O Google entrega os dados como arrays gigantes indexados por
// posicao (sem chaves). Em vez de depender de caminhos fixos e
// frageis, usamos uma busca por "marcos" (landmarks) reconheciveis
// dentro da estrutura sempre que possivel. Ainda assim, esses
// indices podem mudar quando o Google alterar o layout.
// =====================================================

// ---- Utilitarios de navegacao na arvore ----

/** Percorre recursivamente (DFS) todos os nos chamando visit(node).
 * Visita inclusive folhas primitivas (strings/numeros) para que a
 * busca por strings funcione. */
function walk(node, visit) {
  visit(node);
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
  } else if (node && typeof node === "object") {
    for (const key of Object.keys(node)) walk(node[key], visit);
  }
}

/** Retorna o primeiro no (em ordem DFS) que satisfaca o predicado. */
function findFirst(root, predicate) {
  let found;
  try {
    walk(root, (node) => {
      if (found !== undefined) return;
      if (predicate(node)) found = node;
    });
  } catch {
    /* ignora */
  }
  return found;
}

/** Retorna o primeiro valor string (em ordem DFS) que case com a regex. */
function findString(root, regex) {
  let found;
  walk(root, (node) => {
    if (found !== undefined) return;
    if (typeof node === "string" && regex.test(node)) found = node;
  });
  return found;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const COD3 = /^[A-Z]{3}$/;

// ---- Extratores especificos ----

/**
 * Um "bloco de time" da selecao tem [0] = info do time
 * (["Selecao X","NomeCurto","COD",...]) e contem em algum ponto
 * a cor hex do time; o placar fica logo antes da cor.
 */
function isTeamBlock(node) {
  return (
    Array.isArray(node) &&
    Array.isArray(node[0]) &&
    typeof node[0][2] === "string" &&
    COD3.test(node[0][2]) &&
    node.some((x) => typeof x === "string" && HEX.test(x))
  );
}

function extractTeam(block) {
  if (!isTeamBlock(block)) return null;
  const info = block[0];
  const colorIdx = block.findIndex((x) => typeof x === "string" && HEX.test(x));
  const placar = colorIdx > 0 ? block[colorIdx - 1] : null;
  const cor = colorIdx >= 0 ? block[colorIdx] : null;
  const logo = block.find(
    (x) => typeof x === "string" && x.includes(".png") && x.includes("/")
  );
  return {
    nome: info[1] ?? info[0] ?? null,
    sigla: info[2] ?? null,
    placar: placar ?? null,
    cor: cor ?? null,
    logo: logo ? (logo.startsWith("//") ? "https:" + logo : logo) : null,
  };
}

function extractTeams(mf) {
  const blocks = [];
  walk(mf, (node) => {
    if (blocks.length >= 2) return;
    if (isTeamBlock(node)) blocks.push(node);
  });
  return blocks.map(extractTeam);
}

/** Tabela de estatisticas: linhas como ["Chutes","17","11",...]. */
function extractEstatisticas(mf) {
  const STAT_LABELS = ["Chutes", "Posse de bola", "Passes", "Faltas"];
  const tbl = findFirst(mf, (n) => {
    if (!Array.isArray(n) || !Array.isArray(n[1])) return false;
    const rows = n[1];
    if (rows.length < 4) return false;
    const allRows = rows.every(
      (r) =>
        Array.isArray(r) &&
        typeof r[0] === "string" &&
        typeof r[1] === "string" &&
        typeof r[2] === "string"
    );
    return allRows && rows.some((r) => STAT_LABELS.includes(r[0]));
  });
  if (!tbl) return [];
  return tbl[1].map((r) => ({ nome: r[0], casa: r[1], fora: r[2] }));
}

/** Opcoes de transmissao (streaming). */
function extractTransmissao(mf) {
  const opt = findFirst(
    mf,
    (n) => Array.isArray(n) && n[0] === "Opções de streaming" && Array.isArray(n[1])
  );
  if (!opt) return [];
  return opt[1]
    .filter((p) => Array.isArray(p) && typeof p[0] === "string")
    .map((p) => ({
      nome: p[0],
      url: typeof p[1] === "string" ? p[1] : null,
      preco: typeof p[6] === "string" ? p[6] : null,
    }));
}

/** Local da partida: array que contem o marcador "Local:". */
function extractLocal(mf) {
  const v = findFirst(
    mf,
    (n) =>
      Array.isArray(n) &&
      n.includes("Local:") &&
      Array.isArray(n[0]) &&
      Array.isArray(n[1])
  );
  if (!v) return null;
  return {
    estadio: typeof v[0][0] === "string" ? v[0][0] : null,
    cidade: typeof v[1][0] === "string" ? v[1][0] : null,
  };
}

/** Probabilidade de vitoria ao vivo. */
function extractProbabilidade(mf) {
  const p = findFirst(
    mf,
    (n) => Array.isArray(n) && n[1] === "Probabilidade de vitória ao vivo"
  );
  if (!p || !Array.isArray(p[0]) || !Array.isArray(p[0][0])) return null;
  const valores = p[0][0]; // ex.: ["24","38","38"]
  const label = (x) => (Array.isArray(x) ? x[0] : null);
  return {
    casa: { time: label(p[4]), chance: valores[0] ?? null },
    visitante: { time: label(p[5]), chance: valores[1] ?? null },
    empate: { time: label(p[6]), chance: valores[2] ?? null },
  };
}

/** Escalacoes (titulares + reservas) de cada time, quando disponiveis. */
function extractEscalacoes(mf) {
  // Cada formacao aparece como ["Time","4-1-2-3","//logo.png","#cor",[ ...jogadores... ]]
  const formacoes = [];
  walk(mf, (n) => {
    if (
      Array.isArray(n) &&
      typeof n[0] === "string" &&
      typeof n[1] === "string" &&
      /^\d(-\d){1,3}$/.test(n[1]) &&
      typeof n[2] === "string" &&
      n[2].includes(".png") &&
      Array.isArray(n[4])
    ) {
      formacoes.push(n);
    }
  });

  const nomeJogador = (playerInfo) =>
    Array.isArray(playerInfo) && typeof playerInfo[0] === "string"
      ? playerInfo[0]
      : null;

  return formacoes.map((f) => {
    const jogadores = [];
    // f[4] e uma arvore com os jogadores; cada jogador tem um sub-array cujo
    // [0] e a info ["Nome",...] e ha um numero da camisa em string.
    walk(f[4], (node) => {
      if (
        Array.isArray(node) &&
        Array.isArray(node[0]) &&
        typeof node[0][0] === "string" &&
        typeof node[6] === "string" && // posicao (ex.: "Goleiro")
        typeof node[3] === "string" // numero da camisa
      ) {
        const nome = nomeJogador(node[0]);
        if (nome && !jogadores.some((j) => j.nome === nome && j.numero === node[3])) {
          jogadores.push({ nome, numero: node[3], posicao: node[6] });
        }
      }
    });
    return { time: f[0], formacao: f[1], jogadores };
  });
}

// ---- Funcao principal ----

/**
 * Recebe o objeto completo { match_fullpage: [...] } e devolve um
 * resumo limpo da partida.
 */
function parseMatch(raw) {
  const mf = raw && raw.match_fullpage ? raw.match_fullpage : raw;
  if (!Array.isArray(mf)) throw new Error("Estrutura match_fullpage invalida");

  const titulo =
    (Array.isArray(mf[0]) && typeof mf[0][0] === "string" && mf[0][0]) ||
    findString(mf, /.+ x .+/i) ||
    null;

  const [mandante, visitante] = extractTeams(mf);

  const status =
    findString(mf, /^(Ao vivo|Encerrado|Encerrada|Intervalo|Adiado|Agendado)$/i) ||
    (findFirst(mf, (n) => Array.isArray(n) && n.includes("Live")) ? "Ao vivo" : null);

  const minuto = findString(mf, /^\d{1,3}'$/) || null;
  const dataIso = findString(mf, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/) || null;

  const competicao =
    findString(mf, /Copa do Mundo da FIFA[^"]*/) ||
    findString(mf, /^Copa do Mundo$/) ||
    null;

  const fase =
    findString(mf, /Fase de grupos\s*·\s*Grupo/) ||
    findString(mf, /Fase de grupos/) ||
    null;

  return {
    titulo,
    competicao,
    fase,
    status,
    minuto,
    data: dataIso,
    local: extractLocal(mf),
    mandante,
    visitante,
    placar:
      mandante && visitante
        ? `${mandante.nome} ${mandante.placar ?? "?"} x ${
            visitante.placar ?? "?"
          } ${visitante.nome}`
        : null,
    probabilidade: extractProbabilidade(mf),
    estatisticas: extractEstatisticas(mf),
    transmissao: extractTransmissao(mf),
    escalacoes: extractEscalacoes(mf),
  };
}

/**
 * Extrai o objeto {match_fullpage:...} de um texto bruto de resposta
 * de rede. Lida com o prefixo anti-XSSI do Google ( )]}' ) e tambem
 * com o JSON embutido em HTML/JS da pagina.
 */
function extractMatchFullpage(text) {
  if (typeof text !== "string" || !text.includes("match_fullpage")) return null;

  let t = text.trim();
  if (t.startsWith(")]}'")) t = t.slice(4).trim();

  // 1) Resposta async "pura": ja e o JSON inteiro.
  try {
    const obj = JSON.parse(t);
    if (obj && obj.match_fullpage) return obj;
  } catch {
    /* segue para extracao embutida */
  }

  // 2) JSON embutido: localiza {"match_fullpage" e faz extracao balanceada.
  const key = '{"match_fullpage"';
  const start = text.indexOf(key);
  if (start < 0) return null;

  const json = extractBalanced(text, start);
  if (!json) return null;
  try {
    const obj = JSON.parse(json);
    if (obj && obj.match_fullpage) return obj;
  } catch {
    /* nao foi possivel */
  }
  return null;
}

/** Extrai uma substring de objeto JSON balanceado a partir de startIdx (em "{"). */
function extractBalanced(text, startIdx) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(startIdx, i + 1);
    }
  }
  return null;
}

export { parseMatch, extractMatchFullpage, extractBalanced };
