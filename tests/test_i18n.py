import argparse
from pathlib import Path
import string
import tempfile
import unittest
from unittest import mock

from library.i18n import (
    MESSAGES,
    SUPPORTED_LANGUAGES,
    get_language,
    normalize_language,
    set_language,
    tr,
)
from library.utils import add_logging_arguments
from library import train_util


class I18nTest(unittest.TestCase):
    def tearDown(self):
        set_language("zh_CN")

    def test_chinese_is_default(self):
        set_language(None)
        self.assertEqual("zh_CN", get_language())
        self.assertEqual(
            "已启用 cache_latents_to_disk，因此同时启用 cache_latents",
            tr("cache_latents_to_disk_enabled"),
        )

    def test_language_aliases(self):
        self.assertEqual("zh_CN", normalize_language("zh-CN"))
        self.assertEqual("en", normalize_language("en-US"))
        self.assertEqual("ja", normalize_language("ja-JP"))
        self.assertEqual("zh_CN", normalize_language("unsupported"))

    def test_runtime_language_switch(self):
        set_language("en")
        self.assertEqual("Loading dataset config from dataset.toml", tr("loading_dataset_config", path="dataset.toml"))
        set_language("ja")
        self.assertIn("dataset.toml", tr("loading_dataset_config", path="dataset.toml"))

    def test_every_message_has_all_languages_and_matching_placeholders(self):
        formatter = string.Formatter()
        for message_id, translations in MESSAGES.items():
            self.assertEqual(set(SUPPORTED_LANGUAGES), set(translations), message_id)
            placeholder_sets = []
            for language in SUPPORTED_LANGUAGES:
                placeholders = {
                    field_name
                    for _, field_name, _, _ in formatter.parse(translations[language])
                    if field_name is not None
                }
                placeholder_sets.append(placeholders)
            self.assertTrue(all(fields == placeholder_sets[0] for fields in placeholder_sets), message_id)

    def test_cli_argument_defaults_to_chinese(self):
        set_language("zh_CN")
        parser = argparse.ArgumentParser()
        add_logging_arguments(parser)
        self.assertEqual("zh_CN", parser.parse_args([]).console_log_language)
        self.assertEqual("en", parser.parse_args(["--console_log_language", "en"]).console_log_language)

    def test_config_file_selects_language_before_training_starts(self):
        parser = argparse.ArgumentParser()
        add_logging_arguments(parser)
        parser.add_argument("--config_file")
        parser.add_argument("--output_config", action="store_true")
        parser.add_argument("--wandb_api_key")

        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = Path(tmpdir) / "config.toml"
            config_path.write_text('[training_arguments]\nconsole_log_language = "en"\n', encoding="utf-8")
            args = parser.parse_args(["--config_file", str(config_path)])
            with mock.patch("sys.argv", ["test_i18n", "--config_file", str(config_path)]):
                loaded = train_util.read_config_from_file(args, parser)

        self.assertEqual("en", loaded.console_log_language)
        self.assertEqual("en", get_language())


if __name__ == "__main__":
    unittest.main()
