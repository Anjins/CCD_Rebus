# Re🤖 — Laboratório de Tensão Narrativa

Ferramenta de composição visual a partir de texto. Escreves um poema ou texto em português, e a aplicação analisa as emoções de cada frase e gera uma composição tipográfica onde o peso, cor e forma de cada palavra reflete o que estás a sentir.

---

## O que precisas de instalar

- **Python 3.12** — obrigatório (versões mais antigas ou mais novas não funcionam com todas as dependências)
- **Ligação à internet** — o servidor usa APIs externas gratuitas para os ícones

Não precisas de Node.js nem de mais nada.

---

## Passo a passo

### 1. Verifica se tens o Python 3.12

Abre o terminal e corre:

```bash
python3.12 --version
```

Se aparecer `Python 3.12.x`, continua para o passo 2.

Se aparecer `command not found`, instala o Python 3.12:
- **macOS:** `brew install python@3.12`
- **Outro:** vai a [python.org/downloads](https://www.python.org/downloads/) e descarrega a versão 3.12

---

### 2. Abre o terminal na pasta do projeto

Arrasta a pasta do projeto para o terminal, ou usa `cd`:

```bash
cd caminho/para/a/pasta/do/projeto
```

Confirma que estás no sítio certo:

```bash
ls
```

Deves ver `servidor.py`, `index.html`, `skeleton.json`, etc.

---

### 3. Cria um ambiente virtual

```bash
python3.12 -m venv venv
```

Isto cria uma pasta `venv/` dentro do projeto. Só precisas de fazer isto uma vez.

---

### 4. Ativa o ambiente virtual

**macOS / Linux:**
```bash
source venv/bin/activate
```

**Windows:**
```bash
venv\Scripts\activate
```

Sabes que funcionou quando aparece `(venv)` no início da linha do terminal. **Todos os comandos seguintes têm de ser corridos com o `(venv)` ativo.**

---

### 5. Atualiza o pip

```bash
pip install --upgrade pip
```

---

### 6. Instala as dependências

```bash
pip install -r requirements.txt
```

Isto pode demorar alguns minutos — está a descarregar todas as bibliotecas necessárias.

---

### 7. Instala o modelo de português do spaCy

```bash
python3.12 -m spacy download pt_core_news_sm
```

---

### 8. Corre o servidor

```bash
python3.12 -m uvicorn servidor:app --reload
```

Quando aparecer uma linha como esta no terminal, está pronto:

```
INFO:     Uvicorn running on http://127.0.0.1:8000
```

---

### 9. Abre no browser

Vai a **[http://localhost:8000](http://localhost:8000)**

---

## Na próxima vez que quiseres correr

Não precisas de repetir a instalação. Só precisas de:

```bash
# 1. Ativa o ambiente virtual
source venv/bin/activate        # macOS/Linux
venv\Scripts\activate           # Windows

# 2. Corre o servidor
python3.12 -m uvicorn servidor:app --reload
```

---

## Aviso — primeira vez a analisar texto

Na primeira vez que escreves texto e carregas Enter, o servidor vai descarregar o modelo de inteligência artificial (mDeBERTa, ~900 MB). Pode demorar alguns minutos dependendo da internet. As vezes seguintes é imediato porque fica guardado no computador.

---

## Problemas comuns

**`python3.12: command not found`**
→ O Python 3.12 não está instalado. Segue o passo 1.

**`(venv)` não aparece no terminal**
→ O ambiente virtual não está ativo. Corre o comando do passo 4.

**`No module named spacy` ou erro parecido**
→ O ambiente virtual não está ativo, ou o passo 6 não foi concluído. Ativa o `(venv)` e corre o passo 6 novamente.

**A página abre mas a tela está em branco**
→ O ficheiro `skeleton.json` está em falta na pasta do projeto.

**Os ícones nunca aparecem**
→ O servidor precisa de acesso à internet. Verifica a ligação ou o firewall.