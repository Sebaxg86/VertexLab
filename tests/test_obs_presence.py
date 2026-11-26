import unittest
from unittest.mock import Mock, call
from obs_control import OBS


class OBSConnectionPresenceTests(unittest.TestCase):
    def test_read_only_probe_restores_the_capture_timeout(self):
        obs = OBS()
        socket = Mock()
        socket.gettimeout.return_value = 2
        obs.ws = socket
        obs.request = Mock(return_value={})
        self.assertTrue(obs.probe_connection())
        obs.request.assert_called_once_with('GetVersion')
        self.assertEqual(socket.settimeout.call_args_list, [call(.25), call(2)])
        self.assertIs(obs.ws, socket)

    def test_closed_obs_cannot_keep_a_green_connection_status(self):
        obs = OBS()
        socket = Mock()
        obs.ws = socket
        obs.request = Mock(side_effect=ValueError('closed'))
        self.assertFalse(obs.probe_connection())
        self.assertFalse(obs.status()['connected'])
        socket.close.assert_called_once()
        self.assertIn('OBS', obs.error)
