import json
import tempfile
import unittest
from pathlib import Path
from connect_window import centered_bounds, WindowPlacement


class CompactWindowTests(unittest.TestCase):
    def test_compact_window_fits_a_1024_by_600_screen_with_taskbar(self):
        self.assertEqual(centered_bounds((0, 0, 1024, 560)), (142, 10, 740, 540))

    def test_window_centers_on_negative_coordinate_and_scaled_monitors(self):
        self.assertEqual(centered_bounds((-1920, 0, 0, 1048)), (-1330, 254, 740, 540))
        self.assertEqual(centered_bounds((1920, 0, 4480, 1400), 1.5), (2645, 295, 1110, 810))
        x, y, width, height = centered_bounds((0, 0, 800, 560), 2)
        self.assertGreaterEqual(x, 8)
        self.assertGreaterEqual(y, 8)
        self.assertLessEqual(x+width, 792)
        self.assertLessEqual(y+height, 552)

    def test_missing_or_corrupt_monitor_preference_cannot_block_startup(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'window.json'
            self.assertIsNone(WindowPlacement(path).device)
            for invalid in ['bad json', '[]', 'null', '{"monitor":42}']:
                path.write_text(invalid, encoding='utf-8')
                self.assertIsNone(WindowPlacement(path).device)
            path.write_text(json.dumps({'monitor': 'DISPLAY2'}), encoding='utf-8')
            self.assertEqual(WindowPlacement(path).device, 'DISPLAY2')
