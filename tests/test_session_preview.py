import json
import tempfile
import unittest
from pathlib import Path
from session_preview import second_lap_preview

class PreviewTests(unittest.TestCase):
    def render(self, rows, manual=False):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'session.jsonl'
            path.write_text(''.join(json.dumps(row)+'\n' for row in rows),encoding='utf-8')
            return second_lap_preview(path, manual=manual)
    def row(self, lap, stamp, x, z, **extra):
        return dict(lap=lap,timestamp=stamp,t=stamp*.01,x=x,z=z,**extra)
    def test_only_second_recorded_lap_is_drawn(self):
        rows=[self.row(4,1,999,999),self.row(4,2,1000,1000),self.row(5,3,0,0),self.row(5,4,10,10),self.row(5,5,20,0),self.row(6,6,-999,-999)]
        preview=self.render(rows)
        self.assertEqual(preview['lap'],6)
        self.assertFalse(preview['partial'])
        self.assertEqual(preview['path'],'M8.00,52.00 L48.00,12.00 L88.00,52.00')
    def test_single_lap_and_stationary_second_lap_have_no_invented_map(self):
        self.assertEqual(self.render([self.row(0,1,0,0),self.row(0,2,10,10)])['recordedLap'],1)
        self.assertIsNone(self.render([self.row(0,1,0,0),self.row(1,2,5,5),self.row(1,3,5,5)]))
    def test_gaps_break_route_and_unfinished_second_lap_is_partial(self):
        preview=self.render([self.row(0,1,0,0),self.row(1,2,0,0),self.row(1,3,10,10),self.row(1,4,20,0,breakBefore=True)])
        self.assertTrue(preview['partial'])
        self.assertEqual(preview['path'].count('M'),2)

    def test_free_session_uses_the_whole_route_even_if_lap_counter_resets(self):
        rows=[self.row(0,1,0,0),self.row(0,2,10,10),self.row(1,3,20,0),self.row(1,4,30,10)]
        preview=self.render(rows, manual=True)
        self.assertEqual(preview['source'],'session')
        self.assertIsNone(preview['lap'])
        self.assertEqual(preview['path'].count('L'),3)
    def test_manual_recording_inside_event_still_prefers_second_lap(self):
        rows=[self.row(0,1,0,0,lapTime=1),self.row(0,2,10,10,lapTime=2),self.row(1,3,20,0,lapTime=1),self.row(1,4,30,10,lapTime=2)]
        self.assertEqual(self.render(rows, manual=True)['recordedLap'],2)
