"""Robô da Receita Federal: cadastro e sócios de todos os fornecedores da cota.

Uso:
    python receita.py            # só processa se houver base nova da Receita
    python receita.py --forcar   # refaz mesmo com a mesma base

Roda pelo GitHub Actions (receita-e-projetos.yml), uma vez por semana: confere se a
Receita publicou uma base nova (é mensal) e, se sim, baixa e processa.

Saídas:
    docs/dados/receita/meta.json               -> base usada, fonte, data, contagens
    docs/dados/receita/cadastro/XX.json        -> cadastro + sócios de cada fornecedor (CNPJ)
    docs/dados/receita/deputados_socios.json   -> deputados encontrados como sócios de empresas
    docs/dados/receita/cruz/XX.json, alertas.json  (cruzamento com a cota; ver coletor/cruzamento.py)
"""
import argparse
import json
import logging
import os
import shutil
import sys
import tempfile
import traceback
from datetime import datetime, timezone
from pathlib import Path

from coletor import camara, cruzamento, notas, receita

RAIZ = Path(__file__).parent
SAIDA = RAIZ / "docs" / "dados"
BRUTOS = RAIZ / "dados_brutos"
log = logging.getLogger("qcd")


def ler(p: Path, padrao=None):
    return json.loads(p.read_text("utf-8")) if p.exists() else padrao


def gravar(p: Path, obj):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), "utf-8")


def fornecedores_com_cnpj() -> set[str]:
    """Todos os CNPJs que já receberam da cota, em todos os anos coletados."""
    alvos = set()
    for p in SAIDA.glob("*/fornecedores.json"):
        if not p.parent.name.isdigit():
            continue
        f = ler(p, {}) or {}
        if f.get("formato") != 2:
            continue
        for linha in f["linhas"]:
            if linha[3] == "PJ" and len(linha[0]) == 14 and linha[0].isdigit():
                alvos.add(linha[0])
    return alvos


def chaves_deputados() -> dict:
    """Trecho do CPF + nomes de cada deputado. Completa os anos que faltarem
    baixando o arquivo da cota daquele ano (só é preciso uma vez)."""
    arq = BRUTOS / "deputados_chaves.json"
    dados = ler(arq, {"anos": [], "deps": {}}) or {"anos": [], "deps": {}}
    anos = sorted(int(p.parent.name) for p in SAIDA.glob("*/resumo.json") if p.parent.name.isdigit())
    for ano in anos:
        if ano in dados["anos"]:
            continue
        try:
            log.info("Chaves dos deputados: lendo a cota de %s...", ano)
            for dep_id, x in camara.chaves_deputados(camara.baixar_ceap(ano)).items():
                dados["deps"].setdefault(str(dep_id), {}).update(x)
            dados["anos"] = sorted(set(dados["anos"]) | {ano})
        except Exception as e:  # noqa: BLE001
            log.warning("cota de %s indisponível para as chaves: %s", ano, e)
    gravar(arq, dados)
    detalhes = ler(BRUTOS / "deputados_detalhes.json", {}) or {}
    for dep_id, x in dados["deps"].items():
        civil = (detalhes.get(dep_id) or {}).get("nome_civil")
        if civil:
            x["nome_civil"] = civil
    return dados["deps"]


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--forcar", action="store_true", help="refaz mesmo se a base for a mesma")
    ap.add_argument("--pasta-tmp", help="onde guardar os arquivos baixados (padrão: pasta temporária)")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    pasta = SAIDA / "receita"
    meta = ler(pasta / "meta.json", {}) or {}
    try:
        loc = receita.descobrir()
    except receita.ReceitaIndisponivel as e:
        log.error("%s", e)
        return 1
    if loc["mes"] == meta.get("base") and not args.forcar:
        log.info("Receita: base %s já processada. Nada a fazer (use --forcar para refazer).", loc["mes"])
        cruzamento.gerar(SAIDA, BRUTOS)
        return 0

    alvos = fornecedores_com_cnpj()
    if not alvos:
        log.error("Nenhum fornecedor com CNPJ nos dados do site: rode o robô principal antes.")
        return 1
    invalidos = sorted(c for c in alvos if not receita.cnpj_valido(c))
    log.info("Receita: %d CNPJs de fornecedores (%d com dígito verificador inválido)", len(alvos), len(invalidos))
    deps = chaves_deputados()
    tmp = Path(args.pasta_tmp or os.environ.get("RUNNER_TEMP") or tempfile.gettempdir()) / "receita_cnpj"
    try:
        res = receita.coletar(alvos, deps, tmp, loc=loc)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    # grava em grupos (o site abre só o grupo do fornecedor clicado)
    grupos = {}
    for c14, x in res["cadastro"].items():
        grupos.setdefault(notas.grupo(c14), {})[c14] = x
    shutil.rmtree(pasta / "cadastro", ignore_errors=True)
    for g, conteudo in grupos.items():
        gravar(pasta / "cadastro" / f"{g}.json", conteudo)
    gravar(pasta / "deputados_socios.json", res["deputados_socios"])
    gravar(pasta / "meta.json", {
        "base": res["base"], "fonte": res["fonte"],
        "processado_em": datetime.now(timezone.utc).isoformat(timespec="minutes"),
        "estatisticas": res["estatisticas"], "cnpjs_invalidos": len(invalidos),
    })
    log.info("Receita: %s", res["estatisticas"])
    cruzamento.gerar(SAIDA, BRUTOS)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        sys.exit(1)
