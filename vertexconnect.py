"""Windows companion: local capture service, setup window and notification area."""
import argparse
import json
import logging
import os
import sys
import threading
import urllib.request
import webbrowser
from pathlib import Path

from connect_window import WindowPlacement, WIDTH, HEIGHT
from connect_config import ConnectConfig, default_sessions_dir
from connect_service import ConnectRuntime
from server import ThreadingHTTPServer, handler_for, ROOT


def main():
    parser = argparse.ArgumentParser(description='VertexLab + VertexConnect')
    parser.add_argument('--port', type=int, default=8766)
    parser.add_argument('--config', type=Path)
    parser.add_argument('--headless', action='store_true', help='Run service only for development and tests')
    parser.add_argument('--uninstall-cleanup', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.uninstall_cleanup:
        from uninstall_cleanup import main as cleanup
        return cleanup()
    config = ConnectConfig(args.config, default_data=default_sessions_dir() if getattr(sys, 'frozen', False) else ROOT/'data')
    config.path.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(filename=config.path.parent/'connect.log', level=logging.INFO,
                        format='%(asctime)s %(levelname)s %(message)s', encoding='utf-8')
    url = f'http://127.0.0.1:{args.port}'
    runtime = None
    try:
        # Bind HTTP before opening UDP/OBS. A second launch cannot create a
        # second recorder or touch the first instance's active recording.
        http = ThreadingHTTPServer(('127.0.0.1', args.port), handler_for(None))
    except OSError:
        try:
            with urllib.request.urlopen(url+'/api/status', timeout=2) as response:
                existing = json.load(response)
            if existing.get('connect', {}).get('product') != 'VertexConnect':
                raise ValueError('El puerto de VertexConnect está ocupado por otro programa')
            if not args.headless:
                native = False
                request = urllib.request.Request(url+'/api/connect/show', data=b'{}', headers={'Content-Type': 'application/json'})
                with urllib.request.urlopen(request, timeout=3) as response:
                    native = json.load(response).get('nativeWindow') is True
                if not native:
                    webbrowser.open(url+'/connect.html')
            return
        except Exception as error:
            show_error(str(error))
            return 1
    try:
        runtime = ConnectRuntime(config)
        http.RequestHandlerClass = handler_for(runtime)
        try:
            runtime.restore()
        except ValueError as error:
            runtime.recorder.auto = False
            runtime.recorder.mode = 'idle'
            runtime.setup_error = str(error)
        service = threading.Thread(target=http.serve_forever, daemon=True)
        service.start()
        if args.headless:
            try:
                service.join()
            except KeyboardInterrupt:
                pass
        else:
            desktop(runtime, config, url)
    except Exception:
        logging.exception('VertexConnect could not start')
        show_error('No se pudo abrir VertexConnect. Revisa connect.log en la carpeta de configuración.')
        return 1
    finally:
        if runtime:
            http.shutdown()
            runtime.close()
        http.server_close()
    return 0


def show_error(message):
    if os.name == 'nt':
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, message, 'VertexConnect', 0x10)
    else:
        print(message, file=sys.stderr)


def confirm_stop_and_quit():
    if os.name == 'nt':
        import ctypes
        # MB_YESNO (0x4) | MB_ICONQUESTION (0x20)
        return ctypes.windll.user32.MessageBoxW(
            None,
            'Hay una sesión activa o en pausa.\n\n¿Finalizarla, guardar el video de OBS y salir de VertexConnect?',
            'VertexConnect',
            0x24,
        ) == 6
    return True


def desktop(runtime, config, url):
    import webview
    import pystray
    from PIL import Image

    if os.name == 'nt':
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID('VertexLab.Connect')

    window = None
    tray = None
    quitting = threading.Event()
    placement = WindowPlacement(config.path.parent/'window.json')

    class Bridge:
        def open_vertexlab(self):
            if not runtime.config.values['complete']:
                raise ValueError('Completa la configuración primero')
            webbrowser.open(url+'/')
            if tray:
                window.hide()

        def minimize_window(self):
            placement.remember(window)
            window.minimize()

        def close_window(self):
            placement.remember(window)
            window.destroy()

        def choose_folder(self):
            paths = window.create_file_dialog(webview.FileDialog.FOLDER)
            return paths[0] if paths else None

    webview.settings['DRAG_REGION_DIRECT_TARGET_ONLY'] = False
    window = webview.create_window('VertexConnect', url+'/connect.html', js_api=Bridge(),
                                   width=WIDTH, height=HEIGHT, x=0, y=0, min_size=(200, 100), resizable=False,
                                   frameless=True, easy_drag=False, hidden=True,
                                   background_color='#09090c')

    def can_quit(_=None):
        with runtime.lock:
            return not runtime.recorder.meta and not runtime.recorder.obs.owned

    def quit_app(*_):
        if not can_quit():
            if not confirm_stop_and_quit():
                return
            try:
                runtime.command('stop', {})
            except Exception as error:
                show_error(f'No se pudo finalizar la sesión en curso: {error}')
                return
            if not can_quit():
                show_error('OBS conserva una grabación pendiente. Detenla o finaliza la sesión en VertexLab antes de salir.')
                return
        quitting.set()
        if tray:
            tray.stop()
        window.destroy()

    def show_settings(*_):
        window.restore()
        placement.center(window)
        window.show()
        try:
            window.evaluate_js("window.dispatchEvent(new Event('vertexconnectshown'))")
        except Exception:
            pass  # The initial page may still be loading.

    runtime.show_window = show_settings

    def on_close():
        if quitting.is_set():
            return True
        if tray:
            window.hide()
            return False
        if not can_quit():
            show_error('Finaliza la sesión antes de cerrar VertexConnect.')
            return False
        return True

    def start_tray():
        nonlocal tray
        image = Image.open(ROOT/'public/vertexlab.ico').convert('RGBA')
        try:
            tray = pystray.Icon('VertexConnect', image, 'VertexConnect · captura local', pystray.Menu(
                pystray.MenuItem('Abrir VertexLab', lambda *_: Bridge().open_vertexlab(),
                                enabled=lambda _: config.values['complete'], default=True),
                pystray.MenuItem('Configurar conexiones', show_settings),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem('Salir de VertexConnect', quit_app)))
            tray.run_detached()
        except Exception:
            logging.exception('Notification icon unavailable; keeping the window open')
            tray = None
        show_settings()

    window.events.before_show += lambda: placement.center(window)
    window.events.moved += lambda *args: placement.remember(window)
    window.events.restored += lambda *args: placement.center(window)
    window.events.closing += on_close
    try:
        webview.start(start_tray, gui='edgechromium', private_mode=False,
                      storage_path=str(config.path.parent/'WebView'), icon=str(ROOT/'public/vertexlab.ico'))
    finally:
        runtime.show_window = None
        if tray:
            tray.stop()


if __name__ == '__main__':
    raise SystemExit(main())
