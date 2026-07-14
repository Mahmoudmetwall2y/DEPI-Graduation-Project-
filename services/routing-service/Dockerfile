# Build a static Linux binary with a Go version compatible with Prometheus dependencies.
FROM golang:1.24.5-alpine AS builder

WORKDIR /app

# Download dependencies before copying source to preserve the Docker cache.
COPY go.mod go.sum ./
RUN go mod download

COPY main.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o routing-service .

# Run the static binary in a small, non-root runtime image.
FROM alpine:3.22

RUN apk --no-cache add ca-certificates && \
    addgroup -S -g 10001 appgroup && \
    adduser -S -D -H -u 10001 -G appgroup appuser

WORKDIR /app
COPY --from=builder /app/routing-service ./routing-service

USER appuser

EXPOSE 8000
ENV PORT=8000

CMD ["./routing-service"]
