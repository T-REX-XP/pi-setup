#!/usr/bin/env node
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const file = path.resolve('.pi/meta/version.json');
const history = path.resolve('.pi/meta/version-history.log');

function bumpPatch(version) {
  const [major, minor, patch] = version.split('.').map((value) => Number(value || 0));
  return `${major}.${minor}.${patch + 1}`;
}

const raw = await readFile(file, 'utf8');
const data = JSON.parse(raw);
const next = bumpPatch(data.version || '0.1.0');
const timestamp = new Date().toISOString();
const nextData = { ...data, version: next, lastBump: timestamp };
await writeFile(file, JSON.stringify(nextData, null, 2) + '\n', 'utf8');
await mkdir(path.dirname(history), { recursive: true });
await appendFile(history, `${timestamp} ${next}\n`, 'utf8');
console.log(next);
