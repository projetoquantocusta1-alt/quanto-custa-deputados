"""Cruzamento: cadastro da Receita × notas da cota parlamentar.

Para cada fornecedor com CNPJ:
  - quanto recebeu em todos os anos, de quais deputados, primeira e última nota;
  - alertas objetivos, sempre com o dado que os gerou (não são acusação):
      aberta_recente    empresa aberta pouco antes do primeiro pagamento
      antes_abertura    nota com data anterior à abertura da empresa
      situacao          empresa não está ATIVA na Receita (e se recebeu depois disso)
      mei_acima         optante pelo MEI que recebeu da cota, num ano, mais que o limite do MEI
      capital_baixo     capital social muito pequeno perto do que recebeu
      deputado_socio    um deputado aparece como sócio (pior: o próprio deputado pagou)
      socio_comum       sócio em comum com outro fornecedor pago pelo mesmo deputado
      mesmo_endereco    mesmo endereço (com complemento) de outro fornecedor do mesmo deputado
      nao_encontrado    CNPJ não está na base da Receita

Saídas: docs/dados/receita/cruz/XX.json e docs/dados/receita/alertas.json
"""
import json
import logging
from datetime import date, datetime, timezone
from pathlib import Path

import config
from coletor.notas import grupo
from coletor.receita import normalizar

log = logging.getLogger("qcd")

GRAV = {"alta": 3, "media": 2, "baixa": 1}
ROTULOS = {
    "deputado_socio": "Deputado é sócio",
    "situacao": "Empresa não está ativa",
    "antes_abertura": "Nota anterior à abertura",
    "aberta_recente": "Aberta pouco antes de receber",
    "mei_acima": "MEI acima do limite",
    "socio_comum": "Sócio em comum com outro fornecedor",
    "mesmo_endereco": "Mesmo endereço de outro fornecedor",
    "capital_baixo": "Capital social baixo",
    "nao_encontrado": "CNPJ não encontrado na Receita",
}


def _ler(p: Path, padrao=None):
    return json.loads(p.read_text("utf-8")) if p.exists() else padrao


def _gravar(p: Path, obj):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), "utf-8")


def _reais(v: float) -> str:
    return "R$ " + f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _data_br(s: str | None) -> str:
    return "/".join(reversed(s.split("-"))) if s else "—"


def eh_dono(qualificacao: str | None) -> bool:
    """Sócio/titular de fato (dono), e não só diretor, conselheiro ou procurador."""
    q = normalizar(qualificacao or "")
    return any(t in q for t in ("SOCIO", "TITULAR", "EMPRESARIO", "PROPRIETARIO"))


def pago_desde(saida: Path, dep_id: int, chave: str, anos, desde: str | None) -> float:
    """Quanto o deputado pagou à empresa em notas com data a partir de `desde`
    (lê as notas do próprio deputado; sem data de entrada, conta tudo)."""
    total = 0.0
    for ano in anos:
        if desde and ano < int(desde[:4]):
            continue
        nd = _ler(saida / str(ano) / "notas" / f"{dep_id}.json", {}) or {}
        idx = [i for i, f in enumerate(nd.get("f", [])) if f[0] == chave]
        if not idx:
            continue
        lim = int(desde[5:7]) * 100 + int(desde[8:10]) if desde and ano == int(desde[:4]) else 0
        for n in nd.get("n", []):
            if n[2] in idx and (n[0] >= lim or n[0] % 100 == 0 and n[0] // 100 >= lim // 100):
                total += n[1] / 100
    return total


def _limite_mei(ano: int) -> float:
    v = 0.0
    for a, lim in sorted(config.MEI_LIMITE):
        if ano >= a:
            v = lim
    return v


def gerar(saida: Path, brutos: Path | None = None) -> dict:
    pasta = saida / "receita"
    meta = _ler(pasta / "meta.json", {}) or {}
    cad = {}
    for p in sorted((pasta / "cadastro").glob("*.json")):
        cad.update(_ler(p, {}))
    if not cad:
        return {}
    hist = _ler(saida / "historico.json", {}) or {}
    fatores = {a["ano"]: a.get("fator_ipca", 1.0) for a in hist.get("anos", [])}
    anos = sorted(int(p.parent.name) for p in saida.glob("*/fornecedores.json") if p.parent.name.isdigit())

    # ------------------------------------------------ cota: todos os anos
    nomes = {}
    cota = {}
    for ano in anos:
        rs = _ler(saida / str(ano) / "resumo.json", {}) or {}
        for d in rs.get("deputados", []):
            nomes[d["id"]] = [d.get("nome"), d.get("partido"), d.get("uf")]
        for g in (saida / str(ano) / "fornecedores").glob("*.json"):
            for k, f in (_ler(g, {}) or {}).items():
                if k not in cad:
                    continue
                c = cota.setdefault(k, {"total": 0.0, "hoje": 0.0, "notas": 0, "por_ano": {}, "mes": {}, "deps": {},
                                        "primeira": None, "ultima": None})
                c["total"] += f["valor"]
                c["hoje"] += f["valor"] * fatores.get(ano, 1.0)
                c["notas"] += f["notas"]
                c["por_ano"][str(ano)] = round(f["valor"], 2)
                c["mes"][ano] = f.get("mes") or [0] * 12
                for dep_id, v, n in f.get("pagadores", []):
                    x = c["deps"].setdefault(dep_id, [0.0, 0, []])
                    x[0] += v
                    x[1] += n
                    x[2].append(ano)
                if f.get("primeira") and (not c["primeira"] or f["primeira"] < c["primeira"]):
                    c["primeira"] = f["primeira"]
                if f.get("ultima") and (not c["ultima"] or f["ultima"] > c["ultima"]):
                    c["ultima"] = f["ultima"]

    # ------------------------------------------------ índices auxiliares
    por_socio, por_end = {}, {}
    for k, x in cad.items():
        if x.get("nao_encontrado"):
            continue
        for s in x.get("socios") or []:
            chave = (s[0], normalizar(s[1]), s[2])
            if s[1]:
                por_socio.setdefault(chave, set()).add(k)
        e = x.get("end") or {}
        num = normalizar(e.get("numero"))
        if e.get("cep") and e.get("logradouro") and num and num not in ("SN", "S N", "SEM NUMERO"):
            por_end.setdefault((e["cep"], normalizar(e["logradouro"]), num, normalizar(e.get("complemento"))), set()).add(k)
    dep_soc = {}
    for d in _ler(pasta / "deputados_socios.json", []) or []:
        dep_soc.setdefault(d["cnpj_basico"], []).append(d)

    deps_de = {k: set(c["deps"]) for k, c in cota.items()}
    saida_grupos, alertas, contagem = {}, [], {}
    for k, x in cad.items():
        c = cota.get(k, {"total": 0.0, "hoje": 0.0, "notas": 0, "por_ano": {}, "mes": {}, "deps": {}, "primeira": None, "ultima": None})
        al = []
        razao = x.get("razao") or ""
        if x.get("nao_encontrado"):
            al.append(["nao_encontrado", "media", f"O CNPJ {k} não aparece na base da Receita de {meta.get('base', '?')}"
                       + ("" if x.get("cnpj_valido", True) else " — e os dígitos verificadores não conferem (CNPJ inválido)") + "."])
        else:
            ab = x.get("abertura")
            if ab and c["primeira"]:
                dias = (date.fromisoformat(c["primeira"]) - date.fromisoformat(ab)).days
                if dias < 0:
                    al.append(["antes_abertura", "alta", f"Há nota com data de {_data_br(c['primeira'])}, anterior à abertura da empresa ({_data_br(ab)})."])
                elif dias < 180:
                    al.append(["aberta_recente", "alta" if dias < 60 else "media",
                               f"Empresa aberta em {_data_br(ab)}, {dias} dia(s) antes da primeira nota paga com a cota ({_data_br(c['primeira'])})."])
            sit = x.get("situacao")
            if sit and sit != "ATIVA":
                ds = x.get("data_situacao")
                depois = 0.0
                if ds:
                    y, m = int(ds[:4]), int(ds[5:7])
                    for ano, meses in c["mes"].items():
                        depois += sum(v for i, v in enumerate(meses, 1) if ano > y or (ano == y and i >= m))
                mot = f" (motivo: {x['motivo']})" if x.get("motivo") else ""
                reorg = any(t in normalizar(x.get("motivo")) for t in ("INCORPORA", "FUSAO", "CISAO"))
                if depois > 0:
                    al.append(["situacao", "media" if reorg else "alta", f"Situação {sit} na Receita desde {_data_br(ds)}{mot}, mas recebeu {_reais(depois)} da cota em notas desse mês em diante."])
                else:
                    al.append(["situacao", "baixa", f"Situação atual na Receita: {sit} desde {_data_br(ds)}{mot}."])
            sim = x.get("simples") or {}
            if sim.get("mei"):
                for ano_s, v in c["por_ano"].items():
                    ano = int(ano_s)
                    ini, fim = sim.get("mei_desde"), sim.get("mei_ate")
                    ativo = (not ini or ini <= f"{ano}-12-31") and (not fim or fim >= f"{ano}-01-01")
                    lim = _limite_mei(ano)
                    if ativo and lim and v > lim:
                        al.append(["mei_acima", "media", f"Optante pelo MEI (desde {_data_br(ini)}) recebeu {_reais(v)} da cota em {ano}, acima do limite anual de faturamento do MEI ({_reais(lim)})."])
            cap = x.get("capital")
            if cap is not None and c["total"] >= 100_000 and cap < 0.02 * c["total"]:
                al.append(["capital_baixo", "baixa", f"Capital social de {_reais(cap)}; recebeu {_reais(c['total'])} da cota (todos os anos)."])
        # deputados no quadro de sócios e administradores (QSA)
        ds_list = []
        for d in dep_soc.get(k[:8], []):
            dep_id, desde, q = d["dep_id"], d.get("desde"), d.get("qualificacao") or ""
            pago_total = c["deps"].get(dep_id, [0.0])[0]
            anos_pg = c["deps"].get(dep_id, [0, 0, []])[2]
            pago = pago_desde(saida, dep_id, k, sorted(set(anos_pg)), desde) if pago_total else 0.0
            dono = eh_dono(q)
            nm = (nomes.get(dep_id) or [d.get("nome_socio")])[0]
            ds_list.append([dep_id, nm, q, desde, d["confianca"], round(pago, 2), round(pago_total, 2), dono])
            conf = "" if d["confianca"] == "confirmado" else " (nome e CPF parcial semelhantes — conferir)"
            papel = "aparece como sócio(a)" if dono else f"aparece no quadro da empresa como {q.lower() or 'administrador(a)'}"
            base = f"{nm} {papel} ({q}, desde {_data_br(desde)}){conf}"
            if pago > 0 and dono:
                al.append(["deputado_socio", "alta", f"{base} e, depois de entrar, pagou {_reais(pago)} a esta empresa com a cota. O Ato da Mesa 43/2009 proíbe usar a cota com empresa de que o parlamentar seja sócio."])
            elif pago > 0:
                al.append(["deputado_socio", "media", f"{base} e pagou {_reais(pago)} a esta empresa com a cota depois disso."])
            elif pago_total > 0:
                al.append(["deputado_socio", "baixa", f"{base}; pagou {_reais(pago_total)} a esta empresa com a cota, mas antes de entrar no quadro."])
            else:
                al.append(["deputado_socio", "baixa", f"{base}."])
        # sócios em comum e mesmo endereço com fornecedores do mesmo deputado
        comuns = {}
        for s in x.get("socios") or []:
            for outro in por_socio.get((s[0], normalizar(s[1]), s[2]), ()):
                if outro != k:
                    comuns.setdefault(outro, set()).add(s[1])
        lista_c = []
        for outro, ss in comuns.items():
            mesmos = deps_de.get(k, set()) & deps_de.get(outro, set())
            lista_c.append([outro, cad.get(outro, {}).get("razao", ""), sorted(ss), len(mesmos)])
        lista_c.sort(key=lambda z: (-z[3], z[1]))
        n_mesmo = sum(1 for z in lista_c if z[3])
        if n_mesmo:
            al.append(["socio_comum", "media", f"Tem sócio em comum com {n_mesmo} outro(s) fornecedor(es) pago(s) pelo mesmo deputado."])
        end_l = []
        e = x.get("end") or {}
        num = normalizar(e.get("numero"))
        if e.get("cep") and num:
            for outro in por_end.get((e["cep"], normalizar(e.get("logradouro")), num, normalizar(e.get("complemento"))), ()):
                if outro != k:
                    end_l.append([outro, cad.get(outro, {}).get("razao", ""), len(deps_de.get(k, set()) & deps_de.get(outro, set()))])
        n_end = sum(1 for z in end_l if z[2])
        if n_end:
            al.append(["mesmo_endereco", "media", f"Mesmo endereço (inclusive complemento) de {n_end} outro(s) fornecedor(es) pago(s) pelo mesmo deputado."])

        al.sort(key=lambda a: -GRAV[a[1]])
        deps = sorted(c["deps"].items(), key=lambda z: -z[1][0])
        saida_grupos.setdefault(grupo(k), {})[k] = {
            "total": round(c["total"], 2), "total_hoje": round(c["hoje"], 2), "notas": c["notas"],
            "por_ano": c["por_ano"], "primeira": c["primeira"], "ultima": c["ultima"], "n_deps": len(deps),
            "deps": [[i, *(nomes.get(i) or ["Deputado " + str(i), "", ""]), round(v[0], 2), v[1], sorted(set(v[2]))] for i, v in deps[:60]],
            "alertas": al, "comuns": lista_c[:30], "mesmo_end": sorted(end_l, key=lambda z: -z[2])[:20], "dep_socio": ds_list,
        }
        for a in al:
            contagem[a[0]] = contagem.get(a[0], 0) + 1
            alertas.append([k, razao, a[0], a[1], a[2], round(c["total"], 2), [i for i, _ in deps[:5]]])

    for g, conteudo in saida_grupos.items():
        _gravar(pasta / "cruz" / f"{g}.json", conteudo)
    alertas.sort(key=lambda a: (-GRAV[a[3]], -a[5]))
    por_tipo = {}
    for a_ in alertas:                      # até 600 por tipo, para filtrar no site
        por_tipo.setdefault(a_[2], []).append(a_)
    alertas = [a_ for v in por_tipo.values() for a_ in v[:600]]
    alertas.sort(key=lambda a: (-GRAV[a[3]], -a[5]))
    # deputados sócios de qualquer empresa (recebendo ou não da cota)
    soc = []
    for d in _ler(pasta / "deputados_socios.json", []) or []:
        k = d.get("cnpj")
        recebeu = cota.get(k, {}).get("total", 0.0) if k else 0.0
        info_k = next((z for z in saida_grupos.get(grupo(k), {}).get(k, {}).get("dep_socio", []) if z[0] == d["dep_id"]), None) if k else None
        proprio = info_k[5] if info_k else 0.0
        nm = nomes.get(d["dep_id"]) or [d.get("nome_socio"), "", ""]
        soc.append([d["dep_id"], nm[0], nm[1], nm[2], k, d.get("razao"), d.get("qualificacao"), d.get("desde"),
                    d["confianca"], d.get("situacao"), d.get("uf"), round(recebeu, 2), round(proprio, 2), eh_dono(d.get("qualificacao"))])
    soc.sort(key=lambda z: (-z[12], -z[11], z[1] or ""))
    _gravar(pasta / "alertas.json", {
        "base": meta.get("base"), "gerado_em": datetime.now(timezone.utc).isoformat(timespec="minutes"),
        "rotulos": ROTULOS, "contagem": contagem, "fornecedores": len(cad),
        "itens": alertas, "deputados_socios": soc,
    })
    log.info("Cruzamento Receita × cota: %d fornecedores, %d alertas", len(cad), len(alertas))
    return contagem
