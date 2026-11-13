"""Projetos aprovados na Câmara e a relevância de cada um para a população.

Fonte: arquivos anuais de dados abertos da Câmara (proposições apresentadas em
cada ano, com a situação atual; temas; autores). Entra o que foi aprovado:
virou lei, aguarda sanção/promulgação, foi aprovado e enviado ao Senado, ou
foi aprovado e vetado por inteiro.

Relevância (0 a 100), por critério de utilidade para a população — regras
abertas e explicadas em cada projeto ("motivos"):
  + tipo da proposta (emenda à Constituição pesa mais que projeto de lei)
  + temas da Câmara (trabalho, previdência, saúde, educação... pesam mais)
  + palavras que mostram efeito direto na vida das pessoas (jornada, salário
    mínimo, imposto de renda, SUS, aluguel, violência contra a mulher...)
  + virou lei de fato
  − homenagens, nomes de ruas/viadutos, datas comemorativas, títulos,
    concessões de rádio e TV e acordos internacionais têm teto baixo.
"""
import csv
import io
import logging
import re
import unicodedata

log = logging.getLogger("qcd")

TIPOS = {"PEC": 25, "PLP": 20, "MPV": 20, "PL": 12, "PDL": 3, "PDC": 3, "PRC": 0}
NOME_TIPO = {"PEC": "Proposta de Emenda à Constituição", "PLP": "Projeto de Lei Complementar", "MPV": "Medida Provisória",
             "PL": "Projeto de Lei", "PDL": "Projeto de Decreto Legislativo", "PDC": "Projeto de Decreto Legislativo",
             "PRC": "Projeto de Resolução da Câmara"}

TEMAS = [  # (trecho do nome do tema, peso)
    ("trabalho e emprego", 30), ("previdencia e assistencia", 30), ("saude", 28), ("educacao", 25),
    ("consumidor", 25), ("direito penal", 18), ("defesa e seguranca", 18), ("direitos humanos", 18),
    ("cidades e desenvolvimento urbano", 18), ("viacao, transporte", 18), ("energia", 18), ("economia", 18),
    ("financas publicas", 15), ("meio ambiente", 15), ("direito civil", 12), ("agricultura", 12),
    ("industria, comercio", 12), ("politica, partidos e eleicoes", 12), ("direito constitucional", 10),
    ("direito e justica", 10), ("ciencia, tecnologia", 10), ("estrutura fundiaria", 10), ("comunicacoes", 8),
    ("administracao publica", 8), ("esporte", 5), ("turismo", 5), ("arte, cultura", 5),
    ("relacoes internacionais", 4), ("processo legislativo", 2), ("homenagens", 0),
]

PALAVRAS = [  # (expressão, pontos, motivo)
    (r"\b6\s*x\s*1\b|escala de trabalho|jornada (de trabalho|semanal|maxima)|duracao do trabalho", 25, "jornada de trabalho"),
    (r"salario minimo|piso salarial|piso nacional", 25, "salário mínimo / piso"),
    (r"bolsa familia|auxilio emergencial|transferencia de renda|renda basica|combate a fome|seguranca alimentar|cesta basica", 22, "renda e combate à fome"),
    (r"aposentadoria|previdencia social|beneficio de prestacao continuada|\bbpc\b|pensao por morte|\binss\b", 20, "aposentadoria e benefícios"),
    (r"imposto (sobre a )?renda|reforma tributaria|isencao do imposto|\bicms\b|\bipi\b|tributacao sobre o consumo|\bibs\b|\bcbs\b", 20, "impostos"),
    (r"isencao|isentar|reduz(ir)? (o |a )?(imposto|aliquota|tributo)|faixa de isencao", 10, "isenção ou redução de imposto"),
    (r"\bfgts\b|seguro-desemprego|consolidacao das leis do trabalho|\bclt\b|licenca-maternidade|licenca-paternidade|ferias|direitos trabalhistas|trabalhador", 18, "direitos do trabalhador"),
    (r"sistema unico de saude|\bsus\b|medicament|vacina|atendimento (de|a) saude|hospital|cancer|saude mental|plano de saude", 18, "saúde"),
    (r"violencia contra a mulher|maria da penha|feminicidio|violencia domestica", 22, "violência contra a mulher"),
    (r"escola|ensino (fundamental|medio|basico|superior)|educacao basica|creche|universidad|professor|merenda|\bfundeb\b|\benem\b|\bfies\b|\bprouni\b", 15, "educação"),
    (r"consumidor|tarifa|conta de (luz|energia|agua)|energia eletrica|combustive|gasolina|diesel|gas de cozinha|preco", 15, "custo de vida"),
    (r"moradia|habitacao|minha casa|aluguel|locacao de imoveis|despejo", 15, "moradia"),
    (r"crianca|adolescente|idoso|pessoa com deficiencia|autis", 12, "crianças, idosos e pessoas com deficiência"),
    (r"seguranca publica|crime|homicidio|trafico|arma de fogo|sistema prisional|pena de", 12, "segurança"),
    (r"credito (consignado|rural|estudantil|ao consumidor|imobiliario|habitacional)|endividamento|superendividamento|juros|dividas? (das familias|de pessoas)|renegociacao de dividas", 12, "crédito e dívidas"),
    (r"saneamento|agua potavel|esgoto", 12, "saneamento"),
    (r"transporte publico|mobilidade urbana|transito|carteira nacional de habilitacao|\bcnh\b", 10, "transporte e trânsito"),
    (r"desastre|calamidade|enchente|queimada|desmatamento|mudanca do clima|climatic", 10, "clima e desastres"),
    (r"dados pessoais|internet|telefonia|golpe|fraude", 8, "internet e golpes"),
]
TETO_PALAVRAS = 35

FILTROS = [  # (expressão, teto, rótulo) — limitam a nota
    (r"\bdenomina\b|\bdenominacao\b|da (nova )?denominacao|inscreve o nome|inscricao do nome|livro dos herois|panteao da patria"
     r"|declara patron|e declarad[oa] patron|capital nacional d|titulo de cidadao|confere o titulo|honorari"
     r"|homenage|data comemorativa|institui o dia\b|institui o \"?dia|dia nacional d|semana nacional d|mes nacional d"
     r"|ano nacional d|institui a semana|institui o mes|patrimonio cultural imaterial|hino oficial", 5, "homenagem ou data comemorativa"),
    (r"outorga|renova(cao|r)? (a |da )?(concessao|permissao|autorizacao)|radiodifusao|radio comunitaria|servico de radio", 4, "concessão de rádio/TV"),
    (r"aprova o texto d[oa] (acordo|convencao|tratado|protocolo|memorando|emenda)|acordo entre (o governo|a republica)", 15, "acordo internacional"),
    (r"abre credito extraordinario|abre (ao orcamento|aos orcamentos).{0,40}credito", 35, "crédito no Orçamento"),
]

SITUACOES = [  # (expressão na situação, código, rótulo)
    (r"transformad[oa] em norma juridica", "lei", "Virou lei"),
    (r"transformad[oa] (na|em) lei", "lei", "Virou lei"),
    (r"aguardando sancao", "sancao", "Aprovado, aguarda sanção"),
    (r"aguardando promulgacao", "promulgacao", "Aprovado, aguarda promulgação"),
    (r"vetad[oa] totalmente|veto total", "vetado", "Aprovado e vetado"),
    (r"remetid[oa] ao senado|enviad[oa] ao senado|aguardando apreciacao pelo senado|apreciacao pelo senado federal", "senado", "Aprovado na Câmara, no Senado"),
]
NIVEIS = [(65, "alto", "Alto impacto"), (40, "medio", "Impacto médio"), (20, "baixo", "Impacto baixo"), (0, "simbolico", "Simbólico ou administrativo")]


def sem_acento(s) -> str:
    return unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()


def situacao(desc: str):
    t = sem_acento(desc)
    for exp, cod, rot in SITUACOES:
        if re.search(exp, t):
            return cod, rot
    return None


def relevancia(sigla: str, ementa: str, temas: list[str], keywords: str = "", cod_sit: str = "") -> tuple[int, str, list[str]]:
    """(nota 0–100, nível, motivos)."""
    texto = sem_acento(f"{ementa} {keywords}")
    motivos = []
    nota = TIPOS.get(sigla, 8)
    if sigla == "PEC":
        motivos.append("muda a Constituição")
    elif sigla == "PLP":
        motivos.append("lei complementar")
    elif sigla == "MPV":
        motivos.append("medida provisória (já vale ao ser editada)")
    pesos = sorted(((p, t) for t in temas for trecho, p in TEMAS if trecho in sem_acento(t)), reverse=True)
    if pesos:
        nota += pesos[0][0] + min(15, 0.3 * sum(p for p, _ in pesos[1:]))
        motivos.append("tema: " + ", ".join(dict.fromkeys(t for _, t in pesos[:3])))
    pts = 0
    for exp, p, rot in PALAVRAS:
        if re.search(exp, texto):
            pts += p
            motivos.append(rot)
    nota += min(TETO_PALAVRAS, pts)
    if cod_sit == "lei":
        nota += 10
    elif cod_sit == "vetado":
        nota -= 10
        motivos.append("vetado: não entrou em vigor")
    teto = 100
    for exp, lim, rot in FILTROS:
        if re.search(exp, texto) and lim < teto:
            teto = lim
            motivos.insert(0, rot)
    if any("homenage" in sem_acento(t) for t in temas):
        teto = min(teto, 5)
        if "homenagem ou data comemorativa" not in motivos:
            motivos.insert(0, "homenagem ou data comemorativa")
    if re.search(r"\b(no|do) municipio de|\bna cidade de|\bno distrito de", texto):
        nota -= 10
        motivos.append("efeito local")
    nota = int(round(max(0, min(teto, nota))))
    nivel = next(cod for lim, cod, _ in NIVEIS if nota >= lim)
    return nota, nivel, motivos


# ------------------------------------------------------------- data da aprovação
_TRAMITACAO_APROVA = re.compile(r"remessa ao senado|remetid[ao] ao senado|envio ao senado|encaminhad[ao] ao senado|"
                                r"remessa a sancao|enviad[ao] a sancao|encaminhad[ao] a sancao|remessa a promulgacao|"
                                r"transformad[ao] (em|na) (lei|norma)|promulgad[ao]")


def data_aprovacao(tramitacoes: list[dict]) -> str | None:
    """Data em que a proposição foi aprovada na Câmara: a primeira movimentação em que a situação passa a
    "aprovada" (aguardando o Senado, sanção ou promulgação, virou lei, vetada) ou que registra a remessa ao
    Senado / à sanção. A situação atual da proposição muda de data a cada nova movimentação (ofícios,
    recebimentos), por isso não serve para dizer em que ano ela foi aprovada."""
    for t in sorted(tramitacoes or [], key=lambda t: (str(t.get("dataHora") or ""), int(t.get("sequencia") or 0))):
        dh = str(t.get("dataHora") or "")[:10]
        if not dh:
            continue
        if situacao(str(t.get("descricaoSituacao") or "")) or _TRAMITACAO_APROVA.search(sem_acento(str(t.get("descricaoTramitacao") or ""))):
            return dh
    return None


# ------------------------------------------------------------- leitura dos arquivos
def ler_csv(conteudo: bytes) -> list[dict]:
    txt = conteudo.decode("utf-8-sig", errors="replace")
    return list(csv.DictReader(io.StringIO(txt), delimiter=";"))


def _g(r: dict, *nomes, padrao=""):
    for n in nomes:
        if n in r and r[n] not in (None, ""):
            return r[n]
    return padrao


def aprovados_do_ano(props: list[dict], temas: list[dict], autores: list[dict], desde: int) -> list[dict]:
    """Proposições aprovadas (com data da situação a partir de `desde`) de um arquivo anual."""
    tema_por = {}
    for t in temas:
        uri = _g(t, "uriProposicao")
        pid = uri.rstrip("/").split("/")[-1] if uri else ""
        if pid and _g(t, "tema"):
            tema_por.setdefault(pid, []).append(_g(t, "tema"))
    aut_por = {}
    for a in autores:
        pid = _g(a, "idProposicao") or _g(a, "uriProposicao").rstrip("/").split("/")[-1]
        if pid:
            aut_por.setdefault(pid, []).append(a)
    out = []
    for p in props:
        sigla = _g(p, "siglaTipo").strip().upper()
        if sigla not in TIPOS:
            continue
        sit = situacao(_g(p, "ultimoStatus_descricaoSituacao", "statusProposicao_descricaoSituacao"))
        if not sit:
            continue
        data = _g(p, "ultimoStatus_dataHora", "statusProposicao_dataHora")[:10]
        if not data or int(data[:4]) < desde:
            continue
        pid = str(_g(p, "id"))
        ts = list(dict.fromkeys(tema_por.get(pid, [])))
        nota, nivel, motivos = relevancia(sigla, _g(p, "ementa"), ts, _g(p, "keywords"), sit[0])
        aut = sorted(aut_por.get(pid, []), key=lambda a: int(_g(a, "ordemAssinatura", padrao="999") or 999))
        deps = [[int(_g(a, "idDeputadoAutor")), _g(a, "nomeAutor"), _g(a, "siglaPartidoAutor"), _g(a, "siglaUFAutor")]
                for a in aut if str(_g(a, "idDeputadoAutor")).isdigit()]
        out.append({
            "id": int(pid), "sigla": sigla, "numero": int(_g(p, "numero", padrao="0") or 0), "ano": int(_g(p, "ano", padrao="0") or 0),
            "ementa": re.sub(r"\s+", " ", _g(p, "ementa")).strip(), "situacao": sit[0], "situacao_texto": sit[1],
            "situacao_camara": _g(p, "ultimoStatus_descricaoSituacao"), "data": data, "apresentacao": _g(p, "dataApresentacao")[:10],
            "nota": nota, "nivel": nivel, "motivos": motivos, "temas": ts,
            "autor_principal": (_g(aut[0], "nomeAutor") + (f" ({_g(aut[0], 'tipoAutor')})" if not deps else "")) if aut else "",
            "deputados_autores": deps[:8], "n_autores": len(aut),
        })
    return out
