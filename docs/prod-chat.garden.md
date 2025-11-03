# chat.garden → chatapp prod (frontend :3225)

Cel: podpiąć domenę `chat.garden` pod produkcyjny frontend ChatApp działający na porcie hosta `3225` (w kontenerze `vite preview` nasłuchuje na `4173`). Konfiguracja analogiczna do `oazadashboard.garden`.

Poniżej gotowe przykłady dla Nginx i Caddy. Wybierz ten sam stack, którego używa obecny reverse proxy dla `oazadashboard.garden`.

## Nginx

1) Server block (TLS przez Let’s Encrypt). Zapisz np. w `/etc/nginx/sites-available/chat.garden` i zlinkuj do `sites-enabled`.

```
server {
  listen 80;
  listen [::]:80;
  server_name chat.garden;
  location /.well-known/acme-challenge/ { root /var/www/letsencrypt; }
  location / { return 301 https://$host$request_uri; }
}

server {
  listen 443 ssl http2;
  listen [::]:443 ssl http2;
  server_name chat.garden;

  # certy (wygeneruj/odnów certbotem; patrz sekcja Aktywacja)
  ssl_certificate /etc/letsencrypt/live/chat.garden/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/chat.garden/privkey.pem;

  # Podstawowe twarde nagłówki
  add_header X-Frame-Options SAMEORIGIN always;
  add_header X-Content-Type-Options nosniff always;
  add_header Referrer-Policy no-referrer-when-downgrade always;
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

  # Proxy → frontend na :3225 (kontener vite preview :4173)
  location / {
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_pass http://127.0.0.1:3225;
  }
}
```

2) Test i reload:

```
sudo nginx -t && sudo systemctl reload nginx
```

3) Certyfikat Let’s Encrypt (jeśli nie ma):

```
sudo mkdir -p /var/www/letsencrypt
sudo certbot certonly --webroot -w /var/www/letsencrypt -d chat.garden
sudo systemctl reload nginx
```

## Caddy

W Caddy wystarczy prosty blok — Caddy sam zrobi/odnowi certyfikaty. Dodatkowo mapujemy `/api` na backend `:3025`:

Zalecana, jednoznaczna kolejność (matcher + dwa handle):

Wariant LAN + własny cert (bez ACME). Dwa bloki: redirect z HTTP do HTTPS oraz właściwy vhost HTTPS z plikami certu/klucza:

```
http://chat.garden {
  # Ogranicz nasłuch do interfejsu LAN (ZMIEŃ na realny IP np. 192.168.14.55)
  bind 192.168.14.55
  redir https://chat.garden{uri} permanent
}

https://chat.garden {
  # Ogranicz nasłuch do interfejsu LAN (ZMIEŃ na realny IP np. 192.168.14.55)
  bind 192.168.14.55
  tls /etc/ssl/certs/chat.garden.crt /etc/ssl/private/chat.garden.key

  encode zstd gzip

  @api path /api/*
  handle @api {
    uri strip_prefix /api
    reverse_proxy 127.0.0.1:3025
  }

  # Keycloak reverse proxy pod /auth → :8080
  @kc path /auth*
  handle @kc {
    uri strip_prefix /auth
    reverse_proxy 192.168.14.55:8080 {
      header_up Host {host}
      header_up X-Forwarded-Host {host}
      header_up X-Forwarded-Proto https
      header_up X-Forwarded-Port 443
      header_up X-Forwarded-Prefix /auth
    }
  }

  # Serwowanie statycznego builda (fallback)
  handle {
    root * /home/ubuntu/Projects/chatapp/frontend/dist
    try_files {path} /index.html
    file_server
  }
}
```

Podmień ścieżki certu/klucza na te, gdzie wgrasz swoje pliki.

Zastosuj w `Caddyfile` i wykonaj reload (np. `sudo systemctl reload caddy`).

## Traefik (docker labels – opcjonalnie)

Jeśli `oazadashboard.garden` idzie przez Traefika, można dodać labels do kontenera frontendu. W tym repo Compose nie ma Traefika, więc tu zostawiamy jako referencję:

```
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.chat.rule=Host(`chat.garden`)"
  - "traefik.http.routers.chat.entrypoints=websecure"
  - "traefik.http.routers.chat.tls=true"
  - "traefik.http.services.chat.loadbalancer.server.port=4173"  # port w kontenerze
```

## Uwaga na backend URL, IP i SSO

- W `docker-compose.prod.yml` ustawiono (LAN-only z HTTPS):
  - `VITE_CHATAPI_URL=/api` — frontend korzysta z tego samego hosta (Caddy przekazuje `/api` → `127.0.0.1:3025`).
- `VITE_KEYCLOAK_SILENT_CHECK_SSO=https://chat.garden/silent-check-sso.html` — iFrame SSO po HTTPS (wymaga zaufanego certu na klientach).
- `VITE_KEYCLOAK_URL=https://chat.garden/auth` oraz `KEYCLOAK_URL=https://chat.garden/auth` — Keycloak przez ten sam host, bez mixed content.

Uwaga: w aplikacji nie nadpisujemy `redirectUri` w Keycloak JS (pozwalamy bibliotece użyć bieżącego adresu),
żeby nie utracić parametrów `code`/`iss` w hash przed ich przetworzeniem.
  - `ALLOWED_IPS=*` w backendzie — pozwala na dostęp spoza LAN; uwierzytelnianie Keycloak blokuje niezalogowanych.

Jeśli Keycloak działa po HTTP (np. `http://192.168.14.55:8080`), przeglądarka zablokuje mieszane treści w kontekście HTTPS. Masz dwie opcje:
- Wystawić Keycloak również pod HTTPS w LAN (np. `https://keycloak.garden` z własnym certem) i ustawić `KEYCLOAK_URL`/`VITE_KEYCLOAK_URL` na ten adres.
- Tymczasowo wyłączyć logowanie w LAN (ustaw `KEYCLOAK_ENABLED=false` i `VITE_KEYCLOAK_ENABLED=false`), dopóki Keycloak nie będzie dostępny przez HTTPS.

Po zmianach przeładuj Compose (frontend) i Caddy.

## Aktywacja – skrót

1) Wybierz właściwy reverse proxy (Nginx/Caddy/Traefik) – taki sam jak dla `oazadashboard.garden`.
2) Wgraj powyższą konfigurację `chat.garden` wskazując na `127.0.0.1:3225`.
3) Wgraj własny cert/klucz do `/etc/ssl/certs/chat.garden.crt` i `/etc/ssl/private/chat.garden.key` (patrz niżej jak wygenerować) i wykonaj reload Caddy.
4) Zrestartuj frontend po zmianach env.
5) Zainstaluj zaufanie certu na klientach (patrz niżej), inaczej przeglądarka pokaże ostrzeżenie.

## Jak wygenerować własny cert w LAN

Najprościej z `mkcert` (lokalna CA, automatyczne zaufanie na kliencie):

1) Zainstaluj mkcert na kliencie i serwerze (instrukcje: https://github.com/FiloSottile/mkcert)
2) Na kliencie: `mkcert -install` (doda lokalny root CA do zaufanych)
3) Na serwerze: `mkcert -cert-file chat.garden.crt -key-file chat.garden.key chat.garden`
4) Skopiuj pliki do Caddy: `/etc/ssl/certs/chat.garden.crt` i `/etc/ssl/private/chat.garden.key` (uprawnienia 600 dla klucza)
5) `sudo systemctl reload caddy`

Albo OpenSSL (self-signed; wymaga ręcznego zaufania na każdym kliencie):

```
openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
  -keyout chat.garden.key -out chat.garden.crt \
  -subj "/CN=chat.garden" -addext "subjectAltName=DNS:chat.garden"
```
Potem skopiuj jak wyżej i dodaj cert do zaufanych magazynów na klientach.
