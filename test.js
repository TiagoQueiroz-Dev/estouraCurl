// Valida o parser offline usando uma resposta real do Google
// (salva em samples/). Rode com: npm test
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseMatch, extractMatchFullpage } from "./parser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(
  join(__dirname, "samples", "colombia-portugal.raw.txt"),
  "utf8"
);

const obj = extractMatchFullpage(raw);
if (!obj) {
  console.error("FALHOU: nao consegui extrair match_fullpage do sample");
  process.exit(1);
}

const jogo = parseMatch(obj);
console.log(JSON.stringify(jogo, null, 2));

// Verificacoes minimas
const checks = [
  ["titulo", jogo.titulo === "Colômbia x Portugal"],
  ["competicao", /Copa do Mundo da FIFA/.test(jogo.competicao || "")],
  ["fase", /Grupo K/.test(jogo.fase || "")],
  ["status", jogo.status === "Ao vivo"],
  ["minuto", jogo.minuto === "57'"],
  ["mandante", jogo.mandante?.nome === "Colômbia" && jogo.mandante?.sigla === "COL"],
  ["visitante", jogo.visitante?.nome === "Portugal" && jogo.visitante?.sigla === "POR"],
  ["local", jogo.local?.estadio === "Estádio de Miami"],
  ["estatisticas", jogo.estatisticas.some((e) => e.nome === "Chutes" && e.casa === "17")],
  ["transmissao", jogo.transmissao.some((t) => t.nome === "Cazé TV")],
  ["probabilidade", jogo.probabilidade?.casa?.chance === "24"],
  ["escalacoes", jogo.escalacoes.length >= 2],
  ["xi-completo", jogo.escalacoes.every((e) => e.jogadores.length === 11)],
  ["jogador-detalhe", jogo.escalacoes[0]?.jogadores.some(
    (j) => j.nome === "James Rodríguez" && j.numero === "10" && j.posicao === "Meio-campo"
  )],
];

let ok = true;
console.log("\n--- Verificacoes ---");
for (const [nome, passou] of checks) {
  console.log(`${passou ? "OK  " : "FALHOU"} ${nome}`);
  if (!passou) ok = false;
}

process.exit(ok ? 0 : 1);
