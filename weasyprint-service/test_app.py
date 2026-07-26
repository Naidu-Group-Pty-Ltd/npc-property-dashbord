import socket
import unittest
from unittest.mock import patch

import app


class RestrictedUrlFetcherTests(unittest.TestCase):
    @patch("app.build_opener")
    @patch("app.socket.getaddrinfo")
    def test_allows_public_https_resource(self, getaddrinfo, build_opener):
        getaddrinfo.return_value = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]
        response = build_opener.return_value.open.return_value
        response.read.return_value = b"image"
        response.geturl.return_value = "https://images.example/image.png"
        response.info.return_value.get.return_value = None
        response.info.return_value.get_content_type.return_value = "image/png"

        result = app.restricted_url_fetcher("https://images.example/image.png")

        self.assertEqual(result["string"], b"image")
        build_opener.return_value.open.assert_called_once()

    @patch("app.build_opener")
    def test_blocks_non_https_schemes_before_fetch(self, build_opener):
        for url in ("file:///etc/passwd", "data:image/png;base64,AA==", "http://example.com/image.png"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                app.restricted_url_fetcher(url)
        build_opener.assert_not_called()

    @patch("app.build_opener")
    @patch("app.socket.getaddrinfo")
    def test_blocks_private_and_metadata_addresses(self, getaddrinfo, build_opener):
        for address in ("127.0.0.1", "10.0.0.1", "169.254.169.254", "::1"):
            getaddrinfo.return_value = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 443))]
            with self.subTest(address=address), self.assertRaises(ValueError):
                app.restricted_url_fetcher(f"https://{address}/image.png")
        build_opener.assert_not_called()

    @patch("app.socket.getaddrinfo")
    def test_blocks_redirect_to_private_address(self, getaddrinfo):
        getaddrinfo.return_value = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("169.254.169.254", 443))]
        handler = app._RestrictedRedirectHandler()
        with self.assertRaises(ValueError):
            handler.redirect_request(None, None, 302, "Found", {}, "https://169.254.169.254/latest/meta-data")


if __name__ == "__main__":
    unittest.main()
