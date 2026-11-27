# VertexLab

Telemetría y análisis para Forza Horizon 6. VertexConnect captura en Windows y
sincroniza video de OBS. VertexLab permite comparar vueltas por tiempo y revisar
sesiones locales o sincronizadas con Google Drive, también desde el visor web.

Para retomar el desarrollo en otro equipo, consulta [CONTEXTO.md](CONTEXTO.md).

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
3. Introduce en VertexLab el puerto (normalmente 4455) y la contraseña. Pulsa Conectar OBS.
4. Usa un modo de grabación de OBS que permita pausar. Si OBS rechaza la pausa,
   VertexLab lo muestra como error; no simula que la grabación se haya detenido.
5. Para reproducción directa en el navegador, usa MP4 con H.264 y audio compatible.
   Si grabas MKV o un codec que el navegador no decodifica, remultiplexa/convierte
   el archivo en OBS y selecciónalo con Abrir video local. Remultiplexar conserva
   el tiempo; recortar o editar el video invalida la asociación temporal original.

La contraseña no se escribe en disco, no se devuelve en la API y no se incluye en
Git. Reconecta OBS al reiniciar VertexLab; también puedes proporcionar la contraseña
con `VERTEXLAB_OBS_PASSWORD` en el entorno. OBS debe estar abierto previamente.
VertexLab controla exclusivamente grabaciones que él mismo inicia. Si OBS ya está
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

Pulsa el nombre del vehículo en el header y selecciona una sesión guardada. El selector se superpone sin
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
corresponde al cursor de la sesión; LIVE muestra los paquetes actuales del juego.
El acceso a LIVE está fijo arriba en el selector de sesiones. La columna de gráficas tiene un
encabezado compacto y dos filas visibles: velocidad, RPM, acelerador, freno, tiempos
y distancia se recorren verticalmente. Los tiempos de vuelta y carrera se muestran
como segundos con tres decimales por debajo de un minuto (`45.123 s`) y minutos
decimales a partir de 60 segundos (`1.234 min`), manteniendo segundos
en los datos originales y en la sincronización. Posición X/Y/Z, marcha y posición
de carrera no se muestran como gráficas; la marcha permanece en el panel del motor.
El desplazamiento vertical encaja en los límites de cada fila; al terminar el gesto
quedan dos gráficas completas. La velocidad tiene un indicador destacado junto al motor.
El video no tiene controles internos: usa la barra flotante para reproducir, pausar,
deslizar el tiempo, saltar cinco segundos, ajustar velocidad, volumen o silencio. Rueda/arrastre sobre el
mapa: zoom/pan; Encuadrar restablece la vista. No se incluye imagen del mapa de Forza.
En el recorrido, la rueda mantiene fijo el punto bajo el mouse. Los botones +/− de
las gráficas amplían todas a la vez alrededor del cursor de análisis; Ver todo restaura
la distancia completa. Ctrl + rueda sobre una gráfica amplía alrededor del puntero.
La barra horizontal entre el texto y los botones desplaza la ventana ampliada de todas
las gráficas sin cambiar el zoom ni mover el cursor del video. El ancho del control
representa la proporción visible; se desactiva cuando ya se ve toda la distancia.
Durante la reproducción con zoom, la ventana compartida sigue automáticamente el
cursor por distancia sin cambiar el nivel de ampliación. Al pausar, vuelve a permitir
la exploración manual; al inicio y al final de cada vuelta se respetan sus límites.
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
muestran la cifra de RPM y la marcha, y las luces usan el pico realmente medido en la
sesión como referencia visual explícita (no se considera límite del motor ni régimen
óptimo de cambio). En LIVE, ese pico se acumula para el vehículo actual.
Las luces avanzan por pares desde las orillas al centro. Al alcanzar el 88% de la
referencia de RPM, en marcha hacia delante y a más de 15 km/h, todas parpadean en azul
como aviso estimado de cambio (no una orden explícita del juego). Con movimiento
reducido configurado en el sistema, se iluminan en azul sin parpadear.
El giro del volante es ilustrativo y no representa grados físicos del volante. Las G laterales/longitudinales
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
ver `THIRD_PARTY_NOTICES.md`. La implementación de VertexLab es independiente.

## Selección de recorrido y vueltas

El header incluye «Todo el recorrido» fijo y una lista horizontal de vueltas con
sus tiempos registrados. Las capturas incompletas se identifican como parciales.
En Todo, las gráficas usan el tiempo de sesión: se recorre la grabación completa
sin superponer vueltas. En una vuelta, el reproductor queda limitado a su tramo.
Puedes marcar varias vueltas para comparar las gráficas y trazadas por distancia;
volver a pulsar una vuelta la desmarca, y quitar la última vuelve a Todo.

Se muestran como máximo dos videos, en columnas. Desde «Videos» eliges cuáles de
las vueltas marcadas ver y cuál es la referencia del reloj y de los indicadores.
La comparación alinea los videos por distancia sobre esa referencia, utilizando
las referencias de sincronización existentes de OBS. El audio sale del primero.
Si falta cobertura en una vuelta o video, se indica y se pausa ese panel, sin
extrapolar imágenes. Los archivos grabados y sus referencias no se modifican.

Verificación adicional: `node --test tests/analysis-model.test.cjs`.

## Tablero LIVE y selector de sesiones

Pulsa el nombre del vehículo en el header para desplegar el selector animado.
LIVE permanece fijo arriba; las sesiones guardadas tienen su propio scroll.
Seleccionar una sesión abre análisis, con las vueltas y videos habituales.
LIVE abre un tablero dedicado para el segundo monitor: marcha, velocidad y luces
al centro, y dirección, fuerzas G y neumáticos debajo. Puedes abrir directamente
`http://127.0.0.1:8765/#live` en otra ventana. Recargar conserva la vista elegida.

El indicador verde respira mientras llegan paquetes recientes de Forza. Las lecturas se limpian tras dos segundos sin datos. El estado LIVE tolera
cortes UDP de hasta cinco segundos y reconexiones breves del visor antes de pasar
a OFFLINE; no conserva lecturas viejas como si fueran actuales. La antigüedad
del paquete usa un reloj monotónico del servidor y el tiempo transcurrido local,
sin comparar el reloj del navegador con el de Windows. Los paquetes
de pausa o menú mantienen la conexión e indican ese estado, sin mostrar conducción
activa. Guardar automáticamente una carrera no saca al usuario de LIVE. El selector
admite Escape, teclado y movimiento reducido del sistema.

Los cambios de Python requieren reiniciar el servidor, además de recargar el visor.
En Windows los puertos HTTP/UDP son exclusivos para evitar instancias superpuestas.
## Interfaz racing

El selector del header permite cambiar entre LIVE y sesiones guardadas. La
hamburguesa fue eliminada. LIVE incluye un desplegable para nombrar sesiones,
REC y guardar, y un engranaje a la derecha con OBS y detección automática.
Guardar manualmente mantiene LIVE abierto; la sesión aparece en el selector.
En análisis aparecen reproducción, vueltas y un engranaje propio para destacar
o borrar la sesión; los ajustes de captura pertenecen a LIVE. BEST identifica la vuelta completa más rápida, incluyendo empates;
las vueltas parciales no compiten. Las fuentes se incluyen localmente para uso
sin internet. Los colores, secuencia, umbral y parpadeo de las luces RPM se conservan.

El header de análisis no muestra importación de video ni diagnóstico UDP. En LIVE,
los controles de nombre y REC están centrados; el diagnóstico se consulta desde el
engranaje. Sin nombre, la grabación manual recibe «Sesión libre 001», «002», etc.;
el contador persiste en data/.manual-sequence y no se reinicia al borrar sesiones.
El selector muestra una miniatura de la segunda vuelta registrada y el logotipo
local del fabricante, identificado mediante el catálogo del vehículo. Si no hay segunda vuelta utilizable, se dibuja la primera; en una sesión libre
sin cronometraje se utiliza todo el recorrido. Solo se muestra «Sin trazada»
si no hay movimiento registrado suficiente. Las miniaturas se generan con límites
y discontinuidades reales de los datos y se cachean hasta que el archivo cambia.


Detección automática: conducción activa y posición de carrera mayor que cero o
tiempo de vuelta mayor que cero. Esto incluye contrarrelojes/Rivales que emitan
su reloj de vuelta. No hay reconocimiento geográfico de Time Attack en mundo
abierto ni clasificación por nombre de modo; si no llegan esas señales, usar REC.


## Interacción de análisis

El engranaje de análisis permite destacar una sesión (estrella dorada en el
selector) y borrarla junto con su video. El borrado es permanente y requiere
confirmación con el nombre y el archivo; se bloquean grabaciones activas y videos
compartidos con otra sesión. No se borran archivos mediante las pruebas reales:
las pruebas de eliminación utilizan exclusivamente directorios temporales.

El mapa admite hasta 256×. Mientras se reproduce con zoom, sigue al auto de la
vuelta de referencia (o al instante actual de Todo). En pausa, la rueda hace zoom
bajo el puntero y arrastrar desplaza el mapa. Hover resalta una trazada; clic lleva
video, gráficas e instrumentos a ese punto. La leyenda prioriza una vuelta cuando
las trazadas coinciden. Pulsar la línea de otra vuelta en mapa o gráfica cambia
la referencia a esa vuelta sin descartar las otras comparaciones.

Las gráficas muestran dos parámetros completos, con scroll de una fila por paso.
Pulsar su nombre expande uno a toda la altura; volver a pulsarlo recupera dos.
En modo expandido, scroll recorre los parámetros individualmente. Hover muestra
vuelta, tiempo y valor; clic navega al instante exacto con el mapeo OBS existente.
El aviso azul de RPM se activa al 88% en LIVE y análisis, con salida bajo 86%.

### Instrumentos y rendimiento

Las luces de RPM llenan progresivamente desde las orillas: todas las luces rojas quedan encendidas al 80% de la referencia; el aviso azul conserva el 88% (libera bajo 86%). Es una referencia visual estimada, no una orden de cambio enviada por Forza.

Las gráficas conservan una capa dibujada por parámetro y ventana visible; el cursor se actualiza aparte. La reducción por píxel conserva extremos, cambios y cortes, sin modificar muestras guardadas. El mapa conserva las trazadas y consulta un índice espacial cuando se acerca la cámara.

El panel Vueltas muestra tiempos guardados y diferencias en segundos respecto a la mejor vuelta completa. La mejor se destaca en verde; las parciales se identifican y no compiten por ese distintivo. La lista es informativa, con scroll y sin acciones al hacer clic. En LIVE indica que se debe abrir una sesión para consultar sus vueltas. La lista ocupa el tercio derecho del bloque de Recorrido. Al volante mantiene Motor exactamente centrado y Dirección/Fuerzas G alineadas, con tipografía uniforme y una etiqueta legible del instante observado. Los neumáticos conservan dibujos, temperaturas y slip ampliados en una distribución compacta que deja más altura al video.

La vuelta de referencia se elige en el selector de Al volante: ofrece todas en Todo el recorrido, y solo las seleccionadas en comparación. En Todo el recorrido salta al inicio de la vuelta y sigue la vuelta reproducida; al comparar conserva la distancia cuando existe cobertura. El menú de videos conserva únicamente la elección de los dos videos. Recorrido muestra velocidad y distancia en tarjetas separadas del mismo tamaño que el instante de sesión.

En Todo el recorrido, las trazas de telemetría y la barra de reproducción comparten los colores de vuelta del mapa. Los segmentos conservan el eje de tiempo de sesión y los cortes de datos originales. Hover en la barra identifica vuelta, duración del tramo registrado (parcial cuando corresponde) e instante de sesión; el arrastre y el clic mantienen la navegación sincronizada. La comparación por distancia conserva su barra habitual.


### Sesiones portables .vrtx

VertexLab exporta una sesión finalizada desde el engranaje de análisis → **Exportar sesión .vrtx**. El navegador descarga un único archivo con el video original, todas las muestras de telemetría, la sincronización de OBS (incluidas pausas), la información del vehículo y el estado del análisis. No incluye contraseñas ni configuración de OBS. El video no se recodifica.

En otro equipo que ejecute esta versión de VertexLab, abre el selector de sesiones → **Importar sesión .vrtx**. Se crea una sesión nueva, con video copiado al almacenamiento local y rutas reconstruidas para ese equipo. Importar otra vez no sobrescribe grabaciones. Las sesiones sin video siguen siendo exportables, exclusivamente con sus datos; si existe un video asociado pero falta en disco, la exportación se rechaza para evitar un paquete incompleto.

Se restauran las vueltas seleccionadas, referencia, los dos videos de comparación, instante observado, zoom y ventana de gráficas, vista del mapa, parámetro expandido, posición de las gráficas, velocidad y volumen. La reproducción se abre pausada. El desplazamiento del mapa se guarda proporcionalmente al tamaño de su contenedor para adaptarlo a otra pantalla. Los nombres y emblemas siguen usando el catálogo de la versión instalada.

El formato v1 es un ZIP64 con `manifest.json`, `session.json`, `view.json`, `telemetry.jsonl` y, si existe, `video.<extensión>`. El manifiesto contiene tamaños y SHA-256 de cada componente. Se validan integridad, nombres exactos, versión, espacio libre, muestras y sincronización antes de publicar la sesión. No se extraen rutas del ZIP ni se usan rutas de video suministradas en sus metadatos. El límite del paquete es 256 GiB, con telemetría de hasta 4 GiB. El empaquetado, subida local e importación usan bloques sin cargar el video entero en RAM; la exportación temporal necesita espacio adicional en disco y caduca a los 30 minutos si no se descarga.

El archivo portable permite trasladar una sesión entre equipos y abrirla en el visor web, también desde teléfonos. La reproducción depende de que el navegador admita el códec original.

La carpeta del repositorio se conserva en su ubicación actual para mantener accesos existentes. El nombre visible es VertexLab. Se admite `VERTEXLAB_OBS_PASSWORD` y, por compatibilidad, `RACELAB_OBS_PASSWORD`.

Las luces de RPM reinician un barrido visual de 220 ms desde cero al detectar cambios de marcha, tanto ascendentes como descendentes, en LIVE y durante reproducción. El destino sigue las RPM reales; los números, telemetría y sincronización no cambian. No se dispara al buscar puntos con la sesión pausada ni al cambiar de vehículo. Se respeta la preferencia de reducir movimiento.


### Visor web para computadora y teléfono

Disponible en https://sebaxg86.github.io/VertexLab/ . Exporta el `.vrtx` en la PC, cópialo al dispositivo y pulsa **Abrir archivo .vrtx** en el visor. No necesita Python, OBS ni que la PC siga encendida. El archivo se procesa en el dispositivo: no se suben grabaciones al sitio ni a GitHub. Conserva la interfaz de análisis, vueltas, comparación de dos videos y sincronización por tramos. La captura LIVE y el control de OBS permanecen en la aplicación local de Windows.

La biblioteca web persiste en el dispositivo cuando está activado el guardado en Almacenamiento de sesiones. Las aperturas temporales solo viven en la pestaña. **Cerrar sesión de esta pestaña** libera sus recursos sin borrar el original. Además se puede iniciar sesión con una cuenta VertexLab, vincular Google Drive y reproducir desde la nube las grabaciones sincronizadas.

El visor incluye manifiesto instalable y caché sin conexión: después de una primera visita completa puede abrirse sin servidor. El sistema operativo puede eliminar esa caché; guarda siempre tus archivos originales. No almacena los videos en la caché. El diseño se verificó en Chromium con tamaños de escritorio y teléfono; queda pendiente probar en dispositivos Android/iPhone físicos. El navegador debe admitir el codec del video original: el visor no convierte formatos.

Para proteger la memoria del teléfono, el lector web limita la telemetría a 128 MiB y 250 000 muestras, y el paquete a 256 GiB. Valida SHA-256 y CRC antes de abrir; esa primera lectura tarda según el tamaño del video. Usa un Worker y una porción del archivo original para reproducir el video sin descomprimirlo entero en memoria. Admite el video sin compresión ZIP que genera el exportador de VertexLab.

Construcción local: `python tools/build_viewer.py`, seguido de `python -m http.server 8770 --directory _site`. Abre `http://localhost:8770`; no abras el HTML mediante `file://`. El directorio `_site` contiene solo código, catálogos y recursos públicos. El flujo de GitHub Actions publica ese resultado en Pages con cada actualización de `main`.


### Biblioteca local y video fijo en móvil

El engranaje **Almacenamiento de sesiones** aparece también sin una sesión abierta. Permite guardar automáticamente las sesiones importadas o abrirlas temporalmente, consultar la cuota y solicitar almacenamiento persistente. En navegadores con `showDirectoryPicker` permite escoger una carpeta de destino; los paquetes se guardan con identificador único y extensión `.vrtx`. Cambiar la carpeta afecta las próximas importaciones, sin mover las anteriores. La biblioteca conserva la referencia a cada ubicación y vuelve a pedir permiso de lectura cuando el navegador lo exige.

En Safari/iPhone y otros navegadores sin selector de carpeta se usa almacenamiento privado del sitio (OPFS cuando puede escribir archivos; IndexedDB como alternativa). No es una carpeta visible en Archivos. El índice, las preferencias y las estrellas locales persisten en IndexedDB; la telemetría se lee al seleccionar cada sesión, sin cargar todas las grabaciones al iniciar. Quitar de la biblioteca conserva el paquete guardado; no libera ese espacio. Borrar datos del sitio o la expulsión de almacenamiento del navegador puede eliminar las copias privadas: conserva siempre el original. Las sesiones sincronizadas con Drive están disponibles al iniciar sesión con la misma cuenta VertexLab.

En pantallas de hasta 600 px el video permanece arriba, debajo del header, mientras se exploran las gráficas y el recorrido. Conserva los mismos elementos de video, reproducción y sincronización, sin recrearlos al desplazar.

El lector de paquetes usa lecturas por rangos y `FileReaderSync` en el Worker cuando está disponible, en lugar del streaming de Blob. Reintenta errores transitorios de lectura y conserva la validación de tamaños, SHA-256 y CRC. Si Archivos/iCloud no puede proporcionar el archivo, indica descargarlo completamente y copiarlo a **En mi iPhone**. La corrección tiene pruebas automatizadas; su confirmación con el archivo y iPhone del usuario está pendiente.


Para errores de lectura de archivos grandes en el Worker de Safari, el visor reintenta automáticamente con un puente de lectura: el hilo principal lee rangos pequeños con FileReader y transfiere los bloques al Worker, donde siguen verificándose y analizándose. No se carga el archivo completo en RAM. Se verificaron posiciones superiores a 2 GiB y la lectura integral de un paquete a través del puente. Caso reportado pendiente de confirmar en hardware: iOS 26, app web instalada desde Safari y paquete local de 2.8 GB.


### Reproducción local en iPhone y memoria

En iPhone/iPad el visor activa por defecto **Reproducir video por fragmentos locales** y desactiva **Permitir dos videos simultáneos**. Ambas opciones están en Almacenamiento de sesiones y se aplican al reabrir la sesión. La comparación de telemetría conserva todas las vueltas. El segundo decodificador no carga una fuente mientras está desactivado.

El video se sirve mediante una ruta virtual `__vertex_media/<id>/video` interceptada por el Service Worker: no se envía a GitHub ni a ningún servidor. Responde a GET/HEAD y rangos HTTP con 206/416 y tamaños exactos. Lee bloques de hasta 256 KiB con FileReader en la página y transfiere solo esos bloques al Service Worker, sin clonar el archivo grande ni crear un Blob de video para el decodificador. Si se reinicia el Service Worker, recupera los metadatos de la biblioteca y vuelve a pedir los bloques a la pestaña que reproduce. Las sesiones temporales requieren reabrirse si el Service Worker pierde su registro. Es necesario cerrar y reabrir todas las ventanas al actualizar desde una versión sin esta ruta.

El reproductor mantiene una sola petición play pendiente por video, ignora AbortError de búsquedas interrumpidas y diferencia fallos de permisos, contenedor y decodificación. Un error de video no bloquea la exploración de telemetría. Los MP4 H.264/AAC siguen siendo el formato recomendado; esto no recodifica archivos incompatibles.

La vista Todo el recorrido comparte las muestras originales para los instrumentos y conserva únicamente una proyección de los campos de las gráficas, evitando duplicar todos los datos de cada muestra. Al cambiar entre sesiones guardadas libera la anterior de la memoria; no modifica sus archivos.

Validación: pruebas de rangos por encima de 2 GiB, cortes exactos del ZIP, HEAD/206/416, cancelación, recuperación del Service Worker y control de play; prueba en navegador de reproducción desde la ruta local. Sigue pendiente confirmar el comportamiento y la memoria con el iPhone físico y su sesión local de 2.8 GB.


### Reloj de reproducción y cortes periódicos

Con video sincronizado, el primer video (el que tiene audio) marca el reloj de sesión. Las gráficas y el mapa siguen la marca temporal del fotograma presentado mediante requestVideoFrameCallback y las referencias reales de OBS; si el navegador no ofrece esa API, se utiliza currentTime. Al esperar datos o buscar un punto no acumulan tiempo independiente que obligue a saltar el video para alcanzarlo. En comparación, cada vuelta usa el tiempo transcurrido desde su inicio, reconstruido con el cronómetro de vuelta del primer paquete. Ambos videos mantienen la velocidad elegida, sin adaptar el segundo a la distancia del primero. Los saltos explícitos del usuario y los cortes reales entre segmentos de OBS siguen aplicándose.

Las secciones sin video o con error conservan el reloj de telemetría. No se reinicia un video que ya terminó. Se verificaron relojes con renderizado irregular y buffering repetido, pausas OBS y referencias de vueltas diferentes. Validación física de los tirones reportados en iPhone pendiente.

### Enfoque táctil en teléfonos

En pantallas de hasta 600 px, un toque enfoca Telemetría, Recorrido o el reproductor. El video permanece visible y el fondo se desenfoca. En Telemetría se puede desplazar la lista sin buscar otro instante; tocar una gráfica la expande y habilita su cursor. Listo o Escape cierra el enfoque. Recorrido conserva controles de zoom y arrastre dentro del enfoque. La barra de reproducción deja espacio sobre el área de gestos del sistema y se amplía al enfocarla, con respuesta visual durante el arrastre. La fila de vueltas admite desplazamiento horizontal y bloquea el vertical. El zoom de página se desactiva para esta experiencia; los controles propios de gráficas y mapa siguen disponibles. El almacenamiento del visor se abre desde el único engranaje de configuración.

Estos cambios requieren comprobación de gestos en iPhone físico; la simulación de tamaño móvil en Chrome no reproduce la navegación de Safari ni todos los gestos del sistema.

El reproductor enfocado se centra en el espacio libre bajo el video y vuelve a su posición compacta mediante una transición de posición y tamaño. Se cierra tocando el fondo oscuro; no muestra Listo. Mantener pulsada la línea de tiempo compacta enfoca y busca la proporción señalada; dentro del enfoque, pulsar cualquier punto permite buscar y arrastrar directamente, sin acertar a la perilla. La captura del puntero conserva el gesto aunque el dedo salga de la línea. La navegación de escritorio conserva el control nativo.

Al reabrir una sesión de la biblioteca, el visor lee el paquete mediante rangos desde el hilo principal, evitando transferir el File grande al Worker. Si una apertura directa falla con «End of central directory not found», reintenta una vez mediante ese puente y mantiene la validación ZIP/SHA-256. Al guardar comprueba la longitud de cada bloque y compara tamaño y últimos 65 557 bytes de la copia antes de registrar la sesión; al reabrir comprueba que el tamaño siga coincidiendo. Una copia realmente incompleta requiere volver a importar el original; los errores no borran las sesiones ya guardadas. Verificado con pruebas de copia truncada, final alterado y posiciones mayores a 2 GiB, recuperación del Worker y guardado/recarga/reapertura en navegador. La causa concreta del error en el teléfono reportado sigue pendiente de confirmar allí.

Al iniciar la reproducción antes de la primera cobertura de video, se avanza al primer instante sincronizado disponible. Las muestras anteriores se conservan y pueden explorarse en pausa; no se inventan fotogramas. Un desfase comprobado en una grabación se corrige con el ajuste de esa sesión, sin aplicar una compensación global a otras grabaciones.

### Referencias de captura OBS

Las grabaciones nuevas, tanto automáticas como manuales, toman cinco lecturas breves del contador de video al iniciar y reanudar. Se conserva la referencia más fresca teniendo en cuenta el tiempo de ida y vuelta, junto con las observaciones para diagnóstico. La cobertura empieza donde los fotogramas confirmados permiten reconstruir el inicio, en lugar de descartar todo lo anterior a la respuesta de OBS. Tras una pausa se utiliza solo el incremento desde el contador confirmado en esa pausa, nunca la duración acumulada completa.

OBS calcula outputDuration con fotogramas de salida codificados. Estas referencias reducen la dependencia de una lectura aislada, pero no miden el retraso entre la imagen del juego, su captura y su codificación. uncertainty representa únicamente la incertidumbre de comunicación de la lectura elegida; no es una garantía de precisión visual. La sincronización sigue marcada como estimada y no se aplica el ajuste particular de una sesión a las demás. Una comprobación física con una carrera nueva y una pausa sigue siendo necesaria para medir el resultado en cada equipo. Reiniciar el servidor local activa estos cambios de captura; recargar el navegador por sí solo no actualiza el proceso Python.

La comparación de vueltas alinea gráficas y marcadores por tiempo transcurrido. El cursor mueve ambas vueltas al mismo tiempo relativo; los clics sobre trazadas o gráficas conservan ese criterio. El transporte llega hasta la vuelta seleccionada más larga. Fuera de la cobertura de una vuelta se muestra la ausencia de datos, sin repetir muestras ni extender su video a la siguiente vuelta. El zoom antiguo de gráficas por distancia se descarta al restaurar vistas portables anteriores.


## VertexLab + VertexConnect para Windows

VertexConnect recibe UDP, controla OBS y sirve la interfaz de análisis en la PC. La captura y el análisis local funcionan sin internet. El visor de GitHub Pages puede abrir archivos portables o reproducir las sesiones sincronizadas con Drive mediante la misma cuenta VertexLab.

El primer arranque abre un asistente Forza → OBS o solo telemetría → Todo listo. Continuar exige paquetes válidos recientes en el primer paso; el segundo exige una conexión OBS comprobada o la casilla explícita de solo telemetría. No se graba durante la configuración inicial. El puerto UDP predeterminado es 5301 y la interfaz local de Connect usa http://127.0.0.1:8766. El antiguo start.cmd usa 8765: no deben ejecutarse simultáneamente sobre el mismo puerto UDP. Si hay conflicto, el asistente permite liberar el puerto y reintentar Aplicar, o elegir otro puerto y configurarlo también en Forza.

Después de configurar, el acceso directo VertexLab abre el panel rápido de VertexConnect sin repetir el asistente ni exigir que el juego ya esté abierto. Desde Abrir VertexLab se entra a la app local. Connect queda en la bandeja: Abrir VertexLab, Configurar conexiones y Salir. Cerrar la ventana no finaliza el servicio; Salir está bloqueado mientras hay una sesión abierta o una grabación OBS pendiente. No controla grabaciones iniciadas por el usuario fuera de VertexLab.

La configuración se guarda en %LOCALAPPDATA%/VertexLab/connect.json. La contraseña OBS se guarda cifrada con Windows DPAPI para la cuenta actual y no se devuelve en la API. La carpeta de sesiones se elige en el asistente; cambiarla no mueve ni borra archivos. Una instalación nueva propone Documents/VertexLab/Sessions. En desarrollo se conserva data/ del repositorio. Los archivos de sesión están fuera de la instalación y no se eliminan al desinstalar. La configuración de OBS se restaura al abrir; si no responde, la captura con video queda pendiente y se puede revisar desde Connect. No se aplica un ajuste visual universal de sincronización.

Para desarrollo: instala requirements-desktop.txt en el entorno virtual y abre start-connect.cmd. Requiere Windows de 64 bits con Microsoft Edge WebView2 Runtime. Para generar el ejecutable: python tools/build_desktop.py. Para generar el instalador con Inno Setup: ISCC.exe installer/VertexLab.iss. El resultado es dist/installer/VertexLab-Setup-0.2.13.exe; el ejecutable portable y sus recursos están en dist/VertexConnect/ y deben conservarse juntos. El flujo manual Build VertexLab for Windows de GitHub Actions produce los mismos artefactos. El instalador es por usuario y no requiere administrador. Esta primera distribución no tiene firma de código ni actualización automática.

El servicio admite --headless, --port y --config para comprobaciones aisladas. Las pruebas cubren el bloqueo de pasos, credenciales DPAPI, persistencia, conflicto y recuperación UDP, captura solo telemetría, cambio de carpeta sin pérdida de sesiones y acceso HTTP con rechazo de origen externo. El asistente se comprobó con paquetes de prueba en un puerto separado; la prueba de una carrera real con OBS en esta distribución debe hacerse después de configurar el equipo.


## Home de VertexLab

Cada apertura entra en Home, aunque la URL anterior apunte a LIVE o a una sesión. El logo permite volver al inicio desde el análisis o LIVE. La mitad izquierda indica LIVE / OFFLINE según la señal del juego en la PC de captura y ofrece LIVE DEMO en el visor público. La mitad derecha muestra la biblioteca con trazadas, emblemas, favoritos, importación `.vrtx` e indicadores separados de disponibilidad local y en la nube.

La biblioteca solicita bloques de 12 a /api/library?offset=0&limit=12 (máximo 48), sin leer el video ni todas las muestras de análisis. El servidor calcula miniaturas solo para la página solicitada; el navegador mantiene únicamente las filas visibles y un margen de tres por lado. El selector del header carga más sesiones cuando se desplaza hasta el final. Marcar favorito en el visor modifica solo sus metadatos guardados; no requiere abrir el archivo completo.

El menú de cada sesión ofrece acciones según su disponibilidad local y en Drive, como sincronizar, descargar o eliminar una copia. Los borrados requieren confirmación. La captura local protege sesiones activas, archivos compartidos y archivos bloqueados. El visor elimina su copia administrada y conserva el archivo `.vrtx` original importado. Si falla un borrado en Drive, se conserva la copia local.


El scroll de la biblioteca conserva los nodos de las filas que siguen visibles, sin repetir animaciones de entrada. La rueda avanza por filas y al terminar un desplazamiento con teclado, barra o tacto se alinea el borde superior a una fila completa; el borde inferior puede cortar la última. El acceso desde Home a LIVE usa una transición breve que respeta movimiento reducido.

El selector del header es Acceso rápido, tiene el mismo ancho que su disparador e incluye los iconos de disponibilidad de la biblioteca, sin controles de gestión ni importación. En LIVE no repite el acceso a LIVE. En análisis ese acceso conserva su indicador rojo estático y el fondo verde respira solo cuando hay señal real. La configuración de LIVE contiene detección automática y Abrir VertexConnect. El análisis ofrece Destacar, Exportar y acciones de almacenamiento según la disponibilidad de la sesión. La importación se gestiona desde la biblioteca.

La captura manual se abre desde Grabación Manual en el centro del header de LIVE. El nombre es opcional; REC abre una confirmación antes de iniciar. Durante la captura aparecen Detener y el tiempo transcurrido. La detección automática se indica a la derecha y se configura desde el engranaje.

Las etiquetas de clase comparten el mismo diseño en Home, LIVE, biblioteca y análisis. FH6 usa D, C, B, A, S1, S2, R y X (Data Out 0–7); también se acepta X con ID 6 y 999 puntos para emisores compatibles. Referencias: https://support.forza.net/hc/en-us/articles/51744149102611-Forza-Horizon-6-Data-Out-Documentation y https://github.com/SkoiZz94/ForzaHorizon6-Overlay/blob/main/GUIDE.md .

VertexConnect usa una ventana fija de 740 × 540, sin barra nativa de título ni maximización. Se centra en el área útil del último monitor disponible; la preferencia del monitor se guarda en window.json junto a connect.json. La primera apertura muestra el asistente de tres pasos; después se abre el panel rápido con Forza, OBS, carpeta de sesiones y detección automática. La X cierra la ventana a la bandeja; Salir de VertexConnect en la bandeja detiene el servicio cuando no hay una grabación en curso. El botón Minimizar conserva la ventana en la barra de tareas.

El panel rápido de Connect muestra estados independientes de Forza y OBS, un resumen de preparación, ayuda contextual y campos de conexión uniformes. Los puertos confirmados se conservan incluso si OBS está desconectado al aplicar su puerto. La selección de solo telemetría se guarda sin exigir conectar OBS. El estado de OBS se comprueba con una consulta de lectura cada dos segundos, con un tiempo de espera acotado.


El instalador muestra bienvenida, selección de carpeta, instalación y cierre con opciones de crear acceso directo e iniciar VertexConnect. Bienvenida y cierre reservan exactamente la mitad izquierda para ilustraciones distintas. Cada área mide 298 × 386 px al 100 % de escala de Windows: preparar dos imágenes verticales de **1192 × 1544 px**, PNG, con la misma proporción. Al escalar Windows se conserva la composición. Las imágenes y los iconos originales están en assets/branding; tools/prepare_branding.py genera los formatos del navegador, Windows y el instalador conservando el encuadre original.


La desinstalación elimina los archivos instalados y limpia ajustes conocidos y caché de WebView. Exige cerrar VertexConnect para no interrumpir capturas. Conserva las carpetas de sesiones, videos, archivos .vrtx, bases de biblioteca antiguas, respaldos y archivos desconocidos. Si la caché contiene grabaciones, coincide con la biblioteca o la configuración está dañada, se conserva por seguridad. Al reinstalar se muestra la configuración inicial; selecciona la carpeta anterior para recuperar la biblioteca.


En Home, Importar ofrece .vrtx individual o un ZIP con sesiones .vrtx completas. Exportar activa casillas y Seleccionar todo consulta toda la biblioteca, independientemente del scroll. Una sesión se descarga como .vrtx; varias se empaquetan como VRTX-Sessions-AAAA-MM-DD.zip con la fecha local. Los nombres duplicados reciben un prefijo y se conserva el video original, sin recomprimirlo. Cada engranaje permite exportar la sesión individual. Límite por lote: 10000 sesiones y 256 GiB. La importación verifica los paquetes y revierte únicamente las copias nuevas si falla un archivo; las sesiones existentes permanecen intactas. El visor estático utiliza los archivos originales de su biblioteca y almacenamiento temporal del dispositivo para el ZIP.


El panel LIVE del Home usa public/live-night-track.webp (65 KB), derivada del original en assets/home/live-night-track.png. La imagen está contenida en una capa CSS independiente, anclada abajo a la derecha, con máscara diagonal, protección fija del texto y transiciones de opacidad, brillo y zoom. No modifica el layout ni el estado de conexión; el zoom se desactiva con movimiento reducido.


Biblioteca comparte las capas y transiciones cinematográficas de LIVE mediante variables CSS, con una intensidad menor y protección adicional de la lista. Su imagen optimizada public/library-night-garage.webp (43 KB) conserva el original en assets/home/library-night-garage.png. El ambiente se ancla al panel y permanece fijo al hacer scroll; hover de filas y controles son independientes.
