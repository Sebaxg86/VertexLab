import json
import socket
import struct
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server
from telemetry import decode, analyze

def packet():
    b=bytearray(324)
    struct.pack_into('<iI',b,0,1,12345)
    struct.pack_into('<fff',b,244,10,20,30)
    struct.pack_into('<f',b,256,25)
    struct.pack_into('<fff',b,300,60,5,125)
    struct.pack_into('<H',b,312,2)
    b[315]=255
    b[316]=128
    return b

class Tests(unittest.TestCase):
    def test_layout(self):
        r=decode(packet())
        self.assertEqual((r['x'],r['z'],r['speed'],r['lap'],r['lapTime'],r['raceTime']),(10,30,90,2,5,125))
        self.assertEqual(r['throttle'],100)
        self.assertAlmostEqual(r['brake'],128/255*100)
        with self.assertRaises(ValueError): decode(bytes(323))
        b=packet();struct.pack_into('<f',b,244,float('nan'))
        with self.assertRaises(ValueError): decode(b)

    def test_distance_and_gap(self):
        rows=[]
        for i,(x,z,t,lap) in enumerate([(0,0,0,0),(3,4,.1,0),(500,4,2,0),(0,0,3,1),(3,4,3.1,1),(0,0,4,2)]):
            rows.append(dict(decode(packet()),x=x,z=z,t=t,lap=lap,timestamp=i))
        laps=analyze(rows)
        self.assertEqual(laps[0]['rows'][1]['d'],5)
        self.assertEqual(laps[0]['rows'][2]['d'],5)
        self.assertTrue(laps[0]['rows'][2]['gap'])
        self.assertFalse(laps[1]['partial'])

    def test_udp_record_reload_sync(self):
        with tempfile.TemporaryDirectory() as tmp:
            server.DATA=Path(tmp)
            http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
            threading.Thread(target=http.serve_forever,daemon=True).start()
            probe=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);probe.bind(('127.0.0.1',0));port=probe.getsockname()[1];probe.close()
            threading.Thread(target=server.receive,args=('127.0.0.1',port),daemon=True).start()
            base=f'http://127.0.0.1:{http.server_port}/api/'
            def request(route,body=None):
                req=urllib.request.Request(base+route,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'})
                with urllib.request.urlopen(req) as r:return json.load(r)
            try:
                sid=request('start',{'name':'SYNTHETIC TEST ONLY'})['id']
                sender=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
                for _ in range(3):sender.sendto(packet(),('127.0.0.1',port));time.sleep(.02)
                sender.sendto(b'bad',('127.0.0.1',port));sender.close()
                time.sleep(.1)
                request('stop',{})
                data=request('sessions/'+sid)
                self.assertEqual(len(data['laps'][0]['rows']),3)
                self.assertGreaterEqual(request('status')['invalid'],1)
                request('sync/'+sid,{'offset':2.5})
                self.assertEqual(request('sessions/'+sid)['meta']['offset'],2.5)
                self.assertEqual(len(request('sessions')),1)
            finally:http.shutdown();http.server_close()

if __name__=='__main__': unittest.main()
