# VertexLab · Continuar desde otra computadora

Actualizado el 27 de noviembre de 2026. La rama de trabajo es `main`. El repositorio y el producto se llaman **VertexLab**. El trabajo de Gemini y las correcciones posteriores ya están integrados en `main`. La rama `feature/windows-native` conserva el experimento anterior de análisis nativo.

- [Repositorio en GitHub](https://github.com/Sebaxg86/VertexLab)
- [Visor publicado](https://sebaxg86.github.io/VertexLab/)
- [Estado de la publicación en GitHub Pages](https://github.com/Sebaxg86/VertexLab/actions/workflows/pages.yml)

## Retomar el proyecto

Si ya tienes un clon, abre su carpeta y ejecuta `git switch main` y `git pull --ff-only origin main`. Para un clon nuevo:

```sh
git clone https://github.com/Sebaxg86/VertexLab.git
cd VertexLab
```

Usa Python 3.12 y Node.js 22 para coincidir con GitHub Actions. En Windows, VertexConnect usa Microsoft Edge WebView2 Runtime. Una laptop Windows puede ejecutar el flujo completo. En macOS o Linux puedes desarrollar y probar el visor web con los mismos archivos de interfaz.

### Visor web local

```sh
python tools/build_viewer.py
python -m http.server 8770 --directory _site
```

Abre [el visor local](http://localhost:8770/). Si tu sistema usa `python3`, usa ese comando en ambas líneas. Repite la compilación al cambiar los archivos del visor. Para validar el acceso con Google y Drive desde otro equipo, usa el visor publicado o un origen de prueba autorizado en OAuth.

### Captura en Windows

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-desktop.txt
.\start-connect.cmd
```

Abre VertexLab desde la ventana de VertexConnect. El servicio usa `127.0.0.1:8766` por defecto. En Forza configura Data Out a `127.0.0.1`, puerto UDP `5301`. Para capturar video, abre OBS con su servidor WebSocket activado (puerto predeterminado `4455`) y conéctalo en VertexConnect. El asistente también permite grabar solo telemetría. `start.cmd` es el arranque anterior para desarrollo y usa HTTP `8765`. Ejecuta solo una instancia por puerto UDP.

La configuración local de Connect se guarda en `%LOCALAPPDATA%\VertexLab\connect.json`. En una instalación nueva se propone `%USERPROFILE%\Documents\VertexLab\Sessions` para las sesiones. La ruta efectiva se ve en VertexConnect. Para llevar grabaciones a la laptop, abre las sesiones sincronizadas en Drive o exporta desde Biblioteca un `.vrtx` por sesión o un ZIP con varias.

## Arquitectura actual

| Parte | Dónde trabajar |
| --- | --- |
| VertexConnect para Windows | `vertexconnect.py`, `connect_service.py`, `connect_config.py` y `connect_window.py` |
| Data Out, sesiones y OBS | `telemetry.py`, `recorder.py`, `obs_control.py` y `server.py` |
| Home, LIVE y análisis | `public/` contiene la interfaz compartida por VertexConnect y el visor. El visor público tiene LIVE DEMO y análisis, mientras que la telemetría en vivo de tu juego se recibe en la PC de captura. |
| Biblioteca portable | `portable.py`, `public/browser-library.js` y `public/library-transfer.js`. El `.vrtx` conserva telemetría, sincronización, estado del análisis y video original si existe. |
| Cuenta y Drive | `supabase/`, `cloud_sync.py` y `public/cloud-client.js`. Supabase gestiona la cuenta y el índice. La vinculación a Drive es independiente y las sesiones se guardan por componentes en Drive. |
| Streaming | `public/media-service-worker.js`, `public/browser-media.js`, `public/cloud-model.js` y `tools/build_viewer.py`. El visor pide rangos HTTP 206, anticipa hasta dos bloques de Drive y limita la caché en memoria a 24 MiB. |
| Interfaz móvil | `public/home.css`, `public/mobile-focus.js` y `public/browser-runtime.js`. En análisis el video queda arriba al explorar la telemetría. |

La comparación de vueltas usa el tiempo desde el inicio de cada vuelta. El video de referencia marca el reloj de reproducción, así que el mapa y la telemetría conservan la sincronización si el video espera datos. En escritorio se pueden mostrar hasta dos videos simultáneos.

## Estado verificado

- El usuario probó varias sesiones reales desde Drive. Confirmó que la telemetría coincide con el video al buscar, y que en su PC el streaming quedó fluido incluso en doble vista.
- El usuario confirmó reproducción desde Drive en un iPhone físico. Después se publicaron tarjetas de neumáticos más altas con filas fijas para temperatura y slip, flechas SVG en móvil y el centrado del botón «Descargar para Windows». Esos ajustes se verificaron en Chrome con tamaños de móvil.
- Se corrigió la activación del Service Worker eliminando entradas duplicadas en la precarga y versionando sus dependencias. El visor desplegado sirve esos cambios.
- Tras integrar Gemini se reconstruyó localmente el instalador Windows `0.2.13` en el commit `252b8ea`. Los ajustes web posteriores están en `main`. Si necesitas que una instalación de Windows incorpore los cambios recientes, vuelve a compilarla.

## Verificar y publicar

En Windows, desde la raíz y con el entorno de arriba:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -q
node --test tests/*.test.cjs
.\.venv\Scripts\python.exe tools/build_viewer.py
```

El push a `main` publica el visor mediante GitHub Actions. Para generar los archivos de Windows, usa el flujo manual **Build VertexLab for Windows** en GitHub Actions o ejecuta `tools/build_desktop.py` con el Python del entorno y después `ISCC.exe installer\VertexLab.iss` con Inno Setup instalado. Los archivos locales quedan en `dist/VertexConnect/` y `dist/installer/`. El flujo de Windows entrega artefactos de compilación. Publicar un release de Windows es un paso aparte.

Las grabaciones, configuraciones personales, credenciales, entornos virtuales y salidas de compilación se gestionan fuera del historial de Git. La configuración del servicio de Drive está documentada en [Supabase](supabase/README.md). La cuenta y el Drive existentes se reutilizan iniciando sesión, sin copiar credenciales a la laptop.

## Siguiente verificación

1. Reprobar en el iPhone los ajustes visuales más recientes. Registrar por separado qué ocurre en Safari y en la PWA instalada, especialmente al volver del login de Google.
2. Para validar un instalador nuevo de punta a punta, grabar una carrera corta con OBS, comprobar inicio, pausa y final, revisar la sincronización local y abrir esa misma sesión desde Drive.
3. Si se abre el producto al público, revisar el estado de verificación de Google OAuth, el dominio y la política de privacidad antes de cambiar la configuración de producción.
