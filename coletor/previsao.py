"""Previsão de quanto cada deputado ainda vai custar no ano (e até o fim do
mandato), a partir do que já gastou.

Método, pensado para ser explicável a qualquer pessoa:
- Parte fixa (salário, auxílio-moradia, 13º, ajuda de custo de fim de
  mandato): é conhecida pelas normas, só é somada.
- Parte variável (cota parlamentar + verba de gabinete): ritmo médio dos
  últimos meses do próprio deputado, ajustado pela sazonalidade da Câmara
  (ex.: dezembro costuma ser mais caro), estimada nos anos já fechados.
- Faixa provável (80%): variação mês a mês do próprio deputado.
"""
from datetime import date
from statistics import mean, pstdev

import config

JANELA = 6          # meses usados para medir o ritmo
Z80 = 1.2816        # 80% de confiança (normal)


def sazonalidade(resumos_fechados: list[dict]) -> list[float]:
    """Índice mensal (média = 1) do gasto variável da Câmara inteira."""
    perfis = []
    for r in resumos_fechados:
        tot = [0.0] * 12
        for d in r.get("deputados", []):
            m = d.get("mensal")
            if not m:
                continue
            for i in range(12):
                tot[i] += m["cota"][i] + m["gabinete"][i]
        media = sum(tot) / 12
        if media > 0:
            perfis.append([t / media for t in tot])
    if not perfis:
        return [1.0] * 12
    idx = [mean(p[i] for p in perfis) for i in range(12)]
    # suaviza extremos (anos com dados incompletos)
    return [round(min(max(x, 0.5), 2.0), 4) for x in idx]


def prever(linha: dict, ano: int, meses_decorridos: int, saz: list[float],
           fim_de_mandato: bool) -> dict | None:
    if meses_decorridos >= 12 or not linha.get("mensal"):
        return None
    m = linha["mensal"]
    var = [m["cota"][i] + m["gabinete"][i] for i in range(12)]
    ultimos = [i for i in range(meses_decorridos) if var[i] > 0][-JANELA:]
    # só projeta quem continua em exercício (gastou no último ou penúltimo mês)
    ativo = bool(ultimos) and ultimos[-1] >= meses_decorridos - 2
    if not ativo:
        return {"ativo": False, "restante": 0.0, "min": 0.0, "max": 0.0,
                "total_ano": linha["custo_mandato"], "ate_fim_mandato": 0.0}

    dessaz = [var[i] / saz[i] for i in ultimos]
    base = mean(dessaz)
    desvio = pstdev(dessaz) if len(dessaz) > 1 else base * 0.15
    restantes = list(range(meses_decorridos, 12))
    var_rest = sum(base * saz[i] for i in restantes)
    margem = Z80 * desvio * (len(restantes) ** 0.5) * mean(saz[i] for i in restantes)

    recebe_aux = linha["flags"].get("auxilio_moradia")
    subs = [config.valor_vigente(config.SUBSIDIO, date(ano, i + 1, 1)) for i in restantes]
    fixo_rest = sum(subs)
    if recebe_aux:
        fixo_rest += sum(config.valor_vigente(config.AUXILIO_MORADIA, date(ano, i + 1, 1)) for i in restantes)
    meses_total = linha["meses"] + len(restantes)
    fixo_rest += subs[-1] * meses_total / 12          # 13º em dezembro
    restante = var_rest + fixo_rest

    # até o fim do mandato (janeiro seguinte, quando o ano seguinte abre legislatura)
    extra_mandato = 0.0
    if fim_de_mandato:
        jan = date(ano + 1, 1, 1)
        s = config.valor_vigente(config.SUBSIDIO, jan)
        extra_mandato = base * saz[0] + s + s   # janeiro + ajuda de custo de fim de mandato
        if recebe_aux:
            extra_mandato += config.valor_vigente(config.AUXILIO_MORADIA, jan)

    return {
        "ativo": True,
        "restante": round(restante, 2),
        "min": round(max(fixo_rest, restante - margem), 2),
        "max": round(restante + margem, 2),
        "total_ano": round(linha["custo_mandato"] + restante, 2),
        "ritmo_mensal_variavel": round(base, 2),
        "ate_fim_mandato": round(restante + extra_mandato, 2) if fim_de_mandato else None,
    }


def prever_camara(linhas: list[dict], meses_decorridos: int, saz: list[float]) -> dict | None:
    prevs = [l["previsao"] for l in linhas if l.get("previsao")]
    if not prevs:
        return None
    restante = sum(p["restante"] for p in prevs)
    # margens somam em quadratura (desvios independentes)
    marg = sum(((p["max"] - p["restante"]) ** 2) for p in prevs) ** 0.5
    ja = sum(l["custo_mandato"] for l in linhas)
    mensal_previsto = [0.0] * 12
    for l in linhas:
        p = l.get("previsao")
        if not p or not p["ativo"]:
            continue
        for i in range(meses_decorridos, 12):
            mensal_previsto[i] += p["ritmo_mensal_variavel"] * saz[i]
    return {
        "ja_gasto": round(ja, 2),
        "restante": round(restante, 2),
        "min": round(restante - marg, 2),
        "max": round(restante + marg, 2),
        "total_ano": round(ja + restante, 2),
        "variavel_previsto_por_mes": [round(x) for x in mensal_previsto],
        "sazonalidade": saz,
    }
