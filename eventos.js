// =====================================================
// eventos.js
// Compara duas coletas da partida e produz a lista de eventos
// (alteracoes) a serem logados no modo --watch.
// =====================================================

/** Mapa "Time#numero" -> nome, para detectar substituicoes. */
function chaveJogadores(jogo) {
  const m = new Map();
  for (const esc of jogo.escalacoes || [])
    for (const j of esc.jogadores || []) m.set(`${esc.time}#${j.numero}`, j.nome);
  return m;
}

/** Compara duas coletas (a = anterior, b = nova) e devolve eventos. */
function diffEventos(a, b) {
  const ev = [];

  // Status (Inicio, Intervalo, Encerrado, ...)
  if ((a.status || "") !== (b.status || "") && b.status) ev.push(`📣  ${b.status}`);

  // Placar -> gol
  if (
    a.mandante?.placar !== b.mandante?.placar ||
    a.visitante?.placar !== b.visitante?.placar
  ) {
    const m = b.mandante || {}, v = b.visitante || {};
    ev.push(`⚽  GOL!  ${m.nome} ${m.placar} x ${v.placar} ${v.nome}`);
  }

  // Estatisticas discretas (cada mudanca e um lance)
  const discretas = {
    "Chutes a gol": "🎯",
    Chutes: "👟",
    Escanteios: "⛳",
    "Cartões amarelos": "🟨",
    "Cartões vermelhos": "🟥",
    Impedimentos: "🚩",
  };
  for (const [nome, emoji] of Object.entries(discretas)) {
    const ea = (a.estatisticas || []).find((e) => e.nome === nome);
    const eb = (b.estatisticas || []).find((e) => e.nome === nome);
    if (eb && ea && (ea.casa !== eb.casa || ea.fora !== eb.fora))
      ev.push(`${emoji}  ${nome}: ${eb.casa} x ${eb.fora}`);
  }

  // Substituicoes (mudanca no conjunto de jogadores)
  const ka = chaveJogadores(a), kb = chaveJogadores(b);
  if (ka.size && kb.size) {
    const entrou = [], saiu = [];
    for (const [k, nome] of kb) if (!ka.has(k)) entrou.push(nome);
    for (const [k, nome] of ka) if (!kb.has(k)) saiu.push(nome);
    if (entrou.length || saiu.length) {
      const partes = [];
      if (saiu.length) partes.push("🔻 " + saiu.join(", "));
      if (entrou.length) partes.push("🔺 " + entrou.join(", "));
      ev.push(`🔁  Substituicao: ${partes.join("  ")}`);
    }
  }

  return ev;
}

export { diffEventos, chaveJogadores };
