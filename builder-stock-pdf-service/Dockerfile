# Builder Stock PDF election worker.
#
# Mirrors the pdf-parse-service / weasyprint-service sidecar pattern, with one
# deliberate difference: this image runs DENO, because it executes the very
# TypeScript the Edge settler used to run. Re-implementing the election in
# Python would make two extractors that must agree for ever; running the same
# module makes agreement a property of there being one of them.
#
# Build:  docker build -f builder-stock-pdf-service/Dockerfile -t bsp .
#         (context is the REPOSITORY ROOT — the worker imports supabase/functions/_shared)
# Run:    docker run -p 8080:8080 -e BUILDER_STOCK_PDF_SERVICE_TOKEN=dev bsp
FROM denoland/deno:alpine-2.1.4

ENV PORT=8080 \
    DENO_DIR=/deno-dir

WORKDIR /app

# Only what the election needs: the worker and the shared modules it imports.
# Copied before the cache warm so a source change does not re-download the
# dependency graph.
COPY supabase/functions/_shared/ /app/supabase/functions/_shared/
COPY builder-stock-pdf-service/main.ts /app/builder-stock-pdf-service/main.ts

# Bake the dependency graph into the image — `unpdf` is pinned at
# esm.sh/unpdf@0.12.1 and is fetched at call time otherwise, which would put a
# CDN on the path of every cold start and of every election.
RUN deno cache --node-modules-dir=none builder-stock-pdf-service/main.ts

# A non-root user, as the sibling services do.
USER deno

EXPOSE 8080

# No secrets here: BUILDER_STOCK_PDF_SERVICE_TOKEN arrives from the runtime
# environment, and the service refuses every request while it is unset.
CMD ["run", "--allow-net", "--allow-env", "--allow-read=/app", "builder-stock-pdf-service/main.ts"]
