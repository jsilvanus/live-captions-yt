FROM node:20-slim AS build
WORKDIR /app

# Copy workspace manifests (enables layer caching for npm ci)
COPY package.json package-lock.json ./
COPY packages/lcyt/package.json packages/lcyt/
COPY packages/lcyt-backend/package.json packages/lcyt-backend/
COPY packages/lcyt-mcp-sse/package.json packages/lcyt-mcp-sse/

# Install workspace dependencies.
RUN npm ci \
  --workspace=packages/lcyt \
  --workspace=packages/lcyt-backend \
  --workspace=packages/lcyt-mcp-sse

# Copy source
COPY packages/lcyt/ packages/lcyt/
COPY packages/lcyt-backend/ packages/lcyt-backend/
COPY packages/lcyt-mcp-sse/src/ packages/lcyt-mcp-sse/src/

### Build FFmpeg from source (multi-stage) ###################################
FROM ubuntu:24.04 AS ffmpeg-build

ARG FFMPEG_VERSION=6.1
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
   autoconf automake build-essential cmake git pkg-config yasm nasm wget ca-certificates \
   libnuma-dev libx264-dev libx265-dev libvpx-dev libfdk-aac-dev libfreetype-dev libfontconfig1-dev \
   libass-dev libopus-dev libvorbis-dev libwebp-dev libmp3lame-dev libopenjp2-7-dev libaom-dev libdav1d-dev \
   libssl-dev texinfo pkg-config zlib1g-dev python3 \
 && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /usr/src/ffmpeg
WORKDIR /usr/src

# Download and build FFmpeg
RUN wget https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.bz2 \
 && tar xjf ffmpeg-${FFMPEG_VERSION}.tar.bz2 \
 && cd ffmpeg-${FFMPEG_VERSION} \
 && ./configure \
   --prefix=/usr/local \
   --extra-cflags="-I/usr/local/include" \
   --extra-ldflags="-L/usr/local/lib" \
   --enable-gpl \
   --enable-nonfree \
   --enable-libx264 \
   --enable-libx265 \
   --enable-libvpx \
   --enable-libfdk-aac \
   --enable-libass \
   --enable-libfreetype \
   --enable-libopus \
   --enable-libvorbis \
   --enable-libwebp \
   --enable-libmp3lame \
   --enable-libopenjpeg \
   --enable-libaom \
   --enable-libdav1d \
   --enable-openssl \
   --enable-libzimg \
   --enable-shared \
   --disable-debug \
   --disable-ffplay \
   --disable-doc \
 && make -j"$(nproc)" \
 && make install \
 && make distclean \
 && rm -rf /usr/src/ffmpeg-${FFMPEG_VERSION} /usr/src/ffmpeg-${FFMPEG_VERSION}.tar.bz2

### Final image: node on slim, copy built ffmpeg ################################
FROM node:20-slim
WORKDIR /app

# Copy application built artifacts from the earlier Node build stage
COPY --from=build /app .

# Copy ffmpeg and libraries from the build stage
COPY --from=ffmpeg-build /usr/local /usr/local

# Install runtime deps required by some ffmpeg libraries and update linker cache
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates libnuma1 libssl3 libx264-163 libx265-199 || true \
 && ldconfig || true \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
# Toggle free-tier API key handout endpoint (0 = disabled, 1 = enabled)
ENV FREE_APIKEY_ACTIVE=0

# Copy process manager entrypoint and make executable, create SQLite data dir
COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \
 && mkdir -p /data \
 && chown node:node /data

# Create a convenience symlink `/app/bin` → backend's bin directory
# so any runtime scripts can be found at `/app/bin` inside the image.
RUN rm -rf /app/bin \
 && ln -s /app/packages/lcyt-backend/bin /app/bin || true

USER node
EXPOSE 3000
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
	CMD node -e "const http=require('http');const req=http.get('http://127.0.0.1:3000/health',res=>{process.exit(res.statusCode===200?0:1)});req.on('error',()=>process.exit(1));"
ENTRYPOINT []
CMD ["/entrypoint.sh"]
