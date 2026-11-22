# RaceLab · MVP local

Python 3.11+ y un navegador moderno. Sin paquetes externos, cuentas ni servicios remotos.

## Iniciar en Windows

Abre PowerShell en esta carpeta y ejecuta:

```powershell
python server.py
```

Abre http://127.0.0.1:8765. En FH6: Settings → HUD and Gameplay → Data Out = On, IP = 127.0.0.1, puerto = 5301. El servidor muestra si recibe paquetes y cuántos rechaza. Si otro programa usa ese puerto, el error se muestra en pantalla. Cambia el puerto con `python server.py --udp-port 5302` y configura el mismo en el juego.

Para recibir desde otra máquina de tu red usa `--udp-host 0.0.0.0`, configura en FH6 la IP LAN de la PC receptora y permite ese puerto UDP en el firewall. La página web sigue accesible sólo desde la PC receptora.

## Usar

1. Pon nombre y pulsa Grabar antes de conducir. Graba el juego con OBS por separado.
2. Pulsa Detener y guardar; abre la sesión desde la lista.
3. Selecciona el MP4 local. No se sube ni se copia. Si el navegador no decodifica su codec, exporta desde OBS a MP4 H.264/AAC.
4. Pausa el video en un evento reconocible. Mueve el cursor de telemetría al mismo evento y pulsa Alinear fotograma actual con cursor; guarda la sincronización. También puedes ajustar el desfase numérico, positivo o negativo.
5. Reproduce desde RaceLab para mover video, mapa y gráficas juntos. Usa las casillas para superponer vueltas; rueda y arrastre en el mapa. Clic en las gráficas posiciona la primera vuelta marcada a esa distancia.

Las sesiones persisten en `data/`: metadatos JSON y muestras JSONL, vaciadas a disco tras cada muestra. Puedes respaldar esa carpeta. El MP4 se vuelve a seleccionar después de recargar. No hay datos de ejemplo en la aplicación.

## Semántica y límites

- Decodifica exclusivamente FH6 de 324 bytes, little endian. Fuente: [documentación oficial de Forza](https://support.forza.net/hc/en-us/articles/51744149102611-Forza-Horizon-6-Data-Out-Documentation). No se asume compatibilidad con otros juegos.
- La línea temporal usa tiempo monotónico de recepción, incluyendo pausas sin paquetes, para poder alinearse con una grabación continua de OBS. El desfase es constante: no corrige deriva ni ediciones del video.
- Las vueltas se separan por cambio de LapNumber o reinicio del reloj del juego. Primera y última se marcan parciales de forma conservadora. En conducción libre puede existir una sola sección parcial. No identifica circuitos ni eventos automáticamente.
- Distancia por vuelta: suma de desplazamientos X/Z en metros, desde la primera muestra de cada vuelta. No es progreso oficial de pista. No suma saltos de más de 100 m ni intervalos sin muestras mayores de un segundo; rompe la trazada. Las gráficas comparan metros absolutos, sin estirar vueltas para que coincidan.
- El mapa es una trazada de posiciones, sin imagen del mapa del juego. La reproducción es del MP4 y de la telemetría, no controla el replay del juego.
- Carga y dibuja la sesión completa en memoria. Diseñado para sesiones cortas del MVP; no incorpora reducción de puntos, indexación, instalador de escritorio ni sincronización automática.
- Datos ausentes durante menús, rebobinado o replay no se reconstruyen. FH6 no transmite en esos estados según su documentación.

## Verificación

```powershell
python -m unittest discover -s tests -v
node --check public/app.js
```

Las pruebas generan paquetes sintéticos únicamente en un directorio temporal: comprueban offsets binarios, rechazo de formatos inválidos, distancia y huecos, y el flujo HTTP → grabación UDP → disco → lectura → sincronización. La interfaz vacía también se verificó en el navegador. Estas pruebas no equivalen a una captura real de FH6 ni verifican la reproducción de un MP4 de OBS. Para validación real: grabar dos vueltas con OBS, verificar trazadas y entradas de pedales, alinear un frenado y comprobar sincronía al principio y al final.

