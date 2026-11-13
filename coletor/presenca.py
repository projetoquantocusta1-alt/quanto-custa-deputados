"""Presença dos deputados no Plenário e em comissões (dados abertos da Câmara).

Fontes (arquivos anuais):
  eventos-AAAA.csv                    -> sessões e reuniões (data, tipo, situação, órgão)
  eventosPresencaDeputados-AAAA.csv   -> quem registrou presença em cada evento

Como contamos, do jeito da Câmara: a frequência é por DIA com sessão deliberativa
no Plenário. O deputado está presente no dia se registrou presença em ao menos uma
sessão deliberativa daquele dia. Dias sem sessão deliberativa não contam; recesso
parlamentar aparece só como contexto. Só entram os dias dos meses em que o deputado
estava em exercício. A classificação oficial em falta justificada / não justificada
não está nos dados abertos: quando a página do deputado mostra esses números, eles
são guardados à parte, como "oficial".
"""
import csv
import io
import unicodedata
from collections import defaultdict
from datetime import date

import config


def _norm(s: str) -> str:
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower().strip()


def ler_csv(conteudo: bytes) -> list[dict]:
    txt = conteudo.decode("utf-8-sig", errors="replace")
    return list(csv.DictReader(io.StringIO(txt), delimiter=";"))


def _g(r: dict, *nomes) -> str:
    for n in nomes:
        v = r.get(n)
        if v not in (None, ""):
            return str(v)
    return ""


def _id(uri_ou_id: str) -> str:
    return (uri_ou_id or "").rstrip("/").split("/")[-1]


def eh_sessao_deliberativa(tipo: str) -> bool:
    t = _norm(tipo)
    return "sessao deliberativa" in t and "nao deliberativa" not in t


def eh_reuniao_comissao(tipo: str, orgao: str) -> bool:
    t, o = _norm(tipo), _norm(orgao)
    return ("reuniao" in t or "audiencia" in t) and "plenario" not in o


def cancelado(situacao: str) -> bool:
    s = _norm(situacao)
    return "cancelad" in s or "nao realizad" in s or "adiad" in s


def em_recesso(d: date) -> bool:
    for (m1, d1), (m2, d2) in config.RECESSOS:
        if (m1, d1) <= (d.month, d.day) <= (m2, d2):
            return True
    return False


def calcular(eventos: list[dict], presencas: list[dict], meses_por_dep: dict[int, list[int]], ano: int,
             oficiais: dict[int, dict] | None = None) -> dict:
    """Resumo do ano: dias de sessão, e por deputado presenças, faltas (com as datas) e comissões."""
    sess_dia = defaultdict(list)          # data -> [[id_evento, descrição]]
    ev_dia, ev_comissao = {}, set()
    for e in eventos:
        eid = _g(e, "id") or _id(_g(e, "uri"))
        ini = _g(e, "dataHoraInicio")[:10]
        if not eid or not ini.startswith(str(ano)) or cancelado(_g(e, "situacao")):
            continue
        tipo = _g(e, "descricaoTipo", "tipo")
        orgao = _g(e, "orgaos.sigla", "localCamara.nome", "orgaos_sigla", "siglaOrgao")
        if eh_sessao_deliberativa(tipo):
            sess_dia[ini].append([int(eid) if eid.isdigit() else eid, _g(e, "descricao")[:140] or tipo])
            ev_dia[eid] = ini
        elif eh_reuniao_comissao(tipo, orgao):
            ev_comissao.add(eid)
    dias = sorted(sess_dia)

    pres_dias = defaultdict(set)
    com = defaultdict(int)
    for p in presencas:
        eid = _g(p, "idEvento") or _id(_g(p, "uriEvento"))
        did = _g(p, "idDeputado") or _id(_g(p, "uriDeputado"))
        if not did.isdigit():
            continue
        if eid in ev_dia:
            pres_dias[int(did)].add(ev_dia[eid])
        elif eid in ev_comissao:
            com[int(did)] += 1

    deps = {}
    for dep_id, meses in meses_por_dep.items():
        ms = set(meses)
        dias_dep = [d for d in dias if int(d[5:7]) in ms]
        if not dias_dep:
            continue
        presentes = sorted(set(dias_dep) & pres_dias.get(dep_id, set()))
        faltas = [d for d in dias_dep if d not in pres_dias.get(dep_id, set())]
        deps[str(dep_id)] = {
            "dias": len(dias_dep), "presencas": len(presentes), "faltas": len(faltas),
            "taxa": round(len(presentes) / len(dias_dep), 4),
            "datas_falta": faltas,
            "reunioes_comissao": com.get(dep_id, 0),
            "meses": sorted(ms),
            "oficial": (oficiais or {}).get(dep_id),
        }
    por_mes = defaultdict(int)
    for d in dias:
        por_mes[int(d[5:7])] += 1
    return {
        "ano": ano, "dias_sessao": dias, "sessoes": {d: sess_dia[d] for d in dias},
        "dias_por_mes": [por_mes.get(m, 0) for m in range(1, 13)],
        "recessos": [[f"{ano}-{m1:02d}-{d1:02d}", f"{ano}-{m2:02d}-{d2:02d}"] for (m1, d1), (m2, d2) in config.RECESSOS],
        "reunioes_comissao_total": len(ev_comissao),
        "deputados": deps,
        "url_evento": config.URL_EVENTO,
    }
