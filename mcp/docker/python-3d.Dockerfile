FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxrender1 \
    libxext6 \
  && rm -rf /var/lib/apt/lists/*

COPY requirements-3d.txt /tmp/requirements-3d.txt
RUN pip install --no-cache-dir -r /tmp/requirements-3d.txt

WORKDIR /work
