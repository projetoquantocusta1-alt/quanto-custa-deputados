"""Testes offline dos leitores (rodar: python -m pytest -q)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from coletor import camara, custos, transparencia  # noqa: E402

FIX = Path(__file__).parent / "fixtures"


def test_br_para_float():
    assert camara.br_para_float("1.234,56") == 1234.56
    assert camara.br_para_float("1234.56") == 1234.56
    assert camara.br_para_float("") == 0.0
    assert camara.br_para_float(None) == 0.0


def test_normalizar_nome():
    assert camara.normalizar_nome("Dep. José Guimarães") == "JOSE GUIMARAES"


def test_parse_perfil():
    p = camara.parse_perfil((FIX / "perfil.html").read_text("utf-8"))
    assert p["cota_parlamentar"]["gasto"] == 500766.48
    assert p["cota_parlamentar"]["por_mes"][1] == 33300.06
    assert p["verba_gabinete"]["gasto"] == 1357872.73
    assert p["verba_gabinete"]["nao_utilizado"] == 15290.30
    assert p["verba_gabinete"]["por_mes"][1] == 117930.16
    assert len(p["verba_gabinete"]["por_mes"]) == 11
    assert p["salario_mensal_bruto"] == 44008.52
    assert p["pessoal_gabinete"] == 22
    assert p["recebe_auxilio_moradia"] is False
    assert p["imovel_funcional"].startswith("Fez uso")
    assert p["viagens_missao_oficial"] == 0


def test_ceap():
    df = camara.ler_ceap_csv((FIX / "ceap.csv").read_bytes())
    r = camara.resumir_ceap(df)
    assert r[74550]["total"] == 1500.5 + 300 + 200
    assert r[74550]["por_mes"] == {1: 1800.5, 2: 200.0}
    assert r[74550]["top_fornecedores"][0]["nome"] == "CIA AEREA X"


def test_emendas():
    df = transparencia.ler_emendas_csv((FIX / "emendas.csv").read_bytes())
    deps = [{"id": 74550, "nome": "João Leão", "nome_civil": "João Felipe de Souza Leão"},
            {"id": 1, "nome": "Fulano"}]
    r = transparencia.resumir_emendas(df, 2024, deps)
    assert set(r) == {74550}          # bancada não entra
    assert r[74550]["empenhado"] == 1_000_000.0
    assert r[74550]["pago"] == 750_000.0
    assert r[74550]["top_destinos"][0]["destino"] == "SALVADOR/BA"


def test_calculo_custos():
    perfil = {"verba_gabinete": {"gasto": 1000.0, "por_mes": {1: 500.0, 2: 500.0}},
              "cota_parlamentar": {"gasto": 999.0}, "recebe_auxilio_moradia": True}
    ceap = {"total": 300.0, "por_mes": {1: 300.0}}
    r = custos.calcular({"id": 1, "nome": "X"}, 2025, perfil, ceap, None, 12)
    # jan/2025 = 44.008,52 ; fev/2025 = 46.366,19 ; 13º proporcional 2/12
    assert r["meses"] == 2
    assert r["custos"]["salario"] == round(44008.52 + 46366.19 + 46366.19 * 2 / 12, 2)
    assert r["custos"]["auxilio_moradia"] == 2 * 4253.0   # valor desde abr/2015 (o complemento sai da cota)
    assert r["custos"]["cota_parlamentar"] == 300.0   # CSV tem prioridade
    assert r["custos"]["verba_gabinete"] == 1000.0


def test_ajuda_de_custo():
    # até 2012: 14º e 15º (fevereiro e dezembro)
    assert custos.ajuda_de_custo(2011, list(range(1, 13)), 100.0, True) == 200.0
    assert custos.ajuda_de_custo(2012, list(range(1, 7)), 100.0, True) == 100.0
    # 2015 (início de legislatura): fim do mandato anterior + início do novo
    assert custos.ajuda_de_custo(2015, list(range(1, 13)), 100.0, True) == 200.0
    assert custos.ajuda_de_custo(2015, list(range(3, 13)), 100.0, True) == 0.0
    # ano comum, depois de 2013
    assert custos.ajuda_de_custo(2017, list(range(1, 13)), 100.0, True) == 0.0


def test_subsidio_historico():
    from datetime import date
    import config
    assert config.valor_vigente(config.SUBSIDIO, date(2010, 6, 1)) == 16512.09
    assert config.valor_vigente(config.SUBSIDIO, date(2011, 1, 1)) == 16512.09
    assert config.valor_vigente(config.SUBSIDIO, date(2011, 2, 1)) == 26723.13
    assert config.valor_vigente(config.SUBSIDIO, date(2022, 12, 1)) == 33763.00
    assert config.valor_vigente(config.AUXILIO_MORADIA, date(2023, 2, 1)) == 4253.00


def test_ipca_fatores():
    from coletor import ipca
    serie = [(2020, m, 1.0) for m in range(1, 13)] + [(2021, 1, 10.0)]
    f = ipca.fatores_por_ano(serie)
    assert f["referencia"] == "01/2021"
    assert f["fatores"][2021] == 1.0
    assert 1.15 < f["fatores"][2020] < 1.18   # ~1,01^6,5 x 1,10


def test_previsao():
    from coletor import previsao
    saz = [1.0] * 12
    linha = {"custo_mandato": 1000.0, "meses": 10, "flags": {"auxilio_moradia": False},
             "mensal": {"fixo": [0] * 12, "cota": [100] * 10 + [0, 0], "gabinete": [0] * 12}}
    p = previsao.prever(linha, 2026, 10, saz, fim_de_mandato=True)
    assert p["ativo"]
    # variável: 2 meses x 100 ; fixo: 2 subsídios + 13º (12/12)
    s = 46366.19
    assert round(p["restante"], 2) == round(200 + 2 * s + s, 2)
    assert p["min"] <= p["restante"] <= p["max"]
    assert p["ate_fim_mandato"] > p["restante"]
    # quem parou de gastar não é projetado
    linha2 = {**linha, "mensal": {"fixo": [0] * 12, "cota": [100] * 5 + [0] * 7, "gabinete": [0] * 12}}
    assert previsao.prever(linha2, 2026, 10, saz, True)["ativo"] is False
    # sazonalidade: dezembro 2x mais caro que a média
    r = {"deputados": [{"mensal": {"cota": [10] * 11 + [20], "gabinete": [0] * 12}}]}
    idx = previsao.sazonalidade([r])
    assert idx[11] > idx[0]


def _variante(trocas):
    html = (FIX / "perfil.html").read_text("utf-8")
    for a, b in trocas:
        assert a in html
        html = html.replace(a, b)
    return html


def test_perfil_com_icones_de_ajuda():
    # a página real põe um "?" (ícone de ajuda) entre o rótulo e o valor
    html = _variante([
        ("<span>Não recebe o auxílio</span>", "<span>?</span> <span>Não recebe o auxílio</span>"),
        ("<a>22 pessoas</a>", "<span>?</span> <a>22 pessoas</a>"),
        ("<a>R$ 44.008,52</a>", "<span>?</span> <a>R$ 44.008,52</a>"),
        ("<span>Fez uso", "<span>? Fez uso"),
    ])
    p = camara.parse_perfil(html, 2024)
    assert p["recebe_auxilio_moradia"] is False
    assert p["pessoal_gabinete"] == 22
    assert p["salario_mensal_bruto"] == 44008.52
    assert p["imovel_funcional"].startswith("Fez uso")
    p2 = camara.parse_perfil(_variante([("<span>Não recebe o auxílio</span>", "<span>? Recebe o auxílio</span>")]), 2024)
    assert p2["recebe_auxilio_moradia"] is True


def test_perfil_de_outro_ano_e_ignorado():
    html = _variante([("Gastos e recursos 2024", "Gastos e recursos 2023")])
    p = camara.parse_perfil(html, 2024)
    assert p["ano_pagina"] == 2023
    assert p["verba_gabinete"]["gasto"] is None and p["cota_parlamentar"]["gasto"] is None
    assert camara.parse_perfil(html, 2023)["verba_gabinete"]["gasto"] == 1357872.73


def test_categoria_curta():
    assert camara.categoria_curta("PASSAGEM AÉREA - SIGEPA") == "Passagens aéreas"
    assert camara.categoria_curta("PASSAGENS TERRESTRES, MARÍTIMAS OU FLUVIAIS") == "Passagens terrestres e fluviais"
    assert camara.categoria_curta("DIVULGAÇÃO DA ATIVIDADE PARLAMENTAR.") == "Divulgação do mandato"
    assert camara.categoria_curta("LOCAÇÃO OU FRETAMENTO DE VEÍCULOS AUTOMOTORES") == "Aluguel de veículos"
    assert camara.categoria_curta("LOCAÇÃO OU FRETAMENTO DE AERONAVES") == "Fretamento de aeronaves"
    assert camara.categoria_curta("XYZ") == "Outros"


def _df_analises():
    import pandas as pd
    linhas = []
    # deputado 1: 80% da divulgação numa só gráfica, notas redondas, de sábado
    for m in range(1, 13):
        linhas.append(dict(id=1, mes=m, categoria="Divulgação do mandato", fornecedor="GRAFICA X",
                           cnpj_cpf="11.111.111/0001-11", valor=15000.0, data=pd.Timestamp(2024, m, 6)))  # dia 6 varia
        linhas.append(dict(id=1, mes=m, categoria="Combustível", fornecedor="POSTO", cnpj_cpf="22.222.222/0001-22",
                           valor=2500.0, data=pd.Timestamp(2024, m, 10)))
        linhas.append(dict(id=2, mes=m, categoria="Combustível", fornecedor="POSTO", cnpj_cpf="22.222.222/0001-22",
                           valor=3000.0 if m != 7 else 90000.0, data=pd.Timestamp(2024, m, 10)))
    return pd.DataFrame(linhas)


def test_pontos_de_atencao_e_fornecedores():
    from coletor import analises
    df = _df_analises()
    info = {1: {"nome": "A", "partido": "X", "uf": "CE"}, 2: {"nome": "B", "partido": "Y", "uf": "SP"}}
    pts = analises.pontos_de_atencao(df, info, 2024)
    tipos = {(p["tipo"], p["id"]) for p in pts}
    assert ("concentracao", 1) in tipos
    assert ("exclusivo", 1) in tipos          # GRAFICA X só recebeu do deputado 1
    assert ("valores_redondos", 1) in tipos
    assert ("pico", 2) in tipos               # julho do deputado 2
    assert ("exclusivo", 2) not in tipos      # POSTO recebeu dos dois
    f = analises.fornecedores(df, info)
    assert {x["nome"] for x in f["lista"][:2]} == {"GRAFICA X", "POSTO"}
    posto = [x for x in f["lista"] if x["nome"] == "POSTO"][0]
    assert posto["deputados"] == 2 and len(posto["pagadores"]) == 2


def test_alerta_ano_eleitoral():
    from coletor import analises
    def ano(a, cota):
        return {"ano": a, "meses": 12, "partido": "X", "uf": "CE", "custos": {"cota_parlamentar": cota}}
    t = {1: {"nome": "A", "anos": [ano(2019, 300000), ano(2020, 300000), ano(2021, 300000), ano(2022, 450000)]}}
    al = analises.alertas_eleitorais(t)
    assert len(al) == 1 and al[0]["ano"] == 2022


def test_notas_e_fornecedores():
    import pandas as pd
    from coletor import notas
    df = pd.DataFrame([
        dict(id=1, nome="A", partido="X", uf="CE", mes=1, categoria="Divulgação do mandato", fornecedor="GRAFICA X",
             cnpj_cpf="11.111.111/0001-11", valor=1000.0, data=pd.Timestamp(2024, 1, 5), numero="123",
             url="https://www.camara.leg.br/cota-parlamentar/documentos/publ/1/2024/999.pdf", glosa=0.0, trecho="", passageiro=""),
        dict(id=2, nome="B", partido="Y", uf="SP", mes=2, categoria="Passagens aéreas", fornecedor="CIA AEREA",
             cnpj_cpf="22.222.222/0001-22", valor=500.0, data=pd.Timestamp(2024, 2, 10), numero="",
             url="", glosa=0.0, trecho="FOR/BSB", passageiro="FULANO"),
        dict(id=2, nome="B", partido="Y", uf="SP", mes=3, categoria="Combustível", fornecedor="JOAO DA SILVA",
             cnpj_cpf="123.456.789-01", valor=200.0, data=pd.Timestamp(2024, 3, 1), numero="9",
             url="", glosa=10.0, trecho="", passageiro=""),
    ])
    d = notas.preparar(df)
    assert d.loc[2, "tipo"] == "PF" and "123" not in d.loc[2, "doc"] and d.loc[2, "chave"].startswith("pf")
    por_dep = notas.notas_por_deputado(d, 2024)
    n1 = por_dep[1]["n"][0]
    assert n1[0] == 105 and n1[1] == 100000 and n1[5] == "p1/999"
    assert por_dep[2]["n"][0][7:] == ["FOR/BSB", "FULANO"]
    assert por_dep[2]["n"][1][6] == 1000          # glosa em centavos
    info = {1: {"nome": "A", "partido": "X", "uf": "CE"}, 2: {"nome": "B", "partido": "Y", "uf": "SP"}}
    resumo, fichas = notas.fornecedores(d, info, 2024)
    assert resumo["qtd"] == 3 and resumo["linhas"][0][1] == "GRAFICA X"
    assert resumo["por_tipo"]["PF"]["fornecedores"] == 1
    assert resumo["maiores_notas"][0][3] == "A"
    k = resumo["linhas"][0][0]
    ficha = fichas[notas.grupo(k)][k]
    assert ficha["pagadores"][0][:2] == [1, 1000.0] and ficha["mes"][0] == 1000
    # por partido e por estado
    gr = notas.fornecedores_grupos(d, info, 2024)
    assert set(gr) == {"P-X", "P-Y", "U-CE", "U-SP"}
    assert gr["P-Y"]["total"] == 700.0 and gr["P-Y"]["qtd"] == 2 and gr["P-Y"]["n_deps"] == 1
    assert gr["P-Y"]["linhas"][0][1] == "CIA AEREA" and gr["P-Y"]["linhas"][0][9] == [2]
    assert gr["U-CE"]["total"] == 1000.0 and gr["U-CE"]["resto"] == []


def test_notas_novas(tmp_path):
    import pandas as pd
    from datetime import date
    from coletor import novas

    def nota(i, dep, forn, cnpj, valor, dia, cat="Divulgação do mandato"):
        return dict(id=dep, nome=f"D{dep}", partido="X", uf="CE", mes=dia.month, categoria=cat, fornecedor=forn,
                    cnpj_cpf=cnpj, valor=valor, data=pd.Timestamp(dia), numero=str(i), url="", glosa=0.0,
                    trecho="", passageiro="", ide=str(1000 + i))
    base = [nota(i, 1 + i % 3, "GRAFICA A", "11.111.111/0001-11", 100.0 + i, date(2026, 3, 2)) for i in range(30)]
    saida, brutos = tmp_path / "docs", tmp_path / "brutos"
    info = {1: {"nome": "Um", "partido": "X", "uf": "CE", "sexo": "F"}}
    # dia 1: só guarda a referência
    r = novas.processar(pd.DataFrame(base), 2026, info, date(2026, 11, 10), saida, brutos)
    assert r["inicio"] and not list((saida / "novas").glob("2026-*.json"))
    # dia 2: duas notas novas (uma de fornecedor novo, sábado, valor redondo)
    dia2 = base + [nota(100, 1, "GRAFICA B", "22.222.222/0001-22", 5000.0, date(2026, 11, 7)),
                   nota(101, 2, "GRAFICA A", "11.111.111/0001-11", 120.0, date(2026, 11, 9))]
    r = novas.processar(pd.DataFrame(dia2), 2026, info, date(2026, 11, 11), saida, brutos)
    assert r["notas"] == 2
    d = novas._ler(saida / "novas" / "2026-11-11.json")
    s = d["anos"]["2026"]
    assert len(s["n"]) == 2 and s["f"][0][1] == "GRAFICA B"
    marcas = s["n"][0][8]
    assert marcas & novas.NOVO_NA_COTA and marcas & novas.FIM_DE_SEMANA and marcas & novas.REDONDO
    assert s["dep"]["1"][0] == "Um" and s["dep"]["1"][3] == "F"
    assert s["tot"]["depois"] - s["tot"]["antes"] == 5120.0
    # notas sem código e sem data (acontece no arquivo real) não podem quebrar
    dia3 = dia2 + [dict(nota(200, 3, "TAXI X", "", 35.5, date(2026, 11, 1)), ide="", data=pd.NaT, numero=float("nan"))]
    r = novas.processar(pd.DataFrame(dia3), 2026, info, date(2026, 11, 12), saida, brutos)
    assert r["notas"] == 1
    r = novas.processar(pd.DataFrame(dia3), 2026, info, date(2026, 11, 12), saida, brutos)
    assert r["notas"] == 1                       # a mesma nota não conta duas vezes
    # mesmo dia de novo: nada muda, o lote do dia continua com 2
    r = novas.processar(pd.DataFrame(dia2), 2026, info, date(2026, 11, 11), saida, brutos)
    assert r["notas"] == 2
    idx = novas._ler(saida / "novas" / "indice.json")
    assert [d["notas"] for d in idx["dias"]] == [1, 2] and idx["inicio"] == "2026-11-10"


# ------------------------------------------------------------ Receita
def _zip_csv(pasta, nome, linhas):
    import zipfile
    conteudo = "\n".join(";".join(f'"{c}"' for c in l) for l in linhas).encode("latin-1")
    with zipfile.ZipFile(pasta / f"{nome}.zip", "w") as z:
        z.writestr(f"K3241.{nome.upper()}CSV", conteudo)


def _base_receita(raiz):
    """Monta uma pasta mensal falsa, no formato oficial, e um índice HTML."""
    mes = raiz / "2026-10"
    mes.mkdir(parents=True)
    vazio = lambda n: _zip_csv(mes, n, [])  # noqa: E731
    _zip_csv(mes, "Empresas0", [
        ["11222333", "GRÁFICA EXEMPLO LTDA", "2062", "49", "15000,50", "01", ""],
        ["99887766", "OUTRA SA", "2054", "10", "1000000,00", "05", ""],
        ["55443322", "EMPRESA DO DEPUTADO LTDA", "2062", "49", "1000,00", "01", ""]])
    _zip_csv(mes, "Estabelecimentos0", [
        ["11222333", "0001", "81", "1", "GRAFICA EX", "02", "20150930", "00", "", "", "20150910", "1813001", "1813099,5819100",
         "RUA", "DAS FLORES", "100", "SALA 2", "CENTRO", "60000000", "CE", "1389", "85", "999999", "", "", "", "", "a@b.com", "", ""],
        ["11222333", "0002", "62", "2", "", "08", "20200101", "01", "", "", "20180101", "1813001", "",
         "AV", "X", "1", "", "B", "60000001", "CE", "1389", "", "", "", "", "", "", "", "", ""],
        ["55443322", "0001", "44", "1", "", "02", "20100101", "00", "", "", "20100101", "7020400", "",
         "RUA", "Y", "2", "", "C", "70000000", "DF", "9701", "", "", "", "", "", "", "", "", ""]])
    _zip_csv(mes, "Socios0", [
        ["11222333", "2", "JOSÉ DA SILVA", "***123456**", "49", "20150910", "", "***000000**", "", "00", "5"],
        ["11222333", "1", "HOLDING XYZ LTDA", "44555666000177", "22", "20160101", "", "***000000**", "", "00", "0"],
        ["55443322", "2", "FULANO DEPUTADO DE TAL", "***654321**", "49", "20120505", "", "***000000**", "", "00", "6"]])
    _zip_csv(mes, "Simples", [["11222333", "S", "20150910", "00000000", "N", "00000000", "00000000"]])
    for i in range(1, 10):
        for p in ("Empresas", "Estabelecimentos", "Socios"):
            vazio(f"{p}{i}")
    _zip_csv(mes, "Cnaes", [["1813001", "Impressão de material para uso publicitário"], ["1813099", "Impressão de outros"],
                            ["5819100", "Edição de cadernos"], ["7020400", "Consultoria em gestão"]])
    _zip_csv(mes, "Motivos", [["00", "SEM MOTIVO"], ["01", "EXTINCAO POR ENCERRAMENTO LIQUIDACAO VOLUNTARIA"]])
    _zip_csv(mes, "Municipios", [["1389", "FORTALEZA"], ["9701", "BRASILIA"]])
    _zip_csv(mes, "Naturezas", [["2062", "Sociedade Empresária Limitada"], ["2054", "Sociedade Anônima Fechada"]])
    _zip_csv(mes, "Paises", [["105", "BRASIL"]])
    _zip_csv(mes, "Qualificacoes", [["49", "Sócio-Administrador"], ["22", "Sócio"], ["10", "Diretor"], ["00", "Não informada"]])
    (raiz / "index.html").write_text('<a href="2026-09/">x</a><a href="2026-10/">y</a>')
    (mes / "index.html").write_text("".join(f'<a href="{p.name}">{p.name}</a>' for p in mes.glob("*.zip")))


def test_receita_coleta(tmp_path):
    import functools, http.server, threading
    from coletor import receita
    _base_receita(tmp_path / "srv")
    (tmp_path / "srv" / "2026-09").mkdir()
    (tmp_path / "srv" / "2026-09" / "index.html").write_text("vazio")
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(tmp_path / "srv"))
    h.log_message = lambda *a: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    fontes = [{"tipo": "indice", "url": f"http://127.0.0.1:{srv.server_address[1]}/"}]
    try:
        loc = receita.descobrir(fontes)
        assert loc["mes"] == "2026-10"                  # 2026-09 está incompleta
        deps = {"7": {"cpf6": "654321", "nome": "FULANO DE TAL", "nome_civil": "Fulano Deputado de Tal"}}
        res = receita.coletar({"11222333000181", "11222333000262", "00000000000000"}, deps, tmp_path / "tmp", loc=loc)
    finally:
        srv.shutdown()
    c = res["cadastro"]["11222333000181"]
    assert c["razao"] == "GRÁFICA EXEMPLO LTDA" and c["capital"] == 15000.5 and c["porte"] == "Microempresa"
    assert c["situacao"] == "ATIVA" and c["abertura"] == "2015-09-10" and c["matriz"] is True
    assert c["cnae"] == ["1813001", "Impressão de material para uso publicitário"]
    assert c["cnaes_sec"][1] == ["5819100", "Edição de cadernos"]
    assert c["end"] == {"logradouro": "RUA DAS FLORES", "numero": "100", "complemento": "SALA 2", "bairro": "CENTRO",
                        "cep": "60000000", "uf": "CE", "municipio": "FORTALEZA", "exterior": ""}
    assert c["natureza"] == "2062 · Sociedade Empresária Limitada"
    assert c["socios"][0] == ["PF", "JOSÉ DA SILVA", "***123456**", "Sócio-Administrador", "2015-09-10", "41 a 50 anos", "", "", ""]
    assert c["socios"][1][:3] == ["PJ", "HOLDING XYZ LTDA", "44555666000177"]
    assert c["simples"]["simples"] is True and c["simples"]["mei"] is False and c["simples"]["simples_ate"] is None
    assert "email" not in c and "tel1" not in c
    f = res["cadastro"]["11222333000262"]
    assert f["situacao"] == "BAIXADA" and f["motivo"].startswith("EXTINCAO") and f["matriz"] is False
    assert res["cadastro"]["00000000000000"]["nao_encontrado"]
    ds = res["deputados_socios"]
    assert len(ds) == 1 and ds[0]["dep_id"] == 7 and ds[0]["confianca"] == "confirmado"
    assert ds[0]["cnpj"] == "55443322000144" and ds[0]["razao"] == "EMPRESA DO DEPUTADO LTDA"
    assert not list((tmp_path / "tmp").rglob("*.zip"))   # apaga cada arquivo depois de ler


def test_cnpj_valido_e_datas():
    from coletor import receita
    assert receita.cnpj_valido("11.222.333/0001-81") and not receita.cnpj_valido("11222333000180")
    assert receita.data_iso("20150930") == "2015-09-30" and receita.data_iso("00000000") is None and receita.data_iso("0") is None
    assert receita.numero_br("1.234,56") == 1234.56
    idx = receita.indice_deputados({"1": {"cpf6": "111222", "nome": "ZÉ", "nome_civil": "José Carlos da Silva"}})
    assert receita.confere_deputado(idx, "JOSE CARLOS DA SILVA", "***111222**") == (1, "confirmado")
    assert receita.confere_deputado(idx, "JOSE CARLOS SOUZA DA SILVA", "111222") == (1, "provavel")
    assert receita.confere_deputado(idx, "MARIA DA SILVA", "111222") is None
    assert receita.confere_deputado(idx, "JOSE CARLOS DA SILVA", "999999") is None


def test_relevancia_projetos():
    from coletor import projetos as P
    r = lambda s, e, t, sit="lei": P.relevancia(s, e, t, "", sit)  # noqa: E731
    seis = r("PEC", "Altera o art. 7º da Constituição Federal para reduzir a jornada de trabalho e acabar com a escala 6x1.", ["Trabalho e Emprego"], "senado")
    placa = r("PL", "Denomina Viaduto Fulano de Tal o viaduto localizado no km 10 da BR-116.", ["Viação, Transporte e Mobilidade"])
    dia = r("PL", "Institui o Dia Nacional do Profissional de Eventos.", ["Homenagens e Datas Comemorativas"])
    radio = r("PDL", "Aprova o ato que outorga autorização à Associação X para executar serviço de radiodifusão comunitária.", ["Comunicações"])
    ir = r("PL", "Altera a legislação do imposto sobre a renda para isentar quem ganha até R$ 5.000.", ["Finanças Públicas e Orçamento", "Economia"])
    assert seis[1] == "alto" and seis[0] >= 75 and "jornada de trabalho" in seis[2]
    assert ir[1] == "alto"
    assert placa[0] <= 5 and placa[1] == "simbolico" and placa[2][0] == "homenagem ou data comemorativa"
    assert dia[0] <= 5 and radio[0] <= 4
    assert P.situacao("Transformado em Norma Jurídica") == ("lei", "Virou lei")
    assert P.situacao("Aguardando Apreciação pelo Senado Federal")[0] == "senado"
    assert P.situacao("Arquivada") is None


def test_aprovados_do_ano():
    from coletor import projetos as P
    props = P.ler_csv('"id";"siglaTipo";"numero";"ano";"ementa";"keywords";"dataApresentacao";"ultimoStatus_dataHora";"ultimoStatus_descricaoSituacao"\n'
                      '"10";"PL";"1";"2020";"Garante acesso a medicamentos pelo SUS";"";"2020-01-01T00:00";"2023-05-02T10:00";"Transformado em Norma Jurídica"\n'
                      '"11";"PL";"2";"2020";"Denomina ponte";"";"2020-01-01T00:00";"2023-05-02T10:00";"Arquivada"\n'
                      '"12";"REQ";"3";"2020";"Requer";"";"2020-01-01T00:00";"2023-05-02T10:00";"Transformado em Norma Jurídica"\n'
                      '"13";"PL";"4";"2005";"Antigo";"";"2005-01-01T00:00";"2008-05-02T10:00";"Transformado em Norma Jurídica"\n'.encode())
    temas = P.ler_csv('"uriProposicao";"tema"\n"https://x/proposicoes/10";"Saúde"\n'.encode())
    autores = P.ler_csv('"idProposicao";"idDeputadoAutor";"nomeAutor";"siglaPartidoAutor";"siglaUFAutor";"ordemAssinatura";"tipoAutor"\n'
                        '"10";"204554";"Fulana";"PT";"CE";"1";"Deputado(a)"\n'.encode())
    it = P.aprovados_do_ano(props, temas, autores, 2009)
    assert [x["id"] for x in it] == [10]
    assert it[0]["temas"] == ["Saúde"] and it[0]["deputados_autores"] == [[204554, "Fulana", "PT", "CE"]] and it[0]["situacao"] == "lei"


def test_cota_complementada_pela_pagina_oficial():
    # mês 2: a página oficial tem R$ 500 (passagem SIGEPA) que o arquivo nota a nota não traz;
    # mês 3: devolução de bilhete deixa a página R$ 100 abaixo do arquivo
    perfil = {"verba_gabinete": {"gasto": 0.0, "por_mes": {}},
              "cota_parlamentar": {"gasto": 1100.0, "por_mes": {"1": 300.0, "2": 500.0, "3": 300.0}}}
    ceap = {"total": 700.0, "por_mes": {1: 300.0, 3: 400.0}}
    r = custos.calcular({"id": 1, "nome": "X"}, 2026, perfil, ceap, None, 10)
    assert r["custos"]["cota_parlamentar"] == 1100.0 and r["cota_sem_nota"] == 400.0
    assert r["mensal"]["cota"][:3] == [300, 500, 300]


def test_complemento_auxilio_nao_e_fornecedor():
    import pandas as pd
    from coletor import notas
    df = pd.DataFrame([
        dict(id=1, nome="A", partido="X", uf="CE", mes=1, categoria=camara.CAT_AUX, fornecedor="COMPLEMENTAÇÃO DO AUXÍLIO-MORADIA",
             cnpj_cpf="", valor=-500.0, data=pd.NaT, numero="", url="", glosa=0.0, trecho="", passageiro=""),
        dict(id=1, nome="A", partido="X", uf="CE", mes=1, categoria="Combustível", fornecedor="POSTO", cnpj_cpf="11222333000181",
             valor=100.0, data=pd.Timestamp(2026, 1, 2), numero="1", url="", glosa=0.0, trecho="", passageiro=""),
        dict(id=1, nome="A", partido="X", uf="CE", mes=2, categoria="Alimentação", fornecedor="POSTO", cnpj_cpf="11222333000181",
             valor=30.0, data=pd.Timestamp(2026, 2, 2), numero="2", url="", glosa=0.0, trecho="", passageiro="")])
    resumo, _ = notas.fornecedores(notas.preparar(df), {}, 2026)
    assert resumo["qtd"] == 1 and resumo["total"] == 130.0
    l = resumo["linhas"][0]
    cats = resumo["cats"]
    assert {cats[int(i)]: v for i, v in l[8].items()} == {"Combustível": [100.0, 1], "Alimentação": [30.0, 1]}


def test_pago_desde_e_dono(tmp_path):
    import json
    from coletor import cruzamento
    p = tmp_path / "2024" / "notas"
    p.mkdir(parents=True)
    (p / "7.json").write_text(json.dumps({"f": [["11222333000181", "X", ""], ["99", "Y", ""]], "c": ["A"],
                                          "n": [[110, 10000, 0, 0], [301, 20000, 0, 0], [500, 40000, 0, 0], [301, 999, 1, 0]]}))
    # entrou em 01/03/2024: conta a nota de 01/03 e a de maio (sem dia), não a de janeiro nem a de outro fornecedor
    assert cruzamento.pago_desde(tmp_path, 7, "11222333000181", [2024], "2024-03-01") == 600.0
    assert cruzamento.pago_desde(tmp_path, 7, "11222333000181", [2024], None) == 700.0
    assert cruzamento.eh_dono("Sócio-Administrador") and cruzamento.eh_dono("Titular Pessoa Física Residente ou Domiciliado no Brasil")
    assert not cruzamento.eh_dono("Diretor") and not cruzamento.eh_dono("Conselheiro de Administração")


def test_presenca_por_dia_de_sessao():
    from coletor import presenca
    eventos = [
        {"id": "1", "dataHoraInicio": "2025-03-04T14:00", "situacao": "Encerrada", "descricaoTipo": "Sessão Deliberativa", "descricao": "Sessão A"},
        {"id": "2", "dataHoraInicio": "2025-03-04T19:00", "situacao": "Encerrada", "descricaoTipo": "Sessão Deliberativa Extraordinária", "descricao": "Sessão B"},
        {"id": "3", "dataHoraInicio": "2025-03-05T14:00", "situacao": "Encerrada", "descricaoTipo": "Sessão Deliberativa", "descricao": "Sessão C"},
        {"id": "4", "dataHoraInicio": "2025-03-06T10:00", "situacao": "Encerrada", "descricaoTipo": "Sessão Não Deliberativa Solene", "descricao": "Homenagem"},
        {"id": "5", "dataHoraInicio": "2025-03-07T14:00", "situacao": "Cancelada", "descricaoTipo": "Sessão Deliberativa", "descricao": "Cancelada"},
        {"id": "6", "dataHoraInicio": "2025-05-07T14:00", "situacao": "Encerrada", "descricaoTipo": "Sessão Deliberativa", "descricao": "Maio"},
        {"id": "7", "dataHoraInicio": "2025-03-05T10:00", "situacao": "Encerrada", "descricaoTipo": "Reunião Deliberativa", "orgaos.sigla": "CCJC", "descricao": "CCJ"},
    ]
    pres = [{"idEvento": "2", "idDeputado": "10"}, {"idEvento": "7", "idDeputado": "10"}, {"idEvento": "1", "idDeputado": "20"},
            {"idEvento": "3", "idDeputado": "20"}, {"idEvento": "4", "idDeputado": "20"}]
    r = presenca.calcular(eventos, pres, {10: [3, 4, 5], 20: [3]}, 2025, {20: {"presencas": 2, "justificadas": 0, "nao_justificadas": 0}})
    assert r["dias_sessao"] == ["2025-03-04", "2025-03-05", "2025-05-07"]
    d10 = r["deputados"]["10"]
    assert d10["dias"] == 3 and d10["presencas"] == 1 and d10["datas_falta"] == ["2025-03-05", "2025-05-07"] and d10["reunioes_comissao"] == 1
    d20 = r["deputados"]["20"]          # maio fora do exercício: não conta
    assert d20["dias"] == 2 and d20["faltas"] == 0 and d20["oficial"]["presencas"] == 2


def test_presenca_oficial_da_pagina():
    from coletor.camara import _bloco_presenca
    t = "Presença em Plenário 2025 Presenças 58 dias Ausências justificadas 3 dias Ausências não justificadas 1 dia"
    assert _bloco_presenca(t) == {"presencas": 58, "justificadas": 3, "nao_justificadas": 1}
    assert _bloco_presenca("") is None


def test_comissao_em_sala_chamada_plenario():
    from coletor import presenca
    assert presenca.eh_reuniao_comissao("Reunião Deliberativa", "Anexo II, Plenário 05")
    assert presenca.eh_reuniao_comissao("Audiência Pública", "Anexo II, Plenário 12")
    assert not presenca.eh_reuniao_comissao("Reunião Deliberativa", "Plenário Principal")
    assert not presenca.eh_reuniao_comissao("Sessão Deliberativa", "Anexo II, Plenário 05")
    eventos = [{"id": "9", "dataHoraInicio": "2025-03-05T10:00", "situacao": "Encerrada", "descricaoTipo": "Reunião Deliberativa",
                "localCamara.nome": "Anexo II, Plenário 01"},
               {"id": "1", "dataHoraInicio": "2025-03-04T14:00", "situacao": "Encerrada", "descricaoTipo": "Sessão Deliberativa",
                "localCamara.nome": "Plenário Principal"}]
    r = presenca.calcular(eventos, [{"idEvento": "9", "idDeputado": "10"}], {10: [3]}, 2025, None,
                          {10: {"presencas": 40, "justificadas": 2, "nao_justificadas": 3}})
    assert r["reunioes_comissao_total"] == 1 and r["deputados"]["10"]["reunioes_comissao"] == 1
    assert r["deputados"]["10"]["oficial_comissoes"]["presencas"] == 40 and r["versao"] == presenca.VERSAO
