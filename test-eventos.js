// Valida a deteccao de eventos (diffEventos) sem rede.
// Rode: node test-eventos.js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseMatch, extractMatchFullpage } from "./parser.js";
import { diffEventos } from "./eventos.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(__dirname, "samples", "colombia-portugal.raw.txt"), "utf8");
const base = parseMatch(extractMatchFullpage(raw));

// clona profundo
const clone = (o) => JSON.parse(JSON.stringify(o));

// Cenario: a partir do estado base, simula varias alteracoes
const depois = clone(base);
depois.status = "Intervalo";
depois.mandante.placar = "1"; // gol da Colombia
const chutesAGol = depois.estatisticas.find((e) => e.nome === "Chutes a gol");
chutesAGol.casa = "6"; // era 5
const amarelos = depois.estatisticas.find((e) => e.nome === "Cartões amarelos");
amarelos.fora = "1"; // Portugal levou amarelo
// substituicao: troca James Rodríguez (#10) por outro
const meio = depois.escalacoes[0].jogadores.find((j) => j.numero === "10");
meio.nome = "Quintero";
meio.numero = "20";

const eventos = diffEventos(base, depois);
console.log("Eventos detectados:");
eventos.forEach((e) => console.log("  " + e));

const tem = (sub) => eventos.some((e) => e.includes(sub));
const checks = [
  ["status", tem("Intervalo")],
  ["gol", tem("GOL") && tem("Colômbia 1 x 0 Portugal")],
  ["chutes a gol", tem("Chutes a gol") && tem("6 x 2")],
  ["cartao amarelo", tem("Cartões amarelos") && tem("0 x 1")],
  ["substituicao-saiu", tem("James Rodríguez")],
  ["substituicao-entrou", tem("Quintero")],
];

// Sem alteracao -> nenhum evento
const semMudanca = diffEventos(base, clone(base));
checks.push(["sem-mudanca-sem-evento", semMudanca.length === 0]);

let ok = true;
console.log("\n--- Verificacoes ---");
for (const [n, p] of checks) {
  console.log(`${p ? "OK  " : "FALHOU"} ${n}`);
  if (!p) ok = false;
}
process.exit(ok ? 0 : 1);
