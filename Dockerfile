FROM golang:1.26.5-alpine AS builder

WORKDIR /src

COPY go.mod ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /stream-notifier ./cmd/stream-notifier

FROM alpine:3.23

RUN apk add --no-cache bash ca-certificates tzdata \
	&& adduser -D -h /home/container -s /bin/bash container

WORKDIR /opt/stream-notifier

COPY --from=builder /stream-notifier ./stream-notifier
COPY deploy/featherpanel/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh \
	&& mkdir -p /home/container/logs /home/container/data \
	&& chown -R container:container /home/container

USER container

ENV TZ=Asia/Tokyo \
	USER=container \
	HOME=/home/container

WORKDIR /home/container

CMD ["/bin/bash", "/entrypoint.sh"]
