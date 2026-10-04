#!/bin/sh
set -eu
python /app/prepare_models.py
exec python /app/image_studio_app.py
