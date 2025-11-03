{{- define "chatapp.name" -}}
{{- .Chart.Name -}}
{{- end -}}

{{- define "chatapp.fullname" -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

