# Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub Security Advisories for this repository. Do not include real transcripts, credentials, prompts, command lines, absolute paths, or other personal data in a report. Use synthetic reproductions.

## Privacy boundary

The plugin reads configured local metadata roots and writes one aggregate report plus an installation-local random identity key. It does not make network requests, invoke an LLM, execute discovered commands, read Claude or CodeBuddy workflow scripts/sidecars, or WorkBuddy/CodeBuddy memory, workflow, plan, or automation content, or modify agent presets. Persisted output must never contain prompt/response content, commands, tool arguments, raw events, absolute paths, usernames, or secrets; file observation times are reduced to dates.

## Supported versions

Security fixes are provided for the latest released version. Node.js 20 or newer is required.
