FROM coturn/coturn:latest

USER root
RUN mkdir -p /etc/coturn /var/log/coturn && \
    chown -R turnserver:turnserver /etc/coturn /var/log/coturn

COPY turnserver.conf /etc/coturn/turnserver.conf

USER turnserver

EXPOSE 3478/tcp 3478/udp
EXPOSE 5349/tcp 5349/udp
EXPOSE 49152-65535/udp

ENTRYPOINT ["turnserver"]
CMD ["-c", "/etc/coturn/turnserver.conf"]
