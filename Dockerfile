FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

RUN python3.12 -m spacy download pt_core_news_sm

COPY . .

EXPOSE 7860

CMD ["uvicorn", "servidor:app", "--host", "0.0.0.0", "--port", "7860"]