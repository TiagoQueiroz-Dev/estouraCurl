// =====================================================
// openapi.js
// Especificacao OpenAPI 3.0 da API (Opcao A). Fonte unica:
// usada pelo Swagger UI (/docs) e exposta crua em /openapi.json.
// =====================================================

export const openapi = {
  openapi: "3.0.3",
  info: {
    title: "Copa no Google — API de partidas",
    version: "1.0.0",
    description:
      "API somente-leitura que serve os dados das partidas coletados pelo " +
      "worker (`node index.js --watch`). Cada partida vira um arquivo JSON em " +
      "`dados/<slug>.json`; a API le esses arquivos, calcula o frescor da " +
      "coleta (ao vivo / defasado / encerrado) e expoe via HTTP.",
  },
  servers: [{ url: "/", description: "Servidor atual" }],
  security: [{ ApiToken: [] }],
  tags: [
    { name: "jogos", description: "Partidas coletadas" },
    { name: "jobs", description: "Workers de coleta (1 por jogo)" },
  ],
  paths: {
    "/health": {
      get: {
        summary: "Healthcheck",
        operationId: "health",
        responses: {
          200: {
            description: "API no ar",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Health" },
              },
            },
          },
        },
      },
    },
    "/jogos": {
      get: {
        tags: ["jogos"],
        summary: "Lista as partidas disponiveis (esconde encerradas)",
        description:
          "Le os arquivos de `dados/` e devolve um resumo de cada partida " +
          "com o frescor da ultima coleta. Por padrao **nao inclui jogos " +
          "encerrados**; use `?todos=true` para incluir tambem os finalizados.",
        operationId: "listarJogos",
        parameters: [
          {
            name: "todos",
            in: "query",
            required: false,
            description: "Se `true`, inclui tambem os jogos encerrados.",
            schema: { type: "boolean", default: false },
          },
        ],
        responses: {
          200: {
            description: "Lista de partidas",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/JogoResumo" },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ["jobs"],
        summary: "Sobe um worker para analisar um jogo",
        description:
          "Levanta um worker (Chrome com perfil isolado) que coleta a " +
          "partida informada e grava em `dados/`. O worker encerra sozinho " +
          "quando o jogo termina. Se ja houver um worker rodando para o " +
          "mesmo jogo, ele e reaproveitado.",
        operationId: "criarJob",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/NovoJogo" },
            },
          },
        },
        responses: {
          202: {
            description: "Worker iniciado",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Job" } },
            },
          },
          200: {
            description: "Worker ja existente reaproveitado",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Job" } },
            },
          },
          400: {
            description: "Entrada invalida",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Erro" } } },
          },
          429: {
            description: "Limite de workers simultaneos atingido",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Erro" } } },
          },
        },
      },
    },
    "/jobs": {
      get: {
        tags: ["jobs"],
        summary: "Lista os workers ativos",
        description:
          "Por padrao lista apenas os workers **em execucao**; use " +
          "`?todos=true` para incluir os finalizados/cancelados/expirados.",
        operationId: "listarJobs",
        parameters: [
          {
            name: "todos",
            in: "query",
            required: false,
            description: "Se `true`, inclui tambem os jobs ja terminados.",
            schema: { type: "boolean", default: false },
          },
        ],
        responses: {
          200: {
            description: "Jobs",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/Job" } },
              },
            },
          },
        },
      },
    },
    "/jobs/{id}": {
      get: {
        tags: ["jobs"],
        summary: "Status de um worker",
        operationId: "obterJob",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          200: {
            description: "Job",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Job" } } },
          },
          404: {
            description: "Job nao encontrado",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Erro" } } },
          },
        },
      },
      delete: {
        tags: ["jobs"],
        summary: "Cancela (mata) um worker",
        operationId: "cancelarJob",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          200: {
            description: "Job cancelado",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Job" } } },
          },
          404: {
            description: "Job nao encontrado",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Erro" } } },
          },
        },
      },
    },
    "/jogos/{slug}": {
      get: {
        tags: ["jogos"],
        summary: "Detalhe completo de uma partida",
        operationId: "obterJogo",
        parameters: [
          {
            name: "slug",
            in: "path",
            required: true,
            description: "Identificador da partida (ex.: `colombia-x-portugal`).",
            schema: { type: "string", pattern: "^[a-z0-9-]+$" },
          },
        ],
        responses: {
          200: {
            description: "Dados da partida",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Jogo" },
              },
            },
          },
          404: {
            description: "Partida nao encontrada",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Erro" },
              },
            },
          },
        },
      },
    },
    "/jogos/{slug}/escalacoes": {
      get: {
        tags: ["jogos"],
        summary: "Apenas as escalacoes da partida",
        operationId: "obterEscalacoes",
        parameters: [
          {
            name: "slug",
            in: "path",
            required: true,
            schema: { type: "string", pattern: "^[a-z0-9-]+$" },
          },
        ],
        responses: {
          200: {
            description: "Escalacoes dos dois times",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Escalacao" },
                },
              },
            },
          },
          404: {
            description: "Partida nao encontrada",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Erro" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      ApiToken: {
        type: "apiKey",
        in: "header",
        name: "X-Api-Token",
        description: "Token de acesso. Envie em todas as requisicoes.",
      },
    },
    schemas: {
      Health: {
        type: "object",
        properties: {
          status: { type: "string", example: "ok" },
          dadosDir: { type: "string", example: "/app/dados" },
          jogos: { type: "integer", example: 2 },
        },
      },
      Erro: {
        type: "object",
        properties: {
          erro: { type: "string", example: "Partida nao encontrada" },
          slug: { type: "string", example: "colombia-x-portugal" },
        },
      },
      NovoJogo: {
        type: "object",
        required: ["mandante", "visitante"],
        properties: {
          mandante: { type: "string", example: "Colombia" },
          visitante: { type: "string", example: "Portugal" },
        },
      },
      Job: {
        type: "object",
        properties: {
          id: { type: "string", example: "m1a2b3-1" },
          query: { type: "string", example: "Colombia x Portugal" },
          slug: {
            type: "string",
            description: "Slug derivado da busca (usado no perfil/dedup).",
            example: "colombia-x-portugal",
          },
          dataSlug: {
            type: "string",
            nullable: true,
            description:
              "Slug real do arquivo em dados/ (do titulo do Google). Use em GET /jogos/{slug}.",
            example: "colombia-x-portugal",
          },
          status: {
            type: "string",
            enum: ["rodando", "finalizado", "cancelado", "expirado", "erro"],
            example: "rodando",
          },
          reaproveitado: {
            type: "boolean",
            description: "true se reaproveitou um worker ja em execucao.",
            example: false,
          },
          pid: { type: "integer", nullable: true },
          exitCode: { type: "integer", nullable: true },
          erro: { type: "string", nullable: true },
          startedAt: { type: "string", format: "date-time" },
          finishedAt: { type: "string", format: "date-time", nullable: true },
        },
      },
      Frescor: {
        type: "object",
        description: "Estado/idade da ultima coleta.",
        properties: {
          coletadoEm: { type: "string", format: "date-time", nullable: true },
          idadeSegundos: { type: "integer", nullable: true, example: 27 },
          aoVivo: { type: "boolean", example: true },
          defasado: {
            type: "boolean",
            description: "Ao vivo, mas sem atualizacao recente (worker pode ter parado).",
            example: false,
          },
          encerrado: { type: "boolean", example: false },
        },
      },
      Time: {
        type: "object",
        properties: {
          nome: { type: "string", example: "Colômbia" },
          sigla: { type: "string", nullable: true, example: "COL" },
          placar: { type: "string", nullable: true, example: "0" },
          cor: { type: "string", nullable: true, example: "#000062" },
          logo: { type: "string", nullable: true },
        },
      },
      Estatistica: {
        type: "object",
        properties: {
          nome: { type: "string", example: "Chutes" },
          casa: { type: "string", example: "17" },
          fora: { type: "string", example: "11" },
        },
      },
      Transmissao: {
        type: "object",
        properties: {
          nome: { type: "string", example: "Cazé TV" },
          url: { type: "string", nullable: true },
          preco: { type: "string", nullable: true, example: "Grátis" },
        },
      },
      Jogador: {
        type: "object",
        properties: {
          nome: { type: "string", example: "James Rodríguez" },
          numero: { type: "string", example: "10" },
          posicao: { type: "string", nullable: true, example: "Meio-campo" },
        },
      },
      Escalacao: {
        type: "object",
        properties: {
          time: { type: "string", example: "Colômbia" },
          formacao: { type: "string", example: "4-1-2-3" },
          jogadores: {
            type: "array",
            items: { $ref: "#/components/schemas/Jogador" },
          },
        },
      },
      JogoResumo: {
        type: "object",
        properties: {
          slug: { type: "string", example: "colombia-x-portugal" },
          titulo: { type: "string", example: "Colômbia x Portugal" },
          status: { type: "string", nullable: true, example: "Ao vivo" },
          minuto: { type: "string", nullable: true, example: "57'" },
          placar: { type: "string", nullable: true, example: "Colômbia 0 x 0 Portugal" },
          frescor: { $ref: "#/components/schemas/Frescor" },
        },
      },
      Jogo: {
        type: "object",
        properties: {
          slug: { type: "string", example: "colombia-x-portugal" },
          titulo: { type: "string" },
          competicao: { type: "string", nullable: true },
          fase: { type: "string", nullable: true },
          status: { type: "string", nullable: true },
          minuto: { type: "string", nullable: true },
          data: { type: "string", nullable: true, format: "date-time" },
          local: {
            type: "object",
            nullable: true,
            properties: {
              estadio: { type: "string", nullable: true },
              cidade: { type: "string", nullable: true },
            },
          },
          mandante: { $ref: "#/components/schemas/Time" },
          visitante: { $ref: "#/components/schemas/Time" },
          placar: { type: "string", nullable: true },
          probabilidade: { type: "object", nullable: true },
          estatisticas: {
            type: "array",
            items: { $ref: "#/components/schemas/Estatistica" },
          },
          transmissao: {
            type: "array",
            items: { $ref: "#/components/schemas/Transmissao" },
          },
          escalacoes: {
            type: "array",
            items: { $ref: "#/components/schemas/Escalacao" },
          },
          coletadoEm: { type: "string", format: "date-time" },
          frescor: { $ref: "#/components/schemas/Frescor" },
        },
      },
    },
  },
};
