# =====================================================
# Script para "estourar" o limite de requests da API
# football-data.org
# =====================================================

# ---- Configuracoes ----
$MaxRequests       = 10000000                                   # limite total de requests (configuravel)
$RequestsPerMinute = 10                                    # quantas requests por minuto (configuravel)
$AuthToken         = "d3a3b0e88df74248a185811e86ae52c2"    # token de autenticacao
$Url               = "https://api.football-data.org/v4/competitions/WC/matches"

# Delay entre cada request (em segundos) para respeitar o limite por minuto
$DelaySeconds = 60 / $RequestsPerMinute

# Arquivo onde fica salvo o numero da ultima requisicao feita
$StateFile = Join-Path $PSScriptRoot "ultima_request.txt"

# ---- Recupera de onde parou ----
$ultima = 0
if (Test-Path $StateFile) {
    $ultima = [int](Get-Content $StateFile -Raw).Trim()
}

$inicio = $ultima + 1

if ($inicio -gt $MaxRequests) {
    Write-Host ("Todas as {0} requests ja foram feitas. Apague '{1}' para recomecar." -f $MaxRequests, $StateFile) -ForegroundColor Yellow
    return
}

if ($ultima -gt 0) {
    Write-Host ("Continuando de onde parou: ultima request feita foi a {0}." -f $ultima) -ForegroundColor Yellow
}

# ---- Contadores ----
$sucesso = 0
$erro    = 0

for ($i = $inicio; $i -le $MaxRequests; $i++) {

    # Data e hora da request
    $timestamp = Get-Date -Format "dd/MM/yyyy HH:mm:ss"

    try {
        $resp = Invoke-WebRequest -Uri $Url `
                                  -Headers @{ "X-Auth-Token" = $AuthToken } `
                                  -Method Get `
                                  -ErrorAction Stop

        $sucesso++

        # Extrai um trecho do corpo da resposta para confirmar que a request
        # foi realmente feita e retornou dados validos
        $bodyInfo = ""
        $linhasJogos = @()   # uma entrada por jogo ao vivo (pode haver simultaneos)
        try {
            $json = $resp.Content | ConvertFrom-Json

            # Procura TODOS os jogos que estejam acontecendo agora
            $statusAoVivo = @("LIVE", "IN_PLAY", "PAUSED")
            $jogosAtuais = @($json.matches | Where-Object { $statusAoVivo -contains $_.status })

            if ($jogosAtuais.Count -gt 0) {
                # Tem jogos em andamento: monta um trecho para cada jogo, exibindo o placar
                # atual. Como podem ser simultaneos, cada jogo gera o seu proprio log.
                $linhasJogos = @()
                foreach ($jogoAtual in $jogosAtuais) {
                    $golsCasa = if ($null -ne $jogoAtual.score.fullTime.home) { $jogoAtual.score.fullTime.home } else { 0 }
                    $golsFora = if ($null -ne $jogoAtual.score.fullTime.away) { $jogoAtual.score.fullTime.away } else { 0 }
                    $linhasJogos += (" | [{0}] {1} X {2} [{3}]" -f `
                        $jogoAtual.homeTeam.name, $golsCasa, $golsFora, $jogoAtual.awayTeam.name)
                }
            }
            else {
                # Nao tem jogo agora: pega o proximo jogo agendado e mostra quanto falta.
                # A API retorna utcDate em UTC; comparamos tudo em UTC para evitar
                # erro de fuso horario (o cast direto [datetime] nao converte de forma confiavel).
                $agora = [datetime]::UtcNow
                $estiloUtc = [System.Globalization.DateTimeStyles]::AssumeUniversal -bor `
                             [System.Globalization.DateTimeStyles]::AdjustToUniversal
                $paraUtc = {
                    param($s)
                    [datetime]::Parse($s, [System.Globalization.CultureInfo]::InvariantCulture, $estiloUtc)
                }

                $proximoJogo = $json.matches |
                    Where-Object { $_.utcDate -and ((& $paraUtc $_.utcDate) -gt $agora) } |
                    Sort-Object { & $paraUtc $_.utcDate } |
                    Select-Object -First 1

                if ($proximoJogo) {
                    $golsCasa = if ($null -ne $proximoJogo.score.fullTime.home) { $proximoJogo.score.fullTime.home } else { 0 }
                    $golsFora = if ($null -ne $proximoJogo.score.fullTime.away) { $proximoJogo.score.fullTime.away } else { 0 }

                    # Calcula o tempo que falta para o jogo comecar, mostrando
                    # dias, horas e minutos no formato abreviado (ex.: "2h 29min").
                    # Apenas as unidades maiores que zero sao exibidas.
                    $restante = (& $paraUtc $proximoJogo.utcDate) - $agora

                    $dias    = [math]::Floor($restante.TotalDays)
                    $horas   = $restante.Hours
                    $minutos = $restante.Minutes

                    $partes = @()
                    if ($dias -gt 0)    { $partes += ("{0}d"   -f $dias) }
                    if ($horas -gt 0)   { $partes += ("{0}h"   -f $horas) }
                    if ($minutos -gt 0) { $partes += ("{0}min" -f $minutos) }

                    # Se faltar menos de 1 minuto, evita texto vazio
                    if ($partes.Count -eq 0) { $partes += "menos de 1min" }

                    $tempo = [string]::Join(" ", $partes)

                    $bodyInfo = (" | [{0}] {1} X {2} [{3}] (faltam {4} para o jogo comecar)" -f `
                        $proximoJogo.homeTeam.name, $golsCasa, $golsFora, $proximoJogo.awayTeam.name, $tempo)
                }
                else {
                    # Fallback: nenhum jogo em andamento nem agendado
                    $competicao    = $json.competition.name
                    $totalPartidas = $json.matches.Count
                    $bodyInfo = (" | competicao='{0}' partidas={1} (nenhum jogo em andamento ou agendado)" -f $competicao, $totalPartidas)
                }
            }
        }
        catch {
            # Se nao for um JSON valido, mostra os primeiros caracteres do corpo
            $trecho = ($resp.Content -replace "\s+", " ")
            if ($trecho.Length -gt 80) { $trecho = $trecho.Substring(0, 80) + "..." }
            $bodyInfo = (" | body='{0}'" -f $trecho)
        }

        if ($linhasJogos.Count -gt 0) {
            # Ha jogos acontecendo agora: um log por jogo, mesmo que simultaneos
            foreach ($linhaJogo in $linhasJogos) {
                Write-Host ("[{0}] [{1}/{2}] OK  - Status {3}{4}" -f $timestamp, $i, $MaxRequests, $resp.StatusCode, $linhaJogo) -ForegroundColor Green
            }
        }
        else {
            Write-Host ("[{0}] [{1}/{2}] OK  - Status {3}{4}" -f $timestamp, $i, $MaxRequests, $resp.StatusCode, $bodyInfo) -ForegroundColor Green
        }
    }
    catch {
        $erro++
        $status = $_.Exception.Response.StatusCode.value__

        # Tenta ler o corpo da resposta de erro para confirmar a mensagem da API
        $errBody = ""
        try {
            $stream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $conteudo = $reader.ReadToEnd()
            $reader.Close()
            $conteudo = ($conteudo -replace "\s+", " ")
            if ($conteudo.Length -gt 120) { $conteudo = $conteudo.Substring(0, 120) + "..." }
            if ($conteudo) { $errBody = (" | body='{0}'" -f $conteudo) }
        }
        catch { }

        Write-Host ("[{0}] [{1}/{2}] ERRO - Status {3}{4}" -f $timestamp, $i, $MaxRequests, $status, $errBody) -ForegroundColor Red
    }

    # Salva o numero da ultima request feita (para continuar de onde parou)
    Set-Content -Path $StateFile -Value $i

    # Espera entre requests para respeitar o limite por minuto
    # (nao espera depois da ultima request)
    if ($i -lt $MaxRequests) {
        Start-Sleep -Seconds $DelaySeconds
    }
}

# ---- Resumo final ----
Write-Host ""
Write-Host "==================== RESUMO ====================" -ForegroundColor Cyan
Write-Host ("Total de requests : {0}" -f $MaxRequests)
Write-Host ("Sucesso           : {0}" -f $sucesso)
Write-Host ("Erro              : {0}" -f $erro)
Write-Host "===============================================" -ForegroundColor Cyan
