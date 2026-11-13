"""Cada despesa e cada fornecedor da cota parlamentar, nota a nota.

Formatos compactos (para o site carregar rápido e o repositório não inchar):

notas/AAAA/ID.json  — todas as notas de um deputado no ano
    {"id", "ano", "f": [[chave, nome, doc_exibicao], ...],   # fornecedores
     "c": [categorias...],
     "n": [[mmdd, centavos, i_forn, i_cat, numero, url, glosa_centavos, trecho, passageiro], ...]}

fornecedores/AAAA/XX.json — fichas dos fornecedores cuja chave cai no grupo XX
fornecedores.json (por ano) — lista de TODOS os fornecedores + resumo do ano

CPF de pessoa física aparece mascarado; a chave interna é um código derivado.
"""
import hashlib
import re
import unicodedata

import pandas as pd

import config


def _dig(s) -> str:
    return re.sub(r"\D", "", str(s or ""))


VERSAO_LINHAS = 3   # 3: chave de pessoa física sem o CPF inteiro


def chave_pf(meio6: str, nome: str) -> str:
    """Chave de pessoa física a partir dos 6 dígitos do meio do CPF (já públicos) e do nome."""
    n = unicodedata.normalize("NFKD", str(nome or "")).encode("ascii", "ignore").decode().upper()
    n = re.sub(r"[^A-Z0-9]+", " ", n).strip()
    return "pf" + hashlib.sha1(f"{meio6}|{n}".encode()).hexdigest()[:12]


def chave_e_doc(doc_bruto: str, nome: str) -> tuple[str, str, str]:
    """(chave interna, documento para exibir, tipo PJ/PF/—)."""
    d = _dig(doc_bruto)
    if len(d) == 14:
        return d, f"{d[:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:]}", "PJ"
    if len(d) == 11:
        # a chave NÃO usa o CPF inteiro (um resumo do CPF pode ser revertido testando ~1.000
        # combinações, já que os 6 dígitos do meio são públicos): usa só o que já é público.
        return chave_pf(d[3:9], nome), f"***.{d[3:6]}.{d[6:9]}-**", "PF"
    base = re.sub(r"[^a-z0-9]+", "-", str(nome).lower()).strip("-")[:24] or "sem-nome"
    return "sd-" + base, "", "—"


def grupo(chave: str) -> str:
    """Grupo do arquivo de fichas (00–ff). O site calcula igual em JavaScript."""
    return format(sum((i + 1) * ord(c) for i, c in enumerate(chave)) % 256, "02x")


_RE_PDF = re.compile(r"^documentos/publ/(\d+)/\d{4}/(\d+)\.pdf$")
_RE_NFE = re.compile(r"^nota-fiscal-eletronica\?ideDocumentoFiscal=(\d+)$")


def _url_curta(u: str) -> str:
    """Encurta o link da nota. "p<pasta>/<doc>" = PDF digitalizado;
    "e<doc>" = nota eletrônica; outro texto = link completo ou parcial."""
    u = str(u or "").strip()
    for pre in (config.URL_NOTA_PREFIXO, "http://www.camara.leg.br/cota-parlamentar/",
                "https://camara.leg.br/cota-parlamentar/", "http://camara.leg.br/cota-parlamentar/"):
        if u.startswith(pre):
            u = u[len(pre):]
            break
    m = _RE_PDF.match(u)
    if m:
        return f"p{m.group(1)}/{m.group(2)}"
    m = _RE_NFE.match(u)
    if m:
        return "e" + m.group(1)
    return u


def preparar(df: pd.DataFrame) -> pd.DataFrame:
    """Acrescenta chave, documento de exibição e tipo a cada nota."""
    trio = [chave_e_doc(d, n) for d, n in zip(df["cnpj_cpf"], df["fornecedor"])]
    out = df.copy()
    for col, padrao in (("numero", ""), ("url", ""), ("trecho", ""), ("passageiro", ""), ("glosa", 0.0), ("nome", ""),
                        ("partido", ""), ("uf", "")):
        if col not in out.columns:
            out[col] = padrao
    if "data" not in out.columns:
        out["data"] = pd.NaT
    out["glosa"] = out["glosa"].fillna(0.0)
    out["chave"] = [t[0] for t in trio]
    out["doc"] = [t[1] for t in trio]
    out["tipo"] = [t[2] for t in trio]
    return out


def _nome_mais_comum(s: pd.Series) -> str:
    v = s[s != ""].value_counts()
    return v.index[0] if len(v) else ""


# ---------------------------------------------------------- por deputado
def notas_por_deputado(d: pd.DataFrame, ano: int) -> dict[int, dict]:
    res = {}
    for dep_id, g in d.groupby("id"):
        g = g.sort_values(["data", "valor"], ascending=[True, False], na_position="last")
        forn = {}
        cats = {}
        linhas = []
        for r in g.itertuples(index=False):
            if r.chave not in forn:
                forn[r.chave] = [len(forn), r.chave, r.fornecedor, r.doc]
            if r.categoria not in cats:
                cats[r.categoria] = len(cats)
            if pd.notna(r.data):
                mmdd = r.data.month * 100 + r.data.day
            else:
                mmdd = int(r.mes or 0) * 100
            linha = [mmdd, int(round(r.valor * 100)), forn[r.chave][0], cats[r.categoria],
                     r.numero, _url_curta(r.url), int(round((r.glosa or 0) * 100))]
            if r.trecho or r.passageiro:
                linha += [r.trecho, r.passageiro]
            linhas.append(linha)
        res[int(dep_id)] = {
            "id": int(dep_id), "ano": ano,
            "f": [v[1:] for v in sorted(forn.values())],
            "c": [k for k, _ in sorted(cats.items(), key=lambda x: x[1])],
            "n": linhas,
        }
    return res


# -------------------------------------------------------- fornecedores
def fornecedores(d: pd.DataFrame, info: dict[int, dict], ano: int, com_fichas: bool = True) -> tuple[dict, dict[str, dict]]:
    """(lista + resumo do ano, fichas agrupadas por grupo XX)."""
    from coletor.camara import CAT_AUX
    d = d[d["categoria"] != CAT_AUX]          # ajuste da Câmara, não é fornecedor
    total = float(d["valor"].sum()) or 1.0
    g = d.groupby("chave")
    base = pd.DataFrame({
        "nome": g["fornecedor"].agg(_nome_mais_comum),
        "doc": g["doc"].first(),
        "tipo": g["tipo"].first(),
        "categ": g["categoria"].agg(lambda s: s.value_counts().index[0]),
        "valor": g["valor"].sum(),
        "notas": g.size(),
        "deps": g["id"].nunique(),
        "maior": g["valor"].max(),
        "primeira": g["data"].min(),
        "ultima": g["data"].max(),
    }).sort_values("valor", ascending=False)

    cats = list(d.groupby("categoria")["valor"].sum().sort_values(ascending=False).index)
    ci = {c: i for i, c in enumerate(cats)}

    # valor e notas de cada fornecedor em cada tipo de gasto (para filtrar por tipo com precisão)
    pc = d.groupby(["chave", "categoria"]).agg(v=("valor", "sum"), n=("valor", "size"))
    por_tipo_f = {}
    for (k, c), x in pc.iterrows():
        por_tipo_f.setdefault(k, {})[str(ci[c])] = [round(float(x.v), 2), int(x.n)]
    # lista compacta de todos: [chave, nome, doc, tipo, i_cat principal, valor, notas, deputados, {i_cat: [valor, notas]}]
    linhas = [[k, r.nome, r.doc, r.tipo, ci[r.categ], round(float(r.valor), 2), int(r.notas), int(r.deps), por_tipo_f.get(k, {})]
              for k, r in base.iterrows()]

    # concentração (curva de Pareto)
    acum = base["valor"].cumsum() / total
    n = len(base)
    pareto = []
    for p in (0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1.0):
        k = max(1, int(round(n * p)))
        pareto.append([p, round(float(acum.iloc[k - 1]), 4)])
    partic = base["valor"] / total
    hhi = round(float((partic ** 2).sum()) * 10_000, 1)

    por_cat = d.groupby("categoria").agg(valor=("valor", "sum"), forn=("chave", "nunique"), notas=("valor", "size"))
    tipos = d.groupby("tipo")["valor"].agg(["sum", "size"])
    forn_tipo = base.groupby("tipo").size()

    maiores = d.sort_values("valor", ascending=False).head(100)
    maiores_notas = []
    for r in maiores.itertuples(index=False):
        i = info.get(int(r.id), {})
        maiores_notas.append([r.data.strftime("%Y-%m-%d") if pd.notna(r.data) else "", round(float(r.valor), 2), int(r.id),
                              i.get("nome") or r.nome, i.get("partido") or r.partido, i.get("uf") or r.uf,
                              r.chave, r.fornecedor, r.categoria, _url_curta(r.url)])

    resumo = {
        "ano": ano, "formato": 2, "versao_linhas": VERSAO_LINHAS, "total": round(total, 2), "qtd": n, "notas": int(len(d)),
        "ticket_medio": round(total / max(len(d), 1), 2),
        "top10_participacao": round(float(base["valor"].head(10).sum()) / total, 4),
        "hhi": hhi, "pareto": pareto,
        "por_tipo": {t: {"valor": round(float(r["sum"]), 2), "notas": int(r["size"]), "fornecedores": int(forn_tipo.get(t, 0))}
                     for t, r in tipos.iterrows()},
        "por_categoria": [[c, round(float(r.valor), 2), int(r.forn), int(r.notas)] for c, r in por_cat.sort_values("valor", ascending=False).iterrows()],
        "exclusivos": int(((base["deps"] == 1) & (base["valor"] >= 150_000)).sum()),
        "cats": cats,
        "maiores_notas": maiores_notas,
        "linhas": linhas,
    }

    # fichas
    fichas: dict[str, dict] = {}
    if not com_fichas:
        return resumo, fichas
    pag = d.groupby(["chave", "id"]).agg(valor=("valor", "sum"), notas=("valor", "size"))
    mes = d.groupby(["chave", "mes"])["valor"].sum()
    cat = d.groupby(["chave", "categoria"])["valor"].sum()
    top = d.sort_values("valor", ascending=False).groupby("chave").head(5)
    top_por = {k: v for k, v in top.groupby("chave")}
    for k, r in base.iterrows():
        pg = pag.loc[k].sort_values("valor", ascending=False)
        ficha = {
            "chave": k, "nome": r.nome, "doc": r.doc, "tipo": r.tipo, "ano": ano,
            "valor": round(float(r.valor), 2), "notas": int(r.notas), "deputados": int(r.deps),
            "ticket": round(float(r.valor) / int(r.notas), 2), "maior": round(float(r.maior), 2),
            "primeira": r.primeira.strftime("%Y-%m-%d") if pd.notna(r.primeira) else None,
            "ultima": r.ultima.strftime("%Y-%m-%d") if pd.notna(r.ultima) else None,
            "participacao": round(float(r.valor) / total, 6),
            "posicao": int(base.index.get_loc(k)) + 1,
            "mes": [round(float(mes.get((k, m), 0))) for m in range(1, 13)],
            "categorias": {c: round(float(v), 2) for c, v in cat.loc[k].sort_values(ascending=False).items()},
            # [id do deputado, valor, notas] — nome/partido/UF vêm do resumo do ano
            "pagadores": [[int(dep), round(float(x.valor), 2), int(x.notas)] for dep, x in pg.iterrows()],
            "maiores": [[t.data.strftime("%Y-%m-%d") if pd.notna(t.data) else "", round(float(t.valor), 2), int(t.id),
                         t.categoria, t.numero, _url_curta(t.url)] for t in top_por[k].itertuples(index=False)],
        }
        fichas.setdefault(grupo(k), {})[k] = ficha
    return resumo, fichas


# ------------------------------------------------------ por partido e por estado
TOP_GRUPO = 300


def fornecedores_grupos(d: pd.DataFrame, info: dict[int, dict], ano: int) -> dict[str, dict]:
    """Resumo de fornecedores de cada partido (P-XX) e de cada estado (U-XX) no ano.

    Mesmo formato do fornecedores.json, com os 300 maiores completos (mais a lista
    de deputados que pagaram cada um) e o resto compacto [chave, tipo, valor, notas],
    para o site somar vários anos sem baixar as notas de cada deputado.
    """
    from coletor.camara import CAT_AUX
    d = d[d["categoria"] != CAT_AUX]
    grupos: dict[str, set] = {}
    for dep_id, i in info.items():
        if i.get("partido"):
            grupos.setdefault("P-" + str(i["partido"]).strip(), set()).add(int(dep_id))
        if i.get("uf"):
            grupos.setdefault("U-" + str(i["uf"]).strip(), set()).add(int(dep_id))
    out = {}
    for g, ids in grupos.items():
        sub = d[d["id"].isin(ids)]
        if sub.empty:
            continue
        res, _ = fornecedores(sub, info, ano, com_fichas=False)
        deps = sub.groupby("chave")["id"].unique()
        top, resto = res["linhas"][:TOP_GRUPO], res["linhas"][TOP_GRUPO:]
        res["linhas"] = [l + [sorted(int(x) for x in deps.get(l[0], []))] for l in top]
        res["resto"] = [[l[0], l[3], l[5], l[6]] for l in resto]
        res["maiores_notas"] = res["maiores_notas"][:30]
        res["n_deps"] = int(sub["id"].nunique())
        res["grupo"] = g
        out[g] = res
    return out
