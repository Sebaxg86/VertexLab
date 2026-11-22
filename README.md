# RaceLab

Aplicación web local para FH6: telemetría LIVE, registro automático por vehículo,
grabación de OBS con pausas y análisis de video, trazadas y entradas por distancia.

## Iniciar en Windows

Requiere Python 3.11+, un navegador moderno y OBS Studio con WebSocket v5 para video automático.
Ejecuta `start.cmd`. La primera vez prepara `.venv` e instala `websocket-client` desde PyPI.
Abre http://127.0.0.1:8765. También puedes preparar todo manualmente:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe server.py
```

En FH6: Settings → HUD and Gameplay → Data Out = On, IP = `127.0.0.1`, puerto = `5301`.
Para otra PC de tu red: `--udp-host 0.0.0.0`, IP LAN de esta PC en FH6 y permiso
del puerto UDP en el firewall. La web y OBS se conectan sólo a localhost.
Puedes cambiar puertos: `server.py --udp-port 5302 --port 8766`.

## Preparar OBS una vez

1. Abre OBS y configura una escena con la captura del juego y el audio deseado.
2. En Herramientas → Ajustes del servidor WebSocket, habilita el servidor con autenticación.
3. Introduce en RaceLab el puerto (normalmente 4455) y la contraseña. Pulsa Conectar OBS.
4. Usa un modo de grabación de OBS que permita pausar. Si OBS rechaza la pausa,
   RaceLab lo muestra como error; no simula que la grabación se haya detenido.
5. Para reproducción directa en el navegador, usa MP4 con H.264 y audio compatible.
   Si grabas MKV o un codec que el navegador no decodifica, remultiplexa/convierte
   el archivo en OBS y selecciónalo con Abrir video local. Remultiplexar conserva
   el tiempo; recortar o editar el video invalida la asociación temporal original.

La contraseña no se escribe en disco, no se devuelve en la API y no se incluye en
Git. Reconecta OBS al reiniciar RaceLab; también puedes proporcionar la contraseña
con `RACELAB_OBS_PASSWORD` en el entorno. OBS debe estar abierto previamente.
RaceLab controla exclusivamente grabaciones que él mismo inicia. Si OBS ya está
grabando, guarda sólo telemetría y muestra el conflicto. No inicia ni detiene streams.
Las órdenes de OBS se confirman consultando su estado durante un máximo de cinco
segundos: la respuesta inicial de WebSocket puede llegar antes de que el cambio se
haya aplicado. Se espera también la finalización antes de ofrecer el archivo de video.

## Flujo automático

- LIVE funciona también en manejo libre. Muestra velocidad, RPM, marcha, pedales,
  vehículo, clase y PI, con conexión persistente SSE de 10 actualizaciones/s.
- Inicia una sesión cuando `IsRaceOn` está activo y hay posición de carrera o
  cronómetro de vuelta positivo. El primer paquete de manejo libre no abre sesión.
- El nombre sale de `CarOrdinal`. El catálogo prioriza FH6 y usa entradas heredadas
  como respaldo; un identificador desconocido queda como `Vehículo #ID`.
- Un paquete inactivo o 0.6 s sin muestras de carrera pausa OBS y el tiempo de análisis.
  Conserva la misma sesión indefinidamente. Los paquetes de pausa no se guardan como muestras de conducción.
- Al volver los datos del evento, reanuda OBS y la misma sesión; no suma al análisis
  los minutos de pausa. Se marca el corte para no dibujar una línea entre sus extremos.
- Confirma salida cuando recibe durante al menos 1.5 s paquetes activos de manejo
  libre (sin posición ni cronómetro de vuelta). También separa un reinicio del tiempo
  de carrera cerca de cero o un cambio de vehículo.
- Al terminar, detiene OBS y guarda la ruta que devuelve; el video queda asociado y
  se sirve localmente con HTTP Range para saltar a cualquier instante.
- Puedes pulsar Finalizar y guardar en cualquier momento. Impide reabrir inmediatamente
  el mismo evento por los paquetes que aún siguen llegando.

**Límite de detección:** UDP no contiene una señal inequívoca que diferencie pausa,
pantalla de resultados y pérdida de red. Si no vuelven paquetes al terminar, queda
pausado hasta regresar a manejo libre o pulsar Finalizar. No hay un timeout largo que
corte una pausa legítima, ni se afirma que un silencio confirma una carrera completada.
El umbral de 0.6 s implica un pequeño retardo de detección; no es pausa instantánea.
No hay reconocimiento visual de resultados ni rebobinado soportado en esta entrega.

## Analizar

Abre el menú hamburguesa y selecciona una sesión guardada. El menú se superpone sin
desplazar el área de análisis. Se carga automáticamente el video asociado si sigue en su
ruta original y el navegador admite su codec. Las sesiones antiguas del MVP siguen
abriéndose y permiten seleccionar MP4 y ajustar el desfase como antes.
Si existe video pero faltan referencias de sincronización, se puede reproducir por
separado y se muestra un aviso; no se inventa una relación con la telemetría.

Marca vueltas y elige una de referencia. Arrastra sobre las gráficas para moverte por
distancia en esa vuelta: el video y el marcador de su trazada saltan al instante.
Los marcadores de las otras vueltas se comparan a la misma distancia. La vista de escritorio
mantiene el reparto 60/40: video e indicadores instantáneos a la izquierda; la zona
derecha se divide en dos filas de igual altura: gráficas desplazables arriba y recorrido abajo.
La telemetría observada
corresponde al cursor de la sesión; Volver a LIVE muestra los paquetes actuales del juego.
El video no tiene controles internos: usa la barra flotante para reproducir, pausar,
deslizar el tiempo, saltar cinco segundos, ajustar velocidad, volumen o silencio. Rueda/arrastre sobre el
mapa: zoom/pan; Encuadrar restablece la vista. No se incluye imagen del mapa de Forza.
En el recorrido, la rueda mantiene fijo el punto bajo el mouse. Los botones +/− de
las gráficas amplían todas a la vez alrededor del cursor de análisis; Ver todo restaura
la distancia completa. Ctrl + rueda sobre una gráfica amplía alrededor del puntero.
El zoom horizontal es compartido y las escalas verticales se ajustan a la zona observada;
arrastrar una gráfica sigue buscando el instante correcto dentro de esa zona. En LIVE,
los botones cambian la ventana reciente de 20 hasta 0.5 segundos.

La grabación manual permite capturar también manejo libre. Desactivar la detección
automática evita abrir nuevas sesiones; no descarta ni cierra la que ya está abierta.

## Sincronización y datos

Sesiones en `data/`: metadatos JSON y muestras JSONL. El reloj de recepción es
monotónico; la línea de análisis elimina intervalos de pausa. Cada reanudación crea
un tramo con referencia a `GetRecordStatus.outputDuration` de OBS y registra la mitad
del tiempo de ida/vuelta de la petición como incertidumbre de comunicación.

Las muestras recibidas antes de la confirmación de inicio o reanudación quedan sin
cobertura de video. No se inventan fotogramas. Las pequeñas colas que OBS graba antes
de confirmar una pausa se saltan al reproducir el análisis por tramos. La latencia de
captura/codificación y posibles pérdidas de frames no están medidas por esa petición:
**la sincronización es estimada, no hay garantía de precisión de un fotograma**. Existe
ajuste fino persistente para calibración; requiere comprobar una captura real al
principio, después de una pausa y al final. El reloj real no supone 60 paquetes/s.

La distancia suma desplazamientos X/Z en metros por vuelta. Pausas, saltos >100 m y
huecos >1 s rompen la línea y no añaden distancia ficticia. Primera/última vuelta y
vueltas con cortes se identifican como parciales de forma conservadora. No estima
un tiempo oficial ni reconoce circuitos. Las sesiones completas se cargan en memoria;
el MVP está pensado para sesiones cortas. Los archivos de video no se copian.
No hay datos de demostración en el producto. Respaldar `data/` y los videos por separado.

## Indicadores del instante observado

Debajo del video se muestran marcha, RPM, dirección, pedales, fuerzas G y cuatro neumáticos. Se
actualizan con el mismo paquete del cursor usado para el video y las gráficas; en LIVE
usan únicamente los paquetes actuales de conducción. Las transiciones suaves son visuales,
no generan muestras nuevas. Las sesiones previas a esta función carecen de los campos
adicionales: muestran Sin datos, sin reconstruirlos ni sustituirlos por datos LIVE.

Dirección es la entrada firmada `Steer` normalizada a porcentaje; el giro del icono es
ilustrativo. Las luces y la barra de RPM usan EngineMaxRpm del juego como escala,
sin afirmar un régimen óptimo de cambio de marcha. Capturas antiguas sin ese campo
muestran la cifra de RPM y la marcha, pero no inventan una escala máxima. El giro del volante es
ilustrativo y no representa grados físicos del volante. Las G laterales/longitudinales
se calculan de AccelerationX/Z divididas entre 9.80665, con derecha/adelante positivos;
la cifra combinada es la magnitud en el plano X/Z. El diagrama limita el punto al borde
de 2G, conservando las cifras reales incluso si se supera ese rango.

Temperatura: cuatro lecturas convertidas de Fahrenheit a Celsius, con gradiente visual
de 40 a 140 °C (sin afirmar un rango óptimo universal). Deslizamiento: magnitud de
TireCombinedSlip por rueda, con aviso para >1. No es porcentaje de agarre, coeficiente
de fricción, desgaste ni presión del neumático. El decodificador también conserva
slip longitudinal y suspensión normalizada para análisis posterior. El diseño se inspira
en los indicadores revisados de fh6-tel; los gráficos y componentes se implementaron
de forma independiente.

## Arquitectura y verificación

`telemetry.py`: decodificador FH6 de 324 bytes little endian.
`recorder.py`: ciclo de sesión y reloj activo.
`obs_control.py`: autenticación y órdenes OBS WebSocket v5.
`server.py`: receptor UDP independiente, cola serializada de captura, HTTP y SSE.
`public/timeline.js`: conversión de tiempos por tramos; `public/app.js`: visor LIVE/análisis.

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
node --test tests/timeline.test.cjs
node --test tests/instruments.test.cjs
node --test tests/view-math.test.cjs
node --check public/app.js
```

Las pruebas usan directorios temporales y un OBS simulado: formato, carreras/Time Trial,
pausa larga, reanudación, reinicios, conflictos/errores de OBS, autenticación del protocolo,
UDP real → registro → lectura HTTP, SSE y rangos de video. No sustituyen una prueba con
FH6 y OBS reales. Checklist de aceptación: conducir libre sin sesión; iniciar carrera;
pausar 30 s; reanudar; salir a manejo libre; abrir sesión; arrastrar gráficas; verificar
un frenado antes y después de la pausa y que el menú no suma tiempo de análisis.

Fuentes: [formato oficial de FH6](https://support.forza.net/hc/en-us/articles/51744149102611-Forza-Horizon-6-Data-Out-Documentation),
[protocolo OBS](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md).
Únicamente se reutilizó el catálogo de vehículos de fh6-tel con su licencia MIT;
ver `THIRD_PARTY_NOTICES.md`. La implementación de RaceLab es independiente.
