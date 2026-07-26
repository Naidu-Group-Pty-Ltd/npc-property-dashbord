import socket
import unittest
from unittest.mock import patch

import app


class ResourceUrlPolicyTests(unittest.TestCase):
    def test_allows_embedded_data_without_dns(self):
        with patch.object(app.socket, "getaddrinfo") as resolve:
            app._validate_resource_url("data:image/png;base64,AAAA")
        resolve.assert_not_called()

    @patch.object(app.socket, "getaddrinfo")
    def test_allows_public_https_host(self, resolve):
        resolve.return_value = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]
        app._validate_resource_url("https://example.com/image.png")

    @patch.object(app.socket, "getaddrinfo")
    def test_rejects_host_if_any_address_is_private(self, resolve):
        resolve.return_value = [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.8", 443)),
        ]
        with self.assertRaisesRegex(ValueError, "not public"):
            app._validate_resource_url("https://example.com/image.png")

    def test_rejects_local_and_non_network_schemes(self):
        for url in ("http://127.0.0.1/", "http://[::1]/", "file:///etc/passwd", "ftp://example.com/a"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                app._validate_resource_url(url)

    def test_rejects_redirect_before_following_private_target(self):
        handler = app.SafeRedirectHandler()
        with self.assertRaisesRegex(ValueError, "not public"):
            handler.redirect_request(None, None, 302, "Found", {}, "http://169.254.169.254/latest/meta-data")

if __name__ == "__main__":
    unittest.main()
