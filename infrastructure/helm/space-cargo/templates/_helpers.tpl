{{- define "space-cargo.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- define "space-cargo.fullname" -}}
{{- default (include "space-cargo.name" .) .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- define "space-cargo.labels" -}}
app.kubernetes.io/part-of: {{ include "space-cargo.name" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end }}

