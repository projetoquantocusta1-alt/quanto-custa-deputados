"""Atualiza os dados do site "Quanto custa um deputado".

Uso:
    python atualizar.py                 # ano corrente (+ anos ainda sem dados)
    python atualizar.py --anos 2024 2025
    python atualizar.py --pendentes     # só lista os anos a coletar (p/ o robô)
    python atualizar.py --limite 5      # teste rápido com 5 deputados

Saídas (servidas pelo site):
    docs/dados/meta.json               -> data da atualização, anos, fontes
    docs/dados/historico.json          -> série anual (nominal e corrigida pelo IPCA)
    docs/dados/AAAA/resumo.json        -> ranking do ano
    docs/dados/AAAA/dep/ID.json        -> detalhe do deputado no ano
    docs/dados/deputados/ID.json       -> trajetória do deputado ano a ano
    docs/dados/fotos/ID.jpg            -> foto oficial (pequena), para as imagens de compartilhar
    docs/dados/novas/                  -> notas novas do dia (ver coletor/novas.py)
Caches (não servidos): dados_brutos/
"""
import argparse
import json
import logging
import sys
import traceback
from datetime import date, datetime, timezone
from pathlib import Path

import config
from coletor import analises, camara, cruzamento, custos, http, ipca, notas, novas, presenca, previsao, transparencia

RAIZ = Path(__file__).parent
SAIDA = RAIZ / "docs" / "dados"
BRUTOS = RAIZ / "dados_brutos"

log = logging.getLogger("qcd")


# ------------------------------------------------------------------ arquivos
def ler(p: Path, padrao=None):
    return json.loads(p.read_text("utf-8")) if p.exists() else padrao


def gravar(p: Path, obj):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), "utf-8")


def anos_com_dados() -> list[int]:
    return sorted(int(p.parent.name) for p in SAIDA.glob("*/resumo.json") if p.parent.name.isdigit())


def anos_pendentes(hoje: date) -> list[int]:
    feitos = set(anos_com_dados())
    # anos já publicados mas ainda sem os fornecedores por partido/estado também entram na fila
    faltam = [a for a in range(config.ANO_INICIAL, hoje.year + 1)
              if a not in feitos or not (SAIDA / str(a) / "forn_grupos").is_dir()
              or (a >= config.PRESENCA_DESDE and not (SAIDA / str(a) / "presenca.json").exists())]
    # o ano corrente sempre entra; de janeiro a março, também o anterior
    # (notas de dezembro continuam chegando); os atrasados, do mais recente ao mais antigo
    fixos = [hoje.year] + ([hoje.year - 1] if hoje.month <= 3 else [])
    return fixos + sorted((a for a in faltam if a not in fixos), reverse=True)


def meses_decorridos(ano: int, hoje: date) -> int:
    if ano < hoje.year:
        return 12
    return max(hoje.month - 1, 1)  # mês corrente ainda está aberto


def legislaturas_do_ano(ano: int) -> list[int]:
    return [n for n, ini, fim in config.LEGISLATURAS if ini.year <= ano <= fim.year]


# ----------------------------------------------------------------- deputados
def obter_deputados(anos: list[int], ceap_bruto: dict, status: dict) -> list[dict]:
    """API -> cache da última execução -> arquivo da cota."""
    cache_p = BRUTOS / "deputados.json"
    cache = {d["id"]: d for d in ler(cache_p, [])}
    legs = sorted({l for a in anos for l in legislaturas_do_ano(a)})
    try:
        log.info("Deputados (API da Câmara, legislaturas %s)...", legs)
        for d in camara.listar_deputados(legs):
            antigo = cache.get(d["id"], {})
            d["legislaturas"] = sorted(set(antigo.get("legislaturas", [])) | set(d["legislaturas"]))
            cache[d["id"]] = {**antigo, **d}
        gravar(cache_p, list(cache.values()))
        status["deputados"] = f"ok ({len(cache)})"
    except Exception as e:  # noqa: BLE001
        log.error("API de deputados falhou: %s", e)
        status["deputados"] = "API fora do ar; usando cache e arquivo da cota"

    for df in ceap_bruto.values():
        for d in camara.deputados_do_ceap(df):
            if d["id"] not in cache:
                cache[d["id"]] = d
    return list(cache.values())


def enriquecer_deputados(deps: list[dict]) -> list[dict]:
    cache_p = BRUTOS / "deputados_detalhes.json"
    cache = {int(k): v for k, v in ler(cache_p, {}).items()}
    falhas = 0
    for i, d in enumerate(deps):
        if d["id"] in cache and "sexo" in cache[d["id"]]:
            continue
        try:
            cache[d["id"]] = camara.detalhar_deputado(d["id"])
        except http.SiteForaDoAr:
            log.warning("API fora do ar: pulando detalhes dos deputados.")
            break
        except Exception as e:  # noqa: BLE001
            falhas += 1
            log.warning("detalhe %s falhou: %s", d["id"], e)
            if falhas >= 3:   # os detalhes são opcionais: não vale travar a coleta
                log.warning("API instável: o resto dos detalhes fica para outro dia.")
                break
            continue
        if i % 50 == 0:
            gravar(cache_p, cache)
    gravar(cache_p, cache)
    for d in deps:
        d.update(cache.get(d["id"], {}))
    return deps


def deputados_do_ano(deps, ano, ceap_df, hoje) -> list[dict]:
    """Quem teve mandato no ano: aparece na cota do ano ou, sem a cota, é de
    uma legislatura que cobre o ano (ou está em exercício, no ano corrente)."""
    ids = set()
    if ceap_df is not None and not ceap_df.empty:
        ids |= set(int(i) for i in ceap_df["id"].unique())
    legs = set(legislaturas_do_ano(ano))
    for d in deps:
        if legs & set(d.get("legislaturas") or []) and (ceap_df is None or ceap_df.empty):
            ids.add(d["id"])
        if ano == hoje.year and d.get("em_exercicio"):
            ids.add(d["id"])
    return [d for d in deps if d["id"] in ids]


# -------------------------------------------------------------------- perfis
def coletar_perfis(deps, ano, reaproveitar: bool) -> dict:
    cache_p = BRUTOS / f"perfis_{ano}.json"
    cache = {int(k): v for k, v in ler(cache_p, {}).items()}
    for i, d in enumerate(deps, 1):
        if reaproveitar and cache.get(d["id"], {}).get("versao") == camara.VERSAO_PARSER:
            continue
        try:
            cache[d["id"]] = camara.coletar_perfil(d["id"], ano)
        except http.SiteForaDoAr:
            log.warning("Site da Câmara fora do ar: perfis de %s ficam com o cache.", ano)
            break
        except Exception as e:  # noqa: BLE001
            log.warning("perfil %s/%s falhou: %s", d["id"], ano, e)
        if i % 25 == 0:
            log.info("  perfis %s: %d/%d", ano, i, len(deps))
            gravar(cache_p, cache)
    gravar(cache_p, cache)
    return cache


def tem_atividade(perfil, ceap) -> bool:
    if ceap and ceap.get("total", 0) > 0:
        return True
    if perfil:
        g = (perfil.get("verba_gabinete") or {}).get("gasto") or 0
        c = (perfil.get("cota_parlamentar") or {}).get("gasto") or 0
        return g > 0 or c > 0
    return False


# ------------------------------------------------- chaves para a Receita
def guardar_chaves_deputados(ceap_bruto: dict):
    """Guarda, por deputado, só os 6 dígitos do meio do CPF (o mesmo trecho que a
    Receita mostra no quadro de sócios) e o nome, para o cruzamento com a Receita."""
    arq = BRUTOS / "deputados_chaves.json"
    dados = ler(arq, {"anos": [], "deps": {}}) or {"anos": [], "deps": {}}
    for ano, df in ceap_bruto.items():
        for dep_id, x in camara.chaves_deputados(df).items():
            dados["deps"].setdefault(str(dep_id), {}).update(x)
        if ano not in dados["anos"]:
            dados["anos"] = sorted(set(dados["anos"]) | {ano})
    gravar(arq, dados)


# --------------------------------------------------------------------- fotos
def baixar_fotos(ids, largura=180):
    """Foto oficial de cada deputado, reduzida, no próprio site (assim a imagem
    de compartilhar pode usá-la). Só baixa quem ainda não tem; quem não tem foto
    na Câmara é lembrado por 60 dias para não insistir todo dia."""
    try:
        from PIL import Image
    except ImportError:
        log.warning("Pillow não instalado: fotos ficam para depois.")
        return
    import io
    pasta = SAIDA / "fotos"
    sem_p = BRUTOS / "fotos_sem.json"
    sem = {int(k): v for k, v in (ler(sem_p, {}) or {}).items()}
    hoje = date.today().toordinal()
    novos, erros = 0, 0
    for dep_id in ids:
        arq = pasta / f"{dep_id}.jpg"
        if arq.exists() or hoje - sem.get(dep_id, -999) < 60:
            continue
        try:
            conteudo = camara.baixar_foto(dep_id)
        except Exception as e:  # noqa: BLE001
            erros += 1
            log.warning("foto %s falhou: %s", dep_id, e)
            if erros >= 5:
                log.warning("Fotos: muitas falhas seguidas, o resto fica para amanhã.")
                break
            continue
        erros = 0
        if not conteudo:
            sem[dep_id] = hoje
            continue
        try:
            img = Image.open(io.BytesIO(conteudo)).convert("RGB")
            if img.width > largura:
                img = img.resize((largura, round(img.height * largura / img.width)), Image.LANCZOS)
            pasta.mkdir(parents=True, exist_ok=True)
            img.save(arq, "JPEG", quality=80, optimize=True)
            novos += 1
        except Exception as e:  # noqa: BLE001
            log.warning("foto %s inválida: %s", dep_id, e)
            sem[dep_id] = hoje
    gravar(sem_p, sem)
    if novos:
        log.info("  fotos novas: %d", novos)


# ---------------------------------------------------------------------- IPCA
def obter_ipca(status) -> dict:
    cache_p = BRUTOS / "ipca.json"
    try:
        serie = ipca.baixar_ipca(config.ANO_INICIAL)
        gravar(cache_p, serie)
        status["ipca"] = "ok"
    except Exception as e:  # noqa: BLE001
        log.error("IPCA falhou: %s", e)
        serie = [tuple(x) for x in ler(cache_p, [])]
        status["ipca"] = "erro; usando cache" if serie else f"erro: {e}"
    return ipca.fatores_por_ano(serie)


# ---------------------------------------------------------- séries históricas
def _somar_categorias(deps) -> dict:
    tot = {}
    for d in deps:
        for k, v in (d.get("categorias") or {}).items():
            tot[k] = tot.get(k, 0) + v
    return tot


def montar_historicos(ipca_info: dict):
    """historico.json (Câmara inteira, por ano) e deputados/ID.json
    (trajetória de cada deputado), a partir de todos os resumos gravados."""
    fatores = {int(k): v for k, v in ipca_info.get("fatores", {}).items()}
    anos, trajetorias = [], {}
    comp = ["salario", "ajuda_de_custo", "auxilio_moradia", "cota_parlamentar", "verba_gabinete"]
    for ano in anos_com_dados():
        r = ler(SAIDA / str(ano) / "resumo.json")
        deps = r["deputados"]
        if not deps:
            continue
        f = fatores.get(ano, 1.0)
        meses_dep = sum(d["meses"] for d in deps) or 1
        tot = {c: round(sum(d["custos"].get(c, 0) for d in deps), 2) for c in comp}
        mensais = sorted(d["custo_mensal_medio"] for d in deps if d["meses"])
        mediana = mensais[len(mensais) // 2] if mensais else 0
        cobertura_gab = sum(1 for d in deps if not d["flags"].get("sem_verba_gabinete")) / len(deps)
        anos.append({
            "ano": ano,
            "meses_decorridos": r["meses_decorridos"],
            "deputados": len(deps),
            "total": r["total_camara"],
            "total_corrigido": round(r["total_camara"] * f, 2),
            "por_componente": tot,
            "custo_mensal_medio": round(r["total_camara"] / meses_dep, 2),
            "custo_mensal_medio_corrigido": round(r["total_camara"] / meses_dep * f, 2),
            "custo_mensal_mediano": round(mediana, 2),
            "emendas_empenhado": round(sum(d.get("emendas_empenhado", 0) for d in deps), 2),
            "fator_ipca": f,
            "cobertura_verba_gabinete": round(cobertura_gab, 3),
            "mensal": [round(sum((d.get("mensal") or {}).get(k, [0] * 12)[i] for d in deps for k in ("fixo", "cota", "gabinete")))
                       for i in range(12)],
            "categorias": {k: round(v) for k, v in sorted(
                _somar_categorias(deps).items(), key=lambda x: -x[1])},
        })
        for d in deps:
            t = trajetorias.setdefault(d["id"], {"id": d["id"], "nome": d["nome"], "anos": []})
            t.update({"nome": d["nome"], "partido": d.get("partido"), "uf": d.get("uf"), "foto": d.get("foto")})
            t["anos"].append({
                "ano": ano, "partido": d.get("partido"), "uf": d.get("uf"), "meses": d["meses"],
                "custo_mandato": d["custo_mandato"],
                "custo_mandato_corrigido": round(d["custo_mandato"] * f, 2),
                "custo_mensal_medio": d["custo_mensal_medio"],
                "custos": d["custos"], "posicao": d.get("posicao"),
                "de": len(deps), "emendas_empenhado": d.get("emendas_empenhado", 0),
            })
    gravar(SAIDA / "historico.json", {"anos": anos, "ipca_referencia": ipca_info.get("referencia")})
    gravar(SAIDA / "pontos_eleitorais.json", analises.alertas_eleitorais(trajetorias))
    for dep_id, t in trajetorias.items():
        gravar(SAIDA / "deputados" / f"{dep_id}.json", t)
    log.info("Históricos: %d anos, %d deputados", len(anos), len(trajetorias))


# ------------------------------------------------------- todos os anos (total)
def montar_total(ipca_info: dict):
    """docs/dados/total/: soma de todos os anos por deputado (em valores de hoje
    e em valores da época), fornecedores e pontos de atenção de todos os anos."""
    fatores = {int(k): v for k, v in ipca_info.get("fatores", {}).items()}
    anos = anos_com_dados()
    if not anos:
        return
    comp = ["salario", "ajuda_de_custo", "auxilio_moradia", "cota_parlamentar", "verba_gabinete"]
    acum = {False: {}, True: {}}     # chave: corrigido?
    pontos = []
    forn = {False: {}, True: {}}
    for ano in anos:
        r = ler(SAIDA / str(ano) / "resumo.json")
        f = fatores.get(ano, 1.0)
        for corr in (False, True):
            k = k_ = f if corr else 1.0
            for d in r["deputados"]:
                a = acum[corr].setdefault(d["id"], {
                    "id": d["id"], "custos": {c: 0.0 for c in comp}, "custo_mandato": 0.0, "meses": 0,
                    "emendas_empenhado": 0.0, "emendas_pago": 0.0, "categorias": {}, "pontos": 0, "anos": [], "por_ano": {}})
                # nome, partido e estado do ano mais recente
                a.update({x: d.get(x) for x in ("nome", "partido", "uf", "foto", "em_exercicio", "sexo")})
                for c in comp:
                    a["custos"][c] += d["custos"].get(c, 0) * k
                a["custo_mandato"] += d["custo_mandato"] * k
                a["meses"] += d["meses"]
                a["emendas_empenhado"] += d.get("emendas_empenhado", 0) * k
                a["emendas_pago"] += d.get("emendas_pago", 0) * k
                for cat, v in (d.get("categorias") or {}).items():
                    a["categorias"][cat] = a["categorias"].get(cat, 0) + v * k
                a["pontos"] += d.get("pontos", 0)
                a["por_ano"][str(ano)] = round(a["por_ano"].get(str(ano), 0) + d["custo_mandato"] * k, 2)
                if ano not in a["anos"]:
                    a["anos"].append(ano)
            fo = ler(SAIDA / str(ano) / "fornecedores.json") or {}
            if fo.get("formato") == 2:
                cats = fo.get("cats", [])
                for linha_f in fo["linhas"]:
                    k, nome, doc, tipo, ci_, valor, n_notas, deps = linha_f[:8]
                    por_t = linha_f[8] if len(linha_f) > 8 else {str(ci_): [valor, n_notas]}
                    o = forn[corr].setdefault(k, {"chave": k, "nome": nome, "doc": doc, "tipo": tipo, "valor": 0.0,
                                                  "notas": 0, "deputados": 0, "por_ano": {}, "_cat": {}})
                    o["nome"] = nome or o["nome"]
                    o["valor"] += valor * k_
                    o["notas"] += n_notas
                    o["deputados"] = max(o["deputados"], deps)
                    o["por_ano"][str(ano)] = round(valor * k_, 2)
                    for ic, (vt, nt) in por_t.items():
                        c = cats[int(ic)] if int(ic) < len(cats) else "Outros"
                        x = o["_cat"].setdefault(c, [0.0, 0])
                        x[0] += vt * k_
                        x[1] += nt
        for p in ler(SAIDA / str(ano) / "pontos.json", []) or []:
            pontos.append({**p, "ano": ano})

    for corr, nome in ((True, "resumo.json"), (False, "resumo_nominal.json")):
        linhas = list(acum[corr].values())
        for a in linhas:
            a["custos"] = {c: round(v, 2) for c, v in a["custos"].items()}
            a["custo_mandato"] = round(a["custo_mandato"], 2)
            a["custo_mensal_medio"] = round(a["custo_mandato"] / a["meses"], 2) if a["meses"] else 0.0
            a["emendas_empenhado"] = round(a["emendas_empenhado"], 2)
            a["emendas_pago"] = round(a["emendas_pago"], 2)
            a["categorias"] = {c: round(v, 2) for c, v in a["categorias"].items()}
            a["flags"] = {}
        linhas.sort(key=lambda x: x["custo_mandato"], reverse=True)
        for i, a in enumerate(linhas, 1):
            a["posicao"] = i
        gravar(SAIDA / "total" / nome, {
            "ano": "total", "total": True, "anos": anos, "corrigido": corr,
            "meses_decorridos": 12, "fator_ipca": 1.0, "ipca_referencia": ipca_info.get("referencia"),
            "deputados": linhas, "total_camara": round(sum(a["custo_mandato"] for a in linhas), 2),
        })

    for corr, nome in ((True, "fornecedores.json"), (False, "fornecedores_nominal.json")):
        todos = sorted(forn[corr].values(), key=lambda x: -x["valor"])
        tot = sum(o["valor"] for o in todos) or 1
        linhas = []
        for o in todos[:3000]:
            cat = max(o["_cat"].items(), key=lambda x: x[1][0])[0] if o["_cat"] else "Outros"
            linhas.append([o["chave"], o["nome"], o["doc"], o["tipo"], cat, round(o["valor"], 2), o["notas"], o["deputados"], o["por_ano"],
                           {c: [round(v, 2), n] for c, (v, n) in o["_cat"].items()}])
        gravar(SAIDA / "total" / nome, {
            "formato": 2, "total_geral": True, "anos": anos, "total": round(tot, 2), "qtd": len(todos),
            "top10_participacao": round(sum(o["valor"] for o in todos[:10]) / tot, 4), "linhas": linhas})
    pontos.sort(key=lambda x: (-x.get("intensidade", 0), -x["valor"]))
    gravar(SAIDA / "total" / "pontos.json", pontos)
    log.info("Total: %d deputados em %d anos", len(acum[True]), len(anos))



# ------------------------------------------------------- presença (recálculo leve)
def refazer_presencas_antigas(hoje: date, status: dict, max_anos: int = 3) -> None:
    """Refaz presenca.json de anos já publicados com versão antiga, sem reprocessar o ano inteiro.
    Usa os meses de mandato já guardados no próprio presenca.json e a presença oficial dos perfis."""
    feitos = 0
    for ano in sorted(anos_com_dados(), reverse=True):
        if ano >= hoje.year or feitos >= max_anos:
            continue
        antigo = ler(SAIDA / str(ano) / "presenca.json")
        if not antigo or antigo.get("indisponivel") or (antigo.get("versao") or 1) >= presenca.VERSAO:
            continue
        feitos += 1
        perfis = ler(BRUTOS / f"perfis_{ano}.json", {}) or {}

        def ofi(bloco):
            out = {}
            for k, v in perfis.items():
                b = ((v or {}).get("presenca") or {}).get(bloco)
                if b and str(k).isdigit():
                    out[int(k)] = b
            return out
        meses_dep = {int(k): v.get("meses") or [] for k, v in (antigo.get("deputados") or {}).items()}
        try:
            log.info("presença de %s (recálculo, versão %s)...", ano, presenca.VERSAO)
            ev = presenca.ler_csv(http.get(config.EVENTOS_CSV.format(ano=ano), timeout=300).content)
            pr = presenca.ler_csv(http.get(config.PRESENCA_CSV.format(ano=ano), timeout=600).content)
            pres = presenca.calcular(ev, pr, meses_dep, ano, ofi("plenario"), ofi("comissoes"))
            if not pres["dias_sessao"]:
                raise ValueError("sem sessões no arquivo")
            status[f"presenca_{ano}"] = f"refeita ({len(pres['dias_sessao'])} dias de sessão)"
        except Exception as e:  # noqa: BLE001
            # sem os arquivos de hoje: mantém o cálculo antigo e acrescenta a presença oficial em comissões
            log.warning("presença de %s: recálculo indisponível (%s); só a presença oficial em comissões", ano, e)
            com = ofi("comissoes")
            pres = dict(antigo)
            pres["deputados"] = {k: {**v, "oficial_comissoes": com.get(int(k))} for k, v in (antigo.get("deputados") or {}).items()}
            pres["versao"] = presenca.VERSAO
            status[f"presenca_{ano}"] = f"oficial em comissões acrescentada ({e})"
        gravar(SAIDA / str(ano) / "presenca.json", pres)


# ---------------------------------------------------------------------- main
def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--anos", type=int, nargs="*")
    ap.add_argument("--pendentes", action="store_true", help="imprime os anos a coletar e sai")
    ap.add_argument("--limite", type=int, help="processa só N deputados (teste)")
    ap.add_argument("--sem-perfis", action="store_true")
    ap.add_argument("--sem-emendas", action="store_true")
    ap.add_argument("--sem-fotos", action="store_true")
    ap.add_argument("--notas", action="store_true", help="regrava notas e fornecedores do ano corrente")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    hoje = date.today()
    if args.pendentes:
        print(" ".join(map(str, anos_pendentes(hoje))))
        return 0
    anos = args.anos or [hoje.year]
    status = {}

    # 1) Cota parlamentar primeiro: outro servidor e plano B da lista de deputados
    ceap_bruto = {}
    for ano in anos:
        try:
            log.info("Cota parlamentar %s...", ano)
            ceap_bruto[ano] = camara.baixar_ceap(ano)
            status[f"ceap_{ano}"] = "ok"
        except Exception as e:  # noqa: BLE001
            log.error("CEAP %s falhou: %s", ano, e)
            status[f"ceap_{ano}"] = f"erro: {e}"

    guardar_chaves_deputados(ceap_bruto)

    # 2) Deputados
    deps = obter_deputados(anos, ceap_bruto, status)
    if not deps:
        log.error("Nenhuma fonte de deputados respondeu. Nada a fazer hoje.")
        return 1
    if args.limite:
        deps = deps[: args.limite]
    if status.get("deputados", "").startswith("ok"):
        deps = enriquecer_deputados(deps)
    else:   # API fora do ar: não perde tempo com os detalhes; usa o que já está guardado
        cache = {int(k): v for k, v in ler(BRUTOS / "deputados_detalhes.json", {}).items()}
        for d in deps:
            d.update(cache.get(d["id"], {}))

    # 3) Emendas e IPCA
    emendas_df = None
    if not args.sem_emendas:
        try:
            log.info("Emendas (Portal da Transparência)...")
            emendas_df = transparencia.baixar_emendas()
            status["emendas"] = "ok"
        except Exception as e:  # noqa: BLE001
            log.error("emendas falhou: %s", e)
            status["emendas"] = f"erro: {e}"
    ipca_info = obter_ipca(status)

    # 4) Ano a ano
    for ano in anos:
        log.info("== %s ==", ano)
        ceap_df = ceap_bruto.get(ano)
        if ceap_df is None and (SAIDA / str(ano) / "resumo.json").exists():
            # Sem o arquivo da cota, o ano sairia incompleto (cota zerada e meses cortados).
            # Melhor manter o que já está publicado e tentar de novo na próxima execução.
            log.warning("%s: cota parlamentar indisponível hoje — mantendo os dados já publicados", ano)
            status[f"ano_{ano}"] = "mantido (CEAP indisponível)"
            continue
        deps_ano = deputados_do_ano(deps, ano, ceap_df, hoje)
        ceap = camara.resumir_ceap(ceap_df) if ceap_df is not None else {}

        perfis = {}
        if not args.sem_perfis:
            perfis = coletar_perfis(deps_ano, ano, reaproveitar=ano < hoje.year)
            status[f"perfis_{ano}"] = f"ok ({len(perfis)}/{len(deps_ano)})"

        emendas = transparencia.resumir_emendas(emendas_df, ano, deps) if emendas_df is not None else {}

        if not ceap and not perfis:
            log.error("Sem dados para %s — mantendo a versão anterior.", ano)
            continue

        md = meses_decorridos(ano, hoje)
        no_ano = {x["id"]: x for x in camara.deputados_do_ceap(ceap_df)}
        linhas, extras = [], {}
        for d in deps_ano:
            p, c, e = perfis.get(d["id"]), ceap.get(d["id"]), emendas.get(d["id"])
            if not tem_atividade(p, c):
                continue
            # partido/UF do próprio ano, quando a cota informa
            if d["id"] in no_ano:
                d = {**d, "partido": no_ano[d["id"]]["partido"] or d.get("partido"),
                     "uf": no_ano[d["id"]]["uf"] or d.get("uf")}
            linha = custos.calcular(d, ano, p, c, e, md)
            linha["categorias"] = dict((c or {}).get("por_categoria") or {})
            if abs(linha.get("cota_sem_nota") or 0) > 1:
                linha["categorias"][camara.CAT_SEM_NOTA] = linha["cota_sem_nota"]
            if d.get("sexo"):
                linha["sexo"] = d["sexo"]
            cota_p = (p or {}).get("cota_parlamentar") or {}
            if cota_p.get("gasto") is not None and cota_p.get("nao_utilizado") is not None:
                disp = cota_p["gasto"] + cota_p["nao_utilizado"]
                linha["cota_uso"] = round(cota_p["gasto"] / disp, 4) if disp else None
            linhas.append(linha)
            extras[d["id"]] = {
                "ceap": c,
                "verba_gabinete_mensal": ((p or {}).get("verba_gabinete") or {}).get("por_mes"),
                "perfil": {k: v for k, v in (p or {}).items()
                           if k not in ("cota_parlamentar", "verba_gabinete")},
                "emendas": e,
                "fonte_perfil": config.PERFIL_DEPUTADO.format(id=d["id"], ano=ano),
            }
        prev_camara = None
        if md < 12:
            fechados = [ler(SAIDA / str(a) / "resumo.json") for a in anos_com_dados()
                        if a < ano and a >= ano - 4]
            saz = previsao.sazonalidade([r for r in fechados if r])
            fim_mandato = (ano + 1) in {fim.year for _, _, fim in config.LEGISLATURAS}
            for l in linhas:
                l["previsao"] = previsao.prever(l, ano, md, saz, fim_mandato)
            prev_camara = previsao.prever_camara(linhas, md, saz)
        # presença no Plenário e em comissões
        try:
            log.info("  presença de %s...", ano)
            ev = presenca.ler_csv(http.get(config.EVENTOS_CSV.format(ano=ano), timeout=300).content)
            pr = presenca.ler_csv(http.get(config.PRESENCA_CSV.format(ano=ano), timeout=600).content)
            meses_dep = {l["id"]: custos.meses_de_mandato(perfis.get(l["id"]), ceap.get(l["id"]), md) for l in linhas}
            ofic = {l["id"]: ((perfis.get(l["id"]) or {}).get("presenca") or {}).get("plenario") for l in linhas}
            ofic_c = {l["id"]: ((perfis.get(l["id"]) or {}).get("presenca") or {}).get("comissoes") for l in linhas}
            pres = presenca.calcular(ev, pr, meses_dep, ano, {k: v for k, v in ofic.items() if v},
                                     {k: v for k, v in ofic_c.items() if v})
            if pres["dias_sessao"]:
                gravar(SAIDA / str(ano) / "presenca.json", pres)
                for l in linhas:
                    x = pres["deputados"].get(str(l["id"]))
                    if x:
                        l["presenca"] = [x["presencas"], x["dias"], x["faltas"]]
                status[f"presenca_{ano}"] = f"ok ({len(pres['dias_sessao'])} dias de sessão)"
            else:
                gravar(SAIDA / str(ano) / "presenca.json", {**pres, "indisponivel": True})
                status[f"presenca_{ano}"] = "sem sessões no arquivo"
        except Exception as e:  # noqa: BLE001
            log.warning("presença de %s indisponível: %s", ano, e)
            status[f"presenca_{ano}"] = f"erro: {e}"
            antigo = ler(SAIDA / str(ano) / "presenca.json")
            for l in linhas:
                x = ((antigo or {}).get("deputados") or {}).get(str(l["id"]))
                if x:
                    l["presenca"] = [x["presencas"], x["dias"], x["faltas"]]

        # fornecedores e pontos de atenção
        info = {l["id"]: {"nome": l["nome"], "partido": l.get("partido"), "uf": l.get("uf"), "sexo": l.get("sexo")}
                for l in linhas}
        pontos = analises.pontos_de_atencao(ceap_df, info, ano) if ceap_df is not None else []
        if ceap_df is not None:
            arq_f = SAIDA / str(ano) / "fornecedores.json"
            atual_f = ler(arq_f, {}) or {}
            ja_tem = atual_f.get("formato") == 2 and atual_f.get("versao_linhas") == 2
            sem_grupos = not (SAIDA / str(ano) / "forn_grupos").is_dir()
            if not ja_tem or sem_grupos or args.notas or hoje.weekday() == config.DIA_DA_SEMANA_NOTAS:
                log.info("  notas e fornecedores de %s...", ano)
                dprep = notas.preparar(ceap_df)
                for dep_id, conteudo in notas.notas_por_deputado(dprep, ano).items():
                    gravar(SAIDA / str(ano) / "notas" / f"{dep_id}.json", conteudo)
                resumo_f, fichas = notas.fornecedores(dprep, info, ano)
                gravar(arq_f, resumo_f)
                for velho in (SAIDA / str(ano) / "fornecedores").glob("*.json"):
                    velho.unlink()          # sem sobras de fornecedores que saíram do arquivo
                for g, conteudo in fichas.items():
                    gravar(SAIDA / str(ano) / "fornecedores" / f"{g}.json", conteudo)
                # por partido e por estado (filtros da aba Fornecedores, inclusive em "Todos os anos")
                for velho in (SAIDA / str(ano) / "forn_grupos").glob("*.json"):
                    velho.unlink()
                for g, conteudo in notas.fornecedores_grupos(dprep, info, ano).items():
                    gravar(SAIDA / str(ano) / "forn_grupos" / f"{g}.json", conteudo)
        gravar(SAIDA / str(ano) / "pontos.json", pontos)
        por_dep = {}
        for pt in pontos:
            por_dep.setdefault(pt["id"], []).append(pt)

        linhas.sort(key=lambda x: x["custo_mandato"], reverse=True)
        for i, l in enumerate(linhas, 1):
            l["posicao"] = i
            l["pontos"] = len(por_dep.get(l["id"], []))
            gravar(SAIDA / str(ano) / "dep" / f"{l['id']}.json",
                   {**l, **extras[l["id"]], "pontos_de_atencao": por_dep.get(l["id"], [])})
        gravar(SAIDA / str(ano) / "resumo.json", {
            "ano": ano, "meses_decorridos": md, "deputados": linhas,
            "total_camara": round(sum(l["custo_mandato"] for l in linhas), 2),
            "fator_ipca": ipca_info["fatores"].get(ano, 1.0),
            "ipca_referencia": ipca_info.get("referencia"),
            "previsao_camara": prev_camara,
        })
        log.info("%s: %d deputados gravados", ano, len(linhas))

        # notas novas do dia (ano corrente; de janeiro a março, também o anterior)
        if ceap_df is not None and (ano == hoje.year or (ano == hoje.year - 1 and hoje.month <= 3)):
            try:
                status[f"novas_{ano}"] = novas.processar(ceap_df, ano, info, hoje, SAIDA, BRUTOS)
            except Exception as e:  # noqa: BLE001
                log.error("notas novas %s falhou: %s", ano, e)
                status[f"novas_{ano}"] = f"erro: {e}"
        if not args.sem_fotos:
            baixar_fotos([l["id"] for l in linhas])

    # 4b) presença de anos antigos gerada por versão anterior (alguns anos por dia, junto com o ano corrente)
    if hoje.year in anos and not args.limite:
        try:
            refazer_presencas_antigas(hoje, status)
        except Exception as e:  # noqa: BLE001
            log.error("recálculo de presença falhou: %s", e)

    # 5) Séries históricas e metadados
    montar_historicos(ipca_info)
    montar_total(ipca_info)
    # 6) cruzamento com a Receita (quando a base da Receita já foi baixada)
    if (SAIDA / "receita" / "meta.json").exists():
        try:
            cruzamento.gerar(SAIDA, BRUTOS)
            status["cruzamento"] = "ok"
        except Exception as e:  # noqa: BLE001
            log.error("cruzamento com a Receita falhou: %s", e)
            status["cruzamento"] = f"erro: {e}"
    meta = ler(SAIDA / "meta.json", {})
    meta.update({
        "atualizado_em": datetime.now(timezone.utc).isoformat(timespec="minutes"),
        "anos": anos_com_dados(),
        "total": (SAIDA / "total" / "resumo.json").exists(),
        "status": status,
        "ipca_referencia": ipca_info.get("referencia"),
        "parametros": {
            "subsidio": [[str(d), v] for d, v in config.SUBSIDIO],
            "auxilio_moradia": [[str(d), v] for d, v in config.AUXILIO_MORADIA],
        },
        "fontes": {
            "deputados": config.API_CAMARA,
            "cota_parlamentar": config.CEAP_ZIP.format(ano="AAAA"),
            "perfil": config.PERFIL_DEPUTADO.format(id="ID", ano="AAAA"),
            "emendas": config.EMENDAS_ZIP,
            "ipca": "https://www3.bcb.gov.br/sgspub (série 433)",
        },
    })
    gravar(SAIDA / "meta.json", meta)
    erros = [k for k, v in status.items() if str(v).startswith("erro")]
    log.info("Fim. Status: %s", status)
    return 1 if status and len(erros) == len(status) else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        sys.exit(1)
