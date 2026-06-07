---
title: Rebus
emoji: 🤖
colorFrom: purple
colorTo: pink
sdk: docker
pinned: false
---

## Online

**[https://anjinho000-rebus.hf.space](https://anjinho000-rebus.hf.space)**

> A primeira utilização do dia pode demorar 1–2 minutos a arrancar.

---

## Local

**Requisitos:** Python 3.12

```bash
python3.12 -m venv venv
source venv/bin/activate        # macOS/Linux
venv\Scripts\activate           # Windows

pip install --upgrade pip
pip install -r requirements.txt
python3.12 -m spacy download pt_core_news_sm

python3.12 -m uvicorn servidor:app --reload
```

Abre **[http://localhost:8000](http://localhost:8000)**

**Da próxima vez:**
```bash
source venv/bin/activate
python3.12 -m uvicorn servidor:app --reload
```