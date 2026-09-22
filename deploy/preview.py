#!/usr/bin/env python3
"""PR Cloud Run preview helpers for Floor Tape.

Pure functions only. Shell and GitHub Actions call the CLI.
Production service name `floor-tape` is never a legal preview target.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Any
from urllib.parse import urlparse

PRODUCTION_SERVICE = "floor-tape"
PROTECTED_NAMES = frozenset({PRODUCTION_SERVICE})
COMMENT_MARKER = "<!-- floor-tape-pr-preview -->"
_SERVICE_RE = re.compile(r"^floor-tape-pr-[1-9][0-9]*$")
_SHA_RE = re.compile(r"^[0-9a-f]+$")


class PreviewError(ValueError):
    pass


def parse_pr_number(value: object) -> int:
    if isinstance(value, bool) or value is None:
        raise PreviewError(f"invalid pull request number: {value!r}")
    if isinstance(value, int):
        number = value
    elif isinstance(value, str) and value.strip().isdigit():
        number = int(value.strip())
    else:
        raise PreviewError(f"invalid pull request number: {value!r}")
    if number < 1:
        raise PreviewError("pull request number must be >= 1")
    return number


def assert_safe_preview_target(name: object) -> str:
    if not isinstance(name, str) or not name.strip():
        raise PreviewError("Cloud Run service name is required")
    trimmed = name.strip()
    if trimmed.lower() in PROTECTED_NAMES:
        raise PreviewError(f"refusing to mutate production Cloud Run name {trimmed!r}")
    if not _SERVICE_RE.fullmatch(trimmed):
        raise PreviewError(f"not a PR preview service name: {trimmed!r}")
    return trimmed


def service_name(pr_number: object) -> str:
    name = f"floor-tape-pr-{parse_pr_number(pr_number)}"
    if len(name) > 63:
        raise PreviewError(f"Cloud Run service name exceeds 63 characters: {name}")
    return assert_safe_preview_target(name)


def image_tag(pr_number: object, git_sha: str) -> str:
    number = parse_pr_number(pr_number)
    sha = (git_sha or "").strip().lower()
    if len(sha) < 7 or not _SHA_RE.fullmatch(sha):
        raise PreviewError("git sha required (hex, at least 7 chars)")
    return f"pr-{number}-{sha[:7]}"


def assert_preview_image(image: str) -> str:
    if not isinstance(image, str) or not image.strip():
        raise PreviewError("preview image is required")
    image = image.strip()
    repo_tag = image.rsplit("/", 1)[-1]
    if ":" not in repo_tag:
        raise PreviewError("preview image must include a PR-specific tag, not latest")
    tag = repo_tag.split(":", 1)[1]
    if tag in {"", "latest"}:
        raise PreviewError("preview image must be a PR-specific tag, not latest")
    return image


def preview_https_url(service: str, project_number: object, region: str) -> str:
    name = assert_safe_preview_target(service)
    number = str(project_number).strip()
    if not number.isdigit():
        raise PreviewError(f"invalid GCP project number: {project_number!r}")
    region = (region or "").strip()
    if not region:
        raise PreviewError("region is required")
    return f"https://{name}-{number}.{region}.run.app"


def _require_https_url(url: str) -> str:
    if not isinstance(url, str) or not url.strip():
        raise PreviewError("preview URL is required")
    url = url.strip().rstrip("/")
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
        raise PreviewError(f"preview URL must be https://... : {url!r}")
    if " " in url or "\n" in url:
        raise PreviewError("preview URL must not contain whitespace")
    return url


def comment_body(pr_number: object, url: str) -> str:
    number = parse_pr_number(pr_number)
    url = _require_https_url(url)
    name = service_name(number)
    return (
        f"{COMMENT_MARKER}\n"
        f"### Preview environment\n\n"
        f"PR **#{number}** is deployed as Cloud Run service `{name}`:\n\n"
        f"**{url}**\n\n"
        f"`/health` is the probe. The first page load ingests filings into ephemeral "
        f"PGLite on that instance. This URL stays the same for the life of the PR; "
        f"later pushes replace the image in place.\n\n"
        f"Closing or merging this PR deletes `{name}` and does not change production "
        f"`floor-tape`.\n"
    )


def destroyed_comment_body(pr_number: object) -> str:
    number = parse_pr_number(pr_number)
    name = service_name(number)
    return (
        f"{COMMENT_MARKER}\n"
        f"Preview Cloud Run service `{name}` has been deleted "
        f"(PR #{number} closed or merged).\n"
    )


def _as_comment_list(payload: object) -> list[dict[str, Any]]:
    if isinstance(payload, str):
        payload = json.loads(payload)
    if isinstance(payload, dict):
        if "id" in payload and "body" in payload:
            return [payload]
        for key in ("data", "comments"):
            if isinstance(payload.get(key), list):
                return _as_comment_list(payload[key])
        raise PreviewError("comments JSON must be an array of comments")
    if not isinstance(payload, list):
        raise PreviewError("comments JSON must be an array")
    comments: list[dict[str, Any]] = []
    for item in payload:
        if isinstance(item, dict):
            comments.append(item)
    return comments


def upsert_comment_action(comments: object, marker: str = COMMENT_MARKER) -> str:
    for comment in _as_comment_list(comments):
        body = comment.get("body") or ""
        if marker in str(body):
            cid = comment.get("id")
            if cid is None:
                raise PreviewError("matching comment missing id")
            return f"update {int(cid)}"
    return "create"


def _gcloud_base(project: str, region: str) -> list[str]:
    if not project or not region:
        raise PreviewError("project and region are required")
    if project.strip() in {"", "(unset)"}:
        raise PreviewError("project is required")
    return ["gcloud", "--project", project.strip(), "--quiet"]


def deploy_argv(pr_number: object, image: str, project: str, region: str) -> list[str]:
    name = service_name(pr_number)
    image = assert_preview_image(image)
    region = region.strip()
    return [
        *_gcloud_base(project, region),
        "run",
        "deploy",
        name,
        "--image",
        image,
        "--region",
        region,
        "--platform",
        "managed",
        "--allow-unauthenticated",
        "--port",
        "8080",
        "--memory",
        "1Gi",
        "--cpu",
        "1",
        "--min-instances",
        "0",
        "--max-instances",
        "1",
        "--concurrency",
        "8",
        "--timeout",
        "300",
        "--service-account",
        f"floor-tape-run@{project.strip()}.iam.gserviceaccount.com",
        "--set-env-vars",
        "HOST=0.0.0.0",
        "--labels",
        f"floor-tape-preview=true,pr-number={parse_pr_number(pr_number)}",
    ]


def delete_argv(pr_number: object, project: str, region: str) -> list[str]:
    name = service_name(pr_number)
    region = region.strip()
    return [
        *_gcloud_base(project, region),
        "run",
        "services",
        "delete",
        name,
        "--region",
        region,
    ]


def describe_argv(pr_number: object, project: str, region: str) -> list[str]:
    name = service_name(pr_number)
    region = region.strip()
    return [
        *_gcloud_base(project, region),
        "run",
        "services",
        "describe",
        name,
        "--region",
        region,
        "--format",
        "value(status.url)",
    ]


def _print_lines(argv: list[str]) -> None:
    for part in argv:
        if part == PRODUCTION_SERVICE or part.startswith(f"{PRODUCTION_SERVICE}@"):
            raise PreviewError(f"refusing production name in argv: {part}")
        print(part)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="preview.py")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("service-name").add_argument("pr")
    safe = sub.add_parser("assert-safe")
    safe.add_argument("name")

    tag = sub.add_parser("image-tag")
    tag.add_argument("--pr", required=True)
    tag.add_argument("--sha", required=True)

    comment = sub.add_parser("comment-payload")
    comment.add_argument("--pr", required=True)
    comment.add_argument("--url", required=True)

    destroyed = sub.add_parser("destroyed-comment-payload")
    destroyed.add_argument("--pr", required=True)

    upsert = sub.add_parser("upsert-comment")
    upsert.add_argument("--comments-json", required=True)

    for name in ("deploy-args", "delete-args", "describe-args"):
        cmd = sub.add_parser(name)
        cmd.add_argument("--pr", required=True)
        cmd.add_argument("--project", required=True)
        cmd.add_argument("--region", required=True)
        if name == "deploy-args":
            cmd.add_argument("--image", required=True)
        cmd.add_argument("--format", choices=("lines",), default="lines")

    args = parser.parse_args(argv)
    try:
        if args.cmd == "service-name":
            print(service_name(args.pr))
        elif args.cmd == "assert-safe":
            print(assert_safe_preview_target(args.name))
        elif args.cmd == "image-tag":
            print(image_tag(args.pr, args.sha))
        elif args.cmd == "comment-payload":
            print(json.dumps({"body": comment_body(args.pr, args.url)}))
        elif args.cmd == "destroyed-comment-payload":
            print(json.dumps({"body": destroyed_comment_body(args.pr)}))
        elif args.cmd == "upsert-comment":
            with open(args.comments_json, encoding="utf-8") as handle:
                print(upsert_comment_action(handle.read()))
        elif args.cmd == "deploy-args":
            _print_lines(deploy_argv(args.pr, args.image, args.project, args.region))
        elif args.cmd == "delete-args":
            _print_lines(delete_argv(args.pr, args.project, args.region))
        elif args.cmd == "describe-args":
            _print_lines(describe_argv(args.pr, args.project, args.region))
        else:
            parser.error(args.cmd)
    except PreviewError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
