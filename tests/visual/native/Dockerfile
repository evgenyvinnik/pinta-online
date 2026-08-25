FROM archlinux:latest

RUN sed -i 's/^DownloadUser/#DownloadUser/' /etc/pacman.conf \
    && pacman -Sy --noconfirm \
    && pacman -S --noconfirm --needed \
      adwaita-icon-theme \
      cantarell-fonts \
      dbus \
      dotnet-sdk \
      imagemagick \
      libadwaita \
      openbox \
      python-atspi \
      webp-pixbuf-loader \
      xclip \
      xdotool \
      xorg-xdpyinfo \
      xorg-server-xvfb \
      xorg-xwininfo \
    && pacman -Scc --noconfirm

ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_NOLOGO=1 \
    GDK_BACKEND=x11 \
    LANG=C.UTF-8

WORKDIR /work
