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
ver `THIRD_PARTY_NOTICES.md`. La implementación de RaceLab es independiente.

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
a OFF LIVE; no conserva lecturas viejas como si fueran actuales. La antigüedad
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
