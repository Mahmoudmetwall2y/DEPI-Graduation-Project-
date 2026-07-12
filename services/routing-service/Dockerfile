# # Stage 1: Build the Go binary
# FROM golang:1.24.5-alpine AS builder

# WORKDIR /app

# # Copy dependency definitions and download modules.
# # Add go.sum to the repository with `go mod tidy` when Go is available locally.
# COPY go.mod ./
# COPY main.go ./

# # Fetch dependencies and build statically compiled binary
# RUN go mod download
# RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o routing-service .

# # Stage 2: Create minimal secure runtime image
# FROM alpine:3.22

# # Add certificates for secure outbound calls (if needed)
# RUN apk --no-cache add ca-certificates

# # Create non-root system user and group
# RUN addgroup -S -g 10001 appgroup && adduser -S -D -H -u 10001 -G appgroup appuser

# # Run as non-root user for K8s security compliance
# USER appuser

# WORKDIR /app

# # Copy binary from builder stage
# COPY --from=builder /app/routing-service .

# EXPOSE 8000

# ENV PORT=8000

# CMD ["./routing-service"]


# Stage 1: Build the Go binary
FROM golang:1.20-alpine AS builder

WORKDIR /app

# تعديل هنا: نسخ go.mod وأيضاً go.sum لضمان وجود الـ checksums
COPY go.mod go.sum ./

# تحميل الاعتماديات بناءً على الملفات المنسوخة
RUN go mod download

# نسخ كود الأبليكيشن
COPY main.go ./

# بناء الـ Binary
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o routing-service .

# Stage 2: Create minimal secure runtime image
FROM alpine:3.18
RUN apk --no-cache add ca-certificates
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
WORKDIR /app
COPY --from=builder /app/routing-service .
EXPOSE 8000
ENV PORT=8000
CMD ["./routing-service"]