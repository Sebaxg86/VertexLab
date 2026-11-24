# VertexLab Desktop — 0.3.2 alpha interna

Aplicación nativa **exclusiva para Windows x64**, escrita en C#/.NET 10 y WPF. No usa navegador, WebView ni un servidor HTTP para su interfaz. El MVP web y Python se conserva en la raíz y en el tag `v0.1.0-mvp`.

## Probar

El instalador generado está en `native/artifacts/VertexLab-0.3.2-alpha.1-win-x64.msi`. Instala para el usuario actual, crea el acceso del menú Inicio y asocia `.vrtx`. Incluye .NET; el equipo de destino no necesita instalar Python, Node ni el SDK. Es una compilación de desarrollo sin firma de distribución. No se ha publicado como release del producto.

También se puede ejecutar `start-native.cmd` o `native/artifacts/app/VertexLab.Desktop.exe`. En configuración se elige el puerto UDP (5301 por defecto), la detección automática y la conexión local con OBS WebSocket v5. La detección automática empieza desactivada en una instalación nueva. Configura Data Out de Forza con IP `127.0.0.1` y el puerto elegido. No ejecutes simultáneamente el MVP y Native sobre el mismo puerto.

Cerrar la ventana **no detiene la captura**. El icono de la bandeja abre otra ventana o cierra el motor cuando no hay una sesión/orden OBS pendiente. Para finalizar, usa Guardar; después puedes cerrar el motor desde configuración o su menú de bandeja. Antes de actualizar o desinstalar, finaliza las grabaciones y cierra el motor.

La contraseña de OBS se transmite exclusivamente por IPC local del usuario y se mantiene en memoria. No se escribe en configuración ni en SQLite. Las grabaciones que OBS ya realiza por su cuenta no se toman ni se detienen. Si una orden Stop falla, se puede reintentar Guardar y asociar la ruta recuperada. Si se pierde la conexión con una grabación pendiente, detén OBS manualmente antes de reconectar.

## Qué incluye esta primera base

- Motor de captura separado con receptor UDP real de 324 bytes, cola acotada y contadores de paquetes rechazados/perdidos.
- Registro manual y automático, pausa por inactividad, reanudación sin sumar la pausa y cierre por regreso confirmado a manejo libre/cambio de evento.
- Control OBS v5 con autenticación, comprobación del estado real y referencias temporales por tramos.
- Biblioteca SQLite con WAL y metadatos JSON; filas JSONL compatibles con el MVP. Se vacían buffers periódicamente y al pausar/finalizar.
- Recuperación de sesiones interrumpidas conservando filas completas. No garantiza recuperar el video ni controlar una grabación OBS tras un fallo del proceso.
- Importación de `.vrtx` verificada por SHA-256 y exportación sin recodificar el video; transferencia por bloques. También se puede importar el JSON de una sesión finalizada del MVP, junto a su JSONL. En ese caso se copia la telemetría y el video queda referenciado en su ubicación original.
- Análisis con la distribución racing del MVP: selector superior de sesiones, pestañas de vueltas, video principal y controles flotantes. Todo el recorrido colorea sus segmentos por vuelta; la selección múltiple compara por distancia y permite hasta dos videos simultáneos, con selectores independientes de la vuelta de referencia.
- Tablero nativo Al volante y LIVE ampliado: volante, pedales, fuerzas G, marcha, velocidad, luces RPM progresivas desde los extremos y aviso azul al 88%, temperaturas y deslizamiento de los cuatro neumáticos.
- Siete gráficas con zoom compartido, desplazamiento horizontal, seguimiento durante la reproducción, dos filas visibles y ampliación al pulsar el nombre. Recorrido con zoom bajo el puntero y seguimiento del vehículo; resumen de vueltas y mejor vuelta destacada.
- Sesiones destacadas, miniatura de trazada, emblemas y eliminación confirmada a la papelera. Si otra sesión referencia el mismo video, este se conserva. La configuración de captura/OBS se abre desde el engranaje en LIVE.

## Límites de esta alpha

La experiencia de análisis y LIVE ya se trasladó a controles y dibujos WPF. Quedan para fases posteriores las pantallas dedicadas de gestión de sesiones, el inicio de sesión, ajustes de ubicación desde la interfaz, accesibilidad completa, medición de rendimiento bajo carga del juego y una estrategia de actualización firmada. La telemetría se lee en segundo plano pero el análisis conserva sus muestras en memoria; el almacenamiento indexado por bloques llegará después. Las geometrías de gráficas se reducen por píxel y se conservan mientras se mueve el cursor.

La reproducción usa MediaElement de WPF y depende de los codecs disponibles en Windows. La versión de prueba abrió la grabación real H.264/AAC de unos 2.8 GB. No hay garantía de decodificación por hardware en todos los equipos. La sincronización OBS sigue siendo estimada, sin garantía de un fotograma.

La recuperación tolera una última fila incompleta; una fila dañada antes del final provoca un error visible. No inventa ni rellena muestras perdidas.

## Cuenta y nube

Esta es una **compilación interna local**. No simula un login ni una cuenta. SQLite reserva `owner_id` y `sync_state=LocalOnly`; el contrato de cuentas se implementará antes de distribuir el producto con acceso obligatorio.

La biblioteca central, autenticación, autorización sin conexión y Google Drive todavía no están implementados. El visor web permanece independiente. La compatibilidad `.vrtx` permite intercambiar sesiones durante la transición.

## Datos

Por defecto: `%LOCALAPPDATA%/VertexLab/` con `library.db`, `settings.json` y `sessions/`. El instalador no incluye ni elimina grabaciones personales. El video de OBS sigue en la carpeta configurada en OBS. La variable `VERTEXLAB_DATA` permite aislar una biblioteca de desarrollo o prueba. El canal de Named Pipes depende de esa ubicación y solo acepta al usuario actual.

## Desarrollar y verificar

Windows, SDK .NET 10 y Node 22 para la prueba cruzada con el lector web. Python solo se necesita al generar el XML del instalador. WiX 4.0.6 se instala en `native/.tools`, no globalmente.

```powershell
dotnet build native/VertexLab.sln
dotnet test native/VertexLab.sln -c Release
./native/tools/build.ps1
./native/tools/smoke.ps1
```

El workflow `Native Windows Preview` compila, prueba, empaqueta y ejecuta la prueba UDP/IPC en Windows. Sube el MSI como artifact de Actions; no cambia GitHub Pages.

## Arquitectura

- `VertexLab.Core`: modelos, decodificación, biblioteca, análisis, `.vrtx`, control OBS e IPC cliente.
- `VertexLab.Capture`: proceso WinForms sin ventana principal, bandeja, receptor UDP y actor serializado de captura.
- `VertexLab.Desktop`: WPF, reproducción local, visualizaciones e interacción. Se conecta al motor mediante Named Pipes.
- `VertexLab.Tests`: protocolo, ciclo de captura, sincronización, recuperación, integridad y compatibilidad con el lector web.

La captura nunca escribe desde el hilo de la interfaz. La cola está acotada; los descartes se contabilizan. SQLite indexa la biblioteca; los videos no se meten en la base de datos.


### Arrastre y búsqueda de video

Durante el arrastre de la línea de tiempo o de una gráfica se pausa la reproducción y los instrumentos siguen inmediatamente el cursor. Se conserva únicamente el destino más reciente. Mientras el puntero se mueve, la vista previa se actualiza como máximo cada 80 ms, usando siempre el destino más reciente; al soltar se aplica el destino final y, tras un breve margen para el decodificador, se reanuda solo si la sesión estaba reproduciéndose. Los cambios de sesión cancelan búsquedas pendientes. Esto evita acumular órdenes Position/Play y que el reloj del video sobrescriba la posición que se está buscando.

Para construir una actualización sin tocar los ejecutables que estén abiertos: `./native/tools/build.ps1 -OutputRoot native/artifacts/scrub-fix`. La salida contiene su propio directorio app y el MSI; no detiene el motor en ejecución.


La vista previa no espera a que el puntero se detenga: moverse despacio permite ver sucesivos fotogramas con el video pausado. Los eventos más rápidos se agrupan para no saturar el decodificador; al soltar se aplica el punto final sin esperar al siguiente intervalo. La precisión temporal sigue dependiendo de la búsqueda del reproductor y de las referencias OBS; no se declara un modo de edición con exactitud garantizada de un fotograma.


### Comprobación de la interfaz 0.3.0

Se comprobó con una copia aislada de la sesión real Toyota GR86 (10 vueltas, 17 minutos y video H.264/AAC de aproximadamente 2.8 GB): apertura, búsqueda, comparación de vueltas 3 y 5 con ambos videos, reproducción hasta el final de la vuelta, arrastre pausado, desplazamiento de gráficas por una fila y ampliación. Las pruebas nativas son 23; incluyen límites de comparación por distancia, exclusión de vueltas parciales para la mejor vuelta y los casos de arrastre previos. La prueba UDP/IPC del paquete recibió 40 muestras, sin descartes, y excluyó la pausa del reloj. No se ha medido todavía bajo la carga simultánea de una carrera y OBS en este cambio.


### Acabado visual 0.3.1

Los instrumentos usan los mismos trazos SVG, colores y escalas de temperatura que el MVP web. El color del neumático interpola durante 150 ms; slip, dirección, G y pedales durante 70 ms; la alerta de deslizamiento cambia fondo y borde durante 100 ms. Las cifras siempre salen directamente de la muestra observada. Las transiciones visuales no suavizan, rellenan ni cambian los datos almacenados.

El tablero se distribuye en píxeles disponibles, conservando las medidas tipográficas del original en lugar de reducir juntos texto y dibujos dentro de un lienzo. El motor permanece centrado. Se añadieron estados hover progresivos, scroll animado con ajuste por fila, subrayados, brillo de LED, iconos vectoriales de reproducción y el indicador de carga del MVP. La captura y el coordinador de arrastre de video se conservan.


### Interacción de editor 0.3.2

La barra de reproducción es un único control de segmentos de vuelta y cabezal. Captura el puntero desde cualquier punto, permite arrastrar y previsualizar y conserva el coordinador de búsqueda a 80 ms. Admite teclado y RangeValue de accesibilidad.

El zoom de las gráficas usa una ventana compartida por tiempo o distancia. La barra representa el ancho real del tramo visible. El zoom de la barra de herramientas centra el cabezal; la reproducción sigue de forma continua. El desplazamiento manual separa temporalmente la ventana del seguimiento y no cambia el instante del video. Buscar, volver a reproducir o pulsar zoom al cursor recupera el seguimiento. El arrastre sobre una gráfica conserva su ventana hasta soltar.

Las trazadas se conservan en una capa visual independiente. Los movimientos del mouse se agrupan una vez por cuadro; el mapa consulta un índice de segmentos cercano al puntero en lugar de recorrer todas las muestras. Solo se presentan las gráficas visibles. Desplazar una ventana reutiliza geometrías mientras permanezca dentro de su margen cacheado. Se evita reconstruir las curvas y sus escalas en cada actualización del cursor.

La comprobación con la sesión real de diez vueltas incluyó tres vueltas seleccionadas y dos videos. En la medición local de CPU de la presentación, el percentil 95 fue aproximadamente 0.073 ms por gráfica y 0.016 ms para el mapa. Son tiempos de preparación de esas capas, no una medición de latencia del video ni una garantía de FPS bajo la carga del juego. El video original y la decodificación observada fueron 1920×1080; se activa el escalado de mayor calidad y el video no se incluye en transiciones de opacidad o desenfoque.

El selector de referencia está alineado a la derecha de Al volante. Los indicadores del recorrido comparten el estilo de su etiqueta temporal. El header calcula el espacio del nombre y permite envolver nombres largos; el botón para ver más vueltas aparece solo cuando hay contenido a la derecha. Las pruebas nativas suman 30, incluyendo desplazamiento/seguimiento/zoom y búsqueda local en trazadas extensas y con huecos.

También se reutilizan pinceles, geometrías, gradientes y textos de los instrumentos para limitar asignaciones durante la reproducción. La posición del video principal se consulta una vez por actualización; el control de deriva del segundo video se limita a diez comprobaciones por segundo. Estas optimizaciones no modifican los archivos ni las referencias temporales guardadas.
