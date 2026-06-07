from fastapi import FastAPI, Response, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from transformers import pipeline
from deep_translator import GoogleTranslator
from functools import lru_cache
from concurrent.futures import ThreadPoolExecutor
from cachetools import TTLCache
import torch
import spacy
import httpx
import asyncio
import random
import re
import threading
import urllib.parse
import uvicorn
import json

app = FastAPI(title="Laboratório de Tensão Narrativa")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="."), name="static")

print("A detetar hardware e a acordar o Cérebro Transformer (mDeBERTa) e spaCy...")

model_kwargs = {}
if torch.cuda.is_available():
    device_id = 0
    model_kwargs["dtype"] = torch.float16
elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
    device_id = "mps"
    model_kwargs["dtype"] = torch.float16
else:
    device_id = -1

classificador = pipeline(
    "zero-shot-classification",
    model="MoritzLaurer/mDeBERTa-v3-base-mnli-xnli",
    device=device_id,
    **model_kwargs
)

try:
    nlp = spacy.load("pt_core_news_sm")
except OSError as e:
    raise RuntimeError("Modelo spaCy não encontrado. Corre: python3.12 -m spacy download pt_core_news_sm") from e

print(f"Transformer Operacional e Otimizado no device: {device_id}!")

try:
    with open("poemas.json", "r", encoding="utf-8") as f:
        raw = json.load(f)
    CORPUS_POEMAS = raw if isinstance(raw, list) else raw.get("poemas", [])
    if CORPUS_POEMAS and not isinstance(CORPUS_POEMAS[0], dict):
        raise ValueError("poemas.json must be a list of dicts")
    print(f"Corpus carregado: {len(CORPUS_POEMAS)} poemas")
except (FileNotFoundError, ValueError) as e:
    CORPUS_POEMAS = []
    print(f"Aviso: {e}")

PLUTCHIK = [
    "alegria", "tristeza", "confiança", "nojo",
    "medo", "raiva", "surpresa", "antecipação"
]

DICIONARIO_EMOCOES_EN = {
    "alegria":      "joy",
    "tristeza":     "sadness",
    "confiança":    "trust",
    "nojo":         "disgust",
    "medo":         "fear",
    "raiva":        "anger",
    "surpresa":     "surprise",
    "antecipação":  "anticipation",
    "neutro":       "abstract"
}

PREFIXES_MONOCROMATICOS = (
    "ph,mdi,lucide,tabler,heroicons,bi,ri,octicon,"
    "fa,fa6-solid,fa6-regular,ion,carbon,fluent,material-symbols"
)

FRAGMENTOS_PROIBIDOS = [
    "duotone", "twotone", "two-tone", "bulk",
    "color", "colour", "colored", "coloured",
    "logo", "logos", "brand", "brands",
    "emoji", "emojis", "noto", "twemoji", "openmoji",
    "flag", "flags", "circle-flags",
    "flat", "filled-color",
]

MAX_REBUS_PER_VERSE = 2

SVG_CACHE    = TTLCache(maxsize=1000, ttl=3600)
OPCOES_CACHE = TTLCache(maxsize=500,  ttl=1800)
_cache_lock  = threading.Lock()

_THREAD_POOL = ThreadPoolExecutor(max_workers=4)

_CLASSIFIER_SEM = asyncio.Semaphore(2)

http_client = httpx.AsyncClient(limits=httpx.Limits(max_keepalive_connections=50, max_connections=100))

@app.on_event("shutdown")
async def shutdown_event():
    await http_client.aclose()

@lru_cache(maxsize=2048)
def cached_translation(palavra: str) -> str:
    return GoogleTranslator(source='pt', target='en').translate(palavra)

class TextoInput(BaseModel):
    texto: str
    intensidade_rebus: float = 0.5

@app.get("/")
def read_root():
    return FileResponse("index.html")

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return Response(content=b"", media_type="image/x-icon")

@app.get("/skeleton.json")
def get_skeleton():
    return FileResponse("skeleton.json", media_type="application/json")

def normalizar_cor(val: str) -> str:
    if re.match(r'^#[0-9a-fA-F]{3}$', val):
        return '#' + ''.join(c * 2 for c in val[1:])
    return val


def svg_e_monocromatico(svg_text: str) -> bool:
    if re.search(r'<image|<linearGradient|<radialGradient', svg_text, re.IGNORECASE):
        return False

    attr_pattern = re.compile(
        r'(?:fill|stroke|stop-color)\s*=\s*["\']'
        r'(?!(?:none|currentColor|currentcolor))["\']?'
        r'\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|[a-zA-Z]{3,30})',
        re.IGNORECASE
    )
    style_pattern = re.compile(
        r'(?:fill|stroke|stop-color)\s*:\s*'
        r'(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|(?!none|currentcolor)[a-zA-Z]{3,20})',
        re.IGNORECASE
    )

    VALORES_SEGUROS = {"none", "inherit", "transparent", "currentcolor", "currentColor"}

    cores = set()
    for match in re.finditer(attr_pattern, svg_text):
        val = match.group(1).strip().lower()
        if val not in VALORES_SEGUROS:
            cores.add(normalizar_cor(val))
    for match in re.finditer(style_pattern, svg_text):
        val = match.group(1).strip().lower()
        if val not in VALORES_SEGUROS:
            cores.add(normalizar_cor(val))

    return len(cores) <= 1

async def classificar_seguro_async(candidatos: list, labels: list) -> list:
    """
    Envia TODOS os candidatos de uma vez ao transformer (true batch).
    O semáforo limita a concorrência para evitar contenção no modelo.
    """
    try:
        if not candidatos or not labels:
            return []
        async with _CLASSIFIER_SEM:
            res = await asyncio.to_thread(
                classificador, candidatos,
                candidate_labels=labels,
                multi_label=True,
                batch_size=16
            )
        return [res] if isinstance(res, dict) else res
    except Exception as e:
        print(f"Erro classificador: {e}")
        return []

async def pesquisar_datamuse(client: httpx.AsyncClient, palavra: str, emocao: str) -> list[str]:
    try:
        url = f"https://api.datamuse.com/words?ml={palavra}+{emocao}&md=p&max=30"
        r = await client.get(url, timeout=5.0)
        if r.status_code == 200:
            return [
                item["word"] for item in r.json()
                if "tags" in item and "n" in item["tags"] and " " not in item["word"]
            ]
    except Exception as e:
        print(f"Aviso Datamuse: {e}")
    return []

async def pesquisar_conceptnet(client: httpx.AsyncClient, conceito: str, relacao: str, limite: int = 15) -> list[str]:
    try:
        url = f"http://api.conceptnet.io/query?node=/c/en/{conceito}&rel=/r/{relacao}&limit={limite}"
        r = await client.get(url, timeout=8.0)
        if r.status_code == 200:
            termos = []
            for edge in r.json().get("edges", []):
                start_label = edge["start"].get("label", "").lower()
                end_label   = edge["end"].get("label", "").lower()
                if start_label != conceito and edge["start"].get("language") == "en":
                    termos.append(start_label)
                elif end_label != conceito and edge["end"].get("language") == "en":
                    termos.append(end_label)
            return termos
    except Exception as e:
        print(f"Aviso ConceptNet ({conceito}): {e}")
    return []

async def gerar_termos_criativos(palavra_ctx: str, emocao_en: str) -> list[str]:
    print(f"A cruzar redes semânticas dinâmicas para '{palavra_ctx}' + '{emocao_en}'...")
    
    resultados_brutos = await asyncio.gather(
        pesquisar_conceptnet(http_client, emocao_en, "SymbolOf", 10),
        pesquisar_conceptnet(http_client, palavra_ctx, "RelatedTo", 15),
        pesquisar_datamuse(http_client, palavra_ctx, emocao_en)
    )

    candidatos_brutos = set()
    for lista in resultados_brutos:
        for termo in lista:
            termo_limpo = re.sub(r'[^a-z]', '', termo)
            if len(termo_limpo) > 2:
                candidatos_brutos.add(termo_limpo)

    candidatos = list(candidatos_brutos)
    if not candidatos:
        print("APIs semânticas falharam. A forçar palavra e emoção literais.")
        return [palavra_ctx, emocao_en, "abstract", "symbol", "shape"]

    labels_crivo = [emocao_en, "visual object", "symbol", "abstract concept"]
    resultados_crivo = await classificar_seguro_async(candidatos, labels_crivo)

    if resultados_crivo:
        def pontuar_candidato(res):
            p = dict(zip(res["labels"], res["scores"]))
            return (
                p.get(emocao_en, 0) * 0.4
                + p.get("visual object", 0) * 0.5
                + p.get("symbol", 0) * 0.2
                - p.get("abstract concept", 0) * 0.4
            )
        candidatos_ordenados = sorted(resultados_crivo, key=pontuar_candidato, reverse=True)
        top5 = [c["sequence"] for c in candidatos_ordenados[:5]]
        print(f"Motor Dinâmico escolheu: {top5}")
        return top5
    return [palavra_ctx, emocao_en]

async def pesquisar_icones(client: httpx.AsyncClient, termo: str) -> list:
    termo_encoded = urllib.parse.quote(termo)

    def filtrar_monocromaticos(lista_icones: list) -> list:
        return [
            ic for ic in lista_icones
            if not any(frag in ic.lower() for frag in FRAGMENTOS_PROIBIDOS)
        ]

    async def buscar(url: str) -> list:
        try:
            r = await client.get(url, timeout=8.0)
            if r.status_code == 200:
                return filtrar_monocromaticos(r.json().get("icons", []))
        except Exception as e:
            print(f"Erro Iconify '{termo}': {e}")
        return []

    icons = await buscar(
        f"https://api.iconify.design/search?query={termo_encoded}"
        f"&limit=30&prefixes={PREFIXES_MONOCROMATICOS}&palette=false"
    )
    if not icons:
        icons = await buscar(
            f"https://api.iconify.design/search?query={termo_encoded}"
            f"&limit=30&palette=false"
        )
    return icons[:10]


async def escolher_melhor_icone(icons: list, palavra_ctx: str, emocao_en: str, termos_criativos: list) -> str:
    if len(icons) == 1:
        return icons[0]

    nomes = [ic.split(":")[-1].replace("-", " ") for ic in icons]
    termos_seguros = termos_criativos if termos_criativos else []
    labels = [emocao_en] + termos_seguros[:3]

    resultados = await classificar_seguro_async(nomes, labels)
    if not resultados:
        return icons[0]

    mapa_pesos = {1: [1.0], 2: [0.6, 0.4], 3: [0.5, 0.3, 0.2], 4: [0.4, 0.3, 0.2, 0.1]}
    pesos_atuais = mapa_pesos.get(len(labels), [1.0])

    def score(res):
        p = dict(zip(res["labels"], res["scores"]))
        return sum(p.get(label, 0) * peso for label, peso in zip(labels, pesos_atuais))

    best_idx = max(range(len(resultados)), key=lambda i: score(resultados[i]))
    chosen = icons[best_idx]
    print(f"IA escolheu '{chosen}' | palavra='{palavra_ctx}' | emoção='{emocao_en}'")
    return chosen

@app.post("/analisar-narrativa")
async def analisar_narrativa(dados: TextoInput):
    texto_limpo = dados.texto.strip()

    doc_fut = asyncio.to_thread(nlp, texto_limpo)

    frases_brutas = re.split(r'(?<=[.,—!?]) +', texto_limpo)
    frases = [f for f in frases_brutas if len(f) > 3]

    if not frases:
        return {"evolucao_frases": [], "rebus_words": []}

    doc, analises_batch_raw = await asyncio.gather(
        doc_fut,
        asyncio.to_thread(
            classificador,
            frases,
            candidate_labels=PLUTCHIK,
            multi_label=True,
            batch_size=16
        )
    )

    analises_batch = [analises_batch_raw] if isinstance(analises_batch_raw, dict) else analises_batch_raw

    linha_frases = []
    memoria_emocoes  = {emo: 0.0 for emo in PLUTCHIK}
    emocoes_acumuladas = {emo: 0.0 for emo in PLUTCHIK}
    tensao_anterior  = 0.5

    for i, (frase, analise) in enumerate(zip(frases, analises_batch)):
        emocoes_brutas = dict(zip(analise['labels'], analise['scores']))

        conflito_bruto    = max(emocoes_brutas.get("raiva", 0), emocoes_brutas.get("medo", 0),
                                emocoes_brutas.get("nojo", 0),  emocoes_brutas.get("tristeza", 0))
        relaxamento_bruto = max(emocoes_brutas.get("alegria", 0), emocoes_brutas.get("confiança", 0))
        tensao_bruta_atual = min(1.0, max(0.0,
            0.5 + ((conflito_bruto
                    + emocoes_brutas.get("antecipação", 0) * 0.3
                    + emocoes_brutas.get("surpresa", 0) * 0.2
                    - relaxamento_bruto * 0.5) * 0.5)
        ))

        if i == 0:
            fator_memoria = 0.0
        else:
            delta_choque  = abs(tensao_bruta_atual - tensao_anterior)
            fator_memoria = 0.1 if (delta_choque > 0.35 or emocoes_brutas.get("surpresa", 0) > 0.5) else 0.6

        emocoes_contextuais = {}
        for emo in PLUTCHIK:
            if i == 0:
                emocoes_contextuais[emo] = emocoes_brutas[emo]
            else:
                emocoes_contextuais[emo] = (
                    emocoes_brutas[emo] * (1 - fator_memoria)
                    + memoria_emocoes[emo] * fator_memoria
                )
            emocoes_acumuladas[emo] += emocoes_contextuais[emo]

        memoria_emocoes = emocoes_contextuais.copy()

        conflito_final    = max(emocoes_contextuais.get("raiva", 0), emocoes_contextuais.get("medo", 0),
                                emocoes_contextuais.get("nojo", 0),  emocoes_contextuais.get("tristeza", 0))
        relaxamento_final = max(emocoes_contextuais.get("alegria", 0), emocoes_contextuais.get("confiança", 0))
        tensao_final = min(1.0, max(0.0,
            0.5 + ((conflito_final
                    + emocoes_contextuais.get("antecipação", 0) * 0.3
                    + emocoes_contextuais.get("surpresa", 0) * 0.2
                    - relaxamento_final * 0.5) * 0.5)
        ))
        tensao_anterior = tensao_final

        linha_frases.append({
            "momento": i + 1,
            "texto":   frase,
            "emocoes": emocoes_contextuais,
            "tensao":  tensao_final
        })

    emocao_dominante = max(emocoes_acumuladas, key=emocoes_acumuladas.get)

    allowed_pos = ["NOUN", "PROPN", "ADJ"]
    if dados.intensidade_rebus >= 0.7:
        allowed_pos.append("VERB")

    candidatos_brutos = [
        token.text.lower() for token in doc
        if token.pos_ in allowed_pos and len(token.text) > 3
    ]
    candidatos_unicos = list(set(candidatos_brutos))
    rebus_words = []

    if candidatos_unicos:
        labels_criativas   = [emocao_dominante, "simbólico", "abstrato", "comum"]
        resultados_criativos = await classificar_seguro_async(candidatos_unicos, labels_criativas)

        palavras_scored = []
        for res in resultados_criativos:
            pontuacoes     = dict(zip(res['labels'], res['scores']))
            score_criativo = max(pontuacoes.get(emocao_dominante, 0), pontuacoes.get("simbólico", 0))
            penalizacao    = pontuacoes.get("comum", 0) * 0.3
            palavras_scored.append((res['sequence'], score_criativo - penalizacao))

        palavras_scored.sort(key=lambda x: x[1], reverse=True)
        palavras_escolhidas = [w for w, s in palavras_scored if s > 0.35]

        if palavras_escolhidas:
            rebus_words = palavras_escolhidas[:MAX_REBUS_PER_VERSE]
            print(f"Rebus restrito a {MAX_REBUS_PER_VERSE} por verso (Guia: {emocao_dominante}): {rebus_words}")

    return {"evolucao_frases": linha_frases, "rebus_words": rebus_words}

async def resolver_pipeline(palavra: str, emocao: str) -> tuple[list[str], str]:
    cache_key = f"{palavra}_{emocao}"
    with _cache_lock:
        cached = OPCOES_CACHE.get(cache_key)
    if cached is not None:
        return cached

    try:
        palavra_en = await asyncio.get_event_loop().run_in_executor(
            _THREAD_POOL, cached_translation, palavra
        )
        palavra_en = palavra_en.lower()
    except Exception:
        palavra_en = palavra.lower()

    palavra_chave = re.sub(
        r'^(to |a |an |the |we |they |he |she |it )', '', palavra_en
    ).strip() or palavra_en

    emocao_limpa = emocao.lower().replace("ç", "c").replace("ã", "a")
    emocao_en    = DICIONARIO_EMOCOES_EN.get(emocao_limpa, "abstract")

    print(f"A procurar ícones para: '{palavra_chave}' ({emocao_en}) — literal + semântico em paralelo")

    icons_diretos_fut     = asyncio.create_task(pesquisar_icones(http_client, palavra_chave))
    termos_criativos_fut  = asyncio.create_task(gerar_termos_criativos(palavra_chave, emocao_en))

    icons_diretos, termos_criativos = await asyncio.gather(
        icons_diretos_fut, termos_criativos_fut
    )

    resultados_semanticos = await asyncio.gather(
        *[pesquisar_icones(http_client, t) for t in termos_criativos]
    )

    icons_merged = list({ic: None for ic in icons_diretos}.keys())
    for r in resultados_semanticos:
        for ic in r:
            if ic not in icons_merged:
                icons_merged.append(ic)

    print(
        f"Pool total: {len(icons_diretos)} literais "
        f"+ {sum(len(r) for r in resultados_semanticos)} semânticos "
        f"= {len(icons_merged)} únicos"
    )

    if not icons_merged:
        result = ([], emocao_en)
        with _cache_lock:
            OPCOES_CACHE[cache_key] = result
        return result

    icon_escolhido = await escolher_melhor_icone(
        icons_merged, palavra_chave, emocao_en, termos_criativos
    )

    async def validar(ic: str) -> str | None:
        prefix_ic, name_ic = ic.split(":")
        url_ic = (
            f"https://api.iconify.design/{prefix_ic}/{name_ic}.svg"
            f"?color=%23000000&width=200&height=200"
        )
        try:
            r = await http_client.get(url_ic, timeout=10.0)
            r.raise_for_status()
            return ic if svg_e_monocromatico(r.text) else None
        except Exception:
            return None

    resultados_val = await asyncio.gather(*[validar(ic) for ic in icons_merged])
    validos = [ic for ic in resultados_val if ic is not None]

    ordenados  = [icon_escolhido] if icon_escolhido in validos else []
    ordenados += [ic for ic in validos if ic != icon_escolhido]

    result = (ordenados, emocao_en)
    with _cache_lock:
        OPCOES_CACHE[cache_key] = result
    return result

@app.get("/gerar-rebus")
async def gerar_rebus(
    palavra: str,
    color:   str = Query("#000000"),
    emocao:  str = Query("neutro"),
    icone:   str = Query(None),
):
    cache_key = f"{palavra}_{color}_{emocao}_{icone or ''}"
    with _cache_lock:
        cached_svg = SVG_CACHE.get(cache_key)
    if cached_svg:
        return Response(content=cached_svg, media_type="image/svg+xml")

    try:
        color_encoded = urllib.parse.quote(color)

        if icone:
            if ":" not in icone:
                return Response(status_code=400)
            prefix_ic, name_ic = icone.split(":", 1)
            url_ic = (
                f"https://api.iconify.design/{prefix_ic}/{name_ic}.svg"
                f"?color={color_encoded}&width=200&height=200"
            )
            r = await http_client.get(url_ic, timeout=10.0)
            r.raise_for_status()
            with _cache_lock:
                SVG_CACHE[cache_key] = r.text
            return Response(content=r.text, media_type="image/svg+xml")

        ordenados, _ = await resolver_pipeline(palavra, emocao)

        if not ordenados:
            print(f"PIPELINE ESGOTADO: sem ícones para '{palavra}'")
            return Response(status_code=404)

        async def tentar_ic(ic: str) -> str | None:
            prefix_ic, name_ic = ic.split(":")
            url_ic = (
                f"https://api.iconify.design/{prefix_ic}/{name_ic}.svg"
                f"?color={color_encoded}&width=200&height=200"
            )
            try:
                r = await http_client.get(url_ic, timeout=10.0)
                r.raise_for_status()
                return r.text if svg_e_monocromatico(r.text) else None
            except Exception:
                return None

        resultados_svg = await asyncio.gather(*[tentar_ic(ic) for ic in ordenados])
        svg_final = next((s for s in resultados_svg if s), None)

        if not svg_final:
            return Response(status_code=404)

        with _cache_lock:
            SVG_CACHE[cache_key] = svg_final
        return Response(content=svg_final, media_type="image/svg+xml")

    except Exception as e:
        print(f"Erro ao gerar rebus para '{palavra}'. Causa: {e}")
        return Response(status_code=404)

@app.get("/gerar-rebus-opcoes")
async def gerar_rebus_opcoes(
    palavra:    str,
    emocao:     str = Query("neutro"),
    max_opcoes: int = Query(8),
):
    try:
        ordenados, emocao_en = await resolver_pipeline(palavra, emocao)
        top = ordenados[:max_opcoes]
        return {
            "opcoes":    top,
            "escolhido": top[0] if top else None,
            "emocao_en": emocao_en,
        }
    except Exception as e:
        print(f"Erro em /gerar-rebus-opcoes para '{palavra}': {e}")
        return {"opcoes": [], "escolhido": None, "emocao_en": "abstract"}


@app.get("/poema-aleatorio")
async def poema_aleatorio(emocao: str = Query("neutro")):
    if not CORPUS_POEMAS:
        from fastapi import HTTPException
        raise HTTPException(status_code=503, detail="Corpus não carregado")

    emocao_limpa = emocao.lower().strip()
    candidatos   = [p for p in CORPUS_POEMAS if emocao_limpa in p.get("emocoes", [])]
    if not candidatos:
        candidatos = CORPUS_POEMAS

    poema = random.choice(candidatos)
    return {
        "titulo":     poema.get("titulo", ""),
        "autor":      poema.get("autor", ""),
        "heterónimo": poema.get("heterónimo", None),
        "linhas":     poema.get("linhas", []),
        "emocoes":    poema.get("emocoes", []),
    }


@app.get("/skeleton")
def get_skeleton(emocao: str = Query("neutro")):
    import os
    emocao_limpa = emocao.lower().strip()
    ficheiro     = f"skeleton_{emocao_limpa}.json"
    if os.path.exists(ficheiro):
        return FileResponse(ficheiro, media_type="application/json")
    return FileResponse("skeleton.json", media_type="application/json")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)