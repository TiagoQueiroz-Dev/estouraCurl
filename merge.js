// =====================================================
// merge.js
// Mescla coletas preservando o ULTIMO VALOR BOM de cada campo. Sem isso, uma
// coleta degradada (fallback de DOM, quando o match_fullpage nao foi capturado
// naquele ciclo) sobrescreve placar/status/sigla/cor/estatisticas/etc. com
// null/[] por cima de dados ja capturados — fazendo o JSON regredir de
// completo para nulo entre um poll e outro.
// =====================================================

// "Vazio" = o que uma coleta sem dado produz: null/undefined, array vazio,
// string vazia, ou placar com "?" (ex.: "Time ? x ? Time").
function vazio(v) {
  return (
    v == null ||
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === "string" && (v.trim() === "" || /\?\s*[x×]\s*\?/.test(v)))
  );
}

// Usa o valor NOVO quando ele tem conteudo; senao mantem o ANTERIOR.
// Objetos sao mesclados chave a chave (uniao das chaves); arrays e primitivos
// seguem a regra de "vazio" acima. Assim, campos que mudam (status, minuto,
// placar) sao atualizados quando vem preenchidos, e preservados quando a
// coleta atual nao os trouxe.
function mesclar(velho, novo) {
  if (velho == null) return novo;
  if (novo == null) return velho;
  if (Array.isArray(novo) || typeof novo !== "object") {
    return vazio(novo) && !vazio(velho) ? velho : novo;
  }
  const out = { ...velho };
  for (const k of Object.keys(novo)) out[k] = mesclar(velho[k], novo[k]);
  return out;
}

export { mesclar, vazio };
