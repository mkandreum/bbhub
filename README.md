# BBHub

Portal ligero para usar una **BlackBerry Curve 9300** (BB OS 6) en 2026. El servidor hace el trabajo pesado y la BlackBerry solo recibe HTML simple, sin JavaScript, pensado para su pantalla de 320x240.

- **WhatsApp**: el servidor se vincula como dispositivo (igual que WhatsApp Web). Chats, envío de texto y fotos, imágenes reducidas, notas de voz convertidas a MP3 y transcripción con IA.
- **Web**: buscador (DuckDuckGo) y lector que limpia las páginas, reduce imágenes y las parte en trozos.
- **Noticias**: El País, 20minutos y Xataka por RSS (configurable).
- **Tiempo**: Open-Meteo, sin clave.
- **Asistente IA**: Gemini con búsqueda en Google para información actual (opcional).

Atajos: en la BlackBerry pulsa `1`–`5` en el inicio, `0` para volver al inicio y `9` para atrás.

## Despliegue en Coolify

1. New Resource → este repositorio → Build Pack **Docker Compose**.
2. Variables: `APP_PASSWORD` (obligatoria) y, si quieres IA, `GEMINI_API_KEY`.
3. Dominio del servicio `app`, puerto 3000.
4. Abre la URL desde un ordenador, entra y escanea el QR en **WhatsApp > Dispositivos vinculados**.

### HTTP y HTTPS

El navegador de BB OS 6 solo admite TLS antiguo (1.0) y certificados de raíces viejas, así que **normalmente no puede abrir webs HTTPS modernas** como las que sirve Traefik con Let's Encrypt. Para la BlackBerry, añade en Coolify un dominio con `http://` (por ejemplo `http://bb.tudominio.com`) y desactiva la redirección forzada a HTTPS para ese recurso. Puedes mantener también el `https://` para usarlo desde otros dispositivos.

Por HTTP la contraseña y los mensajes viajan sin cifrar entre la BlackBerry y el servidor. Usa una contraseña que no uses en otro sitio y, si puedes, conéctate por tu Wi-Fi o una VPN.

## Desarrollo local

```bash
npm install
APP_PASSWORD=prueba123 npm run dev
```

Para probar con la BlackBerry real, conéctala a la misma Wi-Fi y abre `http://<IP-del-PC>:3000`.

## Aviso

WhatsApp no tiene API oficial para esto; se usa [Baileys](https://github.com/WhiskeySockets/Baileys). Existe riesgo de que WhatsApp limite o bloquee la cuenta. Úsalo con moderación (no envíos masivos).
