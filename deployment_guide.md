# Guía Completa de Despliegue en Servidor 24/7 para PalanWeb

Esta guía explica cómo desplegar **PalanWeb** en un servidor remoto (VPS, NAS Synology/QNAP o plataformas en la nube como Render/Railway) para mantener el servicio activo las 24 horas del día sin necesidad de tener el ordenador personal encendido.

---

## 🚀 OPCIÓN 1: Despliegue con Docker y Docker Compose (Recomendado para NAS y VPS)

Es la opción más sencilla, aislada y limpia. Compatible con **Synology NAS**, **QNAP**, **Portainer** o cualquier **VPS Linux con Docker**.

### Pasos:

1. **Subir los archivos al servidor** (vía SSH, FTP o Git):
   Subir toda la carpeta del proyecto `PalanWeb` a tu servidor.

2. **Editar las credenciales en el archivo `.env`**:
   ```env
   PORT=3000
   WEB_AUTH_REQUIRED=true
   WEB_USERNAME=tu_usuario_personal
   WEB_PASSWORD=tu_contraseña_segura
   SESSION_SECRET=clave_secreta_servidor_2026
   ```

3. **Iniciar el servidor con Docker Compose**:
   En el terminal de tu servidor (en la carpeta de PalanWeb):
   ```bash
   docker compose up -d --build
   ```

4. **Verificar estado y logs**:
   ```bash
   docker compose ps
   docker compose logs -f
   ```

5. **Acceso**:
   Ingresa en `http://IP_DE_TU_SERVIDOR:3000` desde Safari en tu iPhone o navegador.

---

## 🖥️ OPCIÓN 2: Despliegue en VPS Linux (Ubuntu/Debian) con PM2 y Nginx (SSL / HTTPS)

Si tienes un servidor VPS (Hetzner, DigitalOcean, Linode, AWS, Contabo, etc.) con Ubuntu/Debian:

### 1. Instalar Node.js y PM2
```bash
sudo apt update && sudo apt install -y curl git nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

### 2. Clonar / Copiar PalanWeb e instalar dependencias
```bash
cd /var/www
git clone <tu-repositorio-git> palanweb  # o subir la carpeta
cd palanweb
npm install --production
```

### 3. Configurar variables y arrancar con PM2
Crea el archivo `.env` con tus credenciales y ejecuta:
```bash
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup
```

### 4. Configurar Nginx y Certificado HTTPS (Gratis con Certbot)
Crea el archivo de configuración `/etc/nginx/sites-available/palanweb`:
```nginx
server {
    server_name tu-dominio.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```
Activa la web y añade HTTPS SSL gratis:
```bash
sudo ln -s /etc/nginx/sites-available/palanweb /etc/nginx/sites-enabled/
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d tu-dominio.com
```

---

## ☁️ OPCIÓN 3: Despliegue Gratis / Bajo Coste en Render.com o Railway.app

Si no tienes servidor propio, puedes desplegarlo directamente en plataformas Cloud conectando tu cuenta de GitHub.

### En Render.com:
1. Crea un repositorio privado en GitHub con el código de PalanWeb y súbelo.
2. Entra en [Render.com](https://render.com) y crea un **Web Service**.
3. Conecta tu repositorio de GitHub.
4. Render detectará automáticamente Node.js.
5. Configura el **Build Command**: `npm install`
6. Configura el **Start Command**: `npm start`
7. En la pestaña **Environment Variables**, añade:
   - `WEB_AUTH_REQUIRED` = `true`
   - `WEB_USERNAME` = `tu_usuario`
   - `WEB_PASSWORD` = `tu_contraseña`
8. Haz clic en **Create Web Service**. ¡Render te dará una URL HTTPS única (ej. `https://palanweb.onrender.com`) accesible desde cualquier lugar!

---

## 📱 Añadir como PWA en iPhone tras el despliegue

Una vez desplegado en tu servidor:
1. Abre Safari en tu iPhone e introduce la URL de tu servidor (ej. `https://tu-dominio.com` o `http://IP-SERVIDOR:3000`).
2. Inicia sesión con tu usuario y contraseña.
3. Pulsa el botón **Compartir (flecha hacia arriba)** en la barra inferior de Safari.
4. Selecciona **Añadir a la pantalla de inicio**.
5. Tendrás PalanWeb como una aplicación nativa en el iPhone, lista para reproducir mediante AllDebrid e Infuse/VLC 24/7.
