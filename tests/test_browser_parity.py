import json
import subprocess
import unittest
from pathlib import Path
from telemetry import analyze


class BrowserParityTests(unittest.TestCase):
    def test_python_and_browser_compute_equivalent_laps_gaps_and_distances(self):
        rows = [dict(t=t, timestamp=stamp, lap=lap, x=x, z=z, speed=100, breakBefore=cut)
                for t,stamp,lap,x,z,cut in [(0,0,0,0,0,False),(.1,100,0,3,4,False),
                    (.2,200,1,0,0,False),(.3,300,1,6,8,False),(.3,300,1,7,9,True),
                    (2,400,1,8,10,False),(2.1,1,1,0,0,False),(2.2,2,2,3,4,False)]]
        root = Path(__file__).resolve().parents[1]
        result = subprocess.run(['node','-e',"let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>process.stdout.write(JSON.stringify(require('./public/browser-core.js').analyze(JSON.parse(s)))));"],
                                input=json.dumps(rows),capture_output=True,text=True,cwd=root,check=True)
        browser = json.loads(result.stdout)
        expected = analyze(rows)
        self.assertEqual(len(browser),len(expected))
        for a,b in zip(browser,expected):
            self.assertEqual((a['id'],a['number'],a['partial']),(b['id'],b['number'],b['partial']))
            for x,y in zip(a['rows'],b['rows']):
                self.assertEqual(x['gap'],y['gap'])
                self.assertAlmostEqual(x['d'],y['d'],places=10)
                self.assertEqual(x['t'],y['t'])
