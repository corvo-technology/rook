# Plain PostgreSQL for Rook on Guará Cloud. The configured user is a real superuser, so
# the API can create the runtime role itself (see ../README.md). Mount a volume at
# /var/lib/postgresql: PGDATA is a subdirectory of it, which avoids the lost+found
# directory a fresh volume contains, and every database write lands on that volume.
FROM postgres:17-alpine
ENV PGDATA=/var/lib/postgresql/pgdata
EXPOSE 5432
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
  CMD pg_isready -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}" || exit 1
# Sized for a 1 GiB memory limit.
CMD ["postgres", \
  "-c", "listen_addresses=*", \
  "-c", "password_encryption=scram-sha-256", \
  "-c", "max_connections=100", \
  "-c", "shared_buffers=256MB", \
  "-c", "effective_cache_size=512MB", \
  "-c", "work_mem=8MB", \
  "-c", "maintenance_work_mem=64MB", \
  "-c", "temp_file_limit=1GB", \
  "-c", "log_min_duration_statement=1000"]
