import logging
import string
import threading
import unittest

from library.i18n import MESSAGES, SUPPORTED_LANGUAGES, set_language
from library.loading_progress import LoadingStage


class LoadingProgressTest(unittest.TestCase):
    def tearDown(self):
        set_language("zh_CN")

    def test_heartbeat_reports_progress_and_stops_on_completion(self):
        set_language("en")
        logger = logging.getLogger("loading-progress-test")
        seen = threading.Event()

        class Capture(logging.Handler):
            def emit(self, record):
                if "50.0%" in record.getMessage():
                    seen.set()

        handler = Capture()
        logger.addHandler(handler)
        try:
            with self.assertLogs(logger, level="INFO") as logs:
                # assertLogs installs its own handler; attach after entering it.
                logger.addHandler(handler)
                with LoadingStage(logger, "DiT", "load_cast", interval=0.01, total=100) as stage:
                    stage.advance(50)
                    self.assertTrue(seen.wait(2), "heartbeat did not report progress")
                self.assertFalse(stage._thread.is_alive())
            self.assertIn("completed", logs.output[-1])
        finally:
            logger.removeHandler(handler)

    def test_failure_stops_thread_and_preserves_exception(self):
        set_language("en")
        logger = logging.getLogger("loading-failure-test")
        error = ValueError("bad weights")
        with self.assertLogs(logger, level="INFO") as logs:
            with self.assertRaises(ValueError) as raised:
                with LoadingStage(logger, "Qwen3", "load_assign", interval=0.01) as stage:
                    raise error
        self.assertIs(raised.exception, error)
        self.assertFalse(stage._thread.is_alive())
        self.assertIn("failed", logs.output[-1])
        self.assertNotIn("completed", "\n".join(logs.output))

    def test_loading_translations_have_matching_fields(self):
        formatter = string.Formatter()
        for key, translations in MESSAGES.items():
            if not key.startswith("load_"):
                continue
            self.assertEqual(set(translations), set(SUPPORTED_LANGUAGES))
            fields = [{field for _, field, _, _ in formatter.parse(text) if field}
                      for text in translations.values()]
            self.assertTrue(all(value == fields[0] for value in fields), key)


if __name__ == "__main__":
    unittest.main()
