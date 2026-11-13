"""Emendas parlamentares — Portal da Transparência (arquivo único, atualizado
diariamente pela CGU). Só emendas individuais entram no casamento com o
deputado; as de bancada/comissão têm como "autor" o colegiado."""
import io
import unicodedata

import pandas as pd

import config
from coletor import http
from coletor.camara import br_para_float, normalizar_nome


def _col(df, *trechos):
    """Acha a coluna cujo nome contém todos os trechos (sem acento/caixa)."""
    def norm(s):
        return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    for c in df.columns:
        if all(t in norm(c) for t in trechos):
            return c
    return None


def ler_emendas_csv(conteudo: bytes) -> pd.DataFrame:
    df = pd.read_csv(io.BytesIO(conteudo), sep=";", dtype=str,
                     encoding="latin-1", low_memory=False)
    c = {
        "ano": _col(df, "ano da emenda"),
        "tipo": _col(df, "tipo de emenda"),
        "autor": _col(df, "nome do autor"),
        "municipio": None,
        "uf": None,
        "funcao": _col(df, "nome funcao"),
        "empenhado": _col(df, "valor empenhado"),
        "pago": _col(df, "valor pago"),
        "rp_pago": _col(df, "restos a pagar pagos"),
        "localidade": _col(df, "localidade"),
    }
    # colunas "Município" e "UF" sem o prefixo "Código"
    for col in df.columns:
        n = unicodedata.normalize("NFKD", col).encode("ascii", "ignore").decode().lower().strip()
        if n == "municipio":
            c["municipio"] = col
        if n == "uf":
            c["uf"] = col

    out = pd.DataFrame({
        "ano": pd.to_numeric(df[c["ano"]], errors="coerce"),
        "tipo": df[c["tipo"]].fillna("") if c["tipo"] else "",
        "autor": df[c["autor"]].fillna(""),
        "autor_norm": df[c["autor"]].fillna("").map(normalizar_nome),
        "municipio": df[c["municipio"]].fillna("") if c["municipio"] else "",
        "uf": df[c["uf"]].fillna("") if c["uf"] else "",
        "localidade": df[c["localidade"]].fillna("") if c["localidade"] else "",
        "funcao": df[c["funcao"]].fillna("") if c["funcao"] else "",
        "empenhado": df[c["empenhado"]].map(br_para_float),
        "pago": df[c["pago"]].map(br_para_float)
                + (df[c["rp_pago"]].map(br_para_float) if c["rp_pago"] else 0),
    })
    return out.dropna(subset=["ano"]).astype({"ano": int})


def baixar_emendas() -> pd.DataFrame:
    z = http.baixar_zip(config.EMENDAS_ZIP, timeout=900)
    nome = next(n for n in z.namelist() if n.lower().endswith(".csv"))
    return ler_emendas_csv(z.read(nome))


def resumir_emendas(df: pd.DataFrame, ano: int, deputados: list[dict]) -> dict[int, dict]:
    """Casa autor da emenda com o deputado por nome parlamentar, nome
    eleitoral ou nome civil (normalizados). Nomes ambíguos são descartados."""
    df = df[(df["ano"] == ano) & df["tipo"].str.contains("Individual", case=False, na=False)]

    chave_para_id: dict[str, set] = {}
    for d in deputados:
        for nome in (d.get("nome"), d.get("nome_eleitoral"), d.get("nome_civil")):
            if nome:
                chave_para_id.setdefault(normalizar_nome(nome), set()).add(d["id"])
    unicos = {k: next(iter(v)) for k, v in chave_para_id.items() if len(v) == 1}

    df = df.assign(dep_id=df["autor_norm"].map(unicos)).dropna(subset=["dep_id"])
    res = {}
    for dep_id, g in df.groupby("dep_id"):
        local = g["municipio"].where(g["municipio"] != "", g["localidade"])
        g = g.assign(destino=(local + "/" + g["uf"]).str.strip("/"))
        dest = g.groupby("destino")[["empenhado", "pago"]].sum() \
                .sort_values("empenhado", ascending=False).head(15)
        func = g.groupby("funcao")["empenhado"].sum().sort_values(ascending=False)
        res[int(dep_id)] = {
            "empenhado": round(float(g["empenhado"].sum()), 2),
            "pago": round(float(g["pago"].sum()), 2),
            "qtd": int(len(g)),
            "top_destinos": [{"destino": k, "empenhado": round(float(r.empenhado), 2),
                              "pago": round(float(r.pago), 2)} for k, r in dest.iterrows()],
            "por_funcao": {k or "Não informado": round(float(v), 2) for k, v in func.items()},
        }
    return res
