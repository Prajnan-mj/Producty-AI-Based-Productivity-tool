FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends gcc libpq-dev && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Run as an unprivileged user, not root.
RUN useradd --create-home --uid 10001 appuser && chown -R appuser /app
USER appuser

# No --reload in the image; production should set DEBUG=false.
# Use multiple workers behind the platform's process manager as needed.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
