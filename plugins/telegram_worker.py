#!/usr/bin/env python3
import argparse
import asyncio
import hashlib
import json
import os
import re
import sys
from pathlib import Path

from telethon import TelegramClient
from telethon.errors import FloodWaitError
from telethon.tl.types import DocumentAttributeFilename

SUPPORTED = {'.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.odt', '.txt', '.jpg', '.jpeg', '.png', '.webp'}


def emit(event, **data):
    print(json.dumps({'event': event, **data}, ensure_ascii=False), flush=True)


def command():
    line = sys.stdin.readline()
    if not line:
        raise SystemExit(0)
    return line.strip()


def filename(message):
    document = getattr(message, 'document', None)
    if not document:
        return None
    for attr in document.attributes:
        if isinstance(attr, DocumentAttributeFilename):
            return Path(attr.file_name).name
    return None


async def run(args):
    client = TelegramClient(args.session, args.api_id, args.api_hash)
    await client.connect()
    if not await client.is_user_authorized():
        raise RuntimeError('Telegram session is not authorized')
    entity = await client.get_entity(args.group)
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    emit('connected', group=getattr(entity, 'title', args.group))
    try:
        async for message in client.iter_messages(entity, reverse=True):
            name = filename(message)
            if not name or Path(name).suffix.lower() not in SUPPORTED:
                continue
            size = int(getattr(message.document, 'size', 0) or 0)
            if size <= 0 or size > args.max_bytes:
                continue
            emit('candidate', message_id=message.id, name=name, size=size,
                 mime_type=message.document.mime_type or 'application/octet-stream',
                 caption=(message.message or '')[:2000])
            action = await asyncio.to_thread(command)
            if action != 'download':
                emit('skipped', message_id=message.id, reason='already processed')
                continue
            safe = re.sub(r'[^A-Za-z0-9._ -]+', '_', name).strip() or f'telegram-{message.id}'
            target = output / f'{message.id}-{safe}'
            last = 0
            def progress(done, total):
                nonlocal last
                if done == total or done - last >= 1024 * 1024:
                    last = done
                    emit('progress', message_id=message.id, done=done, total=total)
            while True:
                try:
                    saved = await client.download_media(message, file=str(target), progress_callback=progress)
                    break
                except FloodWaitError as error:
                    emit('waiting', seconds=error.seconds, message_id=message.id)
                    await asyncio.sleep(error.seconds + 1)
            digest = hashlib.sha256()
            with open(saved, 'rb') as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b''):
                    digest.update(chunk)
            emit('complete', message_id=message.id, name=name, path=str(saved), size=os.path.getsize(saved),
                 sha256=digest.hexdigest(), mime_type=message.document.mime_type or 'application/octet-stream',
                 caption=(message.message or '')[:2000])
            await asyncio.to_thread(command)
        emit('done')
    finally:
        await client.disconnect()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--api-id', type=int, required=True)
    parser.add_argument('--api-hash', required=True)
    parser.add_argument('--session', required=True)
    parser.add_argument('--group', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--max-bytes', type=int, required=True)
    asyncio.run(run(parser.parse_args()))
