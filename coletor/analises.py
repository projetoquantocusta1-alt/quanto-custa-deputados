"""Análises sobre a cota parlamentar: fornecedores, rankings por tipo de gasto
e pontos de atenção.

Os pontos de atenção são padrões estatísticos que merecem um olhar mais de
perto. Não são acusação nem prova de irregularidade: muitos têm explicação
legítima (ex.: aluguel do escritório pago sempre à mesma imobiliária).
"""
import re

import pandas as pd

# categorias em que é natural concentrar num só fornecedor
CATS_NATURAIS = {"Passagens aéreas", "Telefonia", "Correios", "Escritório de apoio",
                 "Assinaturas de publicações"}
# serviços contratados que raramente emitem nota em fim de semana
CATS_EMPRESARIAIS = {"Divulgação do mandato", "Consultorias e pesquisas", "Aluguel de veículos",
                     "Segurança", "Fretamento de aeronaves"}


def _so_digitos(s: str) -> str:
    return re.sub(r"\D", "", str(s or ""))


def _r(v) -> float:
    return round(float(v), 2)


def _reais(v) -> str:
    return "R$ " + f"{float(v):,.0f}".replace(",", ".")


# ---------------------------------------------------------------- fornecedores
def fornecedores(df: pd.DataFrame, info: dict[int, dict], limite: int = 400) -> dict:
    """Quem mais recebe da cota no ano, com os deputados que pagaram cada um."""
    if df is None or df.empty:
        return {"total": 0, "qtd": 0, "lista": []}
    d = df.assign(doc=df["cnpj_cpf"].map(_so_digitos))
    d = d[d["doc"].str.len() >= 11]          # sem documento: passagens da própria Câmara etc.
    total = float(df["valor"].sum())
    g = d.groupby("doc")
    resumo = pd.DataFrame({
        "valor": g["valor"].sum(),
        "notas": g.size(),
        "deps": g["id"].nunique(),
        "nome": g["fornecedor"].agg(lambda s: s.value_counts().index[0]),
        "cat": g["categoria"].agg(lambda s: s.value_counts().index[0]),
        "primeira": g["data"].min() if "data" in d else None,
        "ultima": g["data"].max() if "data" in d else None,
    }).sort_values("valor", ascending=False)
    top = resumo.head(limite)
    por_dep = (d[d["doc"].isin(top.index)].groupby(["doc", "id"])["valor"].sum()
               .reset_index().sort_values("valor", ascending=False))
    lista = []
    for doc, r in top.iterrows():
        deps = por_dep[por_dep["doc"] == doc].head(12)
        lista.append({
            "doc": doc, "nome": r["nome"], "categoria": r["cat"], "valor": _r(r["valor"]),
            "notas": int(r["notas"]), "deputados": int(r["deps"]),
            "primeira": r["primeira"].strftime("%Y-%m-%d") if pd.notna(r["primeira"]) else None,
            "ultima": r["ultima"].strftime("%Y-%m-%d") if pd.notna(r["ultima"]) else None,
            "pagadores": [{"id": int(x.id), "nome": info.get(int(x.id), {}).get("nome"),
                           "partido": info.get(int(x.id), {}).get("partido"),
                           "uf": info.get(int(x.id), {}).get("uf"), "valor": _r(x.valor)}
                          for x in deps.itertuples()],
        })
    return {
        "total": _r(total),
        "qtd": int(len(resumo)),
        "top10_participacao": round(float(resumo["valor"].head(10).sum()) / total, 4) if total else 0,
        "lista": lista,
    }


# ---------------------------------------------------------- pontos de atenção
def pontos_de_atencao(df: pd.DataFrame, info: dict[int, dict], ano: int) -> list[dict]:
    if df is None or df.empty:
        return []
    out = []
    d = df.assign(doc=df["cnpj_cpf"].map(_so_digitos))

    def add(tipo, dep_id, valor, intensidade, texto, extra=None):
        i = info.get(int(dep_id), {})
        out.append({"tipo": tipo, "id": int(dep_id), "nome": i.get("nome"), "partido": i.get("partido"),
                    "uf": i.get("uf"), "valor": _r(valor), "intensidade": round(float(intensidade), 3),
                    "texto": texto, **(extra or {})})

    # 1) Concentração: um fornecedor leva grande parte da cota (fora das categorias naturais)
    base = d[~d["categoria"].isin(CATS_NATURAIS) & (d["doc"].str.len() >= 11)]
    for dep_id, g in base.groupby("id"):
        tot = g["valor"].sum()
        if tot < 60_000:
            continue
        f = g.groupby(["doc", "fornecedor"])["valor"].sum().sort_values(ascending=False)
        (doc, nome), v = f.index[0], f.iloc[0]
        share = v / tot
        if share >= 0.60 and v >= 60_000:
            add("concentracao", dep_id, v, share,
                f"{share:.0%} dos gastos da cota (fora passagens, telefone, correios e escritório) foram para um único fornecedor: {nome} ({_reais(v)}).",
                {"fornecedor": nome, "doc": doc})

    # 2) Fornecedor exclusivo: empresa que só recebeu deste deputado, com valor alto
    emp = d[(d["doc"].str.len() == 14) & ~d["categoria"].isin(CATS_NATURAIS)]
    g = emp.groupby("doc").agg(valor=("valor", "sum"), deps=("id", "nunique"),
                               id=("id", "first"), nome=("fornecedor", "first"), cat=("categoria", "first"))
    for doc, r in g[(g["deps"] == 1) & (g["valor"] >= 150_000)].iterrows():
        add("exclusivo", r["id"], r["valor"], min(r["valor"] / 500_000, 1),
            f"{r['nome']} recebeu {_reais(r['valor'])} da cota no ano, e só deste deputado ({r['cat'].lower()}).",
            {"fornecedor": r["nome"], "doc": doc})

    # 3) Notas de serviços empresariais emitidas em fim de semana
    if "data" in d and d["data"].notna().any():
        e = d[d["categoria"].isin(CATS_EMPRESARIAIS) & d["data"].notna()]
        e = e.assign(fds=e["data"].dt.dayofweek >= 5)
        for dep_id, g in e.groupby("id"):
            tot = g["valor"].sum()
            fds = g.loc[g["fds"], "valor"].sum()
            if tot >= 30_000 and fds >= 15_000 and fds / tot >= 0.25:
                add("fim_de_semana", dep_id, fds, fds / tot,
                    f"{fds / tot:.0%} do valor gasto com divulgação, consultorias, veículos ou segurança ({_reais(fds)}) veio de notas emitidas em sábado ou domingo.")

    # 4) Valores redondos altos (ex.: R$ 15.000,00 exatos) em serviços difíceis de medir
    r = d[d["categoria"].isin({"Divulgação do mandato", "Consultorias e pesquisas"})]
    r = r[(r["valor"] >= 5_000) & ((r["valor"] % 1_000).abs() < 0.005)]
    for dep_id, g in r.groupby("id"):
        if len(g) >= 12 and g["valor"].sum() >= 150_000:
            add("valores_redondos", dep_id, g["valor"].sum(), min(len(g) / 24, 1),
                f"{len(g)} notas de valor redondo (múltiplo de R$ 1.000, a partir de R$ 5.000) em divulgação ou consultoria, somando {_reais(g['valor'].sum())}.")

    # 5) Pico mensal fora do padrão do próprio deputado
    m = d.groupby(["id", "mes"])["valor"].sum().reset_index()
    for dep_id, g in m.groupby("id"):
        if len(g) < 6:
            continue
        media, desvio = g["valor"].mean(), g["valor"].std(ddof=0)
        top = g.sort_values("valor").iloc[-1]
        if desvio > 0 and top["valor"] > media + 3 * desvio and top["valor"] - media >= 20_000:
            add("pico", dep_id, top["valor"], min((top["valor"] - media) / desvio / 6, 1),
                f"Em {int(top['mes']):02d}/{ano}, a cota somou {_reais(top['valor'])}, mais de 3 desvios-padrão acima da média mensal dele ({_reais(media)}).",
                {"mes": int(top["mes"])})

    return sorted(out, key=lambda x: (-x["intensidade"], -x["valor"]))


ANOS_ELEITORAIS = {2010, 2014, 2018, 2022, 2026}


def alertas_eleitorais(trajetorias: dict) -> list[dict]:
    """Cota em ano de eleição muito acima da média dos outros anos do deputado."""
    out = []
    for dep_id, t in trajetorias.items():
        anos = {a["ano"]: a for a in t["anos"] if a["meses"] >= 10}
        for ae in ANOS_ELEITORAIS & set(anos):
            outros = [anos[a]["custos"]["cota_parlamentar"] / anos[a]["meses"]
                      for a in anos if a not in ANOS_ELEITORAIS and abs(a - ae) <= 3]
            if len(outros) < 2:
                continue
            ref = sum(outros) / len(outros)
            atual = anos[ae]["custos"]["cota_parlamentar"] / anos[ae]["meses"]
            if ref > 0 and atual / ref >= 1.30 and (atual - ref) * anos[ae]["meses"] >= 30_000:
                out.append({"tipo": "ano_eleitoral", "id": dep_id, "nome": t["nome"],
                            "partido": anos[ae]["partido"], "uf": anos[ae]["uf"], "ano": ae,
                            "valor": round((atual - ref) * anos[ae]["meses"], 2),
                            "intensidade": round(min(atual / ref - 1, 1), 3),
                            "texto": f"Em {ae} (ano eleitoral), a cota mensal foi {atual / ref - 1:.0%} maior que a média dos anos vizinhos."})
    return sorted(out, key=lambda x: -x["valor"])
