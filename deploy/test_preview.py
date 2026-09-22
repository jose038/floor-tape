#!/usr/bin/env python3
"""Safety checks for Floor Tape PR preview naming and gcloud argv."""
from __future__ import annotations

import json
import unittest

from preview import (
    COMMENT_MARKER,
    PRODUCTION_SERVICE,
    PreviewError,
    assert_preview_image,
    assert_safe_preview_target,
    comment_body,
    deploy_argv,
    destroyed_comment_body,
    image_tag,
    service_name,
    upsert_comment_action,
)


class PreviewSafetyTest(unittest.TestCase):
    def test_service_name(self) -> None:
        self.assertEqual(service_name(12), "floor-tape-pr-12")
        self.assertEqual(service_name("7"), "floor-tape-pr-7")

    def test_refuses_production_and_junk(self) -> None:
        for name in (PRODUCTION_SERVICE, "floor-tape", "cardflow", "floor-tape-pr-0", "floor-tape-pr-"):
            with self.assertRaises(PreviewError):
                assert_safe_preview_target(name)

    def test_image_tag_is_not_latest(self) -> None:
        self.assertEqual(image_tag(4, "abcdef123456"), "pr-4-abcdef1")
        with self.assertRaises(PreviewError):
            assert_preview_image(
                "europe-west2-docker.pkg.dev/j-proj-310112/floor-tape/app:latest"
            )
        image = "europe-west2-docker.pkg.dev/j-proj-310112/floor-tape/app:pr-4-abcdef1"
        self.assertEqual(assert_preview_image(image), image)

    def test_deploy_argv_targets_only_the_preview(self) -> None:
        argv = deploy_argv(
            4,
            "europe-west2-docker.pkg.dev/j-proj-310112/floor-tape/app:pr-4-abcdef1",
            "j-proj-310112",
            "europe-west2",
        )
        self.assertEqual(argv[0], "gcloud")
        self.assertIn("floor-tape-pr-4", argv)
        self.assertNotIn(PRODUCTION_SERVICE, argv)
        self.assertIn("--allow-unauthenticated", argv)
        self.assertIn("--min-instances", argv)
        self.assertIn("0", argv)
        self.assertIn("--max-instances", argv)

    def test_comment_round_trip(self) -> None:
        url = "https://floor-tape-pr-4-686007662332.europe-west2.run.app"
        body = comment_body(4, url)
        self.assertIn(COMMENT_MARKER, body)
        self.assertIn(url, body)
        self.assertIn("floor-tape", body)
        comments = [{"id": 9, "body": "unrelated"}, {"id": 15, "body": body}]
        self.assertEqual(upsert_comment_action(json.dumps(comments)), "update 15")
        self.assertEqual(upsert_comment_action([]), "create")
        destroyed = destroyed_comment_body(4)
        self.assertIn("deleted", destroyed)
        self.assertIn(COMMENT_MARKER, destroyed)


if __name__ == "__main__":
    unittest.main()
