"""Compact companion geometry and last-monitor persistence (Windows only)."""
import ctypes
import json
import os
from ctypes import wintypes
from pathlib import Path

WIDTH, HEIGHT = 740, 540


def centered_bounds(work, scale=1):
    left, top, right, bottom = work
    width = min(round(WIDTH * scale), max(1, right-left-16))
    height = min(round(HEIGHT * scale), max(1, bottom-top-16))
    return left+(right-left-width)//2, top+(bottom-top-height)//2, width, height


class WindowPlacement:
    def __init__(self, path):
        self.path = Path(path)
        self.device = None
        try:
            saved = json.loads(self.path.read_text(encoding='utf-8'))
            if isinstance(saved, dict) and isinstance(saved.get('monitor'), str):
                self.device = saved['monitor']
        except (OSError, ValueError, TypeError):
            pass

    def _api(self):
        user = ctypes.WinDLL('user32', use_last_error=True)
        user.MonitorFromWindow.argtypes = [wintypes.HWND, wintypes.DWORD]
        user.MonitorFromWindow.restype = wintypes.HANDLE
        user.GetMonitorInfoW.argtypes = [wintypes.HANDLE, ctypes.c_void_p]
        user.IsIconic.argtypes = [wintypes.HWND]
        user.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT]
        return user

    def _info(self, user, monitor):
        class Info(ctypes.Structure):
            _fields_ = [('size', wintypes.DWORD), ('monitor', wintypes.RECT),
                        ('work', wintypes.RECT), ('flags', wintypes.DWORD),
                        ('device', wintypes.WCHAR * 32)]
        info = Info()
        info.size = ctypes.sizeof(info)
        if not user.GetMonitorInfoW(monitor, ctypes.byref(info)):
            raise OSError('No se pudo obtener la pantalla de VertexConnect')
        return info

    def remember(self, window, *_):
        if os.name != 'nt' or not window.native:
            return
        user = self._api()
        hwnd = window.native.Handle.ToInt64()
        if user.IsIconic(hwnd):
            return
        info = self._info(user, user.MonitorFromWindow(hwnd, 2))
        if info.device != self.device:
            self.device = info.device
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(json.dumps({'monitor': self.device}), encoding='utf-8')

    def center(self, window, *_):
        if os.name != 'nt' or not window.native:
            return
        user = self._api()
        hwnd = window.native.Handle.ToInt64()
        monitor = user.MonitorFromWindow(hwnd, 2)
        if self.device:
            matches = []
            callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HANDLE, wintypes.HDC, ctypes.POINTER(wintypes.RECT), wintypes.LPARAM)
            def visit(handle, dc, rect, data):
                if self._info(user, handle).device == self.device:
                    matches.append(handle)
                return True
            callback = callback_type(visit)
            user.EnumDisplayMonitors.argtypes = [wintypes.HDC, ctypes.c_void_p, callback_type, wintypes.LPARAM]
            user.EnumDisplayMonitors(None, None, callback, 0)
            if matches:
                monitor = matches[0]
        info = self._info(user, monitor)
        dpi_x, dpi_y = wintypes.UINT(96), wintypes.UINT(96)
        try:
            shcore = ctypes.WinDLL('shcore')
            shcore.GetDpiForMonitor.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.POINTER(wintypes.UINT), ctypes.POINTER(wintypes.UINT)]
            shcore.GetDpiForMonitor(monitor, 0, ctypes.byref(dpi_x), ctypes.byref(dpi_y))
        except OSError:
            pass
        work = info.work
        x, y, width, height = centered_bounds((work.left, work.top, work.right, work.bottom), dpi_x.value/96)
        # No SHOWWINDOW flag: centering must not reveal a hidden companion.
        user.SetWindowPos(hwnd, None, x, y, width, height, 0x0004 | 0x0010)
        self.remember(window)
