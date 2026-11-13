"""Notas novas do dia.

Todo dia o robô baixa o arquivo da cota parlamentar do ano. Comparando com as
notas que ele já tinha visto (dados_brutos/novas/vistas_AAAA.tsv), sabemos
quais despesas a Câmara publicou desde a última execução.

Saídas (servidas pelo site):
    docs/dados/novas/indice.json        -> dias disponíveis (o de hoje + 3 anteriores)
    docs/dados/novas/AAAA-MM-DD.json    -> as notas novas daquele dia + o contexto do ano

No primeiro dia o robô só guarda o que existe: a contagem começa no dia seguinte.
"""
import hashlib
import json
import logging
from datetime import date, datetime, timezone
from pathlib import Path

import pandas as pd

from coletor import notas as N

log = logging.getLogger("qcd")

DIAS_GUARDADOS = 4          # hoje + 3 dias anteriores com notas novas
DIAS_SEMANA = 7             # "notas da semana": 7 dias até a nota mais recente publicada
LIMITE_REINICIO = 0.3       # se "tudo" virar novo, a Câmara refez o arquivo: recomeça

# marcas de cada nota (bits)
ACIMA_P95 = 1        # acima de 95% das notas do mesmo tipo no ano
REDONDO = 2          # valor redondo em milhares
FIM_DE_SEMANA = 4    # emitida em sábado ou domingo
NOVO_P_DEP = 8       # primeira vez que o deputado paga esse fornecedor no ano
NOVO_NA_COTA = 16    # fornecedor que ninguém tinha pago no ano
ANTIGA = 32          # emitida há mais de 90 dias
GLOSA = 64           # a Câmara cortou parte do valor
NEGATIVA = 128       # valor negativo (estorno/compensação)


def _ler(p: Path, padrao=None):
    return json.loads(p.read_text("utf-8")) if p.exists() else padrao


def _gravar(p: Path, obj):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), "utf-8")


def chaves(df: pd.DataFrame) -> pd.Series:
    """Identidade de cada nota: o código do documento na Câmara; sem ele, um
    resumo dos campos. Linhas repetidas ganham um sufixo (~1, ~2...)."""
    def txt(v) -> str:   # vazio/NaN/NaT viram "" (o pandas 3 mantém NaN em astype(str))
        return "" if v is None or (not isinstance(v, str) and pd.isna(v)) else str(v)

    ides = [txt(v).strip() for v in (df["ide"] if "ide" in df.columns else [""] * len(df))]
    out = []
    for i, (dep, num, dt, val, doc) in enumerate(zip(df["id"], df["numero"], df["data"], df["valor"], df["cnpj_cpf"])):
        if ides[i] and ides[i] != "0":
            out.append(ides[i])
            continue
        cent = "" if pd.isna(val) else str(int(round(float(val) * 100)))
        base = "|".join([txt(dep), txt(num), txt(dt), cent, txt(doc)])
        out.append("h" + hashlib.sha1(base.encode()).hexdigest()[:12])
    k = pd.Series(out, index=df.index, dtype=object)
    n = k.groupby(k).cumcount()
    return k.where(n == 0, k + "~" + n.astype(str))


def _ler_vistas(arq: Path) -> dict[str, str]:
    out = {}
    for linha in arq.read_text("utf-8").splitlines():
        if "\t" in linha:
            k, d = linha.split("\t", 1)
            out[k] = d
    return out


def _escrever_vistas(arq: Path, chaves_, dia: str, anexar=False):
    arq.parent.mkdir(parents=True, exist_ok=True)
    with arq.open("a" if anexar else "w", encoding="utf-8") as f:
        for k in chaves_:
            f.write(f"{k}\t{dia}\n")


def _cent(v) -> int:
    return int(round(float(v) * 100))


# ---------------------------------------------------------------- seção do ano
def montar_secao(df: pd.DataFrame, do_dia: set, ano: int, info: dict, hoje: date) -> dict:
    m = df["k"].isin(do_dia)
    nov, ant = df[m], df[~m]

    cats = list(nov.groupby("categoria")["valor"].sum().sort_values(ascending=False).index)
    ci = {c: i for i, c in enumerate(cats)}
    forn_ord = list(nov.groupby("chave")["valor"].sum().sort_values(ascending=False).index)
    fi = {k: i for i, k in enumerate(forn_ord)}
    prim = nov.drop_duplicates("chave").set_index("chave")

    # contexto do ano: antes e depois do lote
    v_ant = ant.groupby("id")["valor"].sum()
    v_dep = df.groupby("id")["valor"].sum()
    n_ant = ant.groupby("id").size()
    pos_dep = v_dep.rank(ascending=False, method="min").astype(int)
    pos_ant = v_ant.rank(ascending=False, method="min").astype(int)

    f_ant = ant.groupby("chave")["valor"].sum()
    f_dep = df.groupby("chave")["valor"].sum()
    fd_ant = ant.groupby("chave")["id"].nunique()
    fd_dep = df.groupby("chave")["id"].nunique()
    pares_ant = set(zip(ant["id"], ant["chave"]))
    forn_ant = set(ant["chave"])

    pos = ant[ant["valor"] > 0]
    q = pos.groupby("categoria")["valor"].quantile([0.5, 0.95]).unstack() if len(pos) else pd.DataFrame()
    nc = pos.groupby("categoria").size()
    cat_ant = ant.groupby("categoria")["valor"].sum()
    cat_dep = df.groupby("categoria")["valor"].sum()

    linhas = []
    for r in nov.sort_values("valor", ascending=False).itertuples(index=False):
        marcas = 0
        if r.categoria in q.index and nc.get(r.categoria, 0) >= 20 and r.valor > q.loc[r.categoria, 0.95]:
            marcas |= ACIMA_P95
        if r.valor >= 1000 and _cent(r.valor) % 100000 == 0:
            marcas |= REDONDO
        if pd.notna(r.data):
            if r.data.weekday() >= 5:
                marcas |= FIM_DE_SEMANA
            if (pd.Timestamp(hoje) - r.data).days > 90:
                marcas |= ANTIGA
        if (r.id, r.chave) not in pares_ant:
            marcas |= NOVO_P_DEP
        if r.chave not in forn_ant:
            marcas |= NOVO_NA_COTA
        if (r.glosa or 0) > 0:
            marcas |= GLOSA
        if r.valor < 0:
            marcas |= NEGATIVA
        linha = [int(r.id), fi[r.chave], ci[r.categoria],
                 r.data.strftime("%Y-%m-%d") if pd.notna(r.data) else "",
                 _cent(r.valor), r.numero, N._url_curta(r.url), _cent(r.glosa or 0), marcas]
        if r.trecho or r.passageiro:
            linha += [r.trecho, r.passageiro]
        linhas.append(linha)

    deps = {}
    for dep_id, g in nov.groupby("id"):
        i = info.get(int(dep_id), {})
        u = g.iloc[0]
        deps[str(int(dep_id))] = [
            i.get("nome") or u["nome"], i.get("partido") or u["partido"], i.get("uf") or u["uf"], i.get("sexo"),
            round(float(v_ant.get(dep_id, 0.0)), 2), round(float(v_dep.get(dep_id, 0.0)), 2),
            int(pos_ant[dep_id]) if dep_id in pos_ant.index else None, int(pos_dep[dep_id]),
            int(n_ant.get(dep_id, 0)),
        ]

    return {
        "ano": ano,
        "c": cats,
        "f": [[k, prim.loc[k, "fornecedor"], prim.loc[k, "doc"], prim.loc[k, "tipo"]] for k in forn_ord],
        # por fornecedor (mesma ordem de "f"): [recebido no ano antes, depois, nº deputados antes, depois]
        "fx": [[round(float(f_ant.get(k, 0.0)), 2), round(float(f_dep.get(k, 0.0)), 2),
                int(fd_ant.get(k, 0)), int(fd_dep.get(k, 0))] for k in forn_ord],
        # [id, i_forn, i_cat, data de emissão, centavos, número, link, glosa, marcas, (trecho, passageiro)]
        "n": linhas,
        # [nome, partido, UF, sexo, cota no ano antes, depois, posição antes, depois, notas antes]
        "dep": deps,
        # por tipo de gasto: [total no ano antes, depois, mediana das notas, p95, nº de notas antes]
        "cat": {c: [round(float(cat_ant.get(c, 0.0)), 2), round(float(cat_dep.get(c, 0.0)), 2),
                    round(float(q.loc[c, 0.5]), 2) if c in q.index else None,
                    round(float(q.loc[c, 0.95]), 2) if c in q.index else None,
                    int(nc.get(c, 0))] for c in cats},
        "tot": {"antes": round(float(ant["valor"].sum()), 2), "depois": round(float(df["valor"].sum()), 2),
                "notas_antes": int(len(ant)), "notas_depois": int(len(df)),
                "deputados": int((v_dep > 0).sum()), "fornecedores_antes": int(len(forn_ant))},
    }


# ------------------------------------------------------------------- índice
def _atualizar_indice(pasta: Path, hoje: date, inicio: str | None = None):
    idx = _ler(pasta / "indice.json", {}) or {}
    if inicio and not idx.get("inicio"):
        idx["inicio"] = inicio
    dias = []
    for p in sorted(pasta.glob("????-??-??.json"), reverse=True):
        d = _ler(p, {}) or {}
        secs = (d.get("anos") or {}).values()
        n = sum(len(s["n"]) for s in secs)
        if not n:
            continue
        dias.append({"data": p.stem, "notas": n,
                     "valor": round(sum(x[4] for s in secs for x in s["n"]) / 100, 2),
                     "deputados": len({x[0] for s in secs for x in s["n"]}),
                     "anos": sorted(int(a) for a in d["anos"])})
    manter = dias[:DIAS_GUARDADOS]
    for p in pasta.glob("????-??-??.json"):
        if p.stem not in {x["data"] for x in manter}:
            p.unlink()
    idx["dias"] = manter
    idx["verificado_em"] = datetime.now(timezone.utc).isoformat(timespec="minutes")
    _gravar(pasta / "indice.json", idx)
    return idx


# ------------------------------------------------------- notas da semana
def gravar_semana(df: pd.DataFrame, ano: int, info: dict, hoje: date, pasta: Path) -> dict | None:
    """Notas emitidas nos 7 dias que terminam na nota mais recente já publicada (até hoje).
    Grava docs/dados/novas/semana.json no mesmo formato de um lote diário."""
    datas = df["data"].dropna()
    datas = datas[datas <= pd.Timestamp(hoje)]
    if datas.empty:
        return None
    fim = datas.max().normalize()
    ini = fim - pd.Timedelta(days=DIAS_SEMANA - 1)
    m = df["data"].notna() & (df["data"] >= ini) & (df["data"] < fim + pd.Timedelta(days=1))
    if not m.any():
        return None
    sec = montar_secao(df, set(df.loc[m, "k"]), ano, info, hoje)
    _gravar(pasta / "semana.json", {"data": "semana", "de": ini.strftime("%Y-%m-%d"), "ate": fim.strftime("%Y-%m-%d"),
                                    "gerado_em": datetime.now(timezone.utc).isoformat(timespec="minutes"),
                                    "anos": {str(ano): sec}})
    return {"de": ini.strftime("%Y-%m-%d"), "ate": fim.strftime("%Y-%m-%d"), "notas": int(m.sum()),
            "valor": round(float(df.loc[m, "valor"].sum()), 2), "deputados": int(df.loc[m, "id"].nunique())}


# --------------------------------------------------------------------- main
def processar(ceap_df: pd.DataFrame, ano: int, info: dict, hoje: date, saida: Path, brutos: Path) -> dict:
    """Detecta e grava as notas novas de `ano`. Devolve um pequeno resumo."""
    pasta = saida / "novas"
    arq = brutos / "novas" / f"vistas_{ano}.tsv"
    dia = hoje.isoformat()
    df = N.preparar(ceap_df)
    df["k"] = chaves(df)
    if ano == hoje.year:
        try:
            sem = gravar_semana(df, ano, info, hoje, pasta)
            idx = _ler(pasta / "indice.json", {}) or {}
            idx["semana"] = sem
            _gravar(pasta / "indice.json", idx)
        except Exception as e:  # noqa: BLE001 — a semana é complemento; não derruba as notas novas
            log.warning("  notas da semana %s: %s", ano, e)

    if not arq.exists():
        _escrever_vistas(arq, df["k"], "0")
        _atualizar_indice(pasta, hoje, inicio=dia)
        log.info("  novas %s: primeira execução, %d notas guardadas como referência", ano, len(df))
        return {"inicio": True, "notas": 0}

    vistas = _ler_vistas(arq)
    novas_k = [k for k in df["k"] if k not in vistas]
    if len(novas_k) > max(5000, LIMITE_REINICIO * len(df)):
        log.warning("  novas %s: %d de %d notas pareceram novas — a Câmara deve ter refeito o arquivo; "
                    "recomeçando a referência.", ano, len(novas_k), len(df))
        _escrever_vistas(arq, df["k"], "0")
        _atualizar_indice(pasta, hoje)
        return {"reinicio": True, "notas": 0}
    _escrever_vistas(arq, novas_k, dia, anexar=True)

    do_dia = {k for k, d in vistas.items() if d == dia} | set(novas_k)
    do_dia &= set(df["k"])
    arq_dia = pasta / f"{dia}.json"
    conteudo = _ler(arq_dia, {}) or {}
    conteudo.update({"data": dia, "gerado_em": datetime.now(timezone.utc).isoformat(timespec="minutes")})
    conteudo.setdefault("anos", {})
    if do_dia:
        conteudo["anos"][str(ano)] = montar_secao(df, do_dia, ano, info, hoje)
    if conteudo["anos"]:
        _gravar(arq_dia, conteudo)
    _atualizar_indice(pasta, hoje)
    log.info("  novas %s: %d nota(s) nova(s) agora, %d no dia", ano, len(novas_k), len(do_dia))
    return {"notas": len(do_dia)}
