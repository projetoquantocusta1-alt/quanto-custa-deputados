"""Robô dos projetos aprovados na Câmara, com nota de relevância para a população.

Uso:
    python projetos.py              # baixa só os anos cujos arquivos mudaram
    python projetos.py --tudo       # refaz todos os anos

Saídas:
    docs/dados/projetos/aprovados.json     -> lista completa, com nota, nível e motivos
    docs/dados/projetos/por_deputado.json  -> quantos projetos aprovados cada deputado assina
    dados_brutos/projetos/AAAA.json        -> cache por ano de apresentação
"""
import argparse
import json
import logging
import sys
import traceback
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path

import config
from coletor import http, projetos

RAIZ = Path(__file__).parent
SAIDA = RAIZ / "docs" / "dados" / "projetos"
CACHE = RAIZ / "dados_brutos" / "projetos"
log = logging.getLogger("qcd")


def ler(p: Path, padrao=None):
    return json.loads(p.read_text("utf-8")) if p.exists() else padrao


def gravar(p: Path, obj):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), "utf-8")


def baixar(url: str, etag: str | None):
    """(conteúdo ou None se não mudou, etag)."""
    cab = {"If-None-Match": etag} if etag else {}
    r = http.sessao().get(url, headers=cab, timeout=(30, 300))
    if r.status_code == 304:
        return None, etag
    r.raise_for_status()
    return r.content, r.headers.get("ETag") or r.headers.get("Last-Modified")


def agregar_por_deputado(itens: list[dict]) -> dict:
    """Por deputado: aprovados, leis e quantos de cada nível de relevância (no total e por ano de aprovação).
    Relevantes = alto + médio; supérfluos = baixo + simbólico (homenagens, datas, nomes, concessões de rádio/TV).
    rel_autor = relevantes em que o deputado é o primeiro autor."""
    por_dep = {}
    for x in itens:
        a = x["data"][:4]
        prim = x["deputados_autores"][0][0] if x["deputados_autores"] else None
        nv = x["nivel"]
        for d in x["deputados_autores"]:
            o = por_dep.setdefault(str(d[0]), {"nome": d[1], "aprovados": 0, "leis": 0, "alto": 0, "medio": 0, "baixo": 0,
                                                "simbolico": 0, "rel_autor": 0, "ids": [], "anos": {}})
            rel_autor = nv in ("alto", "medio") and prim == d[0]
            o["aprovados"] += 1
            o["leis"] += x["situacao"] == "lei"
            o[nv] = o.get(nv, 0) + 1
            o["rel_autor"] += rel_autor
            o["ids"].append(x["id"])
            # por ano de aprovação: [aprovados, viraram lei, alta, média, principal autor, baixa, simbólica, relevantes como 1º autor]
            y = o["anos"].setdefault(a, [0, 0, 0, 0, 0, 0, 0, 0])
            y[0] += 1; y[1] += x["situacao"] == "lei"; y[2] += nv == "alto"; y[3] += nv == "medio"
            y[4] += prim == d[0]; y[5] += nv == "baixo"; y[6] += nv == "simbolico"; y[7] += rel_autor
    return por_dep


def datas_de_aprovacao(itens: list[dict], minutos: float) -> dict[str, str]:
    """{id: data da aprovação na Câmara}, pelo histórico de tramitação de cada proposição (API da Câmara).
    A data não muda depois, então fica guardada em dados_brutos/projetos/aprovacao.json e só os projetos
    novos são consultados. O que não der tempo fica para a próxima execução (com a data estimada)."""
    import time
    from concurrent.futures import ThreadPoolExecutor
    arq = RAIZ / "dados_brutos" / "projetos_aprovacao.json"
    guard = ler(arq, {}) or {}
    falta = [str(x["id"]) for x in itens if str(x["id"]) not in guard]
    log.info("Datas de aprovação: %d guardadas, %d para consultar", len(guard), len(falta))
    ses = http.sessao()
    fim = time.time() + minutos * 60

    def uma(pid):
        if time.time() > fim:
            return pid, None
        try:
            r = ses.get(config.API_CAMARA + f"/proposicoes/{pid}/tramitacoes", headers={"Accept": "application/json"}, timeout=(20, 60))
            if r.status_code != 200:
                return pid, None
            time.sleep(0.25)
            return pid, projetos.data_aprovacao(r.json().get("dados") or []) or ""
        except Exception:  # noqa: BLE001
            return pid, None
    novas = 0
    with ThreadPoolExecutor(max_workers=3) as ex:
        for i, (pid, d) in enumerate(ex.map(uma, falta), 1):
            if d is not None:
                guard[pid] = d
                novas += 1
            if i % 500 == 0:
                log.info("  %d/%d consultadas", i, len(falta))
                gravar(arq, guard)
    gravar(arq, guard)
    log.info("Datas de aprovação: %d novas; %d ainda sem data (ficam para a próxima)", novas, len([p for p in falta if p not in guard]))
    return {k: v for k, v in guard.items() if v}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--tudo", action="store_true")
    ap.add_argument("--anos", type=int, nargs="*")
    ap.add_argument("--minutos-tramitacao", type=float, default=150, help="tempo máximo para buscar datas de aprovação")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    anos = args.anos or list(range(config.PROP_ANO_APRESENTACAO_INICIAL, date.today().year + 1))
    erros = 0
    for ano in anos:
        cp = CACHE / f"{ano}.json"
        cache = ler(cp, {}) or {}
        try:
            corpo, etag = baixar(config.PROP_CSV.format(ano=ano), None if args.tudo else cache.get("etag"))
            if corpo is None and cache.get("itens") is not None and cache.get("versao") == VERSAO:
                log.info("%s: sem mudança", ano)
                continue
            if corpo is None:
                corpo, etag = baixar(config.PROP_CSV.format(ano=ano), None)
            temas, _ = baixar(config.PROP_TEMAS_CSV.format(ano=ano), None)
            try:
                autores, _ = baixar(config.PROP_AUTORES_CSV.format(ano=ano), None)
            except Exception as e:  # noqa: BLE001
                log.warning("%s: autores indisponíveis (%s)", ano, e)
                autores = b""
            props = projetos.ler_csv(corpo)
            itens = projetos.aprovados_do_ano(props, projetos.ler_csv(temas or b""), projetos.ler_csv(autores or b""),
                                              config.PROP_APROVADOS_DESDE)
            gravar(cp, {"etag": etag, "versao": VERSAO, "proposicoes": len(props), "itens": itens})
            log.info("%s: %d proposições, %d aprovadas desde %s", ano, len(props), len(itens), config.PROP_APROVADOS_DESDE)
        except Exception as e:  # noqa: BLE001
            erros += 1
            log.error("%s falhou: %s (mantendo o que já havia)", ano, e)

    # junta tudo (sem repetir: a mesma proposição só aparece no ano em que foi apresentada)
    todos = {}
    for p in sorted(CACHE.glob("*.json")):
        for it in (ler(p, {}) or {}).get("itens", []):
            todos[it["id"]] = it
    # diagnóstico: guarda o histórico completo de uma amostra de projetos (ids em dados_brutos/projetos_amostra_ids.txt)
    amostra = RAIZ / "dados_brutos" / "projetos_amostra_ids.txt"
    if amostra.exists():
        hist = {}
        for pid in amostra.read_text().split():
            try:
                r = http.sessao().get(config.API_CAMARA + f"/proposicoes/{pid}/tramitacoes", headers={"Accept": "application/json"}, timeout=(20, 60))
                hist[pid] = {"item": {k: todos.get(int(pid), {}).get(k) for k in ("sigla", "numero", "ano", "apresentacao", "data", "situacao_camara")},
                             "tramitacoes": r.json().get("dados") if r.status_code == 200 else r.status_code}
            except Exception as e:  # noqa: BLE001
                hist[pid] = str(e)
        gravar(RAIZ / "dados_brutos" / "projetos_amostra_tramitacoes.json", hist)
        log.info("Amostra de tramitações gravada (%d projetos)", len(hist))
    # ano da APROVAÇÃO (e não da última movimentação, que muda a cada ofício ou recebimento)
    datas = datas_de_aprovacao(list(todos.values()), args.minutos_tramitacao)
    for it in todos.values():
        it["data_situacao"] = it.get("data_situacao") or it["data"]
        d = datas.get(str(it["id"]))
        it["data"] = d or it["data_situacao"]
        it["data_estimada"] = not d
    todos = {k: v for k, v in todos.items() if int(v["data"][:4]) >= config.PROP_APROVADOS_DESDE}
    itens = sorted(todos.values(), key=lambda x: (x["data"], x["nota"]), reverse=True)
    niveis = Counter(x["nivel"] for x in itens)
    por_dep = agregar_por_deputado(itens)
    # arquivos leves para o site: um por ano de aprovação (ementa encurtada) e um resumo
    por_ano = {}
    for x in itens:
        por_ano.setdefault(x["data"][:4], []).append({**x, "ementa": x["ementa"][:320] + ("…" if len(x["ementa"]) > 320 else ""),
                                                      "motivos": x["motivos"][:4]})
    for a, lst in por_ano.items():
        gravar(SAIDA / f"ano_{a}.json", {"ano": int(a), "url_proposicao": config.URL_PROPOSICAO, "itens": lst})
    temas = Counter(t for x in itens if x["nivel"] in ("alto", "medio") for t in x["temas"])
    gravar(SAIDA / "resumo.json", {
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="minutes"), "criterio_versao": VERSAO,
        "desde": config.PROP_APROVADOS_DESDE, "niveis": dict(niveis), "total": len(itens),
        "por_ano": {a: dict(Counter(x["nivel"] for x in lst), total=len(lst), leis=sum(x["situacao"] == "lei" for x in lst))
                    for a, lst in sorted(por_ano.items())},
        "temas_relevantes": temas.most_common(20),
        "url_proposicao": config.URL_PROPOSICAO,
    })
    gravar(SAIDA / "aprovados.json", {
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="minutes"),
        "fonte": "Câmara dos Deputados — dados abertos (proposições, temas e autores por ano)",
        "criterio_versao": VERSAO, "desde": config.PROP_APROVADOS_DESDE, "niveis": dict(niveis),
        "url_proposicao": config.URL_PROPOSICAO, "itens": itens,
    })
    gravar(SAIDA / "por_deputado.json", por_dep)
    log.info("Projetos aprovados: %d (%s)", len(itens), dict(niveis))
    return 1 if erros == len(anos) else 0


VERSAO = 1   # sobe quando o critério de relevância muda: refaz todos os anos

if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        sys.exit(1)
