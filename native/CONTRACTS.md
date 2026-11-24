# Contratos de la base nativa

## Identidad y pertenencia

Cada sesión tiene UUID de 128 bits (`id`, 32 caracteres hexadecimales). La importación asigna un identificador local nuevo para evitar sobrescrituras. La base interna reserva `owner_id`, actualmente nulo porque esta compilación no implementa cuentas. En el producto se asignará desde una identidad autenticada del backend; no se aceptará una identidad declarada por el cliente como prueba de pertenencia.

El futuro login será común a Desktop y Web. Captura, cola de subidas y análisis local podrán continuar con una autorización sin conexión según las reglas del producto. No se implementa ni se simula esa autorización en esta alpha.

## Sesión local

SQLite v1 indexa nombres, fechas, duración, archivo de muestras, estado, pertenencia futura y metadatos. JSON contiene metadatos recuperables; JSONL contiene muestras. El video sigue fuera de SQLite. La captura es el único escritor de la sesión activa. El analizador consume sesiones finalizadas y las importaciones producen copias independientes.

`created` y `ended`: segundos Unix UTC. `t`: segundos activos del análisis, excluyendo pausas. `timestamp`: contador original del juego. `breakBefore`: corte de continuidad. No se deduce distancia de un salto de posición. Los valores faltantes de dirección, fuerzas G y neumáticos se muestran sin datos.

`version=2` en metadatos significa sincronización por tramos OBS; no es la versión de la aplicación. Metadatos antiguos sin version usan el reloj heredado y su offset. El formato portable tiene su propia versión (`manifest.version=1`).

Estados locales actuales: recording, paused, Saved, Imported, Interrupted. `sync_state` permanece LocalOnly. Los estados de subida, descarga y conflicto son parte de la siguiente etapa; no se presentan como ya implementados.

## Integridad y sincronización

Se conserva la estimación temporal de OBS con referencias tStart/tEnd/videoStart e incertidumbre de la petición. No existe garantía de sincronización de un fotograma. El video es el reloj de reproducción cuando hay cobertura. Un corte de OBS se salta usando sus anclas; no se introduce ese corte como conducción.

Una grabación de OBS iniciada fuera de VertexLab nunca se controla. Solo las órdenes iniciadas por el motor generan propiedad de grabación. El estado se consulta después de iniciar/pausar/reanudar/detener. Ante desconexión no se supone que OBS haya parado.

## Portabilidad

Se conserva `.vrtx` ZIP/ZIP64: manifest.json, session.json, view.json, telemetry.jsonl y video opcional. Se comprueban lista exacta de entradas, tamaños y SHA-256; los nombres externos no se utilizan como rutas de extracción. La ruta de video de metadatos importados se descarta y se reconstruye localmente. La exportación no incluye rutas privadas de video ni credenciales.

El estado de vista nativo todavía no tiene paridad con el visor web: esta alpha exporta un objeto de vista vacío y abre el análisis nativo completo. Una futura migración versionará ese estado sin cambiar la telemetría original.

## Cuenta y Drive, siguiente etapa

La biblioteca central será la fuente de pertenencia y coordinación. Drive almacenará archivos pesados, separado del acceso a VertexLab. Subir primero archivos completos y verificarlos, y después publicar su disponibilidad. Cada dispositivo tendrá copias locales y una cola de operaciones reanudables. Eliminar una copia local y eliminar la sesión sincronizada serán acciones distintas.

Este documento fija el destino de arquitectura; no declara implementadas cuentas, Drive, backend ni credenciales de producción.
