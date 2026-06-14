FROM python:3.12-slim

# GeoDjango needs the GDAL, GEOS and PROJ C libraries at runtime. Installing
# them in the image is the whole reason we run Django in a container instead of
# fighting native installs on the host.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    # Put the virtualenv OUTSIDE /app: compose bind-mounts the source over /app
    # at runtime, which would otherwise shadow a .venv created during the build.
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_LINK_MODE=copy \
    PATH="/opt/venv/bin:$PATH"

RUN apt-get update && apt-get install -y --no-install-recommends \
        binutils \
        libproj-dev \
        gdal-bin \
        libgdal-dev \
    && rm -rf /var/lib/apt/lists/*

# Bring in the uv binary from its official image.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

# Install dependencies from the lockfile first for better layer caching. We only
# need the env (the project itself isn't a package — see pyproject [tool.uv]).
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen

COPY . .

EXPOSE 8000

CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]
