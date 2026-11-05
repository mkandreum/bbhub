# BBHub

Portal para usar una **BlackBerry Curve 9300** (BB OS 6) en 2026. El servidor hace el trabajo pesado y la BlackBerry recibe páginas ligeras sin JavaScript, con aspecto moderno y pensadas para su pantalla de 320x240.

| Tecla | Sección | Qué hace |
|---|---|---|
| 1 | **Telegram** | Tu cuenta (no un bot): chats, grupos y canales, enviar texto y fotos, responder, notas de voz en MP3 y transcripción |
| 2 | **Correo** | IMAP/SMTP: bandeja, enviados, búsqueda, leer, responder, reenviar, adjuntos, papelera |
| 3 | **Gemini** | Asistente con búsqueda en Google para información actual; resume cualquier web |
| 4 | **Tiempo** | Actual, por horas y 6 días (Open-Meteo) |
| 5 | **Notas** | Notas y listas de tareas marcables, fijar arriba, búsqueda |
| 6 | **Mapas** | Buscar lugares, mapa con zoom y desplazamiento, rutas en coche, a pie o en bici con indicaciones |
| 7 | **Radio** | Miles de emisoras convertidas a MP3 en el servidor, favoritas, calidad baja para 3G |
| 8 | **Traductor** | 19 idiomas (Gemini, o MyMemory si no hay clave) |
| 9 | **Noticias** | RSS configurable; abre los artículos en el lector |

La caja de búsqueda del inicio busca en la web (DuckDuckGo) o abre direcciones con el lector, que limpia las páginas y reduce las imágenes. En todas las pantallas, `0` vuelve al inicio y `9` va atrás.

## Despliegue en Coolify

1. New Resource → este repositorio → Build Pack **Docker Compose**.
2. Variables (ver `.env.example`):
   - `APP_PASSWORD`: obligatoria.
   - `TG_API_ID` y `TG_API_HASH`: en https://my.telegram.org → API development tools.
   - `MAIL_USER` y `MAIL_PASSWORD`: con Gmail, una [contraseña de aplicación](https://myaccount.google.com/apppasswords).
   - `GEMINI_API_KEY`: activa asistente, traductor, resúmenes y transcripción.
3. Dominio del servicio `app`, puerto 3000.
4. Entra en la web → Telegram → escribe tu número, el código que te llega y, si tienes, la contraseña de verificación en dos pasos.

### HTTP y HTTPS

El navegador de BB OS 6 solo admite TLS antiguo, así que **normalmente no puede abrir el HTTPS moderno** que sirve Traefik con Let's Encrypt. Para la BlackBerry añade en Coolify un dominio con `http://` (por ejemplo `http://bb.tudominio.com`) y desactiva la redirección forzada a HTTPS. Puedes mantener también el `https://` para otros dispositivos.

Por HTTP la contraseña y el contenido viajan sin cifrar entre la BlackBerry y el servidor. Usa una contraseña que no uses en otro sitio.

## Desarrollo local

```bash
npm install
APP_PASSWORD=prueba123 npm run dev
```

Para probar con la BlackBerry, conéctala a la misma Wi-Fi y abre `http://<IP-del-PC>:3000`. Necesitas `ffmpeg` instalado para el audio.

## Servicios externos

OpenStreetMap (mapas y búsqueda), routing.openstreetmap.de (rutas), radio-browser.info (radio), Open-Meteo (tiempo), DuckDuckGo (buscador), MyMemory y Gemini (traducción). Todos gratuitos para uso personal; respeta sus límites de uso.
