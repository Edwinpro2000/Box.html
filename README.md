# KartGame – multijugador

Carreras de karts para hasta 8 jugadores (mínimo 2 para jugar en línea o local; los lugares vacíos los llenan bots).
No necesita instalar nada: solo Node.js 16 o más nuevo.

## Archivos
- `server.js`: servidor (sirve el juego y conecta a los jugadores)
- `public/index.html`: el juego
- `package.json`

## Modo Local (misma red WiFi)
1. Un dispositivo (PC o celular con Termux) corre el servidor:
   - Termux: `pkg install nodejs` y luego, dentro de la carpeta: `node server.js`
   - PC: `node server.js`
2. La consola muestra algo como `Misma red WiFi: http://192.168.1.20:3000`.
   Si no muestra IP, búscala en Ajustes > WiFi del dispositivo.
3. Todos abren esa dirección en su navegador (conectados al mismo WiFi).
4. En el juego: nombre > **En línea** > **Local** > una persona toca **Crear sala** y comparte el código (o el enlace que aparece). Los demás tocan **Unirse**.
5. El anfitrión toca **Iniciar carrera**.

## Modo En línea (internet, cada quien con su WiFi o datos)
El mismo servidor, pero subido a un hosting para que tenga dirección pública.
Ejemplo con Render (gratis):
1. Sube esta carpeta a un repositorio de GitHub.
2. En render.com: New > Web Service > elige el repositorio.
3. Runtime: Node. Build Command: déjalo vacío (o `npm install`). Start Command: `node server.js`.
4. Cuando termine te da un enlace `https://algo.onrender.com`. Ese es el juego.
5. En el juego: **En línea** > **En línea** > Crear sala, y compartan el código o el enlace.

Nota: en el plan gratis Render duerme el servidor tras unos minutos sin uso; la primera visita tarda ~30 s en despertar.
Funciona igual en Fly.io, Railway, Glitch, un VPS, etc. (el servidor usa la variable `PORT` si existe).

## Cómo funciona (resumen)
- Cada jugador maneja su propio kart y manda su posición ~15 veces por segundo; los demás ven una copia suavizada.
- El anfitrión simula a los bots y manda sus posiciones. Si el anfitrión se sale, otro jugador toma su lugar.
- Si un jugador se sale en plena carrera, su kart pasa a ser un bot.
- Una sala no acepta jugadores nuevos una vez iniciada la carrera.
