# Copa no Google — scraper do widget de esportes

Abre o **Chrome** (visível), busca no Google por uma partida da Copa,
abre a **visão imersiva** da partida e **intercepta a resposta de rede**
com o JSON `match_fullpage` do widget de esportes do Google. Em seguida
extrai placar, status/minuto, local, escalações, estatísticas,
probabilidade de vitória e opções de transmissão.

É uma alternativa ao `estoura.ps1` (que usa a API `football-data.org`,
com limite de requisições): aqui os dados vêm do próprio Google.

## Como funciona

1. Abre o Chrome com um **perfil persistente** (`.perfil-chrome/`).
   Navegador **visível** é obrigatório — em modo *headless* o Google
   detecta automação e mostra CAPTCHA ("tráfego incomum").
2. Faz a busca `https://www.google.com/search?q=<partida>`.
3. Se o `match_fullpage` não vier direto, extrai o id da partida
   (`/g/...`) do DOM e abre a **visão imersiva** via fragmento
   `#sie=m;<gid>;2;/m/030q7;<aba>;fp;1;;;;-1` (igual à URL que o Google
   usa). Tenta a aba de resumo (`ms`) e a de **escalações** (`dt`) — o
   `match_fullpage` capturado em qualquer uma já traz placar,
   estatísticas **e a escalação completa** (XI titular + reservas).
4. Escuta todas as respostas do Google; quando alguma contém
   `match_fullpage` (resposta limpa `)]}'{...}` ou embutida em um stream
   em *chunks*), faz a extração balanceada do JSON e processa.

> ⚠️ A resposta limpa `match_fullpage` é servida principalmente durante
> **jogos ao vivo** (o widget faz *polling* a cada ~30s). Fora de jogo ao
> vivo o Google pode não emitir essa resposta.

## Instalação

```bash
npm install          # instala o Playwright e baixa o Chromium
npx playwright install chrome   # garante o canal "chrome" (Chrome real)
```

## Uso

```bash
# uma partida específica (recomendado)
node index.js "colombia x portugal"
node index.js "africa do sul x canada"

# saída apenas em JSON (para integrar com outros scripts)
node index.js --json "mexico x equador"

# acompanhar AO VIVO: fica rodando até o jogo acabar, logando só os EVENTOS
node index.js --watch=30 "brasil x argentina"
```

### Modo ao vivo (`--watch`) — feed de eventos

Mantém o Chrome aberto até a partida terminar e **loga apenas as
alterações** conforme acontecem (não reimprime o bloco inteiro a cada
poll). O snapshot completo é mostrado uma vez no início; depois, só
eventos:

```
================================================================
[20:31:05]  Colômbia x Portugal   (snapshot inicial)
   Colômbia 0  x  0 Portugal   [Ao vivo 57']
   ...
================================================================
🔁  Acompanhando ao vivo — eventos serao logados conforme acontecem. Ctrl+C para sair.

[20:33:10 · 59']  🎯  Chutes a gol: 6 x 2
[20:41:02 · 67']  ⚽  GOL!  Colômbia 1 x 0 Portugal
[20:42:15 · 68']  🟨  Cartões amarelos: 0 x 1
[20:55:48 · 80']  🔁  Substituicao: 🔻 James Rodríguez  🔺 Quintero
[21:18:30 · 90+3']  📣  Encerrado

🏁  Partida encerrada (Encerrado).
```

Eventos detectados: **gol** (placar), **status** (início/intervalo/fim),
**chutes a gol / chutes / escanteios / impedimentos**, **cartões**
(amarelo/vermelho) e **substituições**. O `dados/<partida>.json` é
atualizado silenciosamente a cada coleta com o estado mais recente.
Encerra sozinho ao fim do jogo (ou com Ctrl+C).

Flags:

| Flag           | Descrição                                                        |
| -------------- | ---------------------------------------------------------------- |
| `--json`       | Imprime só o objeto JSON do jogo (sem logs).                     |
| `--watch=N`    | Acompanha ao vivo: mantém a página aberta e reimprime/salva a cada atualização. Para sozinho quando o jogo termina (status "Encerrado"). Ctrl+C encerra. |
| `--timeout=N`  | Segundos de espera por etapa de captura (padrão 12).             |
| `--comp=/m/..` | Id da competição (padrão `/m/030q7` = Copa do Mundo).            |
| `--out=...`    | Caminho do JSON (arquivo `.json` ou pasta). Padrão `dados/`.     |
| `--no-save`    | Não grava o arquivo JSON.                                       |
| `--headless`   | Roda sem janela (⚠️ tende a cair em CAPTCHA — evite).            |

## Onde os dados são salvos

A cada coleta o objeto completo da partida (placar, status, estatísticas,
transmissão **e escalações**) é gravado em **`dados/<partida>.json`**
(ex.: `dados/colombia-x-portugal.json`), com um campo `coletadoEm`. No
modo `--watch` o arquivo é sobrescrito com o estado mais recente. Use
`--out=caminho.json` para escolher o arquivo, ou `--no-save` para
desativar. Estrutura salva (resumo):

```jsonc
{
  "coletadoEm": "2026-06-28T18:42:57.091Z",
  "titulo": "Colômbia x Portugal",
  "status": "Ao vivo", "minuto": "57'",
  "mandante": { "nome": "Colômbia", "placar": "0", ... },
  "visitante": { "nome": "Portugal", "placar": "0", ... },
  "estatisticas": [ { "nome": "Chutes", "casa": "17", "fora": "11" }, ... ],
  "escalacoes": [
    { "time": "Colômbia", "formacao": "4-1-2-3",
      "jogadores": [ { "nome": "Camilo Vargas", "numero": "12", "posicao": "Goleiro" }, ... ] },
    { "time": "Portugal", "formacao": "4-2-3-1", "jogadores": [ ... ] }
  ]
}
```

## Saída (exemplo)

```
================================================================
[20:31:05]  Colômbia x Portugal
   Copa do Mundo da FIFA 2026™  •  Fase de grupos · Grupo K
   Colômbia 0  x  0 Portugal   [Ao vivo 57']
   🏟   Estádio de Miami — Miami Gardens
   📊  Prob: Colômbia 24%  | Empate 38%  | Portugal 38%
   📈  Estatisticas (casa | fora):
        Chutes                  17 | 11
        Posse de bola          54% | 46%
        ...
   📺  Transmissao:
        Cazé TV (Grátis) -> https://youtube.com/live/FDCM9HggRlM
   👥  Colômbia (4-1-2-3) — 11 jogadores
         #12  Camilo Vargas          Goleiro
          #4  Santiago Arias         Zagueiro
         #10  James Rodríguez        Meio-campo
          #7  Luis Díaz              Atacante
          ...
   👥  Portugal (4-2-3-1) — 11 jogadores
          #1  Diogo Costa            Goleiro
          #7  Cristiano Ronaldo      Atacante
          ...
================================================================
```

## Arquivos

| Arquivo                         | Papel                                                    |
| ------------------------------- | -------------------------------------------------------- |
| `index.js`                      | Orquestra o navegador e a interceptação de rede.         |
| `parser.js`                     | Converte o JSON aninhado do Google em objeto limpo.      |
| `eventos.js`                    | Detecta alterações entre coletas (feed de eventos).      |
| `worker-multi.js`               | Monitora N jogos em paralelo da mesma pasta (perfis isolados). |
| `server.js`                     | API HTTP (somente leitura) que serve `dados/` + Swagger. |
| `openapi.js`                    | Especificação OpenAPI da API.                            |
| `test.js`                       | Valida o parser offline (`npm test`).                    |
| `samples/colombia-portugal.raw.txt` | Resposta de exemplo (formato `)]}'{match_fullpage}`).|
| `samples/gen.js`                | Gera o sample acima a partir de uma estrutura fiel.      |

## Vários jogos ao mesmo tempo (sem duplicar a pasta)

O `index.js` usa um perfil de Chrome único (`.perfil-chrome`), então dois
`index.js` na mesma pasta brigam pelo lock do perfil. O **`worker-multi.js`**
resolve isso: monitora **N jogos em paralelo a partir da mesma pasta**,
cada um com um perfil isolado (`.perfil-<slug>`). Reaproveita `parser.js`
e `eventos.js`; grava no mesmo `dados/`, então a **API serve tudo**.

```bash
# Windows
node worker-multi.js "africa do sul x canada" "mexico x equador"

# Linux headless (VM)
xvfb-run -a node worker-multi.js "africa do sul x canada" "mexico x equador"
```

- Cada jogo loga eventos com o prefixo `(slug)` para não se misturar.
- Cada jogo **encerra sozinho** quando termina (status "Encerrado").
- Mesmas flags do `index.js`: `--watch=N`, `--out=`, `--timeout=`, `--comp=`, `--headless`, `--no-save`.
- Custo: 1 Chrome por jogo (RAM/CPU). O CAPTCHA por IP continua valendo.

## API HTTP + Swagger (integração com outras aplicações)

A API (`server.js`) é **somente leitura**: ela serve os arquivos que o
worker grava em `dados/`, **não abre navegador**. O desenho é:

```
worker:  node index.js --watch=30 "time A x time B"   →  escreve dados/<slug>.json
api:     node server.js                                →  lê dados/ e expõe via HTTP + Swagger
```

Subir a API:

```bash
npm run api                 # porta 3000
PORT=8080 npm run api       # outra porta
DADOS_DIR=/caminho/dados npm run api   # ler dados de outro lugar
```

Endpoints:

| Método/rota                     | Descrição                                              |
| ------------------------------- | ------------------------------------------------------ |
| `GET /jogos`                    | Lista as partidas em `dados/` (**esconde encerradas**; `?todos=true` inclui). |
| `GET /jogos/{slug}`             | Objeto completo da partida (placar, stats, escalações).|
| `GET /jogos/{slug}/escalacoes`  | Apenas as escalações dos dois times.                   |
| `POST /jogos`                   | Sobe um **worker sob demanda** para um jogo (1 por POST). |
| `GET /jobs`                     | Lista os workers **ativos** (`?todos=true` inclui finalizados). |
| `GET /jobs/{id}`                | Status de um worker.                                    |
| `DELETE /jobs/{id}`             | Mata um worker manualmente.                             |
| `GET /health`                   | Healthcheck + nº de jogos disponíveis.                 |
| `GET /openapi.json`             | Especificação OpenAPI (crua).                          |
| `GET /docs`                     | **Swagger UI** (documentação interativa).              |

### Autenticação (`X-Api-Token`)

**Todas** as rotas exigem o header `X-Api-Token`; sem ele (ou com valor
errado) a resposta é **`401`**. As únicas exceções são `/docs` e
`/openapi.json` (para o Swagger UI carregar no navegador).

- O token fica em **`.api-token`** (gerado aleatoriamente na 1ª vez; é
  `.gitignored`). Pode ser sobrescrito por `API_TOKEN=<valor> npm run api`.
- O token é impresso no startup: `🔑  X-Api-Token: ...`.

```bash
# sem token -> 401
curl http://localhost:3000/jogos

# com token -> 200
curl http://localhost:3000/jogos -H "X-Api-Token: <SEU_TOKEN>"
```

No **Swagger UI** (`/docs`), clique em **Authorize** e cole o token —
todas as chamadas "Try it out" passam a enviar o header automaticamente.

### Workers sob demanda (`POST /jogos`)

Cada `POST /jogos` levanta **um** worker (via `worker-multi.js`, com perfil
isolado) para o jogo enviado; ele coleta para `dados/` e **encerra sozinho**
quando a partida acaba.

```bash
curl -X POST http://localhost:3000/jogos \
  -H "Content-Type: application/json" \
  -d '{"mandante":"Colombia","visitante":"Portugal"}'
# 202 -> { "id": "...", "slug": "colombia-x-portugal", "status": "rodando", ... }
```

- **Dedup**: POST repetido do mesmo jogo reaproveita o worker existente.
- **Limite**: `MAX_JOBS` (padrão 3) workers simultâneos; estourou → `429`.
- **TTL**: `JOB_TTL_MIN` (padrão 240) mata worker órfão (jogo que não começa).
- **Teardown**: automático no fim do jogo, ou `DELETE /jobs/{id}` (mata a árvore, incluindo o Chrome), ou ao desligar a API (Ctrl+C).
- **Linux/VM**: defina `WORKER_PREFIX="xvfb-run -a"` para os workers rodarem sem GUI.

Depois que o worker grava, leia os dados pelo `dataSlug` retornado:
`GET /jogos/{dataSlug}`.

Variáveis de ambiente: `PORT`, `DADOS_DIR`, `MAX_JOBS`, `JOB_TTL_MIN`, `WORKER_PREFIX`.

Cada resposta inclui um bloco **`frescor`** calculado a partir de
`coletadoEm`, para a aplicação consumidora saber o estado real:

```jsonc
"frescor": {
  "coletadoEm": "2026-06-28T19:52:53.395Z",
  "idadeSegundos": 16,
  "aoVivo": true,      // ao vivo e atualizado há < 90s
  "defasado": false,   // ao vivo, mas sem atualização recente (worker parado?)
  "encerrado": false   // partida finalizada
}
```

> O `slug` é o nome do arquivo (ex.: `colombia-x-portugal`). A leitura é
> tolerante: se pegar o arquivo no meio de uma escrita, a API tenta de novo.

## Teste do parser (sem rede)

```bash
npm test
```

Roda o parser sobre a resposta de exemplo e confere placar, status,
estatísticas, transmissão, probabilidade e escalações.

## Observações

- Os dados do Google são arrays posicionais (sem chaves). O parser usa
  busca por "marcos" de conteúdo (nomes, cor hex, "Local:", "Chutes",
  "Opções de streaming") para ser resiliente, mas **mudanças de layout
  do Google podem quebrar a extração** — nesse caso, ajuste `parser.js`.
- Respeite os Termos de Serviço do Google ao automatizar buscas.
