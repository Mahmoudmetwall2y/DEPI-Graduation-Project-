FROM python:3.10-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

EXPOSE 8000

ENV PORT=8000
ENV TELEMETRY_SERVICE_URL=http://telemetry-service:8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
