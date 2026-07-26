import unittest
from unittest.mock import MagicMock, patch

from weasyprint.urls import URLFetchingError

import app


class EmbeddedResourceFetcherTests(unittest.TestCase):
    def test_allows_embedded_data_urls(self):
        result = app.embedded_resource_fetcher("data:text/plain;charset=utf-8,hello")

        self.assertEqual(result["file_obj"].read(), b"hello")
        self.assertEqual(result["mime_type"], "text/plain")

    def test_blocks_network_and_local_resources(self):
        for url in (
            "https://example.com/image.png",
            "http://169.254.169.254/latest/meta-data/",
            "file:///etc/passwd",
        ):
            with self.subTest(url=url), self.assertRaises(URLFetchingError):
                app.embedded_resource_fetcher(url)


class RenderFetcherTests(unittest.TestCase):
    def setUp(self):
        self.client = app.app.test_client()

    @patch.object(app, "EXPECTED_TOKEN", "test-token")
    @patch.object(app, "HTML")
    def test_render_uses_restricted_fetcher(self, html_mock):
        document = MagicMock()
        document.write_pdf.return_value = b"%PDF-test"
        html_mock.return_value = document

        response = self.client.post(
            "/render",
            headers={"Authorization": "Bearer test-token"},
            json={"html": '<img src="http://169.254.169.254/latest/meta-data/">'},
        )

        self.assertEqual(response.status_code, 200)
        html_mock.assert_called_once_with(
            string='<img src="http://169.254.169.254/latest/meta-data/">',
            base_url=None,
            url_fetcher=app.embedded_resource_fetcher,
        )

    @patch.object(app, "EXPECTED_TOKEN", "test-token")
    @patch.object(app, "HTML")
    def test_compatibility_fallback_keeps_restricted_fetcher(self, html_mock):
        first_document = MagicMock()
        first_document.write_pdf.side_effect = TypeError("unsupported")
        fallback_document = MagicMock()
        fallback_document.write_pdf.return_value = b"%PDF-test"
        html_mock.side_effect = [first_document, fallback_document]

        response = self.client.post(
            "/render",
            headers={"Authorization": "Bearer test-token"},
            json={"html": "<p>Report</p>"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(html_mock.call_count, 2)
        for call in html_mock.call_args_list:
            self.assertIs(call.kwargs["url_fetcher"], app.embedded_resource_fetcher)


if __name__ == "__main__":
    unittest.main()
