"""Consolida as fontes no custo de cada deputado por ano.

Custo do mandato = salário (subsídio + 13º) + ajudas de custo +
auxílio-moradia + cota parlamentar + verba de gabinete. Emendas ficam à
parte: são recursos que o deputado destina, não gasto com ele.
"""
from datetime import date

import config


def meses_de_mandato(perfil: dict | None, ceap: dict | None, meses_decorridos: int) -> list[int]:
    """Meses em exercício no ano, a partir dos meses com verba de gabinete ou
    cota parlamentar (só quem está em exercício as usa). Preenche os buracos
    entre o primeiro e o último mês. A tabela de gabinete da página costuma
    não trazer dezembro: em ano fechado, quem ia até novembro conta dezembro."""
    meses = set()
    if perfil:
        meses |= {int(k) for k, v in (perfil.get("verba_gabinete") or {})
                  .get("por_mes", {}).items() if v and v > 0}
        # a tabela da cota na página costuma estar mais atualizada que a do gabinete
        meses |= {int(k) for k, v in ((perfil.get("cota_parlamentar") or {})
                  .get("por_mes") or {}).items() if v and v > 0}
    if ceap:
        meses |= {int(k) for k, v in (ceap.get("por_mes") or {}).items() if v > 0}
    if not meses:
        return list(range(1, meses_decorridos + 1))
    ini, fim = min(meses), max(meses)
    if fim == 11 and meses_decorridos == 12:
        fim = 12
    return list(range(ini, fim + 1))


def ajuda_de_custo(ano: int, meses: list[int], subsidio_ref: float, ano_fechado: bool) -> float:
    if not meses:
        return 0.0
    if ano <= config.ULTIMO_ANO_14_15:
        # 14º e 15º: um no início e outro no fim da sessão legislativa
        n = (1 if 2 in meses else 0) + (1 if ano_fechado and 12 in meses else 0)
        return n * subsidio_ref
    if ano in config.anos_de_inicio_de_legislatura():
        # fim do mandato anterior (janeiro) e início do novo (fevereiro)
        n = (1 if 1 in meses else 0) + (1 if 2 in meses else 0)
        return n * subsidio_ref
    return 0.0


def calcular(dep: dict, ano: int, perfil: dict | None, ceap: dict | None,
             emendas: dict | None, meses_decorridos: int) -> dict:
    meses = meses_de_mandato(perfil, ceap, meses_decorridos)
    meses = [m for m in meses if m <= meses_decorridos]
    ano_fechado = meses_decorridos == 12

    subsidios = [config.valor_vigente(config.SUBSIDIO, date(ano, m, 1)) for m in meses]
    salario = sum(subsidios)
    # 13º proporcional, pago em dezembro (no ano corrente ainda não entra)
    decimo = (subsidios[-1] * len(meses) / 12) if (subsidios and ano_fechado) else 0.0
    ajuda = ajuda_de_custo(ano, meses, subsidios[-1] if subsidios else 0.0, ano_fechado)

    recebe_aux = (perfil or {}).get("recebe_auxilio_moradia")
    auxilio = sum(config.valor_vigente(config.AUXILIO_MORADIA, date(ano, m, 1))
                  for m in meses) if recebe_aux else 0.0

    cota = (ceap or {}).get("total")
    if cota is None:
        cota = ((perfil or {}).get("cota_parlamentar") or {}).get("gasto")
    gabinete = ((perfil or {}).get("verba_gabinete") or {}).get("gasto")

    # ---- série mensal (para os gráficos por mês)
    fixo = [0.0] * 12
    for m, s in zip(meses, subsidios):
        fixo[m - 1] += s
        if recebe_aux:
            fixo[m - 1] += config.valor_vigente(config.AUXILIO_MORADIA, date(ano, m, 1))
    if decimo:
        fixo[11] += decimo
    if ajuda:
        # 14º/15º em fev e dez; ajudas de mandato em jan e fev
        ref = subsidios[-1]
        if ano <= config.ULTIMO_ANO_14_15:
            if 2 in meses: fixo[1] += ref
            if ano_fechado and 12 in meses: fixo[11] += ref
        else:
            if 1 in meses: fixo[0] += ref
            if 2 in meses: fixo[1] += ref
    cota_m = [0.0] * 12
    for k, v in ((ceap or {}).get("por_mes") or {}).items():
        if 1 <= int(k) <= 12:
            cota_m[int(k) - 1] = v
    # A página oficial do deputado traz a cota mês a mês com tudo o que a Câmara
    # pagou; o arquivo nota a nota deixa de fora parte das despesas (desde ago/2025,
    # as passagens compradas pelo sistema da Câmara — SIGEPA). Onde as duas fontes
    # divergem num mês, vale a página oficial e a diferença fica separada.
    sem_nota = 0.0
    pmes = ((perfil or {}).get("cota_parlamentar") or {}).get("por_mes") or {}
    if ceap is not None and pmes:
        for k, v in pmes.items():
            m = int(k)
            if 1 <= m <= 12 and v is not None and abs(v - cota_m[m - 1]) > 1:
                sem_nota += v - cota_m[m - 1]
                cota_m[m - 1] = v
        cota = (cota or 0.0) + sem_nota
    gab_m = [0.0] * 12
    for k, v in (((perfil or {}).get("verba_gabinete") or {}).get("por_mes") or {}).items():
        if 1 <= int(k) <= 12 and v:
            gab_m[int(k) - 1] = v
    # a tabela mensal da Câmara costuma omitir dezembro: a diferença vai para dez
    if gabinete and ano_fechado:
        falta = gabinete - sum(gab_m)
        if falta > 1:
            gab_m[11] += falta

    custos = {
        "salario": round(salario + decimo, 2),
        "ajuda_de_custo": round(ajuda, 2),
        "auxilio_moradia": round(auxilio, 2),
        "cota_parlamentar": round(cota or 0.0, 2),
        "verba_gabinete": round(gabinete or 0.0, 2),
    }
    total = round(sum(custos.values()), 2)
    em = emendas or {}
    return {
        **{k: dep.get(k) for k in ("id", "nome", "partido", "uf", "foto", "em_exercicio")},
        "meses": len(meses),
        "custos": custos,
        "custo_mandato": total,
        "custo_mensal_medio": round(total / len(meses), 2) if meses else 0.0,
        "cota_sem_nota": round(sem_nota, 2),
        "emendas_empenhado": em.get("empenhado", 0.0),
        "emendas_pago": em.get("pago", 0.0),
        "mensal": {
            "fixo": [round(x) for x in fixo],
            "cota": [round(x) for x in cota_m],
            "gabinete": [round(x) for x in gab_m],
        },
        "flags": {
            "auxilio_moradia": recebe_aux,
            "imovel_funcional": (perfil or {}).get("imovel_funcional"),
            "pessoal_gabinete": (perfil or {}).get("pessoal_gabinete"),
            "perfil_lido": perfil is not None,
            "sem_verba_gabinete": gabinete is None,
            "sem_cota": cota is None,
        },
    }
