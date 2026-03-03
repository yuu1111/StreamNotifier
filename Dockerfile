FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY . .
RUN go build -ldflags "-s -w" -o /stream-notifier ./cmd/stream-notifier

FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=build /stream-notifier .
VOLUME ["/app/config.json", "/app/logs"]
ENTRYPOINT ["./stream-notifier"]
