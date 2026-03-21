FROM jrottenberg/ffmpeg:5.1-ubuntu

# Use the upstream jrottenberg ffmpeg image which bundles common codecs
# and has a well-tested ffmpeg build. Keep the image minimal and expose
# `ffmpeg` as the ENTRYPOINT so the container can be used as a CLI.
ENTRYPOINT ["ffmpeg"]

# By default print ffmpeg version
CMD ["-version"]

LABEL org.opencontainers.image.title="lcyt-ffmpeg"
LABEL org.opencontainers.image.description="FFmpeg image based on jrottenberg/ffmpeg:5.1-ubuntu"
