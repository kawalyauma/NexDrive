#!/usr/bin/env python3
import argparse
import asyncio
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

SUPPORTED = {'.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.odt', '.txt'}


def github_headers():
    headers = {'User-Agent': 'Notesug-NexDrive/1.0', 'Accept': 'application/vnd.github+json'}
    token = os.environ.get('GITHUB_TOKEN', '').strip()
    credential_file = os.environ.get('GITHUB_CREDENTIAL_FILE', '').strip()
    if not token and credential_file and os.path.isfile(credential_file):
        try:
            parsed = urllib.parse.urlparse(Path(credential_file).read_text().strip())
            if parsed.hostname == 'github.com':
                token = urllib.parse.unquote(parsed.password or '')
        except (OSError, ValueError):
            pass
    if token:
        headers['Authorization'] = f'Bearer {token}'
    return headers


def emit(event, **data):
    print(json.dumps({'event': event, **data}, ensure_ascii=False), flush=True)


def command():
    line = sys.stdin.readline()
    if not line:
        raise SystemExit(0)
    return line.strip()


def git(*args):
    return subprocess.check_output(['git', *args], text=True, stderr=subprocess.STDOUT).strip()


def download(url, target, repo, path):
    digest = hashlib.sha256()
    done = 0
    last = 0
    request = urllib.request.Request(url, headers={'User-Agent': 'Notesug-NexDrive/1.0'})
    with urllib.request.urlopen(request, timeout=120) as response, open(target, 'wb') as output:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            output.write(chunk)
            digest.update(chunk)
            done += len(chunk)
            if done - last >= 1024 * 1024:
                last = done
                emit('progress', repo=repo, path=path, done=done)
    return done, digest.hexdigest()


async def scan_repo(args, repo, branch, license_name):
    remote = f'https://github.com/Fresh-Teacher/{repo}.git'
    commit = git('ls-remote', remote, f'refs/heads/{branch}').split()[0]
    emit('repo', repo=repo, branch=branch, license=license_name, commit=commit)
    action = await asyncio.to_thread(command)
    if action == 'unchanged':
        return
    tree_url = f'https://api.github.com/repos/Fresh-Teacher/{urllib.parse.quote(repo)}/git/trees/{commit}?recursive=1'
    request = urllib.request.Request(tree_url, headers=github_headers())
    with urllib.request.urlopen(request, timeout=120) as response:
        tree = json.load(response)
    if tree.get('truncated'):
        raise RuntimeError(f'GitHub tree for {repo} was truncated')
    for item in tree.get('tree', []):
        if item.get('type') != 'blob':
            continue
        path = item.get('path', '')
        if Path(path).suffix.lower() not in SUPPORTED:
            continue
        try:
            size = int(item.get('size') or 0)
        except (TypeError, ValueError):
            continue
        if size <= 0 or size > args.max_bytes:
            emit('ignored', repo=repo, path=path, reason='size', size=size)
            continue
        blob_sha = item.get('sha', '')
        emit('candidate', repo=repo, branch=branch, license=license_name, commit=commit,
             path=path, blob_sha=blob_sha, name=Path(path).name, size=size)
        if await asyncio.to_thread(command) != 'download':
            continue
        safe = re.sub(r'[^A-Za-z0-9._ -]+', '_', Path(path).name).strip() or blob_sha
        target = Path(args.output) / f'{repo}-{blob_sha[:12]}-{safe}'
        url = f'https://raw.githubusercontent.com/Fresh-Teacher/{urllib.parse.quote(repo)}/{commit}/{urllib.parse.quote(path, safe="/")}'
        actual_size, sha256 = await asyncio.to_thread(download, url, target, repo, path)
        emit('complete', repo=repo, branch=branch, license=license_name, commit=commit,
             path=path, blob_sha=blob_sha, name=Path(path).name, size=actual_size,
             sha256=sha256, mime_type='application/octet-stream', local_path=str(target))
        await asyncio.to_thread(command)
    emit('repo_complete', repo=repo, commit=commit)


def public_repositories():
    result = []
    page = 1
    while True:
        url = f'https://api.github.com/users/Fresh-Teacher/repos?per_page=100&page={page}'
        request = urllib.request.Request(url, headers=github_headers())
        with urllib.request.urlopen(request, timeout=120) as response:
            repos = json.load(response)
        for repo in repos:
            license_info = repo.get('license') or {}
            result.append((repo['name'], repo.get('default_branch') or 'main',
                           license_info.get('spdx_id') or 'NONE'))
        if len(repos) < 100:
            return result
        page += 1


async def run(args):
    repos = []
    for value in args.repos.split(','):
        parts = value.strip().split(':', 2)
        if len(parts) == 3:
            repos.append(tuple(parts))
    if not repos:
        raise RuntimeError('No Fresh Teacher repositories configured')
    Path(args.output).mkdir(parents=True, exist_ok=True)
    while True:
        selected = repos
        if args.mode == 'all_downloads':
            try:
                selected = await asyncio.to_thread(public_repositories)
            except Exception as error:
                emit('repo_error', repo='Fresh-Teacher', error=f'Could not list repositories: {error}'[:1000])
                selected = []
        for repo, branch, license_name in selected:
            try:
                await scan_repo(args, repo, branch, license_name)
            except Exception as error:
                emit('repo_error', repo=repo, error=str(error)[:1000])
        emit('idle', seconds=args.poll_seconds)
        await asyncio.sleep(args.poll_seconds)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--repos', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--max-bytes', type=int, required=True)
    parser.add_argument('--poll-seconds', type=int, default=900)
    parser.add_argument('--mode', choices=('licensed_downloads', 'all_downloads'), default='licensed_downloads')
    asyncio.run(run(parser.parse_args()))
