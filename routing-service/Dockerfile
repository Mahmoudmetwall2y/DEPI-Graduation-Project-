# Stage 1: Build the Go binary
FROM golang:1.20-alpine AS builder

WORKDIR /app

# Copy dependency definitions and source code
COPY go.mod ./
COPY main.go ./

# Fetch dependencies and build statically compiled binary
RUN go mod tidy
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o routing-service .

# Stage 2: Create minimal secure runtime image
FROM alpine:3.18

# Add certificates for secure outbound calls (if needed)
RUN apk --no-cache add ca-certificates

# Create non-root system user and group
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Run as non-root user for K8s security compliance
USER appuser

WORKDIR /app

# Copy binary from builder stage
COPY --from=builder /app/routing-service .

EXPOSE 8000

ENV PORT=8000

CMD ["./routing-service"]
