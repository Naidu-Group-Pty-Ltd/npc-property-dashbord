# The product's own address service: G-NAF (the national address register,
# as static files, one per postal area) and Photon (OpenStreetMap's geocoder,
# with the Australia–Oceania index), behind one Caddy on :8080.
#
# Built, run and proved by `.github/workflows/address-service.yml` — in the CI
# runner on every change, and on Fly.io only when a person dispatches a deploy.
# Read `docs/integrations/ADDRESS_SERVICE.md` before changing anything here.
#
# Everything the machine serves is baked into the image, so the machine is
# stateless: no volume, a bluegreen deploy that switches only once the new
# machine is healthy, and a failed download that fails the BUILD while the
# live machine keeps serving what it has.

FROM caddy:2.11.4 AS caddy

FROM eclipse-temurin:21-jre-noble

ARG PHOTON_VERSION=1.3.0
ARG PHOTON_SHA256=a89707c0045e4807b2a1180e132e68e108d998709f48b6c94b98a6e281f571a5
ARG PHOTON_DB_URL=https://download1.graphhopper.com/public/australia-oceania/photon-db-australia-oceania-1.0-latest.tar.bz2
# The workflow passes the index's Last-Modified, so a new index busts this
# layer's cache and an unchanged one does not download 1.5 GB again.
ARG PHOTON_DB_STAMP=unset

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl lbzip2 tini \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --home-dir /srv --shell /usr/sbin/nologin address
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy

# Photon, pinned by version AND checksum: a jar that is not the one measured
# is not deployed.
RUN mkdir -p /srv/photon \
 && curl -fsSL -o /srv/photon/photon.jar \
      "https://github.com/komoot/photon/releases/download/${PHOTON_VERSION}/photon-${PHOTON_VERSION}.jar" \
 && echo "${PHOTON_SHA256}  /srv/photon/photon.jar" | sha256sum -c -

# The index, checked against its published MD5. A dump that is missing,
# truncated or renamed fails here.
RUN echo "photon index stamp: ${PHOTON_DB_STAMP}" \
 && curl -fsSL -o /tmp/db.tar.bz2.md5 "${PHOTON_DB_URL}.md5" \
 && curl -fsSL -o /tmp/db.tar.bz2 "${PHOTON_DB_URL}" \
 && echo "$(cut -d' ' -f1 /tmp/db.tar.bz2.md5)  /tmp/db.tar.bz2" | md5sum -c - \
 && lbzip2 -dc /tmp/db.tar.bz2 | tar -x -C /srv/photon \
 && rm -f /tmp/db.tar.bz2 /tmp/db.tar.bz2.md5 \
 && test -d /srv/photon/photon_data \
 && du -sh /srv/photon/photon_data

# The G-NAF register, built from the current release and checked against
# itself by the workflow before this image is built (`scripts/gnaf/`).
COPY gnaf/ /srv/gnaf/
RUN test -f /srv/gnaf/v1/manifest.json \
 && test -f /srv/gnaf/v1/localities.json.gz \
 && du -sh /srv/gnaf

COPY Caddyfile /etc/caddy/Caddyfile
COPY start.sh /srv/start.sh
# OpenSearch writes its node lock and translog beside the index.
RUN chown -R address:address /srv/photon && chmod 0555 /srv/start.sh

USER address
WORKDIR /srv
ENV JAVA_OPTS="-Xms512m -Xmx768m -XX:+ExitOnOutOfMemoryError"
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--", "/srv/start.sh"]
