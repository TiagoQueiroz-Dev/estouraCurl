// Gera samples/colombia-portugal.raw.txt a partir de uma estrutura
// fiel ao widget do Google, garantindo JSON valido (sem erro de
// colchetes ao montar a mao). Rode: node samples/gen.js
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const L = (p, px) =>
  `//ssl.gstatic.com/onebox/media/sports/logos/optimized/${p}_${px}.png`;
const COL = "tXHnA_tDylayacdjWQCJvw";
const POR = "HJ3_2c4w791nZJj7n-Lj3Q";

// Bloco de time: [info, 0,0,null,null, logo48, null, logo96, 0, placar, cor, null, nome, placarAgg, null, [id]]
const time = (info, logo, placar, cor, nome, id) => [
  info, 0, 0, null, null, L(logo, "48x48"), null, L(logo, "96x96"), 0,
  placar, cor, null, nome, placar, null, [id],
];

const homeInfo = ["Seleção Colombiana de Futebol", "Colômbia", "COL", null, null, "Colômbia", "Seleção Colombiana de Futebol", "/m/032c08"];
const awayInfo = ["Seleção Portuguesa de Futebol", "Portugal", "POR", null, null, "Portugal", "Seleção Portuguesa de Futebol", "/m/02rqxc"];

const venue = [
  ["Estádio de Miami", "Estádio de Miami", null, null, null, "Estádio de Miami", "Estádio de Miami"],
  ["Miami Gardens", null, null, null, null, "Miami Gardens", "Miami Gardens", "/m/04dvzs"],
  "", "", null, "/search?q=Hard+Rock+Stadium", "/m/01_kzm", "Local:", "/search?q=Miami+Gardens",
];

const statusBlock = [
  null, null, null, null, null, null, "Ao vivo", null, null, null, null, null,
  null, null, "Ao vivo", null, null, null, null, null, null, null, null, null,
  null, null, "Live", null, "57'",
];

const liga = ["Copa do Mundo", "Grupo K", null, "Fase de grupos · Grupo K", "Grupo K", "Fase de grupos, Grupo K"];

// Bloco principal da partida
const matchBlock = [
  [null, [
    time(homeInfo, COL, "0", "#000062", "Colômbia", "/m/032c08"),
    time(awayInfo, POR, "0", "#670e30", "Portugal", "/m/02rqxc"),
    null, 0, 1, 0,
    venue,
    3,
    ["2026-06-27T23:30:00Z", ""],
    null,
    [57, 0, 0],
    liga,
    statusBlock,
  ]],
];

// Jogador: [info, null,null, numero, null,null, posicao, urlBusca]
const jogador = (nome, num, pos, id) => [
  [nome, nome, null, null, null, nome, nome, id],
  null, null, num, null, null, pos, `/search?q=${encodeURIComponent(nome)}`,
];

const formacao = (nome, esquema, logo, cor, jogadores) => [
  nome, esquema, L(logo, "48x48"), cor, jogadores, 1,
];

// XI titular real (extraido dos dados que voce forneceu).
const xiColombia = [
  ["Camilo Vargas", "12", "Goleiro", "/m/04cw1bv"],
  ["Santiago Arias", "4", "Zagueiro", "/m/0gx0kcw"],
  ["Davinson Sánchez", "23", "Zagueiro", "/g/11bc7nzn62"],
  ["Jhon Lucumí", "3", "Zagueiro", "/g/11bw7rvdf3"],
  ["Deiver Machado", "22", "Zagueiro", "/g/11b6r7ww4m"],
  ["Jefferson Lerma", "16", "Meio-campo", "/g/1yxkhgbg2"],
  ["Gustavo Puerta", "14", "Meio-campo", "/g/11rsd7n_j1"],
  ["Jhon Arias", "11", "Meio-campo", "/g/11hz8x4_qv"],
  ["James Rodríguez", "10", "Meio-campo", "/m/05mzr8_"],
  ["Jhon Córdoba", "9", "Atacante", "/m/0k3lqjp"],
  ["Luis Díaz", "7", "Atacante", "/g/11c6cz0yy5"],
];
const xiPortugal = [
  ["Diogo Costa", "1", "Goleiro", "/g/11c48m_w1_"],
  ["Nuno Mendes", "25", "Zagueiro", "/g/11hzhg513k"],
  ["Renato Veiga", "13", "Zagueiro", "/g/11qh8y4_r0"],
  ["Rúben Dias", "3", "Zagueiro", "/g/11bwq91hj6"],
  ["João Cancelo", "20", "Zagueiro", "/m/0kny3v7"],
  ["Rúben Neves", "21", "Meio-campo", "/m/011jl3qv"],
  ["Vitinha", "23", "Meio-campo", "/g/11fn46n2yl"],
  ["Bruno Fernandes", "8", "Meio-campo", "/m/0p3qf55"],
  ["João Félix", "11", "Atacante", "/g/11c1r7vpzb"],
  ["Pedro Neto", "18", "Atacante", "/g/11dz1hxm3x"],
  ["Cristiano Ronaldo", "7", "Atacante", "/m/02xt6q"],
];
const formColombia = formacao(
  "Colômbia", "4-1-2-3", COL, "#000062",
  xiColombia.map(([n, num, pos, id]) => jogador(n, num, pos, id))
);
const formPortugal = formacao(
  "Portugal", "4-2-3-1", POR, "#670e30",
  xiPortugal.map(([n, num, pos, id]) => jogador(n, num, pos, id))
);

const stats = [
  [L(COL, "48x48"), L(POR, "48x48"), "#000062", "#670e30", "Colômbia", "Portugal", 0],
  [
    ["Chutes", "17", "11", 60, 40, 1, 1, 0, null, null, "SHOTS"],
    ["Chutes a gol", "5", "2", 71, 29, 1, 1, 0, null, null, "SHOTS_ON_TARGET"],
    ["Posse de bola", "54%", "46%", 54, 46, 1, 1, 0, null, null, "POSSESSION"],
    ["Passes", "361", "295", 55, 45, 1, 1, 0, null, null, "PASSES"],
    ["Precisão de passe", "91%", "95%", 48, 52, 1, 0, 1, null, null, "PASSING_ACCURACY"],
    ["Faltas", "5", "5", 50, 50, 1, 0, 0, null, null, "FOULS"],
    ["Cartões amarelos", "0", "0", 50, 50, 1, 0, 0, null, null, "YELLOW_CARDS"],
    ["Cartões vermelhos", "0", "0", 50, 50, 1, 0, 0, null, null, "RED_CARDS"],
    ["Impedimentos", "2", "1", 66, 34, 1, 0, 1, null, null, "OFFSIDES"],
    ["Escanteios", "1", "0", 100, 0, 1, 1, 0, null, null, "CORNERS"],
  ],
];

const streamingWrapper = [
  null, null, null, 1, null,
  [[null, null, null, 1,
    ["Assista ao vivo", 1, null, null, null, null, "Colômbia", "Portugal",
      ["/g/11ms2k2435", null, null,
        [["Opções de streaming",
          [["Cazé TV", "https://youtube.com/live/FDCM9HggRlM", null, null, 3, 0, "Grátis",
            [L("oRgvv9mQlCyr6GReSlVL8g".replace("optimized/", ""), "96x96")], null, ""]],
          2, 1, 0]],
        "/m/030q7", 0, 0, 0, 0, 0],
      1, 1, ["//ssl.gstatic.com/x_24x24.png"], "https://youtube.com/live/FDCM9HggRlM"],
    null, null, null, null, null, 0]],
  1, 1, 0,
];

const probabilidade = [
  [["24", "38", "38"]],
  "Probabilidade de vitória ao vivo",
  null, null,
  ["Colômbia", "#BCC2FF", "COL"],
  ["Portugal", "#FFB2BC", "POR"],
  ["Empate", "#D6D6D6", "Empate"],
  0,
];

const titleBlock = [
  "Colômbia x Portugal", "", null, "#212121", null, null, "", null, null, null,
  null, null, null, null, null, null, null, null, 1, null, 0, null, null, null, 0,
];

const matchFullpage = [
  titleBlock,
  matchBlock,
  null, 0, 1, null, 1, "/m/0r4xs1m", "#000000", 0, null, 1, 1, null, 0, 0, 1, 1, 0,
  null, "/m/030q7", 0, "SportsImmersiveMatchHeaderExpansionLink", 1,
  "Copa do Mundo da FIFA 2026™", "Copa do Mundo da FIFA 2026™", null, 0, null,
  streamingWrapper,
  formColombia,
  formPortugal,
  stats,
  probabilidade,
];

const obj = { match_fullpage: matchFullpage };
const raw = ")]}'\n" + JSON.stringify(obj) + "\n";
const out = join(__dirname, "colombia-portugal.raw.txt");
writeFileSync(out, raw, "utf8");
console.log("Gerado:", out, "(", raw.length, "bytes )");
