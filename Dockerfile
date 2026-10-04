FROM python:3.12-slim-bookworm
ARG VERSION
LABEL org.opencontainers.image.source="https://github.com/otama-homelab/image-studio" \
      org.opencontainers.image.title="Image Studio" \
      org.opencontainers.image.version="${VERSION}"
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libgomp1 libdrm-amdgpu1 libglib2.0-0 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir torch==2.12.1+rocm7.2 torchvision==0.27.1+rocm7.2 \
    --index-url https://download.pytorch.org/whl/rocm7.2
COPY app/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt \
    && pip install --no-cache-dir --force-reinstall --no-deps opencv-python-headless==4.11.0.86 \
    && pip check \
    && apt-get purge -y build-essential && apt-get autoremove -y \
    && rm -rf /root/.cache
COPY app/ /app/
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod 755 /app/entrypoint.sh && useradd --uid 1000 --create-home studio
ENV HOME=/tmp HF_HOME=/cache/huggingface GRADIO_TEMP_DIR=/tmp/photos \
    GRADIO_ANALYTICS_ENABLED=False PYTHONUNBUFFERED=1 NUMBA_CACHE_DIR=/cache/numba
USER 1000:1000
WORKDIR /app
EXPOSE 7860
ENTRYPOINT ["/app/entrypoint.sh"]
