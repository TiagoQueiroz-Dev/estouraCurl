// =====================================================
// google-dom.js
// Fallback para partidas em que o Google renderiza os dados no DOM da
// visao imersiva, mas nao emite mais a resposta match_fullpage.
// =====================================================

async function extrairJogoDoDom(page, htmlEscalacao = "") {
  try {
    try {
      let clicouDesempenho = false;
      const opcoes = page.getByText("Desempenho", { exact: true });
      for (let i = 0, total = await opcoes.count(); i < total; i++) {
        const opcao = opcoes.nth(i);
        if (await opcao.isVisible({ timeout: 100 }).catch(() => false)) {
          await opcao.click({ timeout: 1000 });
          clicouDesempenho = true;
          break;
        }
      }

      if (!clicouDesempenho) clicouDesempenho = await page.evaluate(() => {
        const clean = (s) => String(s || "").replace(/\u00a0/g, " ").trim();
        const visivel = (el) => {
          const st = getComputedStyle(el);
          const box = el.getBoundingClientRect();
          return st.display !== "none" && st.visibility !== "hidden" && box.width > 0 && box.height > 0;
        };
        const root = [...document.querySelectorAll('[data-app-state^="m;"], [data-async-type="lr_mt_fp"]')]
          .find((el) => visivel(el) && /ESCALAÇÕES/i.test(clean(el.innerText || el.textContent)));
        if (!root) return false;
        const alvo = [...root.querySelectorAll("*")].find((el) => clean(el.textContent) === "Desempenho" && visivel(el));
        if (!alvo) return false;
        alvo.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        return true;
      });
      if (clicouDesempenho) {
        await page.waitForTimeout(300);
      }
    } catch {
      /* subaba ausente; segue com o DOM atual */
    }

    return await page.evaluate(async (htmlEscalacaoCapturado) => {
      const clean = (s) =>
        String(s || "")
          .replace(/\u00a0/g, " ")
          .replace(/[ \t]+/g, " ")
          .trim();

      const text = (el) => clean(el?.innerText || el?.textContent || "");
      const linhas = (s) =>
        clean(s)
          .split(/\n+/)
          .map(clean)
          .filter(Boolean);
      const normalizarUrl = (url) => {
        const valor = clean(url);
        if (!valor) return null;
        if (valor.startsWith("//")) return "https:" + valor;
        if (/^https?:\/\//i.test(valor) || /^data:image\//i.test(valor)) return valor;
        return null;
      };
      const urlsDeSrcset = (srcset) =>
        clean(srcset)
          .split(",")
          .map((item) => item.trim().split(/\s+/)[0])
          .filter(Boolean);
      const escolherImagem = (urls) => {
        const candidatas = urls.map(normalizarUrl).filter(Boolean);
        return candidatas.find((url) => /^https?:\/\//i.test(url)) || candidatas.find((url) => /^data:image\//i.test(url)) || null;
      };
      const imagemDoElemento = (el) => {
        const urls = [];
        for (const img of el?.querySelectorAll?.("img") || []) {
          urls.push(img.getAttribute("data-src"), img.currentSrc, img.getAttribute("src"));
          urls.push(...urlsDeSrcset(img.getAttribute("srcset")));
        }
        return escolherImagem(urls);
      };
      // Resolve a URL de UMA tag <img> (o helper acima varre filhos; uma img
      // nao tem <img> dentro de si, entao precisamos ler os atributos dela).
      const urlDaImg = (img) =>
        escolherImagem([
          img.getAttribute("data-src"),
          img.currentSrc,
          img.getAttribute("src"),
          ...urlsDeSrcset(img.getAttribute("srcset")),
        ]);

      const visivel = (el) => {
        const st = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        return st.display !== "none" && st.visibility !== "hidden" && box.width > 0 && box.height > 0;
      };

      const roots = [...document.querySelectorAll('[data-app-state^="m;"], [data-async-type="lr_mt_fp"]')]
        .map((el) => {
          const t = text(el);
          const all = clean(`${t}\n${el.textContent || ""}`);
          const players = el.querySelectorAll('span[role="text"][aria-label*="nº"]').length;
          const formations = linhas(all).filter((l) => /^\d(?:-\d){1,4}$/.test(l)).length;
          return { el, t, all, players, formations, visible: visivel(el) };
        })
        .filter((r) => {
          const conteudo = r.t || r.all;
          return conteudo && /\b(MINUTO A MINUTO|Minuto a minuto|ESCALAÇÕES|ESTATÍSTICAS)\b/.test(conteudo);
        });

      roots.sort(
        (a, b) =>
          Number(b.visible) - Number(a.visible) ||
          b.players - a.players ||
          b.formations - a.formations ||
          b.t.length - a.t.length
      );
      const root = roots[0]?.el;
      if (!root) return null;

      const raw = text(root);
      const allRaw = `${roots.map((r) => r.all).join("\n")}\n${document.documentElement.textContent || ""}`;
      const lines = linhas(raw);
      const allLines = linhas(allRaw);
      if (!lines.length) return null;

      const titulo = lines.find((l) => /\s[x×]\s/i.test(l)) || null;
      const partesTitulo = titulo ? titulo.split(/\s[x×]\s/i).map(clean) : [];

      // Placar, status e minuto vivem no CABECALHO do card da partida, que
      // costuma ficar FORA do `root` (o root e o painel da aba de escalacoes/
      // estatisticas). Por isso buscamos primeiro no painel (lines) e, se nao
      // achar, no documento inteiro (allLines). O placar pode vir como uma
      // unica linha ("2 x 1" / "2 - 1") ou em tres linhas separadas.
      const acharPlacar = (ls) => {
        for (const l of ls) {
          const m = l.match(/^(\d+)\s*[x×–-]\s*(\d+)$/i);
          if (m) return [m[1], m[2]];
        }
        for (let i = 0; i < ls.length - 2; i++) {
          if (/^\d+$/.test(ls[i]) && /^[x×–-]$/i.test(ls[i + 1]) && /^\d+$/.test(ls[i + 2])) {
            return [ls[i], ls[i + 2]];
          }
        }
        return [null, null];
      };
      let [placarCasa, placarFora] = acharPlacar(lines);
      if (placarCasa == null) [placarCasa, placarFora] = acharPlacar(allLines);

      const reStatus = /^(Ao vivo|Encerrad[oa]|Intervalo|Adiado|Agendado|Final|FIM)$/i;
      const statusLine = lines.find((l) => reStatus.test(l)) || allLines.find((l) => reStatus.test(l));
      const status = /^FIM$/i.test(statusLine || "") ? "Encerrado" : statusLine || null;
      const reMinuto = /^\d{1,3}(?:\+\d+)?'$/;
      const minuto = lines.find((l) => reMinuto.test(l)) || allLines.find((l) => reMinuto.test(l)) || null;

      const compLine = lines.find((l) => /(Copa|FIFA|Campeonato|Liga|Mundial)/i.test(l)) || null;
      const competicao = compLine ? clean(compLine.split(" · ")[0]) : null;
      const fase =
        lines.find(
          (l) =>
            l !== compLine &&
            /(Fase|Grupo|Rodada|rodada|Final|Oitavas|Quartas|Semi|Disputa)/i.test(l)
        ) || null;

      const localMatch = raw.match(/Local:\s*([^\n]+?)(?:\n(?:Fotos:|De acordo)|\n|$)/i);
      const localTexto = localMatch ? clean(localMatch[1]) : null;
      const [estadio, ...cidadePartes] = localTexto ? localTexto.split(",").map(clean) : [];

      // --- Logo dos times ----------------------------------------------------
      // IMPORTANTE: no DOM da visao imersiva o Google NAO renderiza nem o
      // codigo de 3 letras (sigla) nem a cor do time — esses campos so existem
      // no JSON match_fullpage. Por isso aqui extraimos APENAS o escudo (que
      // esta no DOM como <img> de /sports/logos/); sigla/cor ficam null no
      // fallback (preenchidos quando o match_fullpage e capturado).
      const ehLogoEsporte = (url) => /\/sports\/logos\//i.test(url || "");
      const logosEsporte = [];
      const urlsLogoVistas = new Set();
      for (const img of document.querySelectorAll("img")) {
        const url = urlDaImg(img);
        if (!url || !ehLogoEsporte(url) || urlsLogoVistas.has(url)) continue;
        urlsLogoVistas.add(url);
        logosEsporte.push({
          url,
          img,
          alt: clean(img.getAttribute("alt") || img.getAttribute("aria-label")),
        });
      }

      // Escolhe o escudo do time pelo ALT (mais confiavel). O fallback usa a
      // ordem do documento — o Google sempre renderiza o mandante primeiro.
      const logoPorNome = (nome) =>
        nome
          ? logosEsporte.find(
              (l) => l.alt && l.alt.toLowerCase().includes(nome.toLowerCase())
            ) || null
          : null;
      let entradaCasa = logoPorNome(partesTitulo[0]);
      let entradaFora = logoPorNome(partesTitulo[1]);
      if (!entradaCasa) entradaCasa = logosEsporte[0] || null;
      if (!entradaFora) entradaFora = logosEsporte.find((l) => l !== entradaCasa) || null;

      // --- Data/horario agendado --------------------------------------------
      // Para partida ainda nao iniciada nao ha placar/minuto, mas ha o horario.
      // Prioriza o ISO de <time datetime>; cai para a hora visivel (HH:MM).
      let dataIso = null;
      for (const t of document.querySelectorAll("time[datetime]")) {
        const v = clean(t.getAttribute("datetime"));
        if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
          dataIso = v;
          break;
        }
      }
      const horaTexto =
        lines.find((l) => /^\d{1,2}:\d{2}$/.test(l)) ||
        allLines.find((l) => /^\d{1,2}:\d{2}$/.test(l)) ||
        null;

      const estatisticas = [];
      const statNames = new Set();
      for (const row of root.querySelectorAll("tr")) {
        const cells = [...row.children].map(text);
        if (cells.length < 3) continue;
        const [casa, nome, fora] = cells;
        if (!nome || /ESTATÍSTICAS/i.test(nome) || statNames.has(nome)) continue;
        if (!/[A-Za-zÀ-ÿ]/.test(nome)) continue;
        if (!/^\d+(?:[,.]\d+)?%?$/.test(casa) || !/^\d+(?:[,.]\d+)?%?$/.test(fora)) continue;
        estatisticas.push({ nome, casa, fora });
        statNames.add(nome);
      }

      const parseJogador = (aria) => {
        const m = clean(aria).match(/n[ºo]\s*(\d+),\s*([^,]+)(?:,\s*(?:classificação|rating)\s*([\d.,]+))?/i);
        if (!m) return null;
        return { numero: m[1], nome: clean(m[2]), nota: m[3] ? m[3].replace(",", ".") : null };
      };

      const posicaoDaLinha = (linha, totalLinhas) =>
        linha === 1
          ? "Goleiro"
          : linha === 2
            ? "Zagueiro"
            : linha === totalLinhas
              ? "Atacante"
              : "Meio-campo";

      const formacaoValida = (f) =>
        /^\d(?:-\d){1,4}$/.test(f) &&
        f.split("-").map(Number).reduce((total, n) => total + n, 0) === 10;

      const numero = (s) => Number(String(s || "").match(/[\d.]+/)?.[0] || 0);
      const extrairLayoutDeHtml = (html) => {
        if (!html) return null;
        const doc = new DOMParser().parseFromString(html, "text/html");
        const formacoesAsync = [...doc.querySelectorAll('[aria-label^="Esquema"]')]
          .map((el) => clean(el.textContent) || clean(el.getAttribute("aria-label")).replace(/^Esquema\s+/i, ""))
          .filter(formacaoValida);
        if (formacoesAsync.length < 2) return null;

        const rows = [...doc.querySelectorAll(".lrvl-fr")]
          .map((row) => ({
            alturaPct: numero(row.getAttribute("style")),
            slots: [...row.querySelectorAll(".lrvl-pd")]
              .map((slot) => {
                const jogador = parseJogador(slot.querySelector('span[role="text"]')?.getAttribute("aria-label"));
                if (!jogador) return null;
                jogador.imagem = imagemDoElemento(slot);
                jogador.larguraPct = numero(slot.getAttribute("style"));
                return jogador;
              })
              .filter(Boolean),
          }))
          .filter((row) => row.slots.length);

        const linhasPorFormacao = (formacao) => 1 + formacao.split("-").length;
        const linhasCasa = linhasPorFormacao(formacoesAsync[0]);
        const linhasFora = linhasPorFormacao(formacoesAsync[1]);
        if (rows.length < linhasCasa + linhasFora) return null;

        const montarJogadores = (rowList) =>
          rowList.flatMap((row, rowIdx) => {
            const linha = rowIdx + 1;
            const totalLinhas = rowList.length;
            return row.slots.map((jogador, slotIdx) => ({
              ...jogador,
              linha,
              ordem: slotIdx + 1,
              totalNaLinha: row.slots.length,
              alturaLinhaPct: row.alturaPct || null,
              posicao: posicaoDaLinha(linha, totalLinhas),
            }));
          });

        const rowsCasa = rows.slice(0, linhasCasa);
        const rowsFora = rows.slice(linhasCasa, linhasCasa + linhasFora).reverse();
        return {
          formacoes: formacoesAsync,
          homePlayers: montarJogadores(rowsCasa),
          awayPlayers: montarJogadores(rowsFora),
        };
      };

      const extrairLayoutAsync = async () => {
        const capturado = extrairLayoutDeHtml(htmlEscalacaoCapturado);
        if (capturado) return capturado;

        const urls = performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .filter((url) => url.includes("/async/lr_mt_fp"));

        for (const url of urls.reverse()) {
          try {
            const html = await fetch(url, { credentials: "include" }).then((r) => r.text());
            const extraido = extrairLayoutDeHtml(html);
            if (extraido) return extraido;
          } catch {
            /* tenta a proxima resposta async */
          }
        }
        return null;
      };

      const layoutAsync = await extrairLayoutAsync();
      const formacoesTexto = [...new Set(allRaw.match(/\d(?:-\d){1,4}/g) || [])].filter(formacaoValida);
      const formacoes = layoutAsync?.formacoes || formacoesTexto;
      const titulares = [];
      const vistos = new Set();
      for (const span of root.querySelectorAll('span[role="text"][aria-label*="nº"]')) {
        const aria = clean(span.getAttribute("aria-label"));
        const jogador = parseJogador(aria);
        if (!jogador) continue;
        jogador.imagem = imagemDoElemento(span.closest(".lrvl-pd") || span.parentElement);
        for (let el = span; el; el = el.parentElement) {
          const box = el.getBoundingClientRect();
          if (box.width > 0 && box.height > 0) {
            jogador._x = box.x;
            jogador._y = box.y;
            break;
          }
        }
        const chave = `${jogador.numero}|${jogador.nome}`;
        if (vistos.has(chave)) {
          const idx = titulares.findIndex((j) => `${j.numero}|${j.nome}` === chave);
          if (idx >= 0 && titulares[idx]._y == null && jogador._y != null) titulares[idx] = jogador;
          continue;
        }
        vistos.add(chave);
        titulares.push(jogador);
      }

      const agruparPorCampo = (jogadores, invertido = false) => {
        const todosTemPosicao = jogadores.length && jogadores.every((j) => Number.isFinite(j._y));
        if (!todosTemPosicao) return { jogadores: invertido ? [...jogadores].reverse() : jogadores, formacao: null };

        const ordenados = [...jogadores].sort((a, b) => (invertido ? b._y - a._y : a._y - b._y));
        const grupos = [];
        for (const jogador of ordenados) {
          const grupo = grupos[grupos.length - 1];
          if (!grupo || Math.abs(grupo.y - jogador._y) > 45) {
            grupos.push({ y: jogador._y, jogadores: [jogador] });
          } else {
            grupo.jogadores.push(jogador);
            grupo.y = grupo.jogadores.reduce((s, j) => s + j._y, 0) / grupo.jogadores.length;
          }
        }

        for (const grupo of grupos) grupo.jogadores.sort((a, b) => a._x - b._x);
        const counts = grupos.map((g) => g.jogadores.length);
        if (counts[0] !== 1 || counts.length <= 2) {
          return { jogadores: invertido ? [...jogadores].reverse() : jogadores, formacao: null };
        }
        const formacao = counts.slice(1).join("-");
        return { jogadores: grupos.flatMap((g) => g.jogadores), formacao };
      };

      const atribuirLinhaEOrdem = (jogadores, formacao) => {
        const tamanhos = [1, ...String(formacao || "").split("-").map(Number).filter((n) => n > 0)];
        let idx = 0;
        for (let linha = 0; linha < tamanhos.length; linha++) {
          for (let ordem = 1; ordem <= tamanhos[linha] && idx < jogadores.length; ordem++) {
            const j = jogadores[idx++];
            j.linha = linha + 1;
            j.ordem = ordem;
            j.totalNaLinha = tamanhos[linha];
            j.larguraPct = 100 / tamanhos[linha];
            j.alturaLinhaPct = 100 / tamanhos.length;
            j.posicao =
              posicaoDaLinha(linha + 1, tamanhos.length);
          }
        }
      };

      const campoCasa = agruparPorCampo(titulares.slice(0, 11));
      const campoFora = agruparPorCampo(titulares.slice(11, 22), true);
      const formacaoCasa = formacoes[0] || campoCasa.formacao;
      const formacaoFora = formacoes[1] || campoFora.formacao;
      const homePlayers = layoutAsync?.homePlayers || campoCasa.jogadores;
      const awayPlayers = layoutAsync?.awayPlayers || campoFora.jogadores;
      if (!layoutAsync) {
        atribuirLinhaEOrdem(homePlayers, formacaoCasa);
        atribuirLinhaEOrdem(awayPlayers, formacaoFora);
      }
      for (const jogador of [...homePlayers, ...awayPlayers]) {
        delete jogador._x;
        delete jogador._y;
      }

      const escalacoes = [];
      if (homePlayers.length) escalacoes.push({ time: partesTitulo[0] || null, formacao: formacaoCasa || null, jogadores: homePlayers });
      if (awayPlayers.length) escalacoes.push({ time: partesTitulo[1] || null, formacao: formacaoFora || null, jogadores: awayPlayers });

      // --- Probabilidade de vitoria (quando o Google exibe o bloco) ---------
      // Generico: ancora no texto "Probabilidade de vitoria" e le as 3
      // porcentagens na ordem visual tipica (mandante | empate | visitante).
      const extrairProbabilidade = () => {
        const idx = allLines.findIndex((l) => /Probabilidade de vit[oó]ria/i.test(l));
        if (idx < 0) return null;
        const pcts = [];
        for (const l of allLines.slice(idx, idx + 14)) {
          const m = l.match(/^(\d{1,3})%$/);
          if (m) pcts.push(m[1]);
          if (pcts.length >= 3) break;
        }
        if (pcts.length < 3) return null;
        return {
          casa: { time: partesTitulo[0] || null, chance: pcts[0] },
          empate: { time: "Empate", chance: pcts[1] },
          visitante: { time: partesTitulo[1] || null, chance: pcts[2] },
        };
      };

      // Transmissao: no DOM as opcoes de streaming nao sao ancoras limpas
      // (o "Assista ao vivo" e um botao de video, e os demais links da pagina
      // sao resultados de busca/redes sociais — ruido). Esse dado so vem
      // confiavel pelo match_fullpage, entao no fallback fica vazio.
      const probabilidade = extrairProbabilidade();
      const transmissao = [];

      // sigla/cor: ausentes no DOM (so existem no match_fullpage) -> null.
      const mandante = partesTitulo[0]
        ? {
            nome: partesTitulo[0],
            sigla: null,
            placar: placarCasa,
            cor: null,
            logo: entradaCasa?.url || null,
          }
        : null;
      const visitante = partesTitulo[1]
        ? {
            nome: partesTitulo[1],
            sigla: null,
            placar: placarFora,
            cor: null,
            logo: entradaFora?.url || null,
          }
        : null;

      // Jogo sem placar, sem status ao vivo, mas com horario => "Agendado".
      const statusFinal =
        status || (placarCasa == null && (dataIso || horaTexto) ? "Agendado" : null);

      // So descarta se nao houver NADA aproveitavel (nem times, nem dados).
      const temConteudo =
        estatisticas.length ||
        escalacoes.length ||
        placarCasa != null ||
        dataIso ||
        mandante?.logo ||
        visitante?.logo;
      if (!titulo || !temConteudo) return null;

      return {
        titulo,
        competicao,
        fase,
        status: statusFinal,
        minuto,
        data: dataIso,
        local: localTexto ? { estadio: estadio || null, cidade: cidadePartes.join(", ") || null } : null,
        mandante,
        visitante,
        placar:
          mandante && visitante
            ? `${mandante.nome} ${mandante.placar ?? "?"} x ${visitante.placar ?? "?"} ${visitante.nome}`
            : null,
        probabilidade,
        estatisticas,
        transmissao,
        escalacoes,
      };
    }, htmlEscalacao || "");
  } catch {
    return null;
  }
}

export { extrairJogoDoDom };
