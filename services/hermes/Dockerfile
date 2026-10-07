FROM python:3.14.4-slim
ARG HERMES_COMMIT=e76fb951a1d207c9596032426e7e0eadfb197bea
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN git init /opt/hermes && cd /opt/hermes && git remote add origin https://github.com/NousResearch/hermes-agent.git && git fetch --depth=1 origin ${HERMES_COMMIT} && git checkout --detach FETCH_HEAD && test "$(git rev-parse HEAD)" = "${HERMES_COMMIT}" && git rev-parse HEAD > /opt/hermes/.ulysse-pinned-commit
WORKDIR /opt/hermes
# Official sealed installer consumes upstream pm/lock.json (including artifact hashes).
# No similarly named PyPI package, editable install or moving dependency resolver.
RUN python -m pm.build_env --source /opt/hermes --python /usr/local/bin/python3 --out /opt/hermes/.venv --no-install-project --sealed
COPY services/hermes /opt/ulysse
ENV PYTHONPATH=/opt/hermes PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN useradd --uid 10001 --no-create-home ulysse
USER 10001
WORKDIR /opt/ulysse
EXPOSE 8090
CMD ["/opt/hermes/.venv/bin/python", "server.py"]
