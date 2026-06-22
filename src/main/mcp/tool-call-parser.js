function createToolCallId() {
  return `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function extractJsonObject(text) {
  let candidate = String(text || '').trimStart();
  if (!candidate) {
    return { ok: false, reason: 'missing_params_json' };
  }

  if (candidate.startsWith('```')) {
    const firstNewline = candidate.indexOf('\n');
    if (firstNewline !== -1) {
      candidate = candidate.slice(firstNewline + 1).trimStart();
      const fenceEnd = candidate.indexOf('```');
      if (fenceEnd !== -1) {
        candidate = candidate.slice(0, fenceEnd).trim();
      }
    }
  }

  const jsonStart = candidate.indexOf('{');
  if (jsonStart === -1) {
    return { ok: false, reason: 'missing_json_object' };
  }
  candidate = candidate.slice(jsonStart);

  let depth = 0;
  let end = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < candidate.length; i++) {
    const char = candidate[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
  }

  if (end === 0) {
    return { ok: false, reason: 'unclosed_json_object' };
  }

  let params;
  const candidateSlice = candidate.slice(0, end);
  try {
    params = JSON.parse(candidateSlice);
  } catch (error) {
    const repaired = repairJsonForWindowsPaths(candidateSlice);
    if (!repaired) {
      return { ok: false, reason: 'invalid_json' };
    }
    try {
      params = JSON.parse(repaired);
    } catch (_) {
      return { ok: false, reason: 'invalid_json' };
    }
  }

  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return { ok: false, reason: 'params_not_object' };
  }

  return { ok: true, params };
}

function repairJsonForWindowsPaths(jsonText) {
  const input = String(jsonText || '');
  if (!input.includes('\\')) {
    return null;
  }
  const looksLikeWindowsPath = (value) => /^[A-Za-z]:\\/.test(value) || value.startsWith('\\\\');

  const normalizePathLiteral = (raw) => {
    let out = '';
    let localChanged = false;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (ch !== '\\') {
        out += ch;
        continue;
      }
      const next = raw[i + 1];
      if (next === '\\') {
        out += '\\\\';
        i++;
        continue;
      }
      out += '\\\\';
      localChanged = true;
    }
    return { out, changed: localChanged };
  };

  const normalizeGenericLiteral = (raw) => {
    let out = '';
    let localChanged = false;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (ch !== '\\') {
        out += ch;
        continue;
      }
      const next = raw[i + 1] || '';
      if (/["\\/bfnrtu]/.test(next)) {
        out += `\\${next}`;
        i++;
        continue;
      }
      out += '\\\\';
      localChanged = true;
    }
    return { out, changed: localChanged };
  };

  let output = '';
  let changed = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch !== '"') {
      output += ch;
      continue;
    }

    output += ch;
    i++;
    let raw = '';
    let escaped = false;
    for (; i < input.length; i++) {
      const cur = input[i];
      if (!escaped && cur === '"') {
        break;
      }
      raw += cur;
      if (cur === '\\' && !escaped) {
        escaped = true;
      } else {
        escaped = false;
      }
    }

    const normalizer = looksLikeWindowsPath(raw) ? normalizePathLiteral : normalizeGenericLiteral;
    const normalized = normalizer(raw);
    changed = changed || normalized.changed;
    output += normalized.out;

    if (i < input.length && input[i] === '"') {
      output += '"';
    }
  }

  return changed ? output : null;
}

function extractLooseKeyValueObject(text) {
  let candidate = String(text || '').trimStart();
  if (!candidate) {
    return { ok: false, reason: 'missing_loose_params' };
  }

  if (candidate.startsWith('```')) {
    const firstNewline = candidate.indexOf('\n');
    if (firstNewline !== -1) {
      candidate = candidate.slice(firstNewline + 1).trimStart();
      const fenceEnd = candidate.indexOf('```');
      if (fenceEnd !== -1) {
        candidate = candidate.slice(0, fenceEnd).trim();
      }
    }
  }

  if (candidate.startsWith('{')) {
    return extractJsonObject(candidate);
  }

  if (candidate.startsWith('.')) {
    candidate = candidate.slice(1).trimStart();
  }

  const firstLine = candidate.split(/\r?\n/)[0].trim();
  if (!firstLine || !firstLine.startsWith('"')) {
    return { ok: false, reason: 'missing_loose_object_body' };
  }

  let body = firstLine;
  if (body.endsWith('}')) {
    body = body.slice(0, -1).trimEnd();
  }

  try {
    const params = JSON.parse(`{${body}}`);
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      return { ok: false, reason: 'loose_params_not_object' };
    }
    return { ok: true, params };
  } catch (_) {
    return { ok: false, reason: 'invalid_loose_json' };
  }
}

function validateParsedToolCall(server, toolName, params) {
  const tool = server.tools.get(toolName);
  if (!tool) {
    return { ok: false, reason: 'unknown_tool' };
  }

  const normalized = JSON.parse(JSON.stringify(params || {}));
  if (tool.definition.inputSchema?.properties) {
    for (const [key, prop] of Object.entries(tool.definition.inputSchema.properties)) {
      if (normalized[key] === undefined && prop.default !== undefined) {
        normalized[key] = prop.default;
      }
    }
  }

  if (tool.definition.inputSchema) {
    try {
      server.validateInput(normalized, tool.definition.inputSchema);
    } catch (error) {
      return { ok: false, reason: `schema_validation_failed:${error.message}` };
    }
  }

  return { ok: true, params: normalized };
}

function parseToolCall(server, text) {
  const source = String(text || '');
  const calls = [];
  const invalidCandidates = [];
  const acceptedKeys = new Set();
  const toolPrefix = /TOOL\s*:\s*([A-Za-z0-9_]+)/gi;
  let match;

  while ((match = toolPrefix.exec(source)) !== null) {
    const previousChar = match.index > 0 ? source[match.index - 1] : '';
    const isBoundary = !previousChar || /\s|[`"'([{<]/.test(previousChar);
    if (!isBoundary) {
      continue;
    }

    const toolName = match[1];
    const afterTool = source.slice(match.index + match[0].length);
    const parsed = extractJsonObject(afterTool);
    if (!parsed.ok) {
      invalidCandidates.push({
        toolName,
        reason: parsed.reason,
        snippet: source.slice(match.index, Math.min(source.length, match.index + 220))
      });
      continue;
    }

    const validated = validateParsedToolCall(server, toolName, parsed.params);
    if (!validated.ok) {
      invalidCandidates.push({
        toolName,
        reason: validated.reason,
        snippet: source.slice(match.index, Math.min(source.length, match.index + 220))
      });
      continue;
    }

    const acceptedKey = `${toolName}:${JSON.stringify(validated.params)}`;
    if (acceptedKeys.has(acceptedKey)) {
      continue;
    }
    acceptedKeys.add(acceptedKey);
    calls.push({
      toolName,
      params: validated.params,
      toolCallId: createToolCallId(),
      timestamp: new Date().toISOString()
    });
  }

  for (const [toolName] of server.tools) {
    const escapedTool = toolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const loosePattern = new RegExp(`\\b${escapedTool}\\b`, 'gi');
    let looseMatch;

    while ((looseMatch = loosePattern.exec(source)) !== null) {
      const before = looseMatch.index > 0 ? source[looseMatch.index - 1] : '';
      const afterStart = looseMatch.index + looseMatch[0].length;
      const after = source.slice(afterStart);

      if (before === ':') {
        continue;
      }

      const startsLikeParams = /^\s*(\{|\.)/.test(after);
      if (!startsLikeParams) {
        continue;
      }

      const parsed = extractLooseKeyValueObject(after);
      if (!parsed.ok) {
        invalidCandidates.push({
          toolName,
          reason: parsed.reason,
          snippet: source.slice(looseMatch.index, Math.min(source.length, looseMatch.index + 220))
        });
        continue;
      }

      const validated = validateParsedToolCall(server, toolName, parsed.params);
      if (!validated.ok) {
        invalidCandidates.push({
          toolName,
          reason: validated.reason,
          snippet: source.slice(looseMatch.index, Math.min(source.length, looseMatch.index + 220))
        });
        continue;
      }

      const acceptedKey = `${toolName}:${JSON.stringify(validated.params)}`;
      if (acceptedKeys.has(acceptedKey)) {
        continue;
      }
      acceptedKeys.add(acceptedKey);
      calls.push({
        toolName,
        params: validated.params,
        toolCallId: createToolCallId(),
        timestamp: new Date().toISOString()
      });
    }
  }

  server._lastInvalidToolCandidates = invalidCandidates;
  if (invalidCandidates.length > 0) {
    console.warn(`[MCP] Ignored ${invalidCandidates.length} malformed/non-executable tool candidate(s)`);
  }

  return calls;
}

module.exports = {
  parseToolCall
};
