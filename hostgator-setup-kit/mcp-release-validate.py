#!/usr/bin/env python3
"""Fail closed on an incomplete or mismatched MCP release asset."""
import json
import re
import sys


def valid(path: str, tag: str, sha: str, app: str) -> bool:
    try:
        with open(path, encoding="utf-8") as stream:
            release = json.load(stream)
        version = tag.removeprefix("v").removesuffix("-mcp")
        expected = {
            "app": app,
            "worker": app.rsplit("/", 1)[0] + "/deskcomm-worker",
            "scheduler": app.rsplit("/", 1)[0] + "/deskcomm-scheduler",
            "voice_agent": app.rsplit("/", 1)[0] + "/deskcomm-voice-agent",
        }
        if release["schema_version"] != 1 or release["deskcomm_version"] != version:
            return False
        if release["tag"] != tag or release["mcp_commit"] != sha:
            return False
        if release["tests"] != "passed" or release["gaps_a"] != 0:
            return False
        if not isinstance(release["tool_count_snapshot"], int) or release["tool_count_snapshot"] < 1:
            return False
        for role, repository in expected.items():
            image = release["images"][role]
            if image["repository"] != repository:
                return False
            if image["tag"] != version + "-mcp":
                return False
            if not re.fullmatch(r"sha256:[a-f0-9]{64}", image["digest"]):
                return False
        return True
    except (KeyError, ValueError, TypeError, OSError):
        return False


if __name__ == "__main__":
    if len(sys.argv) != 5 or not valid(*sys.argv[1:]):
        print("Manifesto MCP ausente ou inválido", file=sys.stderr)
        sys.exit(1)
