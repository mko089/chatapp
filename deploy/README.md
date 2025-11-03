ChatApp Helm Deploy

Quickstart
- Build and push images via CI or locally:
  - backend: tag `ghcr.io/<org>/chatapp-backend:v0.1.0`
  - frontend: tag `ghcr.io/<org>/chatapp-frontend:v0.1.0-{staging|prod}`
- Install staging:
  - `helm upgrade --install chatapp-staging ./helm/chatapp -n chat --create-namespace -f ./values-staging.yaml`
- Install prod:
  - `helm upgrade --install chatapp-prod ./helm/chatapp -n chat -f ./values-prod.yaml`

Notes
- Frontend uses runtime config loaded from `runtime-config.js` (ConfigMap). Jeden obraz działa w wielu środowiskach.
- Ustaw wartości w `frontend.runtimeConfig` (values-*.yaml). Helm montuje ConfigMap do `/usr/share/nginx/html/runtime-config.js`.
- Backend to jeden obraz; konfiguracja przez env w Helm values.
- Opcjonalny Ingress rozdziela `"/"` (frontend) i `"/api"` (backend).
- Trwałość danych: jeśli używasz SQLite, dodaj PVC i zamontuj do katalogu z `DATABASE_FILE`.
