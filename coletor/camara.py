"""Coleta de dados da Câmara dos Deputados.

- Lista de deputados: API de Dados Abertos (v2)
- Cota parlamentar (CEAP): arquivo anual aberto Ano-AAAA.csv.zip
- Verba de gabinete, salário bruto, auxílio-moradia, imóvel funcional:
  página pública do deputado (camara.leg.br/deputados/ID?ano=AAAA).
  Só a página principal é lida — as subpáginas são vetadas pelo robots.txt.
"""
import io
import re
import unicodedata

import pandas as pd
from bs4 import BeautifulSoup

import config
from coletor import http
from coletor.privacidade import mascarar_cpf_no_texto

MESES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN",
         "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"]
NUM = r"(\d{1,3}(?:\.\d{3})*,\d{2})"


# ----------------------------------------------------------------- utilidades
def br_para_float(txt) -> float:
    """'1.234,56' -> 1234.56 ; '1234.56' -> 1234.56 ; vazio -> 0."""
    if txt is None:
        return 0.0
    s = str(txt).strip().replace("R$", "").replace(" ", "")
    if not s or s.lower() == "nan":
        return 0.0
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0


def normalizar_nome(nome: str) -> str:
    s = unicodedata.normalize("NFKD", str(nome)).encode("ascii", "ignore").decode()
    s = re.sub(r"[^A-Za-z ]", " ", s).upper()
    s = re.sub(r"^(DEP|DEPUTADO|DEPUTADA)\s+", "", s.strip())
    return re.sub(r"\s+", " ", s).strip()


# ------------------------------------------------------------------ deputados
def listar_deputados(legislaturas: list[int] | None = None) -> list[dict]:
    """Todos que tiveram mandato nas legislaturas pedidas (inclui suplentes
    que assumiram), marcando quem está em exercício hoje."""
    def paginar(params):
        url, itens = f"{config.API_CAMARA}/deputados", []
        params = {**params, "itens": 100, "ordem": "ASC", "ordenarPor": "nome"}
        while url:
            r = http.get(url, params=params, headers={"Accept": "application/json"}, timeout=20)
            j = r.json()
            itens += j["dados"]
            url = next((l["href"] for l in j.get("links", []) if l["rel"] == "next"), None)
            params = None  # o link "next" já traz os parâmetros
        return itens

    em_exercicio = {d["id"] for d in paginar({})}
    vistos = {}
    # da legislatura mais antiga para a atual: partido/UF ficam os mais recentes
    for leg in legislaturas or [config.LEGISLATURA]:
        for d in paginar({"idLegislatura": leg}):
            atual = vistos.setdefault(d["id"], {"id": d["id"], "legislaturas": []})
            atual.update({
                "nome": d["nome"],
                "partido": d.get("siglaPartido"),
                "uf": d.get("siglaUf"),
                "foto": d.get("urlFoto"),
                "em_exercicio": d["id"] in em_exercicio,
            })
            if leg not in atual["legislaturas"]:
                atual["legislaturas"].append(leg)
    return list(vistos.values())


FOTO = "https://www.camara.leg.br/internet/deputado/bandep/{id}.jpg"


def deputados_do_ceap(df: pd.DataFrame) -> list[dict]:
    """Plano B quando a API está fora do ar: a lista sai do próprio arquivo
    da cota (nome, UF e partido do lançamento mais recente de cada um)."""
    if df is None or df.empty:
        return []
    ult = df.sort_values("mes").groupby("id").tail(1)
    return [{
        "id": int(r.id), "nome": r.nome, "partido": r.partido or None,
        "uf": r.uf or None, "foto": FOTO.format(id=int(r.id)),
        "em_exercicio": None,
    } for r in ult.itertuples() if r.nome]


def detalhar_deputado(dep_id: int) -> dict:
    """Nome civil (usado para casar com o autor das emendas)."""
    r = http.get(f"{config.API_CAMARA}/deputados/{dep_id}",
                 headers={"Accept": "application/json"}, timeout=20)
    d = r.json()["dados"]
    st = d.get("ultimoStatus") or {}
    return {
        "nome_civil": d.get("nomeCivil"),
        "nome_eleitoral": st.get("nomeEleitoral"),
        "situacao": st.get("situacao"),
        "sexo": d.get("sexo"),
    }


def baixar_foto(dep_id: int) -> bytes | None:
    """Foto oficial do deputado. Usa a sessão direto (sem contar falhas do
    site): foto que não existe não pode derrubar a coleta dos perfis."""
    import time
    time.sleep(config.PAUSA_ENTRE_REQUISICOES / 2)
    r = http.sessao().get(FOTO.format(id=dep_id), timeout=20)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    if not r.headers.get("Content-Type", "").startswith("image"):
        return None
    return r.content


# ----------------------------------------------------------------------- CEAP
# Nomes curtos para as categorias da cota (a Câmara muda a grafia ao longo dos anos)
CATEGORIAS = [
    ("PASSAGE", "AÉRE", "Passagens aéreas"),
    ("PASSAGE", "", "Passagens terrestres e fluviais"),
    ("DIVULGA", "", "Divulgação do mandato"),
    ("COMBUST", "", "Combustível"),
    ("AERONAVE", "", "Fretamento de aeronaves"),
    ("EMBARCA", "", "Fretamento de embarcações"),
    ("VEÍCULO", "", "Aluguel de veículos"),
    ("VEICULO", "", "Aluguel de veículos"),
    ("ESCRIT", "", "Escritório de apoio"),
    ("TELEF", "", "Telefonia"),
    ("POSTA", "", "Correios"),
    ("HOSPED", "", "Hospedagem"),
    ("ALIMENT", "", "Alimentação"),
    ("CONSULTOR", "", "Consultorias e pesquisas"),
    ("TÁXI", "", "Táxi, pedágio e estacionamento"),
    ("TAXI", "", "Táxi, pedágio e estacionamento"),
    ("SEGURAN", "", "Segurança"),
    ("PUBLICA", "", "Assinaturas de publicações"),
    ("CURSO", "", "Cursos e eventos"),
]


CAT_SEM_NOTA = "Sem nota no arquivo aberto"          # diferença para a página oficial (ver custos.py)
CAT_AUX = "Complemento do auxílio-moradia"


def categoria_curta(txt: str) -> str:
    t = str(txt).upper()
    for a, b, nome in CATEGORIAS:
        if a in t and b in t:
            return nome
    return "Outros"


def _col_txt(df, nome):
    if nome not in df.columns:
        return ""
    return df[nome].fillna("").astype(str).str.strip()


def ler_ceap_csv(conteudo: bytes) -> pd.DataFrame:
    df = pd.read_csv(io.BytesIO(conteudo), sep=";", dtype=str,
                     encoding="utf-8-sig", low_memory=False)
    id_col = "ideCadastro" if "ideCadastro" in df.columns else "nuDeputadoId"
    out = pd.DataFrame({
        "id": pd.to_numeric(df[id_col], errors="coerce"),
        "nome": df["txNomeParlamentar"].fillna("").str.strip(),
        "uf": df["sgUF"].fillna("").str.strip(),
        "partido": df["sgPartido"].fillna("").str.strip(),
        "mes": pd.to_numeric(df["numMes"], errors="coerce"),
        "categoria": df["txtDescricao"].fillna("OUTROS").map(categoria_curta),
        "data": pd.to_datetime(df["datEmissao"].str.slice(0, 10), errors="coerce")
                if "datEmissao" in df.columns else pd.NaT,
        "fornecedor": df["txtFornecedor"].fillna("").str.strip().map(mascarar_cpf_no_texto),
        "cnpj_cpf": df["txtCNPJCPF"].fillna("").str.strip(),
        "valor": df["vlrLiquido"].map(br_para_float),
        "glosa": df["vlrGlosa"].map(br_para_float) if "vlrGlosa" in df.columns else 0.0,
        "numero": _col_txt(df, "txtNumero"),
        "url": _col_txt(df, "urlDocumento"),
        "passageiro": _col_txt(df, "txtPassageiro"),
        "trecho": _col_txt(df, "txtTrecho"),
        "ide": _col_txt(df, "ideDocumento"),
        "cpf_dep": _col_txt(df, "cpf"),
    })
    # lançamentos de complemento do auxílio-moradia não são fornecedores
    forn_norm = out["fornecedor"].str.upper()
    aux = forn_norm.str.contains("AUX", na=False) & forn_norm.str.contains("MORADIA", na=False) & (out["cnpj_cpf"].str.strip() == "")
    out.loc[aux, "categoria"] = CAT_AUX
    return out.dropna(subset=["id"]).astype({"id": int})


def chaves_deputados(df: pd.DataFrame) -> dict[int, dict]:
    """{id: {'cpf6': 6 dígitos do meio do CPF, 'nome': nome parlamentar}} — só o
    trecho do CPF que a Receita também mostra (para achar deputados entre sócios)."""
    out = {}
    if df is None or df.empty or "cpf_dep" not in df.columns:
        return out
    for dep_id, cpf, nome in df[["id", "cpf_dep", "nome"]].drop_duplicates("id").itertuples(index=False):
        c = re.sub(r"\D", "", str(cpf or ""))
        if len(c) == 11:
            out[int(dep_id)] = {"cpf6": c[3:9], "nome": nome}
    return out


def baixar_ceap(ano: int) -> pd.DataFrame:
    z = http.baixar_zip(config.CEAP_ZIP.format(ano=ano))
    nome = next(n for n in z.namelist() if n.lower().endswith(".csv"))
    return ler_ceap_csv(z.read(nome))


def doc_publico(c: str) -> str:
    """CNPJ como veio; CPF (11 dígitos, em qualquer formato) mascarado."""
    d = re.sub(r"\D", "", c or "")
    return f"***.{d[3:6]}.{d[6:9]}-**" if len(d) == 11 else mascarar_cpf_no_texto(c)


def resumir_ceap(df: pd.DataFrame) -> dict[int, dict]:
    """Por deputado: total, por mês, por categoria, top fornecedores."""
    res = {}
    for dep_id, g in df.groupby("id"):
        por_mes = g.groupby("mes")["valor"].sum()
        por_cat = g.groupby("categoria")["valor"].sum().sort_values(ascending=False)
        forn = (g.groupby(["fornecedor", "cnpj_cpf"])["valor"].sum()
                  .sort_values(ascending=False).head(15))
        res[int(dep_id)] = {
            "total": round(float(g["valor"].sum()), 2),
            "por_mes": {int(m): round(float(v), 2) for m, v in por_mes.items()},
            "por_categoria": {c: round(float(v), 2) for c, v in por_cat.items()},
            "top_fornecedores": [
                {"nome": f, "cnpj_cpf": doc_publico(c), "valor": round(float(v), 2)}
                for (f, c), v in forn.items()
            ],
        }
    return res


# ------------------------------------------------------------ página pública
def _texto(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for t in soup(["script", "style", "noscript"]):
        t.decompose()
    return re.sub(r"\s+", " ", soup.get_text(" ")).strip()


def _trecho(txt: str, inicio: str, fins: list[str]) -> str:
    i = txt.find(inicio)
    if i < 0:
        return ""
    j = min([k for k in (txt.find(f, i + len(inicio)) for f in fins) if k > 0],
            default=len(txt))
    return txt[i:j]


def _bloco_gasto(trecho: str) -> dict:
    gasto = re.search(r"Gasto\s+" + NUM, trecho)
    nao = re.search(r"Não utilizado\s+" + NUM, trecho)
    meses = {}
    for m, v in re.findall(r"\b(" + "|".join(MESES) + r")\s+" + NUM, trecho):
        meses[MESES.index(m) + 1] = br_para_float(v)
    return {
        "gasto": br_para_float(gasto.group(1)) if gasto else None,
        "nao_utilizado": br_para_float(nao.group(1)) if nao else None,
        "por_mes": meses,
    }


VERSAO_PARSER = 2   # sobe quando a leitura muda: força reler os perfis guardados
_SEP = r"[^\w$]{0,6}"   # ícones/"?" de ajuda que a página põe entre rótulo e valor


def _limpar(t: str | None) -> str | None:
    if not t:
        return None
    return re.sub(r"^[^\wÀ-ú]+", "", t).strip() or None


def parse_perfil(html: str, ano: int | None = None) -> dict:
    txt = _texto(html)
    base = txt[txt.find("Gastos e recursos"):] if "Gastos e recursos" in txt else txt

    # Para quem não teve mandato no ano pedido, a página mostra outro ano:
    # nesse caso os gastos não valem para o ano pedido.
    ano_pag = re.search(r"Gastos e recursos\s+(\d{4})", txt)
    outro_ano = bool(ano and ano_pag and int(ano_pag.group(1)) != ano)

    vazio = {"gasto": None, "nao_utilizado": None, "por_mes": {}}
    cota = vazio if outro_ano else _bloco_gasto(_trecho(base, "Cota parlamentar", ["Verba de gabinete"]))
    gab = vazio if outro_ano else _bloco_gasto(_trecho(base, "Verba de gabinete",
                               ["Pessoal de gabinete", "Salário mensal", "Imóvel funcional"]))

    sal = re.search(r"Salário mensal bruto" + _SEP + r"R\$\s*" + NUM, base)
    pessoal = re.search(r"Pessoal de gabinete\D{0,12}?(\d+)\s+pessoa", base)
    imovel = re.search(r"Imóvel funcional\s+(.{0,90}?)(?=Auxílio-moradia|Viagens|$)", base)
    aux = re.search(r"Auxílio-moradia\s+(.{0,90}?)(?=Viagens|Passaporte|Imóvel|$)", base)
    viagens = re.search(r"Viagens em missão oficial\D{0,8}?(\d+)", base)
    presenca = {"plenario": _bloco_presenca(_trecho(txt, "Presença em Plenário", ["Presença em Comiss", "Gastos e recursos", "Projetos"])),
                "comissoes": _bloco_presenca(_trecho(txt, "Presença em Comiss", ["Presença em Plenário", "Gastos e recursos", "Projetos"]))}

    aux_txt = _limpar(aux.group(1)) if aux else None
    if not aux_txt:
        recebe = None
    else:
        t = aux_txt.lower()
        recebe = False if ("não recebe" in t or "nao recebe" in t or t.startswith("não")) else ("receb" in t)
    return {
        "versao": VERSAO_PARSER,
        "ano_pagina": int(ano_pag.group(1)) if ano_pag else None,
        "cota_parlamentar": cota,
        "verba_gabinete": gab,
        "salario_mensal_bruto": br_para_float(sal.group(1)) if sal else None,
        "pessoal_gabinete": int(pessoal.group(1)) if pessoal else None,
        "imovel_funcional": _limpar(imovel.group(1)) if imovel else None,
        "auxilio_moradia_texto": aux_txt,
        "recebe_auxilio_moradia": recebe,
        "viagens_missao_oficial": int(viagens.group(1)) if viagens else None,
        "presenca": None if outro_ano else presenca,
    }


def _bloco_presenca(trecho: str) -> dict | None:
    """Números oficiais de frequência mostrados na página do deputado (quando existem)."""
    if not trecho:
        return None
    trecho = trecho[:400]
    def n(rotulo):
        m = re.search(rotulo + r"\D{0,25}?(\d+)", trecho, re.I)
        return int(m.group(1)) if m else None
    out = {"presencas": n(r"Presen[çc]as?(?!\s+em)"), "justificadas": n(r"Aus[êe]ncias?\s+justificadas?"),
           "nao_justificadas": n(r"Aus[êe]ncias?\s+n[ãa]o\s+justificadas?")}
    return out if any(v is not None for v in out.values()) else None


def coletar_perfil(dep_id: int, ano: int) -> dict:
    r = http.get(config.PERFIL_DEPUTADO.format(id=dep_id, ano=ano))
    return parse_perfil(r.text, ano)
