# VertexLab Desktop — 0.2.0 alpha interna

Aplicación nativa **exclusiva para Windows x64**, escrita en C#/.NET 10 y WPF. No usa navegador, WebView ni un servidor HTTP para su interfaz. El MVP web y Python se conserva en la raíz y en el tag `v0.1.0-mvp`.

## Probar

El instalador generado está en `native/artifacts/VertexLab-0.2.0-alpha.1-win-x64.msi`. Instala para el usuario actual, crea el acceso del menú Inicio y asocia `.vrtx`. Incluye .NET; el equipo de destino no necesita instalar Python, Node ni el SDK. Es una compilación de desarrollo sin firma de distribución. No se ha publicado como release del producto.

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
- Análisis inicial: reproductor nativo, reloj basado en video, línea de tiempo, selección de una vuelta o toda la sesión, gráficas de velocidad/RPM/pedales y mapa con zoom y navegación al pulsar una trazada.
- Instrumentos numéricos de dirección, pedales, G, marcha, RPM, velocidad y temperaturas.

## Límites de esta alpha

No es todavía la migración completa de la interfaz. Falta la comparación avanzada de múltiples vueltas y dos videos, el acabado de instrumentos y accesibilidad, ajustes de ubicación desde la interfaz, diagnósticos y rendimiento bajo carga del juego, y una estrategia de actualización firmada. La telemetría se lee en segundo plano pero el análisis conserva sus muestras en memoria; el almacenamiento indexado por bloques llegará después. Las geometrías de gráficas se reducen por píxel y se conservan mientras se mueve el cursor.

La reproducción usa MediaElement de WPF y depende de los codecs disponibles en Windows. La versión de prueba abrió la grabación real H.264/AAC de unos 2.8 GB. No hay garantía de decodificación por hardware en todos los equipos. La sincronización OBS sigue siendo estimada, sin garantía de un fotograma.

La recuperación tolera una última fila incompleta; una fila dañada antes del final provoca un error visible. No inventa ni rellena muestras perdidas.

## Cuenta y nube

Esta es una **compilación interna local**, identificada así en pantalla. No simula un login ni una cuenta. SQLite reserva `owner_id` y `sync_state=LocalOnly`; el contrato de cuentas se implementará antes de distribuir el producto con acceso obligatorio.

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
